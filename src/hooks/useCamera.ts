'use client';

import { useState, useCallback, useEffect } from 'react';

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

const DEFAULT_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
  audio: true,
};

export function useCamera(): UseCameraReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

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
  }, [refreshDevices]);

  const initialize = useCallback(async (constraints?: MediaStreamConstraints) => {
    setStatus('requesting');
    setErrorMessage(null);

    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints || DEFAULT_CONSTRAINTS);

      setStream(mediaStream);
      setIsInitialized(true);
      setStatus('ready');
      await refreshDevices();
    } catch (err) {
      setStatus('error');
      setErrorMessage(getErrorMessage(err));
      setIsInitialized(false);
    }
  }, [stream, refreshDevices]);

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