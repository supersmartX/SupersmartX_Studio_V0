'use client';

import { useState, useCallback, useMemo } from 'react';
import type { RecordingConfiguration, PlatformId, AspectRatio } from '@/types';
import { PLATFORM_PRESETS, DEFAULT_PLATFORM_ID } from '@/constants';

interface UseRecordingConfigReturn {
  config: RecordingConfiguration;
  setPlatformId: (id: PlatformId) => void;
  setCustomAspectRatio: (ratio: AspectRatio) => void;
  setCustomDimensions: (width: number, height: number) => void;
  setVideoDevice: (deviceId: string) => void;
  setAudioDevice: (deviceId: string) => void;
  setMirrored: (mirrored: boolean) => void;
  updateConfig: (updates: Partial<RecordingConfiguration>) => void;
  resetConfig: () => void;
  getCanvasDimensions: () => { width: number; height: number };
}

function getPlatformPreset(platformId: PlatformId) {
  return PLATFORM_PRESETS.find((p) => p.id === platformId) ?? PLATFORM_PRESETS[0];
}

function deriveAspectRatio(
  platformId: PlatformId,
  customAspectRatio: AspectRatio,
): AspectRatio {
  if (platformId === 'custom') return customAspectRatio;
  return getPlatformPreset(platformId).aspectRatio;
}

function deriveResolution(
  platformId: PlatformId,
  customAspectRatio: AspectRatio,
  customWidth: number,
  customHeight: number,
): { width: number; height: number } {
  if (platformId === 'custom') {
    // Validate custom dimensions
    const validWidth = Math.max(1, Math.min(1920, Math.floor(customWidth)));
    const validHeight = Math.max(1, Math.min(1080, Math.floor(customHeight)));
    return { width: validWidth, height: validHeight };
  }
  const preset = getPlatformPreset(platformId);
  return { width: preset.width, height: preset.height };
}

export function useRecordingConfig(): UseRecordingConfigReturn {
  const [platformId, setPlatformIdState] = useState<PlatformId>(DEFAULT_PLATFORM_ID);
  const [customAspectRatio, setCustomAspectRatioState] = useState<AspectRatio>('16:9');
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [videoDeviceId, setVideoDeviceId] = useState('');
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [isMirrored, setIsMirrored] = useState(true);

  // Derive current configuration
  const config = useMemo(() => {
    const aspectRatio = deriveAspectRatio(platformId, customAspectRatio);
    const { width, height } = deriveResolution(platformId, customAspectRatio, customWidth, customHeight);
    
    return {
      platformId,
      aspectRatio,
      width,
      height,
      fps: 30,
      videoDeviceId,
      audioDeviceId,
      isMirrored,
    };
  }, [platformId, customAspectRatio, customWidth, customHeight, videoDeviceId, audioDeviceId, isMirrored]);

  // Get canvas dimensions for recording
  const getCanvasDimensions = useCallback(() => {
    return { width: config.width, height: config.height };
  }, [config.width, config.height]);

  // Set platform preference
  const setPlatformId = useCallback((id: PlatformId) => {
    setPlatformIdState(id);
  }, []);

  // Set custom aspect ratio
  const setCustomAspectRatio = useCallback((ratio: AspectRatio) => {
    setCustomAspectRatioState(ratio);
  }, []);

  // Set custom dimensions with validation
  const setCustomDimensions = useCallback((width: number, height: number) => {
    const validWidth = Math.max(1, Math.min(1920, Math.floor(width)));
    const validHeight = Math.max(1, Math.min(1080, Math.floor(height)));
    setCustomWidth(validWidth);
    setCustomHeight(validHeight);
  }, []);

  // Set video device
  const setVideoDevice = useCallback((deviceId: string) => {
    setVideoDeviceId(deviceId);
  }, []);

  // Set audio device
  const setAudioDevice = useCallback((deviceId: string) => {
    setAudioDeviceId(deviceId);
  }, []);

  // Set mirrored state
  const setMirrored = useCallback((mirrored: boolean) => {
    setIsMirrored(mirrored);
  }, []);

  // Update multiple config properties
  const updateConfig = useCallback((updates: Partial<RecordingConfiguration>) => {
    if (updates.platformId !== undefined) {
      setPlatformIdState(updates.platformId);
    }
    if (updates.aspectRatio !== undefined) {
      setCustomAspectRatioState(updates.aspectRatio);
    }
    if (updates.width !== undefined) {
      setCustomWidth(updates.width);
    }
    if (updates.height !== undefined) {
      setCustomHeight(updates.height);
    }
    if (updates.videoDeviceId !== undefined) {
      setVideoDeviceId(updates.videoDeviceId);
    }
    if (updates.audioDeviceId !== undefined) {
      setAudioDeviceId(updates.audioDeviceId);
    }
    if (updates.isMirrored !== undefined) {
      setIsMirrored(updates.isMirrored);
    }
  }, []);

  // Reset to default configuration
  const resetConfig = useCallback(() => {
    setPlatformIdState(DEFAULT_PLATFORM_ID);
    setCustomAspectRatioState('16:9');
    setCustomWidth(1920);
    setCustomHeight(1080);
    setIsMirrored(true);
  }, []);

  return {
    config,
    setPlatformId,
    setCustomAspectRatio,
    setCustomDimensions,
    setVideoDevice,
    setAudioDevice,
    setMirrored,
    updateConfig,
    resetConfig,
    getCanvasDimensions,
  };
}
