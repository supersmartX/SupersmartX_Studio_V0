'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { RecordingState } from '@/types';

interface UseRecordingTimerOptions {
  recordingState: RecordingState;
  stopRecording: () => void;
  showToast: (message: string) => void;
  maxDurationSeconds: number;
  resetOnComplete?: boolean;
}

export function useRecordingTimer({ recordingState, stopRecording, showToast, maxDurationSeconds, resetOnComplete }: UseRecordingTimerOptions) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);

  useEffect(() => {
    if (recordingState === 'recording') {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => {
          const next = prev + 1;
          if (Number.isFinite(maxDurationSeconds)) {
            if (next === maxDurationSeconds - 60) {
              const mins = Math.ceil(maxDurationSeconds / 60);
              showToast(`1 minute remaining on ${mins} minute recording limit`);
            }
            if (next >= maxDurationSeconds) {
              if (timerRef.current) clearInterval(timerRef.current);
              setTimeout(() => stopRecording(), 0);
              const mins = Math.ceil(maxDurationSeconds / 60);
              const display = maxDurationSeconds >= 1800 ? `${mins} minute` : `${maxDurationSeconds / 60} minute`;
              showToast(`Recording stopped — ${display} limit reached`);
              return maxDurationSeconds;
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
  }, [recordingState, stopRecording, showToast, maxDurationSeconds]);

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
