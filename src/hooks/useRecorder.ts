'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RecordingMetadata, RecordingState } from '@/types';
import {
  selectRecordingCodec,
  bitrateForDimensions,
  RECORDING_AUDIO_BITRATE,
} from '@/lib/recording/codec-capability';
import { readTrackCaptureInfo, readTrackCaptureMetadata, readTrackCaptureCapabilities } from '@/lib/recording/capture-constraints';
import { getBestRecordingProfile, profileForActualCapture } from '@/lib/recording-profiles';
import { inspectRecordedContainer, recordRecordingDiagnostic } from '@/lib/recording/diagnostics';
import type { RecordingRecoverySink } from '@/lib/recording/recovery';

interface RecordingResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  duration: number;
  hasAudio: boolean;
  /**
   * The ACTUAL capture geometry the track reported when the take began —
   * a better fallback for downstream consumers than the configured platform
   * target, which the track may never deliver.
   */
  width: number;
  height: number;
  metadata: RecordingMetadata;
}

/**
 * The recording configuration ACTUALLY in force for the current take
 * (Phase 4: the UI never displays values that are not really being used —
 * codec and bitrates here are what the MediaRecorder was constructed with,
 * and the capture geometry shown next to it comes from the track, not a
 * target).
 */
export interface RecordingFormat {
  mimeType: string;
  extension: string;
  configuredVideoBitrate: number;
  actualVideoBitrate: number | null;
  configuredAudioBitrate: number;
  actualAudioBitrate: number | null;
  /** Compatibility alias for older internal consumers; same as configuredVideoBitrate. */
  videoBitsPerSecond: number;
  /** Compatibility alias for older internal consumers; same as configuredAudioBitrate. */
  audioBitsPerSecond: number;
}

/**
 * Chunk cadence (Phase 8). 1000 ms keeps the per-chunk overhead (blob
 * wrappers, IndexedDB writes, upload-free local copy) far below the encoding
 * rate, while capping at roughly one second what a crash/refresh can destroy.
 * Chunks accumulate only in a ref; the final Blob is assembled once at stop.
 */
const CHUNK_INTERVAL_MS = 1000;

/**
 * The recovery copy is best-effort BY CONTRACT: no sink failure — throw,
 * rejected write, missing storage — may ever reach the capture state machine.
 * Every sink entry point is funneled through here.
 */
function safeSinkCall(fn: () => void): void {
  try {
    fn();
  } catch {
    // Recovery copy failure is never a recording failure (Phase 9/14).
  }
}

export interface StartRecordingOptions {
  /**
   * Run the 3-2-1 countdown before capture begins. The studio passes the
   * user's countdown setting here; when false, capture starts immediately
   * with no artificial wait (and no `countdown` state at all).
   */
  countdown?: boolean;
  /**
   * Called ONCE when the teleprompter's end-check stops the take (DC-2).
   * Manual stop / pause / reset never reach this callback — the end-check
   * interval is cleared before those paths can fire it.
   */
  onScriptEnd?: () => void;
  /**
   * Called when capture fails to start (MediaRecorder construction/start
   * throws, or no supported recording codec exists). The message is already
   * human-readable — the hook never exposes the raw exception.
   */
  onError?: (message: string) => void;
  /**
   * Local recovery copy (Phase 9). When provided, every chunk is written to
   * it as it arrives and the session is cleared when the take ends in this
   * document. A crash/refresh mid-take leaves the rows behind for the
   * recovery policy on the next visit. Its failure NEVER blocks recording.
   */
  recovery?: RecordingRecoverySink;
}

export function useRecorder(stream: MediaStream | null) {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [videoUrl, setVideoUrl] = useState('');
  const [countdownText, setCountdownText] = useState('');
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null);
  const [recordingFormat, setRecordingFormat] = useState<RecordingFormat | null>(null);

  const streamRef = useRef<MediaStream | null>(stream);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkEndRef = useRef<(() => boolean) | null>(null);
  const onScriptEndRef = useRef<(() => void) | null>(null);
  // Pause-aware capture clock (see `computeDurationSeconds` below).
  const segmentStartRef = useRef<number>(0);
  const activeMsRef = useRef<number>(0);
  const inPauseRef = useRef<boolean>(false);
  const videoUrlRef = useRef('');
  const startedAtPerformanceRef = useRef<number | null>(null);
  const stopRequestedAtRef = useRef<number | null>(null);
  const stopRequestedPerformanceRef = useRef<number | null>(null);
  const recordingStateRef = useRef<RecordingState>('idle');
  // Last tick of the teleprompter scroll loop — the loop advances by ELAPSED
  // time (dt), not by a fixed per-tick increment, so background-tab timer
  // throttling (Chrome clamps timers to ≥1s when hidden) preserves the
  // configured characters-per-second instead of nearly freezing the prompter.
  const lastScrollTickRef = useRef<number>(0);

  // Per-take identity. MediaRecorder callbacks are asynchronous: a recorder
  // stopped by reset/unmount can still fire `onstop` after a NEW take has
  // begun, and without this guard it would assemble the new take's chunks
  // into the old take's result (or resurrect a discarded one).
  const takeIdRef = useRef(0);
  const finalizedRef = useRef<(() => void) | null>(null);
  const activeRecoveryRef = useRef<RecordingRecoverySink | null>(null);
  // Set on unmount. The document no longer has a place to put the result, so
  // a late `onstop` must not finalize (or delete the recovery rows — they are
  // the only remaining copy of the take).
  const disposedRef = useRef(false);

  recordingStateRef.current = recordingState;

  const beforeUnloadRef = useRef<((e: BeforeUnloadEvent) => void) | null>(null);

  const dropBeforeUnload = useCallback(() => {
    if (beforeUnloadRef.current) {
      window.removeEventListener('beforeunload', beforeUnloadRef.current);
      beforeUnloadRef.current = null;
    }
  }, []);

  // Keep stream ref in sync
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  // Stop an ACTIVE take when the stream changes (device switch).
  // Review ('completed') and idle states are immune: a camera re-acquire for
  // the NEXT take must not kill the countdown the new take just started,
  // and device switches must not discard a finished review.
  // Proven by live probe: re-init during review cleared the countdown
  // interval and reset state, so the second take silently never started.
  useEffect(() => {
    const active = recordingStateRef.current === 'recording' || recordingStateRef.current === 'paused' || recordingStateRef.current === 'countdown';
    if (stream && active) {
      try {
        if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
          stopRequestedAtRef.current = Date.now();
          stopRequestedPerformanceRef.current = performance.now();
          mediaRecorderRef.current.stop();
        }
      } catch { /* ignore */ }
      if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
      if (countIntervalRef.current) clearInterval(countIntervalRef.current);
      if (endCheckIntervalRef.current) clearInterval(endCheckIntervalRef.current);
      scrollIntervalRef.current = null;
      countIntervalRef.current = null;
      endCheckIntervalRef.current = null;
      mediaRecorderRef.current = null;
      // The countdown now carries the navigation guard too — a stream switch
      // that aborts the countdown must drop it, or a cancelled take would
      // keep prompting "leave site?" on every later navigation.
      dropBeforeUnload();
      setRecordingState('idle');
      setCountdownText('');
    }
  }, [stream, dropBeforeUnload]);

  useEffect(() => {
    // StrictMode re-runs mount effects on the same instance (cleanup → setup),
    // so the flag starts false on every setup, not just the first one.
    disposedRef.current = false;
    return () => {
      // Unmount is NOT a take end the document can keep: the finalized result
      // has nowhere to go. Invalidate the take and leave the recovery rows in
      // place so the next visit can offer the take (the recovery copy exists
      // for exactly this). Calling finish() here would delete the only copy.
      disposedRef.current = true;
      takeIdRef.current += 1;
      finalizedRef.current = null;
      dropBeforeUnload();
      try {
        if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
          stopRequestedAtRef.current = Date.now();
          stopRequestedPerformanceRef.current = performance.now();
          mediaRecorderRef.current.stop();
        }
      } catch { /* ignore */ }
      if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
      if (countIntervalRef.current) clearInterval(countIntervalRef.current);
      if (endCheckIntervalRef.current) clearInterval(endCheckIntervalRef.current);
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      activeRecoveryRef.current = null;
      chunksRef.current = [];
      mediaRecorderRef.current = null;
    };
  }, [dropBeforeUnload]);

  const revokeUrls = useCallback(() => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = '';
    setVideoUrl('');
  }, []);

  const clearCountdownInterval = useCallback(() => {
    if (countIntervalRef.current) {
      clearInterval(countIntervalRef.current);
      countIntervalRef.current = null;
    }
  }, []);

  const clearRecordingIntervals = useCallback(() => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
    if (endCheckIntervalRef.current) {
      clearInterval(endCheckIntervalRef.current);
      endCheckIntervalRef.current = null;
    }
  }, []);

  /**
   * The take's recorded duration is ACTIVE capture time: wall clock from
   * start() to stop() would bill the user for every paused second (the timer
   * display, the Free daily budget and the stored duration must all exclude
   * pauses). `activeMsRef` banks each completed active segment; the current
   * segment is only counted while `inPauseRef` is false.
   */
  const computeDurationSeconds = useCallback(() => {
    const currentSegmentMs = inPauseRef.current ? 0 : Math.max(0, Date.now() - segmentStartRef.current);
    return Math.max(0, (activeMsRef.current + currentSegmentMs) / 1000);
  }, []);

  /** Navigation guard while a take is being captured (or counted down to). */
  const registerBeforeUnload = useCallback(() => {
    if (beforeUnloadRef.current) return;
    beforeUnloadRef.current = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnloadRef.current);
  }, []);

  /**
   * Watches for the teleprompter reaching its end and stops the take (DC-2).
   * This is the ONLY stop path allowed to announce itself: it is armed only
   * while capturing and cleared by stop/pause/reset before those paths run,
   * so an ordinary manual Stop can never produce the "Script ended" toast.
   */
  const armEndCheck = useCallback(() => {
    endCheckIntervalRef.current = setInterval(() => {
      if (checkEndRef.current?.()) {
        clearRecordingIntervals();
        // This stop does not pass through stopRecording(), so the navigation
        // guard has to be dropped here too.
        dropBeforeUnload();
        onScriptEndRef.current?.();
        if (mediaRecorderRef.current?.state === 'recording' ||
            mediaRecorderRef.current?.state === 'paused') {
          stopRequestedAtRef.current = Date.now();
          stopRequestedPerformanceRef.current = performance.now();
          mediaRecorderRef.current.stop();
        }
      }
    }, 200);
  }, [clearRecordingIntervals, dropBeforeUnload]);

  const startRecording = useCallback(
    (scrollCallback: (elapsedMs: number) => void, checkEndCallback: () => boolean, liveStream?: MediaStream | null, options?: StartRecordingOptions) => {
      // Prefer an explicitly passed fresh stream (e.g. right after camera
      // re-initialization) — the synced ref may lag by a render.
      const currentStream = liveStream ?? streamRef.current;
      if (!currentStream) return;
      if (recordingStateRef.current !== 'idle' && recordingStateRef.current !== 'completed') return;

      if (recordingStateRef.current === 'completed') {
        revokeUrls();
        setRecordingResult(null);
      }

      clearCountdownInterval();
      clearRecordingIntervals();
      revokeUrls();

      onScriptEndRef.current = options?.onScriptEnd ?? null;
      setRecordingResult(null);

      // Everything the countdown-to-capture transition needs. Runs either
      // after the countdown completes or immediately when the countdown
      // setting is off — never while a countdown is still running.
      const beginCapture = () => {
        const recovery = options?.recovery;
        const takeId = ++takeIdRef.current;
        let finalized = false;
        const isCurrentTake = () => takeIdRef.current === takeId;
        try {
          const activeStream = currentStream;
          if (!activeStream || activeStream.getTracks().length === 0) {
            finalized = true;
            dropBeforeUnload();
            options?.onError?.(
              'Camera and microphone are not active. Enable them on the canvas, then try again.'
            );
            setRecordingState('idle');
            return;
          }

          // Real capability check (Phase 5): a MIME that was never verified
          // through isTypeSupported must not reach the constructor.
          const codec = selectRecordingCodec();
          if (!codec) {
            finalized = true;
            clearCountdownInterval();
            clearRecordingIntervals();
            dropBeforeUnload();
            options?.onError?.(
              'This browser cannot record video. Try the latest Chrome, Edge, Firefox or Safari.'
            );
            setRecordingState('idle');
            return;
          }

          // Bitrate from the ACTUAL capture geometry (Phase 5) — the
          // browser's silent default (~2.5 Mbps at 1080p) is what visibly
          // degrades recorded quality when left unset.
          const capture = readTrackCaptureInfo(activeStream);
          const captureMetadata = readTrackCaptureMetadata(activeStream);
          const capabilities = readTrackCaptureCapabilities(activeStream);
          const profile = getBestRecordingProfile({ capabilities, codec });
          const actualProfile = profileForActualCapture(captureMetadata, codec);
          const videoBitsPerSecond = Math.min(profile.videoBitrate, bitrateForDimensions(
            capture?.width,
            capture?.height,
            capture?.frameRate || undefined,
          ));

          const recorder = new MediaRecorder(activeStream, {
            mimeType: codec.mimeType,
            videoBitsPerSecond,
            audioBitsPerSecond: RECORDING_AUDIO_BITRATE,
          });
          startedAtPerformanceRef.current = null;
          stopRequestedAtRef.current = null;
          stopRequestedPerformanceRef.current = null;

          chunksRef.current = [];
          // The active clock starts (or re-starts) exactly when capture does.
          activeMsRef.current = 0;
          inPauseRef.current = false;
          segmentStartRef.current = Date.now();
          lastScrollTickRef.current = Date.now();

          setRecordingFormat({
            mimeType: recorder.mimeType || codec.mimeType,
            extension: codec.extension,
            configuredVideoBitrate: videoBitsPerSecond,
            actualVideoBitrate: Number.isFinite(recorder.videoBitsPerSecond) ? recorder.videoBitsPerSecond : null,
            configuredAudioBitrate: RECORDING_AUDIO_BITRATE,
            actualAudioBitrate: Number.isFinite(recorder.audioBitsPerSecond) ? recorder.audioBitsPerSecond : null,
            videoBitsPerSecond,
            audioBitsPerSecond: RECORDING_AUDIO_BITRATE,
          });

          const recorderCreatedAt = performance.now();
          recorder.onstart = () => {
            startedAtPerformanceRef.current = performance.now();
            recordRecordingDiagnostic('recorder.started', {
              startupLatencyMs: Math.max(0, Math.round(startedAtPerformanceRef.current - recorderCreatedAt)),
            });
          };

          const inspectOutput = (blob: Blob, activeDuration: number) => {
            const metadata = buildMetadata(blob, activeDuration);
            recordRecordingDiagnostic('recording.output', {
              ...metadata,
              cameraInitializationMs: null,
              microphoneInitializationMs: null,
              combinedCaptureAcquisitionMs: null,
            });
            void inspectRecordedContainer(blob).then((container) => {
              if (!container) {
                recordRecordingDiagnostic('recording.container-unavailable', { fileSize: blob.size, mimeType: blob.type || null });
                return;
              }
              recordRecordingDiagnostic('recording.container-measured', {
                ...container,
                recordingDurationDelta: container.duration === null ? null : container.duration - activeDuration,
                videoDurationDelta: container.videoDuration === null ? null : container.videoDuration - activeDuration,
                audioDurationDelta: container.audioDuration === null ? null : container.audioDuration - activeDuration,
              });
            });
          };
          const buildMetadata = (blob: Blob, duration: number): RecordingMetadata => ({
            profileId: profile.id,
            actualProfileId: actualProfile.id,
            requestedWidth: 1920,
            requestedHeight: 1080,
            requestedFps: 30,
            actualWidth: captureMetadata?.width ?? null,
            actualHeight: captureMetadata?.height ?? null,
            actualFps: captureMetadata?.frameRate || null,
            deviceId: captureMetadata?.deviceId ?? null,
            mimeType: recorder.mimeType || blob.type || codec.mimeType,
            configuredVideoBitrate: videoBitsPerSecond,
            actualVideoBitrate: Number.isFinite(recorder.videoBitsPerSecond) ? recorder.videoBitsPerSecond : null,
            configuredAudioBitrate: RECORDING_AUDIO_BITRATE,
            actualAudioBitrate: Number.isFinite(recorder.audioBitsPerSecond) ? recorder.audioBitsPerSecond : null,
            duration,
            fileSize: blob.size,
            averageFileBitrate: duration > 0 ? Math.round((blob.size * 8) / duration) : null,
            startupLatencyMs: startedAtPerformanceRef.current === null
              ? null
              : Math.max(0, Math.round(startedAtPerformanceRef.current - recorderCreatedAt)),
            finalizationLatencyMs: stopRequestedAtRef.current === null ? null : Math.max(0, Date.now() - stopRequestedAtRef.current),
          });

          // ONE exit for every way a take can end (stop, recorder error,
          // stream change). MediaRecorder fires `stop` after `error`, and an
          // older recorder can fire `onstop` after a reset/new take; both
          // used to assemble a second result, mint a second object URL and
          // delete the recovery rows twice. The local `finalized` flag covers
          // this take, `takeId` covers a callback arriving for a replaced one.
          const finalizeTake = () => {
            if (finalized || !isCurrentTake()) return;
            finalized = true;
            finalizedRef.current = null;
            clearRecordingIntervals();
            clearCountdownInterval();
            dropBeforeUnload();
            // The take ended in this document: the recovery copy is no longer
            // needed. A crash/unload that never reaches this handler leaves
            // the rows for the recovery policy on the next visit.
            safeSinkCall(() => recovery?.finish());
            activeRecoveryRef.current = null;

            const chunks = chunksRef.current;
            // The final Blob owns the bytes; the chunk references must not
            // keep every intermediate blob alive for the life of the review.
            chunksRef.current = [];
            mediaRecorderRef.current = null;
            setCountdownText('');

            if (chunks.length === 0) {
              setRecordingState('idle');
              return;
            }

            // Active time only: a paused take's duration excludes every
            // paused second (matches what the blob actually plays).
            const duration = computeDurationSeconds();
            const hasAudio = activeStream.getAudioTracks().length > 0;
            const blob = new Blob(chunks, { type: codec.mimeType });

            const result: RecordingResult = {
              blob,
              mimeType: codec.mimeType,
              extension: codec.extension,
              duration,
              hasAudio,
              width: capture?.width ?? 0,
              height: capture?.height ?? 0,
              metadata: buildMetadata(blob, duration),
            };
            recordRecordingDiagnostic('recorder.finalized', {
              finalizationLatencyMs: stopRequestedPerformanceRef.current === null
                ? null
                : Math.max(0, Math.round(performance.now() - stopRequestedPerformanceRef.current)),
            });
            inspectOutput(blob, duration);

            setRecordingResult(result);
            const newVideoUrl = URL.createObjectURL(blob);
            videoUrlRef.current = newVideoUrl;
            setVideoUrl(newVideoUrl);
            setRecordingState('completed');
          };
          finalizedRef.current = finalizeTake;

          activeRecoveryRef.current = recovery ?? null;

          // Recovery keeps the same truthful configuration metadata beside
          // its local chunks, so refresh recovery does not lose the profile.
          safeSinkCall(() =>
            recovery?.begin({
              mimeType: recorder.mimeType || codec.mimeType,
              extension: codec.extension,
              width: capture?.width ?? 0,
              height: capture?.height ?? 0,
              frameRate: capture?.frameRate ?? 0,
              hasAudio: activeStream.getAudioTracks().length > 0,
              recordingMetadata: buildMetadata(new Blob(), 0),
            })
          );

          recorder.ondataavailable = (e) => {
            if (!isCurrentTake() || finalized) return;
            if (e.data.size > 0) {
              chunksRef.current.push(e.data);
              const activeMs = Math.round(computeDurationSeconds() * 1000);
              safeSinkCall(() => recovery?.append(e.data, activeMs));
            }
          };

          recorder.onerror = () => {
            if (!isCurrentTake() || finalized) return;
            recordRecordingDiagnostic('recorder.error', {
              mimeType: recorder.mimeType || codec.mimeType,
              state: recorder.state,
            });
            const hadChunks = chunksRef.current.length > 0;
            const stopWasRequested = stopRequestedAtRef.current !== null;
            finalizeTake();
            // A recorder failure used to be console-only. A user-requested
            // stop must not masquerade as one (its own path stays silent).
            if (!stopWasRequested) {
              options?.onError?.(
                hadChunks
                  ? 'Recording stopped unexpectedly. The part captured so far is ready to review.'
                  : 'Recording stopped unexpectedly. Check your camera and microphone, then try again.'
              );
            }
          };

          recorder.onstop = () => {
            if (!isCurrentTake() || finalized) return;
            finalizeTake();
          };

          recorder.start(CHUNK_INTERVAL_MS);
          recordRecordingDiagnostic('recorder.start-requested', {
            mimeType: recorder.mimeType || codec.mimeType,
            configuredVideoBitrate: videoBitsPerSecond,
            configuredAudioBitrate: RECORDING_AUDIO_BITRATE,
            actualVideoBitrate: Number.isFinite(recorder.videoBitsPerSecond) ? recorder.videoBitsPerSecond : null,
            actualAudioBitrate: Number.isFinite(recorder.audioBitsPerSecond) ? recorder.audioBitsPerSecond : null,
            profileId: profile.id,
            actualProfileId: actualProfile.id,
            requestedWidth: 1920,
            requestedHeight: 1080,
            requestedFps: 30,
            actualWidth: captureMetadata?.width ?? null,
            actualHeight: captureMetadata?.height ?? null,
            actualFps: captureMetadata?.frameRate || null,
            cameraInitializationMs: null,
            microphoneInitializationMs: null,
            combinedCaptureAcquisitionMs: null,
          });
          mediaRecorderRef.current = recorder;
          setRecordingState('recording');

          // Protect against accidental navigation during the countdown AND
          // the capture that follows it (registered once, dropped on stop /
          // cancel / reset).
          registerBeforeUnload();

          scrollIntervalRef.current = setInterval(() => {
            const now = Date.now();
            const elapsedMs = now - lastScrollTickRef.current;
            lastScrollTickRef.current = now;
            scrollCallback(Math.max(0, elapsedMs));
          }, 50);
          checkEndRef.current = checkEndCallback;
          armEndCheck();
        } catch {
          // start()/constructor threw: no take exists. Invalidate the closure
          // so a late recorder callback cannot resurrect it, and drop the
          // navigation guard registered for the countdown.
          finalized = true;
          takeIdRef.current += 1;
          finalizedRef.current = null;
          clearCountdownInterval();
          clearRecordingIntervals();
          dropBeforeUnload();
          safeSinkCall(() => recovery?.finish());
          activeRecoveryRef.current = null;
          chunksRef.current = [];
          mediaRecorderRef.current = null;
          revokeUrls();
          // Never surface the raw exception: the caller shows this as a toast,
          // and users have no way to act on a MediaRecorder error name.
          options?.onError?.(
            'Could not start recording. Check your camera and microphone, then try again.'
          );
          setRecordingState('idle');
        }
      };

      // Countdown off: recording starts immediately, with no artificial wait
      // and no invisible hold in a `countdown` state (FC-1.0 countdown rule).
      if (options?.countdown === false) {
        beginCapture();
        return;
      }

      // Countdown on: the first beat is shown IMMEDIATELY (an 800ms blank
      // screen read as a frozen click), then 2, 1, Record. Capture still
      // starts only after the Record beat has been visible for its full
      // step, so the take can never begin before the countdown finishes.
      registerBeforeUnload();
      setRecordingState('countdown');
      const beats = ['3', '2', '1', 'Record'];
      setCountdownText(beats[0]);
      let beatIndex = 0;

      countIntervalRef.current = setInterval(() => {
        beatIndex += 1;
        if (beatIndex < beats.length) {
          setCountdownText(beats[beatIndex]);
          return;
        }
        clearCountdownInterval();
        setCountdownText('');
        beginCapture();
      }, 800);
    },
    [clearCountdownInterval, clearRecordingIntervals, revokeUrls, computeDurationSeconds, registerBeforeUnload, armEndCheck]
  );

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      // Bank the active segment at the pause instant: everything after this
      // point is wall-clock the take did NOT capture.
      activeMsRef.current += Math.max(0, Date.now() - segmentStartRef.current);
      inPauseRef.current = true;
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
      if (endCheckIntervalRef.current) {
        clearInterval(endCheckIntervalRef.current);
        endCheckIntervalRef.current = null;
      }
      setRecordingState('paused');
    }
  }, []);

  const resumeRecording = useCallback(
    (scrollCallback: (elapsedMs: number) => void, checkEndCallback: () => boolean) => {
      if (mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.resume();
        // Open a fresh active segment: paused time never joins the duration.
        segmentStartRef.current = Date.now();
        inPauseRef.current = false;
        lastScrollTickRef.current = Date.now();
        scrollIntervalRef.current = setInterval(() => {
          const now = Date.now();
          const elapsedMs = now - lastScrollTickRef.current;
          lastScrollTickRef.current = now;
          scrollCallback(Math.max(0, elapsedMs));
        }, 50);
        checkEndRef.current = checkEndCallback;
        armEndCheck();
        setRecordingState('recording');
      }
    },
    [armEndCheck]
  );

  const stopRecording = useCallback((countdownReturnState: 'idle' | 'completed' = 'idle') => {
    dropBeforeUnload();
    // Stop during the countdown: nothing has been captured, so stop IS the
    // cancel. (Previously the interval cleared but the state stayed
    // 'countdown', stranding the UI in a phantom recording.) The camera is
    // deliberately left alone — Start may simply be pressed again. The caller
    // picks the return state: 'idle' for a fresh start, 'completed' when the
    // countdown was launched over an existing take (review must survive the
    // cancel — see cancelCountdown).
    if (recordingStateRef.current === 'countdown') {
      clearCountdownInterval();
      setCountdownText('');
      setRecordingState(countdownReturnState);
      return;
    }
    if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
      stopRequestedAtRef.current = Date.now();
      stopRequestedPerformanceRef.current = performance.now();
      mediaRecorderRef.current.stop();
    } else if (
      recordingStateRef.current === 'recording' ||
      recordingStateRef.current === 'paused'
    ) {
      // The recorder is already inactive (an encoder failure, a device
      // removal, or a stop this hook did not initiate) so no `onstop` is
      // coming. Finalize the chunks we have instead of leaving the UI in a
      // phantom active state with the Stop control gone.
      finalizedRef.current?.();
    } else {
      revokeUrls();
    }
    clearRecordingIntervals();
    clearCountdownInterval();
  }, [clearCountdownInterval, clearRecordingIntervals, revokeUrls, dropBeforeUnload]);

  /**
   * Cancels a running countdown, leaving the recorder in a clean
   * non-recording state: no interval, no countdown text, no capture session,
   * and the navigation guard dropped. Quota and teleprompter allowance were
   * never consumed — they only move once a take actually records.
   *
   * A countdown started over an EXISTING take (review → Record again) must
   * fall back to 'completed', not 'idle': 'idle' exits review and hides the
   * take the user still has. Callers pass the target; 'idle' is the fresh-
   * session default.
   */
  const cancelCountdown = useCallback((targetState: 'idle' | 'completed' = 'idle') => {
    if (recordingStateRef.current !== 'countdown') return;
    stopRecording(targetState);
  }, [stopRecording]);

  const resetRecording = useCallback(() => {
    // Invalidate the take BEFORE stopping: `stop()` fires `onstop`
    // asynchronously, and an explicit reset must not let that callback
    // resurrect the discarded take (or assemble it from a newer take's
    // chunks).
    takeIdRef.current += 1;
    finalizedRef.current = null;
    dropBeforeUnload();
    if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
      stopRequestedAtRef.current = Date.now();
      stopRequestedPerformanceRef.current = performance.now();
      try {
        mediaRecorderRef.current.stop();
      } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    // An explicit discard is a take end in this document: its recovery rows
    // must not be offered again on the next visit.
    const recovery = activeRecoveryRef.current;
    activeRecoveryRef.current = null;
    safeSinkCall(() => recovery?.finish());
    clearRecordingIntervals();
    clearCountdownInterval();
    revokeUrls();
    setRecordingState('idle');
    setRecordingResult(null);
    setRecordingFormat(null);
  }, [clearCountdownInterval, clearRecordingIntervals, revokeUrls, dropBeforeUnload]);

  return {
    recordingState,
    videoUrl,
    countdownText,
    recordingResult,
    recordingFormat,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelCountdown,
    resetRecording,
  };
}
