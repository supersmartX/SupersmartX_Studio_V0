'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RecordingState, RecordingConfiguration } from '@/types';

interface RecordingResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  duration: number;
  hasAudio: boolean;
}

function getSupportedMimeType(): { mimeType: string; extension: string } {
  const types = [
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=h264', extension: 'mp4' },
  ];

  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type.mimeType)) {
      return type;
    }
  }

  return { mimeType: 'video/webm', extension: 'webm' };
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
}

export function useRecorder(stream: MediaStream | null, _config?: RecordingConfiguration) {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [videoUrl, setVideoUrl] = useState('');
  const [countdownText, setCountdownText] = useState('');
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null);

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
  const selectedMimeRef = useRef<{ mimeType: string; extension: string }>({ mimeType: 'video/webm', extension: 'webm' });
  const videoUrlRef = useRef('');
  const recordingStateRef = useRef<RecordingState>('idle');

  recordingStateRef.current = recordingState;

  const beforeUnloadRef = useRef<((e: BeforeUnloadEvent) => void) | null>(null);

  // Keep stream ref in sync
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  // Stop an ACTIVE take when the stream changes (format/device switch).
  // Review ('completed') and idle states are immune: a camera re-acquire for
  // the NEXT take must not kill the countdown the new take just started,
  // and device/platform switches must not discard a finished review.
  // Proven by live probe: re-init during review cleared the countdown
  // interval and reset state, so the second take silently never started.
  useEffect(() => {
    const active = recordingStateRef.current === 'recording' || recordingStateRef.current === 'paused' || recordingStateRef.current === 'countdown';
    if (stream && active) {
      try {
        if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
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
      if (beforeUnloadRef.current) {
        window.removeEventListener('beforeunload', beforeUnloadRef.current);
        beforeUnloadRef.current = null;
      }
      setRecordingState('idle');
      setCountdownText('');
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      if (beforeUnloadRef.current) {
        window.removeEventListener('beforeunload', beforeUnloadRef.current);
      }
      try {
        if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
          mediaRecorderRef.current.stop();
        }
      } catch { /* ignore */ }
      if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
      if (countIntervalRef.current) clearInterval(countIntervalRef.current);
      if (endCheckIntervalRef.current) clearInterval(endCheckIntervalRef.current);
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    };
  }, []);

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
        onScriptEndRef.current?.();
        if (mediaRecorderRef.current?.state === 'recording' ||
            mediaRecorderRef.current?.state === 'paused') {
          mediaRecorderRef.current.stop();
        }
      }
    }, 200);
  }, [clearRecordingIntervals]);

  const startRecording = useCallback(
    (scrollCallback: () => void, checkEndCallback: () => boolean, liveStream?: MediaStream | null, options?: StartRecordingOptions) => {
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
        try {
          const activeStream = currentStream;
          if (!activeStream || activeStream.getTracks().length === 0) {
            setRecordingState('idle');
            return;
          }
          const supported = getSupportedMimeType();
          selectedMimeRef.current = supported;

          const recorder = new MediaRecorder(activeStream, {
            mimeType: supported.mimeType,
          });

          chunksRef.current = [];
          // The active clock starts (or re-starts) exactly when capture does.
          activeMsRef.current = 0;
          inPauseRef.current = false;
          segmentStartRef.current = Date.now();

          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };

          recorder.onerror = () => {
            clearRecordingIntervals();
            clearCountdownInterval();
            if (chunksRef.current.length > 0) {
              const duration = computeDurationSeconds();
              const hasAudio = activeStream.getAudioTracks().length > 0;
              const blob = new Blob(chunksRef.current, { type: supported.mimeType });
              const result: RecordingResult = { blob, mimeType: supported.mimeType, extension: supported.extension, duration, hasAudio };
              setRecordingResult(result);
              const newVideoUrl = URL.createObjectURL(blob);
              videoUrlRef.current = newVideoUrl;
              setVideoUrl(newVideoUrl);
              setRecordingState('completed');
            } else {
              setRecordingState('idle');
            }
            setCountdownText('');
          };

          recorder.onstop = () => {
            if (chunksRef.current.length === 0) {
              setRecordingState('idle');
              return;
            }

            // Active time only: a paused take's duration excludes every
            // paused second (matches what the blob actually plays).
            const duration = computeDurationSeconds();
            const hasAudio = activeStream.getAudioTracks().length > 0;
            const blob = new Blob(chunksRef.current, { type: supported.mimeType });

            const result: RecordingResult = {
              blob,
              mimeType: supported.mimeType,
              extension: supported.extension,
              duration,
              hasAudio,
            };

            setRecordingResult(result);
            const newVideoUrl = URL.createObjectURL(blob);
            videoUrlRef.current = newVideoUrl;
            setVideoUrl(newVideoUrl);

            setRecordingState('completed');
          };

          recorder.start(100);
          mediaRecorderRef.current = recorder;
          setRecordingState('recording');

          // Protect against accidental navigation during the countdown AND
          // the capture that follows it (registered once, dropped on stop /
          // cancel / reset).
          registerBeforeUnload();

          scrollIntervalRef.current = setInterval(scrollCallback, 50);
          checkEndRef.current = checkEndCallback;
          armEndCheck();
        } catch (err) {
          clearCountdownInterval();
          clearRecordingIntervals();
          revokeUrls();
          console.error('Recording failed:', err);
          setRecordingState('idle');
        }
      };

      // Countdown off: recording starts immediately, with no artificial wait
      // and no invisible hold in a `countdown` state (FC-1.0 countdown rule).
      if (options?.countdown === false) {
        beginCapture();
        return;
      }

      // Countdown on: capture does NOT start until it completes, and the
      // navigation guard is live from the first tick so a refresh mid-count
      // is caught like any other in-flight take.
      registerBeforeUnload();
      setRecordingState('countdown');
      let count = 3;

      countIntervalRef.current = setInterval(() => {
        setCountdownText(String(count));
        count--;
        if (count < 0) {
          clearCountdownInterval();
          setCountdownText('');
          beginCapture();
        }
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
    (scrollCallback: () => void, checkEndCallback: () => boolean) => {
      if (mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.resume();
        // Open a fresh active segment: paused time never joins the duration.
        segmentStartRef.current = Date.now();
        inPauseRef.current = false;
        scrollIntervalRef.current = setInterval(scrollCallback, 50);
        checkEndRef.current = checkEndCallback;
        armEndCheck();
        setRecordingState('recording');
      }
    },
    [armEndCheck]
  );

  const stopRecording = useCallback(() => {
    if (beforeUnloadRef.current) {
      window.removeEventListener('beforeunload', beforeUnloadRef.current);
      beforeUnloadRef.current = null;
    }
    // Stop during the countdown: nothing has been captured, so stop IS the
    // cancel. (Previously the interval cleared but the state stayed
    // 'countdown', stranding the UI in a phantom recording.) The camera is
    // deliberately left alone — Start may simply be pressed again.
    if (recordingStateRef.current === 'countdown') {
      clearCountdownInterval();
      setCountdownText('');
      setRecordingState('idle');
      return;
    }
    if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.stop();
    } else {
      revokeUrls();
    }
    clearRecordingIntervals();
    clearCountdownInterval();
  }, [clearCountdownInterval, clearRecordingIntervals, revokeUrls]);

  /**
   * Cancels a running countdown, leaving the recorder in a clean
   * non-recording state: no interval, no countdown text, no capture session,
   * and the navigation guard dropped. Quota and teleprompter allowance were
   * never consumed — they only move once a take actually records.
   */
  const cancelCountdown = useCallback(() => {
    if (recordingStateRef.current !== 'countdown') return;
    stopRecording();
  }, [stopRecording]);

  const resetRecording = useCallback(() => {
    if (beforeUnloadRef.current) {
      window.removeEventListener('beforeunload', beforeUnloadRef.current);
      beforeUnloadRef.current = null;
    }
    if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.stop();
    }
    clearRecordingIntervals();
    clearCountdownInterval();
    revokeUrls();
    setRecordingState('idle');
    setRecordingResult(null);
  }, [clearCountdownInterval, clearRecordingIntervals, revokeUrls]);

  return {
    recordingState,
    videoUrl,
    countdownText,
    recordingResult,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelCountdown,
    resetRecording,
  };
}
