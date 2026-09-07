'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { RecordingState } from '@/types';

const FREE_MAX_RECORDING_SECONDS = 300; // 5 minutes

interface UseRecordingTimerOptions {
  recordingState: RecordingState;
  stopRecording: () => void;
  showToast: (message: string) => void;
  isPro: boolean;
  resetOnComplete?: boolean;
}

export function useRecordingTimer({ recordingState, stopRecording, showToast, isPro, resetOnComplete }: UseRecordingTimerOptions) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);

  useEffect(() => {
    if (recordingState === 'recording') {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => {
          const next = prev + 1;
          if (!isPro) {
            if (next === FREE_MAX_RECORDING_SECONDS - 60) {
              showToast('1 minute remaining on Free plan recording limit');
            }
            if (next >= FREE_MAX_RECORDING_SECONDS) {
              if (timerRef.current) clearInterval(timerRef.current);
              setTimeout(() => stopRecording(), 0);
              showToast('Recording stopped — 5 minute limit reached on Free plan');
              return FREE_MAX_RECORDING_SECONDS;
            }
          }
          return next;
        });
      }, 1000);
    } else if (recordingState === 'paused') {
      if (timerRef.current) clearInterval(timerRef.current);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recordingState, stopRecording, showToast, isPro]);

  // Reset elapsed when recording completes (if configured)
  useEffect(() => {
    if (resetOnComplete && recordingState === 'completed') {
      setElapsedSeconds(0);
    }
  }, [recordingState, resetOnComplete]);

  const resetTimer = useCallback(() => {
    setElapsedSeconds(0);
  }, []);

  return { elapsedSeconds, resetTimer };
}
