import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecorder } from '@/hooks/useRecorder';
import { resetRecordingCodecCache } from '@/lib/recording/codec-capability';
import type { RecordingRecoverySink } from '@/lib/recording/recovery';
import type { RecordingBackupState } from '@/lib/recording/chunk-store';

/**
 * Phase 8 — lifecycle hardening.
 *
 * MediaRecorder callbacks are asynchronous and not mutually exclusive: `error`
 * is followed by `stop`, and a recorder stopped by reset/unmount can still
 * call back after a new take started. These tests pin the single-exit
 * contract: one result, one object URL, one recovery finish — and no late
 * callback resurrecting a take the document already abandoned.
 */

type Handler = ((e?: unknown) => void) | null;

class FakeRecorder {
  static isTypeSupported(mime: string) {
    return mime.startsWith('video/');
  }
  static lastInstance: FakeRecorder | null = null;
  /** When false, stop() only flips state — onstop is delivered manually. */
  static invokeStopHandler = true;
  state = 'inactive';
  mimeType = 'video/webm;codecs=vp9,opus';
  videoBitsPerSecond = 5_000_000;
  audioBitsPerSecond = 96_000;
  ondataavailable: Handler = null;
  onstart: Handler = null;
  onstop: Handler = null;
  onerror: Handler = null;
  constructor(_stream: unknown, _opts?: { mimeType?: string }) {
    FakeRecorder.lastInstance = this;
  }
  start() {
    this.state = 'recording';
    this.onstart?.();
    this.ondataavailable?.({ data: new Blob(['chunk']) } as unknown);
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['final']) } as unknown);
    if (FakeRecorder.invokeStopHandler) this.onstop?.();
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
}

function fakeStream() {
  const track = {
    kind: 'audio',
    readyState: 'live',
    stop: vi.fn(),
    enabled: true,
    getSettings: () => ({ width: 1920, height: 1080, frameRate: 30 }),
  } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

class MemorySink implements RecordingRecoverySink {
  began = 0;
  finished = 0;
  state: RecordingBackupState = 'inactive';
  begin() {
    this.began += 1;
    this.state = 'saving';
  }
  append() {
    this.state = 'saved';
  }
  finish() {
    this.finished += 1;
    this.state = 'inactive';
  }
  getState() {
    return this.state;
  }
  getSessionId() {
    return this.began > 0 ? 'rec-test' : null;
  }
  subscribe() {
    return () => {};
  }
}

function setup() {
  return renderHook(({ s }: { s: MediaStream | null }) => useRecorder(s), {
    initialProps: { s: fakeStream() },
  });
}

function start(result: ReturnType<typeof setup>['result'], options: Parameters<typeof result.current.startRecording>[3] = {}) {
  act(() => {
    result.current.startRecording(() => {}, () => false, undefined, { countdown: false, ...options });
  });
}

describe('recorder lifecycle hardening', () => {
  beforeEach(() => {
    FakeRecorder.lastInstance = null;
    FakeRecorder.invokeStopHandler = true;
    resetRecordingCodecCache();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:http://localhost/${Math.random().toString(36).slice(2)}`),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('MediaRecorder', FakeRecorder);
  });

  it('finalizes once when error is followed by stop', () => {
    const sink = new MemorySink();
    const { result } = setup();
    start(result, { recovery: sink });

    act(() => {
      FakeRecorder.lastInstance?.onerror?.();
      // Spec order: MediaRecorder fires `stop` after `error`.
      FakeRecorder.lastInstance?.onstop?.();
    });

    expect(result.current.recordingState).toBe('completed');
    expect(result.current.recordingResult).not.toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(sink.finished).toBe(1);
  });

  it('drops the navigation guard when the recorder errors', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { result } = setup();
    start(result);

    act(() => {
      FakeRecorder.lastInstance?.onerror?.();
    });

    expect(removeSpy.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
  });

  it('surfaces a runtime recorder failure to the user', () => {
    const onError = vi.fn();
    const { result } = setup();
    start(result, { onError });

    act(() => {
      FakeRecorder.lastInstance?.onerror?.();
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/stopped unexpectedly/i);
    expect(result.current.recordingState).toBe('completed');
  });

  it('does not report a failure when the stop was requested', () => {
    const onError = vi.fn();
    FakeRecorder.invokeStopHandler = false;
    const { result } = setup();
    start(result, { onError });

    act(() => {
      result.current.stopRecording();
      FakeRecorder.lastInstance?.onerror?.();
    });

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.recordingState).toBe('completed');
  });

  it('stop with an already-inactive recorder finalizes instead of stranding the UI', () => {
    const { result } = setup();
    start(result);
    expect(result.current.recordingState).toBe('recording');

    act(() => {
      // The encoder stopped on its own and no `onstop` will arrive.
      FakeRecorder.lastInstance!.state = 'inactive';
      result.current.stopRecording();
    });

    expect(result.current.recordingState).toBe('completed');
    expect(result.current.recordingResult).not.toBeNull();
  });

  it('unmount stops capture but leaves the recovery rows for the next visit', () => {
    const sink = new MemorySink();
    const { result, unmount } = setup();
    start(result, { recovery: sink });

    unmount();

    expect(FakeRecorder.lastInstance?.state).toBe('inactive');
    expect(sink.finished, 'the recovery copy is the only remaining take').toBe(0);
  });

  it('a late onstop after reset cannot resurrect the discarded take', () => {
    const sink = new MemorySink();
    const { result } = setup();
    start(result, { recovery: sink });

    act(() => {
      result.current.resetRecording();
    });

    expect(result.current.recordingState).toBe('idle');
    expect(result.current.recordingResult).toBeNull();
    expect(result.current.videoUrl).toBe('');
    expect(sink.finished).toBe(1);
  });

  it('drops the navigation guard when the script-end path stops the take', () => {
    vi.useFakeTimers();
    try {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const { result } = setup();
      act(() => {
        result.current.startRecording(() => {}, () => true, undefined, {
          countdown: false,
          onScriptEnd: () => {},
        });
      });

      act(() => vi.advanceTimersByTime(200));

      expect(result.current.recordingState).toBe('completed');
      expect(removeSpy.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the countdown navigation guard when no codec is supported', () => {
    vi.useFakeTimers();
    try {
      class NoCodecs {
        static isTypeSupported() {
          return false;
        }
      }
      vi.stubGlobal('MediaRecorder', NoCodecs);
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const onError = vi.fn();
      const { result } = setup();

      act(() => {
        result.current.startRecording(() => {}, () => false, undefined, { onError });
      });
      act(() => vi.advanceTimersByTime(3200));

      expect(result.current.recordingState).toBe('idle');
      expect(onError).toHaveBeenCalledTimes(1);
      expect(removeSpy.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a start against a stream with no tracks instead of silently idling', () => {
    const onError = vi.fn();
    const emptyStream = {
      getTracks: () => [],
      getAudioTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    const { result } = renderHook(({ s }: { s: MediaStream | null }) => useRecorder(s), {
      initialProps: { s: emptyStream },
    });

    act(() => {
      result.current.startRecording(() => {}, () => false, undefined, { countdown: false, onError });
    });

    expect(result.current.recordingState).toBe('idle');
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/not active/i));
  });
});
