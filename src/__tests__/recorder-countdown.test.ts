import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecorder } from '@/hooks/useRecorder';

/**
 * FC-1.0 countdown contract (Phase 1 item 2):
 *   - countdown ON  → capture does not start until it completes, and the
 *                     countdown is cancellable into a clean idle state;
 *   - countdown OFF → capture starts immediately, no artificial wait;
 *   - cancelling / stopping mid-count consumes no quota or teleprompter
 *     allowance (nothing recorded yet) and drops the navigation guard.
 */
type Handler = ((e?: unknown) => void) | null;

let recorderCreations = 0;

class FakeRecorder {
  static isTypeSupported(mime: string) {
    return mime.startsWith('video/');
  }
  state = 'inactive';
  ondataavailable: Handler = null;
  onstop: Handler = null;
  onerror: Handler = null;
  constructor(_stream: unknown, _opts?: { mimeType?: string }) {
    recorderCreations += 1;
  }
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

describe('countdown behavior', () => {
  beforeEach(() => {
    recorderCreations = 0;
    vi.useFakeTimers();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:http://localhost/${Math.random().toString(36).slice(2)}`),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('MediaRecorder', FakeRecorder);
  });

  afterEach(() => {
    vi.useRealTimers();
    // URL/MediaRecorder stubs stay for the file — unmount cleanups run later
    // and still expect the stubbed URL statics.
  });

  it('countdown on: capture does not start until the countdown completes', () => {
    const { result } = setup();

    act(() => {
      result.current.startRecording(() => {}, () => false);
    });
    expect(result.current.recordingState).toBe('countdown');
    // Nothing captured yet: the MediaRecorder does not exist during the count.
    expect(recorderCreations).toBe(0);

    act(() => vi.advanceTimersByTime(800));
    expect(result.current.countdownText).toBe('3');
    expect(result.current.recordingState).toBe('countdown');

    // 3199ms in: still counting (fourth tick lands at 3200ms).
    act(() => vi.advanceTimersByTime(2399));
    expect(result.current.recordingState).toBe('countdown');
    expect(recorderCreations).toBe(0);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.recordingState).toBe('recording');
    expect(recorderCreations).toBe(1);
    expect(result.current.countdownText).toBe('');
  });

  it('countdown off: recording starts immediately with no artificial wait', () => {
    const { result } = setup();

    act(() => {
      result.current.startRecording(() => {}, () => false, undefined, { countdown: false });
    });

    expect(result.current.recordingState).toBe('recording');
    expect(result.current.countdownText).toBe('');
    expect(recorderCreations, 'capture begins at once — no invisible hold').toBe(1);

    // No countdown timers materialise later either.
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.recordingState).toBe('recording');
  });

  it('cancelling the countdown leaves a clean non-recording state', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { result } = setup();

    act(() => {
      result.current.startRecording(() => {}, () => false);
    });
    expect(result.current.recordingState).toBe('countdown');
    // The navigation guard is live while the countdown runs.
    act(() => vi.advanceTimersByTime(1600));
    expect(result.current.countdownText).toBe('2');

    act(() => result.current.cancelCountdown());

    expect(result.current.recordingState).toBe('idle');
    expect(result.current.countdownText, 'no phantom countdown text').toBe('');
    expect(recorderCreations, 'cancelling never starts a capture session').toBe(0);
    expect(
      removeSpy.mock.calls.some(([type]) => type === 'beforeunload'),
      'the countdown navigation guard must be dropped on cancel',
    ).toBe(true);

    // The cancelled interval is dead: time passing must not start anything.
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.recordingState).toBe('idle');
    expect(recorderCreations).toBe(0);

    // And the recorder is reusable straight afterwards.
    act(() => {
      result.current.startRecording(() => {}, () => false, undefined, { countdown: false });
    });
    expect(result.current.recordingState).toBe('recording');
    expect(recorderCreations).toBe(1);
  });

  it('stop during the countdown cancels instead of stranding a phantom state', () => {
    const { result } = setup();

    act(() => {
      result.current.startRecording(() => {}, () => false);
    });
    expect(result.current.recordingState).toBe('countdown');

    // Every Stop path funnels through stopRecording; before Phase 1 it left
    // the state at 'countdown' forever.
    act(() => result.current.stopRecording());
    expect(result.current.recordingState).toBe('idle');
    expect(result.current.countdownText).toBe('');
    expect(recorderCreations).toBe(0);
  });

  it('pause during the countdown is a no-op (capture has not begun)', () => {
    const { result } = setup();

    act(() => {
      result.current.startRecording(() => {}, () => false);
    });
    act(() => result.current.pauseRecording());
    expect(result.current.recordingState).toBe('countdown');

    act(() => vi.advanceTimersByTime(3200));
    expect(result.current.recordingState, 'the countdown still completes normally').toBe('recording');
  });
});
