'use client';

import { useState, useCallback, useEffect } from 'react';
import { INSPIRATION_SCRIPTS } from '@/constants';

const STORAGE_KEY = 'sxs-studio-script';
const TARGET_WPM = 150;

export function useScriptStorage() {
  const [script, setScriptState] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setScriptState(saved);
    } catch {
      // ignore storage access failures
    }
  }, []);

  const setScript = useCallback((value: string) => {
    setScriptState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // ignore storage access failures
    }
  }, []);

  const clearScript = useCallback(() => {
    setScriptState('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage access failures
    }
  }, []);

  const loadInspiration = useCallback(
    (key: string) => {
      const text = INSPIRATION_SCRIPTS[key];
      if (text) {
        setScript(text);
      }
    },
    [setScript]
  );

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estimatedMinutes = wordCount / TARGET_WPM;
  const progress = Math.min((estimatedMinutes / 5) * 100, 100);

  return {
    script,
    setScript,
    clearScript,
    loadInspiration,
    wordCount,
    progress,
  };
}
