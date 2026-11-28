'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ScreenCaptureStatus = 'idle' | 'requesting' | 'active' | 'error';

/** Native display surface reported by getDisplayMedia track settings. */
export type ScreenCaptureSurface = 'monitor' | 'window' | 'browser';

interface UseScreenCaptureOptions {
  /** Called when the user stops sharing via the browser UI or the track ends. */
  onStreamEnded?: () => void;
}

function describeScreenError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'Screen sharing was cancelled or blocked. Choose a screen, window, or tab to share.';
      case 'NotFoundError':
        return 'No shareable screen, window, or tab was available.';
      case 'NotReadableError':
        return 'The selected screen could not be captured. Try sharing a different window or tab.';
      case 'AbortError':
        return 'Screen sharing was cancelled before it started.';
      case 'SecurityError':
        return 'Screen sharing is blocked in this browser context.';
      default:
        return `Screen sharing failed (${err.name}). Try again.`;
    }
  }
  if (err instanceof Error) return err.message;
  return 'Screen sharing failed. Try again.';
}

export function isScreenCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

function readDisplaySurface(stream: MediaStream | null): ScreenCaptureSurface | null {
  const track = stream?.getVideoTracks()[0];
  if (!track) return null;
  const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
  const surface = settings.displaySurface;
  if (surface === 'monitor' || surface === 'window' || surface === 'browser') return surface;
  return null;
}

function buildDisplayMediaOptions(): DisplayMediaStreamOptions {
  // Request system/tab audio where the browser/OS permits it. The browser's
  // native picker remains authoritative over which source and whether audio
  // is shared; unsupported options are ignored by browsers that don't know them.
  const video: MediaTrackConstraints & Record<string, unknown> = {
    frameRate: { ideal: 30, max: 60 },
  };
  const audio: MediaTrackConstraints & Record<string, unknown> = {
    // System/tab audio should not be "cleaned up" like a mic.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  const options: DisplayMediaStreamOptions & Record<string, unknown> = {
    video,
    audio,
    // Chromium hints. Harmless where unsupported; they do not replace the
    // native picker (G1 requires the picker to handle source selection).
    selfBrowserSurface: 'include',
    surfaceSwitching: 'include',
    systemAudio: 'include',
    monitorTypeSurfaces: 'include',
  };
  return options as DisplayMediaStreamOptions;
}

/**
 * Manages a browser screen/window/tab capture via getDisplayMedia.
 *
 * The hook owns only the display stream lifecycle. Callers compose it with a
 * microphone track when they need narrated screen recordings.
 */
export function useScreenCapture({ onStreamEnded }: UseScreenCaptureOptions = {}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ScreenCaptureStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [displaySurface, setDisplaySurface] = useState<ScreenCaptureSurface | null>(null);
  const [hasSystemAudio, setHasSystemAudio] = useState(false);
  // SSR-safe support probe. The server has no navigator, so a synchronous
  // read renders the Screen radios `disabled` in the SSR HTML; React adopts
  // that DOM at hydration WITHOUT patching attribute mismatches, and a later
  // render whose `disabled` prop is unchanged never rewrites the attribute —
  // leaving the radios dead until some unrelated state change. Resolving the
  // flag on mount makes the first client render agree with the server (both
  // false) and flips it through a real state update the browser applies.
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => {
    setIsSupported(isScreenCaptureSupported());
  }, []);

  const streamRef = useRef<MediaStream | null>(null);
  const onStreamEndedRef = useRef(onStreamEnded);
  const requestIdRef = useRef(0);

  useEffect(() => {
    onStreamEndedRef.current = onStreamEnded;
  }, [onStreamEnded]);

  const stopTracks = useCallback((s: MediaStream | null) => {
    if (!s) return;
    s.getTracks().forEach((track) => {
      track.onended = null;
      try {
        track.stop();
      } catch {
        // Browser may throw if track is already stopped.
      }
    });
  }, []);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    const current = streamRef.current;
    streamRef.current = null;
    stopTracks(current);
    setStream(null);
    setStatus('idle');
    setErrorMessage(null);
    setDisplaySurface(null);
    setHasSystemAudio(false);
  }, [stopTracks]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      stopTracks(streamRef.current);
      streamRef.current = null;
    };
  }, [stopTracks]);

  const start = useCallback(async (): Promise<MediaStream | null> => {
    if (!isScreenCaptureSupported()) {
      const msg = 'Screen sharing is not supported in this browser.';
      setStatus('error');
      setErrorMessage(msg);
      return null;
    }

    const requestId = ++requestIdRef.current;

    // Stop any previous share before starting a new one.
    const previous = streamRef.current;
    streamRef.current = null;
    stopTracks(previous);
    setStream(null);
    setErrorMessage(null);
    setStatus('requesting');

    const attemptGetDisplayMedia = async (): Promise<MediaStream> => {
      try {
        return await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions());
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        // Some browsers reject unknown audio constraints/options; retry with a
        // simpler audio request, then video-only as a last resort.
        if (name === 'OverconstrainedError' || name === 'NotSupportedError' || name === 'TypeError') {
          try {
            return await navigator.mediaDevices.getDisplayMedia({
              video: { frameRate: { ideal: 30, max: 60 } },
              audio: true,
            } as DisplayMediaStreamOptions);
          } catch (retryErr) {
            const retryName = retryErr instanceof DOMException ? retryErr.name : '';
            if (retryName === 'NotAllowedError' || retryName === 'AbortError' || retryName === 'SecurityError') throw retryErr;
            return await navigator.mediaDevices.getDisplayMedia({
              video: { frameRate: { ideal: 30, max: 60 } },
              audio: false,
            });
          }
        }
        throw err;
      }
    };

    try {
      const displayStream = await attemptGetDisplayMedia();

      // A stale request (user started another share or stopped) must not win.
      if (requestId !== requestIdRef.current) {
        stopTracks(displayStream);
        return null;
      }

      const [videoTrack] = displayStream.getVideoTracks();
      if (!videoTrack) {
        stopTracks(displayStream);
        setStatus('error');
        setErrorMessage('No video track was provided by the screen share.');
        return null;
      }

      videoTrack.onended = () => {
        if (requestId !== requestIdRef.current) return;
        streamRef.current = null;
        setStream(null);
        setStatus('idle');
        setErrorMessage(null);
        setDisplaySurface(null);
        setHasSystemAudio(false);
        onStreamEndedRef.current?.();
      };

      streamRef.current = displayStream;
      setStream(displayStream);
      setStatus('active');
      setErrorMessage(null);
      setDisplaySurface(readDisplaySurface(displayStream));
      setHasSystemAudio(displayStream.getAudioTracks().length > 0);
      return displayStream;
    } catch (err) {
      if (requestId !== requestIdRef.current) return null;
      streamRef.current = null;
      setStream(null);
      const msg = describeScreenError(err);
      // User cancel is not an alarming "error" state; keep it recoverable.
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'AbortError')) {
        setStatus('idle');
        setErrorMessage(msg);
        return null;
      }
      setStatus('error');
      setErrorMessage(msg);
      return null;
    }
  }, [stopTracks]);

  return {
    stream,
    status,
    errorMessage,
    displaySurface,
    hasSystemAudio,
    isActive: status === 'active' && !!stream,
    isSupported,
    start,
    stop,
  };
}
