import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecorder } from '@/hooks/useRecorder';

/**
 * Phase 1 item 1 — pause-aware recorded duration.
 *
 * The old clock was `Date.now() - startTime` at stop: wall time from start()
 * to stop(), which billed the Free daily budget (and stored the duration) for
 * every second the take spent PAUSED — while MediaRecorder.pause() drops that
 * data, so the figure didn't even match what the blob plays. The duration is
 * now ACTIVE capture time: completed segments banked at pause, the current
 * segment counted only while the recorder is not paused.
 *
 * Countdown is disabled in these tests (`{ countdown: false }`) so fake-timer
 * travel starts capture immediately.
 */

type Handler = ((e?: unknown) => void) | null;

class FakeRecorder {
  static isTypeSupported(mime: string) {
    return mime.startsWith('video/');
  }
  state = 'inactive';
  ondataavailable: Handler = null;
  onstop: Handler = null;
  onerror: Handler = null;
  constructor(_stream: unknown, _opts?: { mimeType?: string }) {}
  start() {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['chunk']) } as unknown);
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['final']) } as unknown);
    this.onstop?.();
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
}

function fakeStream() {
  const track = { kind: 'audio', readyState: 'live', stop: vi.fn(), enabled: true } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

function setup() {
  return renderHook(({ s }: { s: MediaStream | null }) => useRecorder(s), {
    initialProps: { s: fakeStream() },
  });
}

function startWithoutCountdown(result: ReturnType<typeof setup>['result']) {
  act(() => {
    result.current.startRecording(() => {}, () => false, undefined, { countdown: false });
  });
}

describe('pause-aware recorded duration', () => {
  beforeEach(() => {
    // Date must travel with the interval clock for duration math.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:http://localhost/${Math.random().toString(36).slice(2)}`),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('MediaRecorder', FakeRecorder);
  });

  afterEach(() => {
    vi.useRealTimers();
    // No unstub: unmount cleanups run after teardown and expect the stub.
  });

  it('excludes paused time from the charged duration', () => {
    const { result } = setup();
    startWithoutCountdown(result);
    expect(result.current.recordingState).toBe('recording');

    // 4s of real capture.
    act(() => vi.advanceTimersByTime(4000));

    act(() => result.current.pauseRecording());
    expect(result.current.recordingState).toBe('paused');

    // 10s paused — the take did not capture this; it must not be billed.
    act(() => vi.advanceTimersByTime(10_000));

    act(() => result.current.resumeRecording(() => {}, () => false));
    expect(result.current.recordingState).toBe('recording');

    // 2s more capture, then stop.
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.stopRecording());

    expect(result.current.recordingState).toBe('completed');
    // Active time = 4 + 2 = 6s. Wall time would have been 16s.
    expect(result.current.recordingResult?.duration).toBeCloseTo(6, 1);
  });

  it('stops from pause without billing the paused wall time', () => {
    const { result } = setup();
    startWithoutCountdown(result);

    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.pauseRecording());
    expect(result.current.recordingState).toBe('paused');

    // Paused for 8s, then the user stops while still paused.
    act(() => vi.advanceTimersByTime(8000));
    act(() => result.current.stopRecording());

    expect(result.current.recordingState).toBe('completed');
    expect(result.current.recordingResult?.duration).toBeCloseTo(3, 1);
  });

  it('counts an uninterrupted take from capture start to stop', () => {
    const { result } = setup();
    startWithoutCountdown(result);

    act(() => vi.advanceTimersByTime(5000));
    act(() => result.current.stopRecording());

    expect(result.current.recordingState).toBe('completed');
    expect(result.current.recordingResult?.duration).toBeCloseTo(5, 1);
  });

  it('multiple pause/resume cycles only bank active segments', () => {
    const { result } = setup();
    startWithoutCountdown(result);

    act(() => vi.advanceTimersByTime(1000)); // capture
    act(() => result.current.pauseRecording());
    act(() => vi.advanceTimersByTime(4000)); // paused
    act(() => result.current.resumeRecording(() => {}, () => false));

    act(() => vi.advanceTimersByTime(2000)); // capture
    act(() => result.current.pauseRecording());
    act(() => vi.advanceTimersByTime(7000)); // paused
    act(() => result.current.resumeRecording(() => {}, () => false));

    act(() => vi.advanceTimersByTime(3000)); // capture
    act(() => result.current.stopRecording());

    expect(result.current.recordingResult?.duration).toBeCloseTo(6, 1); // 1 + 2 + 3
  });
});
