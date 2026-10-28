'use client';

import { useCallback } from 'react';
import {
  buildPreferredVideoConstraints,
  buildPreferredAudioConstraints,
} from '@/lib/recording/capture-constraints';
import type { useSettings } from '@/hooks/useSettings';
import type { useCamera } from '@/hooks/useCamera';

interface UseStudioCameraOptions {
  settings: ReturnType<typeof useSettings>;
  camera: ReturnType<typeof useCamera>;
}

/**
 * Studio-layer camera orchestration.
 *
 * SOURCE vs COMPOSITION vs OUTPUT (Phase 6): the camera is acquired ONCE at
 * source quality (1920×1080 @ 30 preferred, graceful fallback inside
 * `useCamera`) and is deliberately INDEPENDENT of the selected platform.
 * Composition to 16:9 / 9:16 / 4:5 happens at export (mediabunny crop), so
 * changing the platform ratio must NOT restart the camera, destroy the
 * MediaRecorder, or change source quality — that is why there is no
 * platform-change re-initialization effect here anymore, and why these
 * constraints are not derived from PLATFORM_PRESETS dimensions (desktop
 * cameras rarely offer the platform's card geometry; asking for it only
 * moved devices between modes and restarted the camera for nothing).
 */
export function useStudioCamera({ settings, camera }: UseStudioCameraOptions) {
  // Auto-select first available device when device list changes
  const autoSelectDevices = useCallback(() => {
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
  }, [
    camera.videoDevices,
    camera.audioDevices,
    settings.selectedVideoDevice,
    settings.selectedAudioDevice,
    settings.setSelectedVideoDevice,
    settings.setSelectedAudioDevice,
  ]);

  // Initialize camera at SOURCE quality. Returns the live stream (or null)
  // so callers can act on it synchronously without waiting for
  // state/effect round-trips.
  const handleCameraInitialize = useCallback(async (): Promise<MediaStream | null> => {
    const constraints: MediaStreamConstraints = {
      video: buildPreferredVideoConstraints(settings.selectedVideoDevice || undefined),
      audio: settings.selectedAudioDevice
        ? buildPreferredAudioConstraints(settings.selectedAudioDevice)
        : buildPreferredAudioConstraints(),
    };

    try {
      return await camera.initialize(constraints);
    } catch {
      return await camera.initialize();
    }
  }, [camera, settings.selectedAudioDevice, settings.selectedVideoDevice]);

  // Handle video device change — same source-quality constraints, new device.
  const handleVideoDeviceChange = useCallback(async (deviceId: string) => {
    settings.setSelectedVideoDevice(deviceId);
    if (camera.isInitialized) {
      const constraints: MediaStreamConstraints = {
        video: buildPreferredVideoConstraints(deviceId),
        audio: settings.selectedAudioDevice
          ? buildPreferredAudioConstraints(settings.selectedAudioDevice)
          : buildPreferredAudioConstraints(),
      };
      await camera.initialize(constraints);
    }
  }, [camera, settings.selectedAudioDevice, settings.setSelectedVideoDevice]);

  // Handle audio device change — same source-quality constraints, new mic.
  const handleAudioDeviceChange = useCallback(async (deviceId: string) => {
    settings.setSelectedAudioDevice(deviceId);
    if (camera.isInitialized) {
      const constraints: MediaStreamConstraints = {
        video: buildPreferredVideoConstraints(settings.selectedVideoDevice || undefined),
        audio: buildPreferredAudioConstraints(deviceId),
      };
      await camera.initialize(constraints);
    }
  }, [camera, settings.selectedVideoDevice, settings.setSelectedAudioDevice]);

  return {
    camera,
    handleCameraInitialize,
    handleVideoDeviceChange,
    handleAudioDeviceChange,
    autoSelectDevices,
  };
}
