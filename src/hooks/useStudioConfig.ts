'use client';

import { useEffect } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useRecordingConfig } from '@/hooks/useRecordingConfig';

export function useStudioConfig() {
  const settings = useSettings();
  const recording = useRecordingConfig();

  // Sync settings → recording config (platform, dimensions, mirror)
  useEffect(() => {
    recording.setPlatformId(settings.platformId);
    recording.setCustomAspectRatio(settings.customAspectRatio);
    recording.setCustomDimensions(settings.customWidth, settings.customHeight);
    recording.setMirrored(settings.isMirrored);
  }, [
    settings.platformId,
    settings.customAspectRatio,
    settings.customWidth,
    settings.customHeight,
    settings.isMirrored,
    recording.setPlatformId,
    recording.setCustomAspectRatio,
    recording.setCustomDimensions,
    recording.setMirrored,
  ]);

  // Sync device IDs from settings → recording config
  useEffect(() => {
    recording.setVideoDevice(settings.selectedVideoDevice);
    recording.setAudioDevice(settings.selectedAudioDevice);
  }, [
    settings.selectedVideoDevice,
    settings.selectedAudioDevice,
    recording.setVideoDevice,
    recording.setAudioDevice,
  ]);

  return {
    settings,
    recordingConfig: recording.config,
  };
}
