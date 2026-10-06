import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecorder } from '@/hooks/useRecorder';

/**
 * FC-1.0 DC-2 (Phase 1 item 8) — script-end auto-stop + toast.
 *
 * When the teleprompter's end-check stops the take, the recorder fires
 * `onScriptEnd` exactly once so the studio can announce "Script ended —
 * recording stopped". It must be the ONLY stop path that announces itself:
 * a manual Stop/Pause/Reset clears the end-check interval first, so those
 * paths can never produce the toast. No timing or consumption rules change.
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

describe('script-end auto-stop announces itself (and only itself)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

  it('fires the callback once when the teleprompter end-check stops the take', () => {
    const { result } = setup();
    const onScriptEnd = vi.fn();

    act(() => {
      result.current.startRecording(() => {}, () => true, undefined, {
        countdown: false,
        onScriptEnd,
      });
    });
    expect(result.current.recordingState).toBe('recording');
    expect(onScriptEnd).not.toHaveBeenCalled();

    // First end-check tick (200ms): script has ended → stop + announce.
    act(() => vi.advanceTimersByTime(200));
    expect(onScriptEnd).toHaveBeenCalledTimes(1);
    expect(result.current.recordingState).toBe('completed');

    // The interval is dead — no repeated announcements later.
    act(() => vi.advanceTimersByTime(5000));
    expect(onScriptEnd).toHaveBeenCalledTimes(1);
  });

  it('a manual Stop never announces the script end, even with the script at its end', () => {
    const { result } = setup();
    const onScriptEnd = vi.fn();

    // checkEnd says "ended" — the interval WOULD fire it if still armed.
    act(() => {
      result.current.startRecording(() => {}, () => true, undefined, {
        countdown: false,
        onScriptEnd,
      });
    });

    // Manual stop straight away.
    act(() => result.current.stopRecording());
    expect(result.current.recordingState).toBe('completed');
    expect(onScriptEnd, 'manual stop must stay silent').not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(5000));
    expect(onScriptEnd).not.toHaveBeenCalled();
  });

  it('a manual Pause followed by manual Stop stays silent too', () => {
    const { result } = setup();
    const onScriptEnd = vi.fn();

    act(() => {
      result.current.startRecording(() => {}, () => true, undefined, {
        countdown: false,
        onScriptEnd,
      });
    });
    act(() => result.current.pauseRecording());
    expect(result.current.recordingState).toBe('paused');
    expect(onScriptEnd).not.toHaveBeenCalled();

    act(() => result.current.stopRecording());
    act(() => vi.advanceTimersByTime(5000));
    expect(onScriptEnd).not.toHaveBeenCalled();
    expect(result.current.recordingState).toBe('completed');
  });

  it('starts with no callback configured without ever throwing on script end', () => {
    const { result } = setup();

    act(() => {
      result.current.startRecording(() => {}, () => true, undefined, { countdown: false });
    });
    act(() => vi.advanceTimersByTime(300));

    expect(result.current.recordingState).toBe('completed');
  });
});
