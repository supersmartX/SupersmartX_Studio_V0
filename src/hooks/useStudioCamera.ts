'use client';

import { useCallback, useRef, useEffect } from 'react';
import { PLATFORM_PRESETS } from '@/constants';
import type { RecordingState } from '@/types';
import type { useSettings } from '@/hooks/useSettings';
import type { useCamera } from '@/hooks/useCamera';

interface UseStudioCameraOptions {
  recordingState: RecordingState;
  settings: ReturnType<typeof useSettings>;
  camera: ReturnType<typeof useCamera>;
}

export function useStudioCamera({ recordingState, settings, camera }: UseStudioCameraOptions) {
  const prevPlatformRef = useRef(settings.platformId);

  // Auto-select first available device when device list changes
  useEffect(() => {
    if (camera.videoDevices.length > 0) {
      const stillExists = camera.videoDevices.some(d => d.deviceId === settings.selectedVideoDevice);
      if (!settings.selectedVideoDevice || !stillExists) {
        settings.setSelectedVideoDevice(camera.videoDevices[0].deviceId);
      }
    } else {
      settings.setSelectedVideoDevice('');
    }
    if (camera.audioDevices.length > 0) {
      const stillExists = camera.audioDevices.some(d => d.deviceId === settings.selectedAudioDevice);
      if (!settings.selectedAudioDevice || !stillExists) {
        settings.setSelectedAudioDevice(camera.audioDevices[0].deviceId);
      }
    } else {
      settings.setSelectedAudioDevice('');
    }
  }, [camera.videoDevices, camera.audioDevices, settings.selectedVideoDevice, settings.selectedAudioDevice, settings.setSelectedVideoDevice, settings.setSelectedAudioDevice]);

  // Initialize camera with platform-specific constraints
  const handleCameraInitialize = useCallback(async () => {
    const platformPreset = PLATFORM_PRESETS.find((p) => p.id === settings.platformId) ?? PLATFORM_PRESETS[0];
    const constraints: MediaStreamConstraints = {
      video: settings.selectedVideoDevice
        ? { deviceId: { exact: settings.selectedVideoDevice }, width: { ideal: platformPreset.width }, height: { ideal: platformPreset.height } }
        : { width: { ideal: platformPreset.width }, height: { ideal: platformPreset.height }, facingMode: 'user' },
      audio: settings.selectedAudioDevice
        ? { deviceId: { exact: settings.selectedAudioDevice } }
        : true,
    };

    try {
      await camera.initialize(constraints);
    } catch {
      await camera.initialize();
    }
  }, [camera, settings.selectedAudioDevice, settings.selectedVideoDevice, settings.platformId]);

  // Reinitialize camera when platform changes (only when idle)
  useEffect(() => {
    if (prevPlatformRef.current !== settings.platformId) {
      prevPlatformRef.current = settings.platformId;
      if (camera.isInitialized && recordingState === 'idle') {
        handleCameraInitialize();
      }
    }
  }, [settings.platformId]);

  // Handle video device change
  const handleVideoDeviceChange = useCallback(async (deviceId: string) => {
    settings.setSelectedVideoDevice(deviceId);
    if (camera.isInitialized) {
      const constraints: MediaStreamConstraints = {
        video: { deviceId: { exact: deviceId } },
        audio: settings.selectedAudioDevice
          ? { deviceId: { exact: settings.selectedAudioDevice } }
          : true,
      };
      await camera.initialize(constraints);
    }
  }, [camera, settings.selectedAudioDevice, settings.setSelectedVideoDevice]);

  // Handle audio device change
  const handleAudioDeviceChange = useCallback(async (deviceId: string) => {
    settings.setSelectedAudioDevice(deviceId);
    if (camera.isInitialized) {
      const constraints: MediaStreamConstraints = {
        video: settings.selectedVideoDevice
          ? { deviceId: { exact: settings.selectedVideoDevice } }
          : true,
        audio: { deviceId: { exact: deviceId } },
      };
      await camera.initialize(constraints);
    }
  }, [camera, settings.selectedVideoDevice, settings.setSelectedAudioDevice]);

  return {
    camera,
    handleCameraInitialize,
    handleVideoDeviceChange,
    handleAudioDeviceChange,
  };
}
