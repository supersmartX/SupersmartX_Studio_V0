'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

type CameraStatus = 'idle' | 'requesting' | 'ready' | 'error';

interface UseCameraReturn {
  stream: MediaStream | null;
  isInitialized: boolean;
  hasInitialized: boolean;
  status: CameraStatus;
  errorMessage: string | null;
  initialize: (constraints?: MediaStreamConstraints) => Promise<MediaStream | null>;
  stop: () => void;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  refreshDevices: () => Promise<void>;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
        return 'Permission denied. Please allow camera/microphone access in browser settings.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No camera or microphone found. Connect a device and retry.';
      case 'NotReadableError':
        return 'Camera is in use by another app. Close other apps and retry.';
      case 'OverconstrainedError':
        return 'Camera settings not supported. Try a different resolution.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : 'Failed to access camera/microphone';
}

const FALLBACK_CONSTRAINTS: MediaStreamConstraints[] = [
  { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: true },
  { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: true },
  { video: { facingMode: 'user' }, audio: true },
  { video: true, audio: true },
];

export function useCamera(): UseCameraReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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

  const handleTrackEnded = useCallback(() => {
    streamRef.current = null;
    setStream(null);
    setIsInitialized(false);
    setStatus('error');
    setErrorMessage('Camera was disconnected. Please reconnect and retry.');
  }, []);

  const initialize = useCallback(async (constraints?: MediaStreamConstraints) => {
    if (statusRef.current === 'requesting') return streamRef.current;
    
    setStatus('requesting');
    statusRef.current = 'requesting';
    setErrorMessage(null);

    let newStream: MediaStream | null = null;
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.removeEventListener('ended', handleTrackEnded);
          track.stop();
        });
      }

      const constraintsToTry = constraints ? [constraints] : FALLBACK_CONSTRAINTS;
      let lastError: Error | null = null;

      for (const c of constraintsToTry) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia(c);
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'NotFoundError' || err.name === 'SecurityError')) {
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
      setStatus('error');
      statusRef.current = 'error';
      setErrorMessage(getErrorMessage(err));
      setIsInitialized(false);
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
  }, [handleTrackEnded]);

  return {
    stream,
    isInitialized,
    hasInitialized,
    status,
    errorMessage,
    initialize,
    stop,
    videoDevices,
    audioDevices,
    refreshDevices,
  };
}