import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecordingTimer } from '@/hooks/useRecordingTimer';
import { FREE_DAILY_RECORDING_SECONDS } from '@/lib/entitlements';
import type { RecordingState } from '@/types';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(maxDurationSeconds: number | null = FREE_DAILY_RECORDING_SECONDS) {
  const stopRecording = vi.fn();
  const showToast = vi.fn();
  const { result, rerender } = renderHook(() =>
    useRecordingTimer({
      recordingState: 'recording',
      stopRecording,
      showToast,
      maxDurationSeconds,
      resetOnComplete: false,
    }),
  );
  return { result, stopRecording, showToast, rerender };
}

describe('useRecordingTimer — approval wording locks', () => {
  it('shows "1 minute remaining" wording exactly at max-60 seconds', () => {
    const { showToast } = setup(600);

    act(() => {
      vi.advanceTimersByTime(540 * 1000);
    });

    expect(showToast).toHaveBeenCalledWith(
      '1 minute remaining of your 10 min/day Free recording limit',
    );
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('does NOT show "1 minute remaining" at 539 seconds', () => {
    const { showToast } = setup(600);

    act(() => {
      vi.advanceTimersByTime(539 * 1000);
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows limit-reached wording and stops recording at max duration', () => {
    const { result, stopRecording, showToast } = setup(600);

    act(() => {
      vi.advanceTimersByTime(599 * 1000);
    });
    expect(result.current.elapsedSeconds).toBe(599);
    expect(stopRecording).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.elapsedSeconds).toBe(600);
    expect(showToast).toHaveBeenCalledWith('Recording stopped — 10 min/day Free limit reached');
    expect(showToast).toHaveBeenCalledTimes(2);

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(stopRecording).toHaveBeenCalledTimes(1);
  });

  it('does not show minute warning or stop for null max (Creator)', () => {
    const { result, stopRecording, showToast } = setup(null);

    act(() => {
      vi.advanceTimersByTime(700 * 1000);
    });

    expect(result.current.elapsedSeconds).toBe(700);
    expect(showToast).not.toHaveBeenCalled();
    expect(stopRecording).not.toHaveBeenCalled();
  });

  it('does not stop recording when cap not reached', () => {
    const { stopRecording, showToast } = setup(600);

    act(() => {
      vi.advanceTimersByTime(599 * 1000);
    });

    expect(stopRecording).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith(
      'Recording stopped — 10 min/day Free limit reached',
    );
  });

  it('increments elapsed by 1 each second during recording', () => {
    const { result } = setup(600);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.elapsedSeconds).toBe(3);
  });

  it('pauses timer when recording state switches to paused', () => {
    const stopRecording = vi.fn();
    const showToast = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }) =>
        useRecordingTimer({
          recordingState: state,
          stopRecording,
          showToast,
          maxDurationSeconds: 600,
          resetOnComplete: false,
        }),
      { initialProps: { state: 'recording' as RecordingState } },
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.elapsedSeconds).toBe(3);

    rerender({ state: 'paused' });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.elapsedSeconds).toBe(3);

    rerender({ state: 'recording' });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.elapsedSeconds).toBe(5);
  });

  it('resets elapsed on recording completion when resetOnComplete is true', () => {
    const stopRecording = vi.fn();
    const showToast = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }) =>
        useRecordingTimer({
          recordingState: state,
          stopRecording,
          showToast,
          maxDurationSeconds: 600,
          resetOnComplete: true,
        }),
      { initialProps: { state: 'recording' as RecordingState } },
    );

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(result.current.elapsedSeconds).toBe(10);

    rerender({ state: 'completed' });

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.elapsedSeconds).toBe(0);
  });
});
