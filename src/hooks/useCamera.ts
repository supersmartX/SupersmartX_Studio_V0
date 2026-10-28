'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { buildCaptureConstraintLadder } from '@/lib/recording/capture-constraints';
import { readCaptureDeviceLabels, recordRecordingDiagnostic, serializeCaptureConstraints } from '@/lib/recording/diagnostics';

type CameraStatus = 'idle' | 'requesting' | 'ready' | 'error';

interface UseCameraReturn {
  stream: MediaStream | null;
  isInitialized: boolean;
  hasInitialized: boolean;
  status: CameraStatus;
  errorMessage: string | null;
  /** The site is not allowed to use camera/microphone at all (not a device fault). */
  permissionBlocked: boolean;
  initialize: (constraints?: MediaStreamConstraints) => Promise<MediaStream | null>;
  stop: () => void;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  refreshDevices: () => Promise<void>;
}

type BlockedPermissions = { camera: boolean; microphone: boolean };

// The Permissions API knows the SITE decision even when getUserMedia rejects
// with a generic error: headless Chromium auto-denies with NotSupportedError,
// and other browsers use their own names. Classifying on the permission state
// keeps the copy honest ("blocked — allow it") instead of blaming hardware.
async function readBlockedPermissions(): Promise<BlockedPermissions> {
  const denied = async (name: string) => {
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      return status.state === 'denied';
    } catch {
      return false;
    }
  };
  const [camera, microphone] = await Promise.all([denied('camera'), denied('microphone')]);
  return { camera, microphone };
}

function getPermissionMessage({ camera, microphone }: BlockedPermissions): string {
  const subject =
    camera && microphone ? 'Camera and microphone access is' : camera ? 'Camera access is' : 'Microphone access is';
  const allow = camera && microphone ? 'Camera and Microphone' : camera ? 'Camera' : 'Microphone';
  return `${subject} blocked for this site. Open the site-settings icon in your browser's address bar, allow ${allow}, then choose Retry.`;
}

function getErrorMessage(err: unknown): string {
  // getUserMedia rejects with a plain TypeError for a non-secure context or an
  // unsupported constraint shape — NOT a DOMException, so this check must come
  // first (the case inside the switch below was unreachable).
  if (err instanceof TypeError) {
    return 'Camera or microphone access is not available in this context. Try using HTTPS or a supported browser.';
  }
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera and microphone access is blocked. Allow access in your browser settings, then choose Retry.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No camera or microphone was found. Connect one, then choose Retry.';
      case 'NotReadableError':
        return 'Your camera or microphone is being used by another app. Close the other app, then choose Retry.';
      case 'OverconstrainedError':
        return 'Your camera does not support this quality. Choose another camera from the device menu, then try again.';
      case 'AbortError':
        return 'Camera or microphone access was interrupted. Try again.';
      default:
        // Never surface the raw DOMException message — it can carry
        // internal/technical strings the user cannot act on.
        return 'We could not start your camera. Check that it is connected and not in use, then choose Retry.';
    }
  }
  // Same rule for plain errors: describe the situation, not the exception.
  return 'We could not start your camera. Check that it is connected and not in use, then choose Retry.';
}

const FALLBACK_CONSTRAINTS: MediaStreamConstraints[] = buildCaptureConstraintLadder();

function exactDeviceId(constraints: MediaStreamConstraints | undefined, kind: 'video' | 'audio'): string | undefined {
  const track = constraints?.[kind];
  if (!track || typeof track === 'boolean') return undefined;
  const deviceId = track.deviceId;
  if (typeof deviceId === 'string') return deviceId;
  if (deviceId && typeof deviceId === 'object' && 'exact' in deviceId) {
    const exact = deviceId.exact;
    return typeof exact === 'string' ? exact : undefined;
  }
  return undefined;
}

function safeTrackDiagnosticSettings(track: MediaStreamTrack): MediaTrackSettings | null {
  try {
    return typeof track.getSettings === 'function' ? track.getSettings() : null;
  } catch {
    return null;
  }
}

export function useCamera(): UseCameraReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const statusRef = useRef<CameraStatus>('idle');
  const initializeRef = useRef<((constraints?: MediaStreamConstraints) => Promise<MediaStream | null>) | null>(null);
  // True once a stream has ever been acquired. Unlike isInitialized (which
  // stop() resets), this stays true so the UI can tell "camera released
  // after a take" apart from "camera never enabled".
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
      setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
  }, []);

  const handleCaptureLoss = useCallback((endedKind: 'audio' | 'video' | null) => {
    const current = streamRef.current;
    if (!current) return;

    // One device disappearing ends the WHOLE capture session: release the
    // other track too instead of leaving a live camera/microphone (and the
    // OS indicator) behind a stream nothing can record from. Detach the ended
    // listeners first so stopping the remaining tracks cannot re-enter here.
    streamRef.current = null;
    const endedHandler = endedHandlerRef.current;
    current.getTracks().forEach((track) => {
      if (endedHandler) track.removeEventListener('ended', endedHandler);
      try {
        // An already-ended track ignores this; the live sibling is released.
        track.stop();
      } catch {
        // ignore - a track that already ended is already stopped
      }
    });

    setStream(null);
    setIsInitialized(false);
    setStatus('error');
    statusRef.current = 'error';
    setPermissionBlocked(false);
    setErrorMessage(
      endedKind === 'audio'
        ? 'Your microphone was disconnected. Reconnect it, then choose Retry.'
        : endedKind === 'video'
          ? 'Your camera was disconnected. Reconnect it, then choose Retry.'
          : 'Your camera or microphone was disconnected. Reconnect it, then choose Retry.',
    );
    void refreshDevices();
  }, [refreshDevices]);

  const handleTrackEnded = useCallback((event?: Event) => {
    const endedTrack = event?.target as MediaStreamTrack | null;
    const endedKind =
      endedTrack && typeof endedTrack.kind === 'string' ? endedTrack.kind : null;
    recordRecordingDiagnostic('capture.track-ended', {
      kind: endedKind,
      label: endedTrack?.label || null,
      readyState: endedTrack?.readyState ?? null,
      detectedBy: 'ended-event',
    });
    handleCaptureLoss(
      endedKind === 'audio' ? 'audio' : endedKind === 'video' ? 'video' : null,
    );
  }, [handleCaptureLoss]);

  // The loss path detaches this exact listener identity from every track; the
  // ref keeps that possible without making the callback depend on itself.
  const endedHandlerRef = useRef<((event?: Event) => void) | null>(null);
  endedHandlerRef.current = handleTrackEnded;

  // A track can die without ever firing 'ended': the spec only fires it for a
  // device-level end, and script/driver-initiated stop() is deliberately
  // silent. Watching readyState is the only signal left, and without it a dead
  // camera kept rolling under a REC badge with a "Camera on" chip.
  useEffect(() => {
    if (!stream) return;
    const interval = setInterval(() => {
      // A re-acquire (device switch) stops the old tracks while it runs; that
      // is not a loss, and its own failure path reports the real outcome.
      if (statusRef.current !== 'ready') return;
      const current = streamRef.current;
      if (!current) return;
      const dead = current.getTracks().find((track) => track.readyState === 'ended');
      if (!dead) return;
      recordRecordingDiagnostic('capture.track-ended', {
        kind: dead.kind,
        label: dead.label || null,
        readyState: dead.readyState,
        detectedBy: 'readyState-watchdog',
      });
      handleCaptureLoss(
        dead.kind === 'audio' ? 'audio' : dead.kind === 'video' ? 'video' : null,
      );
    }, 750);
    return () => clearInterval(interval);
  }, [stream, handleCaptureLoss]);

  const initialize = useCallback(async (constraints?: MediaStreamConstraints) => {
    if (statusRef.current === 'requesting') return streamRef.current;
    
    setStatus('requesting');
    statusRef.current = 'requesting';
    setErrorMessage(null);
    setPermissionBlocked(false);

    const initializeStartedAt = performance.now();
    let newStream: MediaStream | null = null;
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.removeEventListener('ended', handleTrackEnded);
          track.stop();
        });
      }

      const videoDeviceId = exactDeviceId(constraints, 'video');
      const audioDeviceId = exactDeviceId(constraints, 'audio');
      // Preserve the caller's exact selected device while lowering only the
      // requested capture quality. No fallback rung may silently change cams.
      const constraintsToTry = constraints
        ? [constraints, ...buildCaptureConstraintLadder(videoDeviceId, audioDeviceId).slice(1)]
        : FALLBACK_CONSTRAINTS;
      let lastError: Error | null = null;

      for (const c of constraintsToTry) {
        const attemptStartedAt = performance.now();
        recordRecordingDiagnostic('capture.requested', { constraints: serializeCaptureConstraints(c) });
        try {
          newStream = await navigator.mediaDevices.getUserMedia(c);
          recordRecordingDiagnostic('capture.acquired', {
            attemptMs: Math.round(performance.now() - attemptStartedAt),
            totalAcquisitionMs: Math.round(performance.now() - initializeStartedAt),
            combinedCaptureAcquisitionMs: Math.round(performance.now() - initializeStartedAt),
            cameraInitializationMs: null,
            microphoneInitializationMs: null,
            constraints: serializeCaptureConstraints(c),
            tracks: newStream.getTracks().map((track) => ({
              kind: track.kind,
              label: track.label || null,
              settings: safeTrackDiagnosticSettings(track),
            })),
            devices: await readCaptureDeviceLabels(),
          });
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          recordRecordingDiagnostic('capture.attempt-failed', {
            attemptMs: Math.round(performance.now() - attemptStartedAt),
            name: lastError.name || null,
            constraints: serializeCaptureConstraints(c),
          });
          if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
            throw err;
          }
        }
      }

      if (!newStream) {
        throw lastError;
      }

      newStream.getTracks().forEach((track) => {
        track.addEventListener('ended', handleTrackEnded);
      });

      streamRef.current = newStream;
      setStream(newStream);
      setIsInitialized(true);
      setHasInitialized(true);
      setStatus('ready');
      statusRef.current = 'ready';
      await refreshDevices();
      return newStream;
    } catch (err) {
      if (newStream) {
        newStream.getTracks().forEach((track) => track.stop());
      }
      // The previous stream's tracks were stopped before this attempt. Leaving
      // the stale reference in state made `stream` non-null behind
      // `isInitialized: false`, so Start skipped re-acquisition and handed a
      // dead stream to MediaRecorder.
      streamRef.current = null;
      setStream(null);
      setStatus('error');
      statusRef.current = 'error';
      const blocked = await readBlockedPermissions();
      const isPermissionBlocked = blocked.camera || blocked.microphone;
      setPermissionBlocked(isPermissionBlocked);
      setErrorMessage(
        isPermissionBlocked ? getPermissionMessage(blocked) : getErrorMessage(err),
      );
      setIsInitialized(false);
      recordRecordingDiagnostic('capture.initialization-failed', {
        totalAcquisitionMs: Math.round(performance.now() - initializeStartedAt),
        name: err instanceof Error ? err.name : null,
        message: isPermissionBlocked ? getPermissionMessage(blocked) : getErrorMessage(err),
        permission: { ...blocked, blocked: isPermissionBlocked },
      });
      return null;
    }
  }, [refreshDevices, handleTrackEnded]);

  initializeRef.current = initialize;

  // Release the camera immediately: stop every track (video + microphone
  // belonging to this stream) so the OS/browser indicator turns off.
  // Review uses the recorded Blob, never the live stream, so stopping here
  // is safe. A later initialize() acquires a clean new stream.
  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.removeEventListener('ended', handleTrackEnded);
        try {
          track.stop();
        } catch {
          // ignore — track may already be stopped
        }
      });
      streamRef.current = null;
    }
    setStream(null);
    setIsInitialized(false);
    setStatus('idle');
    statusRef.current = 'idle';
    setPermissionBlocked(false);
  }, [handleTrackEnded]);

  return {
    stream,
    isInitialized,
    hasInitialized,
    status,
    errorMessage,
    permissionBlocked,
    initialize,
    stop,
    videoDevices,
    audioDevices,
    refreshDevices,
  };
}
