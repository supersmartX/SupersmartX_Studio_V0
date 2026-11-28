'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { TeleprompterSettings, AspectRatio, PlatformId, WebcamOverlaySettings } from '@/types';
import { DEFAULT_SETTINGS, PLATFORM_PRESETS, DEFAULT_PLATFORM_ID } from '@/constants';
import { DEFAULT_WEBCAM_OVERLAY, sanitizeWebcamOverlay } from '@/lib/recording/webcam-overlay';

const SETTINGS_KEY = 'sxs-studio-settings';

interface PersistedSettings {
  teleprompter: TeleprompterSettings;
  isMirrored: boolean;
  countdownEnabled: boolean;
  selectedVideoDevice: string;
  selectedAudioDevice: string;
  platformId: PlatformId;
  customAspectRatio: AspectRatio;
  customWidth: number;
  customHeight: number;
  webcamOverlay?: WebcamOverlaySettings;
}

function loadSettings(): PersistedSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSettings(settings: PersistedSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage access failures
  }
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

export function useSettings() {
  const [teleprompter, setTeleprompterState] = useState<TeleprompterSettings>(DEFAULT_SETTINGS);
  const [isMirrored, setIsMirrored] = useState(true);
  const [countdownEnabled, setCountdownEnabled] = useState(true);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState('');
  const [platformId, setPlatformId] = useState<PlatformId>(DEFAULT_PLATFORM_ID);
  const [customAspectRatio, setCustomAspectRatio] = useState<AspectRatio>('16:9');
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [webcamOverlay, setWebcamOverlayState] = useState<WebcamOverlaySettings>(DEFAULT_WEBCAM_OVERLAY);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const saved = loadSettings();
    if (saved) {
      setTeleprompterState(saved.teleprompter);
      setIsMirrored(saved.isMirrored);
      setCountdownEnabled(saved.countdownEnabled);
      setSelectedVideoDevice(saved.selectedVideoDevice);
      setSelectedAudioDevice(saved.selectedAudioDevice);
      if (saved.platformId) setPlatformId(saved.platformId);
      if (saved.customAspectRatio) setCustomAspectRatio(saved.customAspectRatio);
      if (saved.customWidth !== undefined) setCustomWidth(saved.customWidth);
      if (saved.customHeight !== undefined) setCustomHeight(saved.customHeight);
      // Screen+webcam composition layout survives reloads; sanitized because a
      // stale or hand-edited payload must never produce an off-canvas overlay.
      if (saved.webcamOverlay) setWebcamOverlayState(sanitizeWebcamOverlay(saved.webcamOverlay));
    }
    setIsLoaded(true);
  }, []);

  const aspectRatio = deriveAspectRatio(platformId, customAspectRatio);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      saveSettings({
        teleprompter,
        isMirrored,
        countdownEnabled,
        selectedVideoDevice,
        selectedAudioDevice,
        platformId,
        customAspectRatio,
        customWidth,
        customHeight,
        webcamOverlay,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [teleprompter, isMirrored, countdownEnabled, selectedVideoDevice, selectedAudioDevice, platformId, customAspectRatio, customWidth, customHeight, webcamOverlay, isLoaded]);

  const setWebcamOverlay = useCallback((patch: Partial<WebcamOverlaySettings>) => {
    setWebcamOverlayState((prev) => sanitizeWebcamOverlay({ ...prev, ...patch }));
  }, []);

  const setTeleprompter = useCallback((settings: TeleprompterSettings) => {
    setTeleprompterState(settings);
  }, []);

  const updateTeleprompter = useCallback((patch: Partial<TeleprompterSettings>) => {
    setTeleprompterState((prev) => ({ ...prev, ...patch }));
  }, []);

  return useMemo(() => ({
    teleprompter,
    setTeleprompter,
    updateTeleprompter,
    isMirrored,
    setIsMirrored,
    countdownEnabled,
    setCountdownEnabled,
    selectedVideoDevice,
    setSelectedVideoDevice,
    selectedAudioDevice,
    setSelectedAudioDevice,
    platformId,
    setPlatformId,
    customAspectRatio,
    setCustomAspectRatio,
    customWidth,
    setCustomWidth,
    customHeight,
    setCustomHeight,
    webcamOverlay,
    setWebcamOverlay,
    aspectRatio,
    isLoaded,
  }), [
    teleprompter, setTeleprompter, updateTeleprompter,
    isMirrored, countdownEnabled,
    selectedVideoDevice, selectedAudioDevice,
    platformId, customAspectRatio, customWidth, customHeight,
    webcamOverlay, setWebcamOverlay,
    aspectRatio, isLoaded,
  ]);
}
