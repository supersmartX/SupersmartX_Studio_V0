'use client';

import { useState, useCallback, useEffect } from 'react';
import type { TeleprompterSettings, AspectRatio } from '@/types';
import { DEFAULT_SETTINGS } from '@/constants';

const SETTINGS_KEY = 'sxs-studio-settings';

interface PersistedSettings {
  teleprompter: TeleprompterSettings;
  isMirrored: boolean;
  countdownEnabled: boolean;
  selectedVideoDevice: string;
  selectedAudioDevice: string;
  aspectRatio: AspectRatio;
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

export function useSettings() {
  const [teleprompter, setTeleprompterState] = useState<TeleprompterSettings>(DEFAULT_SETTINGS);
  const [isMirrored, setIsMirrored] = useState(true);
  const [countdownEnabled, setCountdownEnabled] = useState(true);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const saved = loadSettings();
    if (saved) {
      setTeleprompterState(saved.teleprompter);
      setIsMirrored(saved.isMirrored);
      setCountdownEnabled(saved.countdownEnabled);
      setSelectedVideoDevice(saved.selectedVideoDevice);
      setSelectedAudioDevice(saved.selectedAudioDevice);
      if (saved.aspectRatio) setAspectRatio(saved.aspectRatio);
    }
    setIsLoaded(true);
  }, []);

  const persist = useCallback(() => {
    saveSettings({
      teleprompter,
      isMirrored,
      countdownEnabled,
      selectedVideoDevice,
      selectedAudioDevice,
      aspectRatio,
    });
  }, [teleprompter, isMirrored, countdownEnabled, selectedVideoDevice, selectedAudioDevice, aspectRatio]);

  useEffect(() => {
    if (isLoaded) persist();
  }, [teleprompter, isMirrored, countdownEnabled, selectedVideoDevice, selectedAudioDevice, aspectRatio, isLoaded, persist]);

  const setTeleprompter = useCallback((settings: TeleprompterSettings) => {
    setTeleprompterState(settings);
  }, []);

  const updateTeleprompter = useCallback((patch: Partial<TeleprompterSettings>) => {
    setTeleprompterState((prev) => ({ ...prev, ...patch }));
  }, []);

  return {
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
    aspectRatio,
    setAspectRatio,
    isLoaded,
  };
}
