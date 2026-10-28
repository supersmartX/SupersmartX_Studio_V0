'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { RecordingState } from '@/types';

interface UseRecordingTimerOptions {
  recordingState: RecordingState;
  stopRecording: () => void;
  showToast: (message: string) => void;
  // null = unlimited (Creator)
  maxDurationSeconds: number | null;
  resetOnComplete?: boolean;
}

export function useRecordingTimer({ recordingState, stopRecording, showToast, maxDurationSeconds, resetOnComplete }: UseRecordingTimerOptions) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  // Active-time clock. A tick-increment counter undercounted whenever the
  // browser throttles hidden-tab timers (Chrome clamps them to ≥1s and can
  // skip ticks), delaying the Free cap and showing a wrong duration. Elapsed
  // is now derived from wall time, with paused spans banked out exactly like
  // the recorder's own duration clock.
  const accumulatedMsRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);
  const minuteWarningShownRef = useRef(false);
  const cappedRef = useRef(false);

  useEffect(() => {
    if (recordingState === 'recording') {
      if (segmentStartRef.current === null) segmentStartRef.current = Date.now();
      const tick = () => {
        const accumulated = accumulatedMsRef.current;
        const segment = segmentStartRef.current === null ? 0 : Math.max(0, Date.now() - segmentStartRef.current);
        const next = Math.floor((accumulated + segment) / 1000);

        if (typeof maxDurationSeconds === 'number' && Number.isFinite(maxDurationSeconds) && next >= maxDurationSeconds) {
          if (!cappedRef.current) {
            cappedRef.current = true;
            if (timerRef.current) clearInterval(timerRef.current);
            setElapsedSeconds(maxDurationSeconds);
            showToast('Recording stopped — device-local Free recording allowance reached for today');
            setTimeout(() => stopRecording(), 0);
          }
          return;
        }

        setElapsedSeconds(next);
        if (
          typeof maxDurationSeconds === 'number' &&
          Number.isFinite(maxDurationSeconds) &&
          !minuteWarningShownRef.current &&
          next >= maxDurationSeconds - 60
        ) {
          minuteWarningShownRef.current = true;
          showToast('1 minute remaining in your device-local Free recording allowance');
        }
      };

      tick();
      timerRef.current = setInterval(tick, 1000);
    } else if (recordingState === 'paused') {
      if (segmentStartRef.current !== null) {
        accumulatedMsRef.current += Math.max(0, Date.now() - segmentStartRef.current);
        segmentStartRef.current = null;
      }
      if (timerRef.current) clearInterval(timerRef.current);
    } else {
      // A new session starts at zero. 'completed' keeps the last value (the
      // review timer shows how long the take ran) unless resetOnComplete says
      // otherwise.
      if (recordingState === 'idle' || recordingState === 'countdown') {
        accumulatedMsRef.current = 0;
        segmentStartRef.current = null;
        minuteWarningShownRef.current = false;
        cappedRef.current = false;
        setElapsedSeconds(0);
      }
      if (timerRef.current) clearInterval(timerRef.current);
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
    accumulatedMsRef.current = 0;
    segmentStartRef.current = recordingState === 'recording' ? Date.now() : null;
    minuteWarningShownRef.current = false;
    cappedRef.current = false;
    setElapsedSeconds(0);
  }, [recordingState]);

  return { elapsedSeconds, resetTimer };
}
