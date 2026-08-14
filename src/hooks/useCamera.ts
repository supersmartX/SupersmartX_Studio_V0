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
  permissionState: PermissionState | 'unsupported';
}

function getCameraErrorState(err: unknown): { status: CameraStatus; message: string } {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return {
        status: 'permission-denied',
        message: 'Camera or microphone permission was denied. Please allow access in browser settings and retry.',
      };
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError' || err.name === 'NotReadableError') {
      return {
        status: 'devices-unavailable',
        message: 'No camera or microphone was found. Connect a device and retry.',
      };
    }
    if (err.name === 'OverconstrainedError') {
      return {
        status: 'error',
        message: 'Camera constraints not satisfied. Trying fallback settings...',
      };
    }
  }

  return {
    status: 'error',
    message: err instanceof Error ? err.message : 'Unable to initialize camera.',
  };
}

const FALLBACK_CONSTRAINTS: MediaStreamConstraints[] = [
  { video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' }, audio: true },
  { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: true },
  { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: true },
  { video: { facingMode: 'user' }, audio: true },
  { video: true, audio: true },
];

async function checkPermissionState(): Promise<PermissionState | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.permissions) {
    return 'unsupported';
  }
  try {
    const [cameraPerm, micPerm] = await Promise.all([
      navigator.permissions.query({ name: 'camera' as PermissionName }),
      navigator.permissions.query({ name: 'microphone' as PermissionName }),
    ]);
    if (cameraPerm.state === 'denied' || micPerm.state === 'denied') {
      return 'denied';
    }
    if (cameraPerm.state === 'granted' && micPerm.state === 'granted') {
      return 'granted';
    }
    return 'prompt';
  } catch {
    return 'unsupported';
  }
}

export function useCamera(): UseCameraReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [permissionState, setPermissionState] = useState<PermissionState | 'unsupported'>('unsupported');

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
      setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }, []);

  const updatePermissionState = useCallback(async () => {
    const state = await checkPermissionState();
    setPermissionState(state);
  }, []);

  useEffect(() => {
    updatePermissionState();

    const handleDeviceChange = () => {
      refreshDevices();
      updatePermissionState();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices, updatePermissionState]);

  const tryGetUserMedia = useCallback(async (_constraints: MediaStreamConstraints): Promise<MediaStream> => {
    let lastError: Error | null = null;
    for (const c of FALLBACK_CONSTRAINTS) {
      try {
        return await navigator.mediaDevices.getUserMedia(c);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          throw err;
        }
        if (err instanceof DOMException && err.name === 'NotFoundError') {
          throw err;
        }
      }
    }
    throw lastError;
  }, []);

  const initialize = useCallback(async (constraints?: MediaStreamConstraints) => {
    setStatus('requesting');
    setErrorMessage(null);

    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const mediaStream = constraints
        ? await navigator.mediaDevices.getUserMedia(constraints)
        : await tryGetUserMedia(FALLBACK_CONSTRAINTS[0]);

      setStream(mediaStream);
      setIsInitialized(true);
      setStatus('ready');
      await refreshDevices();
      updatePermissionState();
    } catch (err) {
      const error = getCameraErrorState(err);
      setStatus(error.status);
      setErrorMessage(error.message);
      setIsInitialized(false);
      updatePermissionState();
      console.error('Failed to access camera/microphone:', err);
    }
  }, [refreshDevices, stream, tryGetUserMedia, updatePermissionState]);

  return {
    stream,
    isInitialized,
    status,
    errorMessage,
    initialize,
    videoDevices,
    audioDevices,
    refreshDevices,
    permissionState,
  };
}
