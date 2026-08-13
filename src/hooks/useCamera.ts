'use client';

import { useState, useCallback, useEffect } from 'react';

type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'permission-denied'
  | 'devices-unavailable'
  | 'error';

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

function getCameraErrorState(err: unknown): { status: CameraStatus; message: string } {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return {
        status: 'permission-denied',
        message: 'Camera or microphone permission was denied. Please allow access and retry.',
      };
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError' || err.name === 'NotReadableError') {
      return {
        status: 'devices-unavailable',
        message: 'No camera or microphone was found. Connect a device and retry.',
      };
    }
  }

  return {
    status: 'error',
    message: err instanceof Error ? err.message : 'Unable to initialize camera.',
  };
}

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
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }, []);

  useEffect(() => {
    const handleDeviceChange = () => {
      refreshDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  const initialize = useCallback(async (constraints?: MediaStreamConstraints) => {
    setStatus('requesting');
    setErrorMessage(null);

    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const defaultConstraints: MediaStreamConstraints = {
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' },
        audio: true,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(
        constraints || defaultConstraints
      );

      setStream(mediaStream);
      setIsInitialized(true);
      setStatus('ready');
      await refreshDevices();
    } catch (err) {
      const error = getCameraErrorState(err);
      setStatus(error.status);
      setErrorMessage(error.message);
      setIsInitialized(false);
      console.error('Failed to access camera/microphone:', err);
    }
  }, [refreshDevices, stream]);

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
