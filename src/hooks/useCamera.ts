'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

type CameraStatus = 'idle' | 'requesting' | 'ready' | 'error';

interface UseCameraReturn {
  stream: MediaStream | null;
  isInitialized: boolean;
  status: CameraStatus;
  errorMessage: string | null;
  initialize: (constraints?: MediaStreamConstraints) => Promise<void>;
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
  const initializeRef = useRef<((constraints?: MediaStreamConstraints) => Promise<void>) | null>(null);

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
    if (statusRef.current === 'requesting') return;
    
    setStatus('requesting');
    statusRef.current = 'requesting';
    setErrorMessage(null);

    let newStream: MediaStream | null = null;
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
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
      setStatus('ready');
      statusRef.current = 'ready';
      await refreshDevices();
    } catch (err) {
      if (newStream) {
        newStream.getTracks().forEach((track) => track.stop());
      }
      setStatus('error');
      statusRef.current = 'error';
      setErrorMessage(getErrorMessage(err));
      setIsInitialized(false);
    }
  }, [refreshDevices, handleTrackEnded]);

  initializeRef.current = initialize;

  return {
    stream,
    isInitialized,
    status,
    errorMessage,
    initialize,
    videoDevices,
    audioDevices,
    refreshDevices,
  };
}