import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecorder } from '@/hooks/useRecorder';
import { resetRecordingCodecCache } from '@/lib/recording/codec-capability';
import type { RecordingRecoverySink } from '@/lib/recording/recovery';
import type { RecordingBackupState } from '@/lib/recording/chunk-store';

/**
 * useRecorder × recovery-sink integration (Phase 8/9/14): the recorder feeds
 * the sink every chunk, opens the session at capture start, closes it when
 * the take ends in this document, and NEVER lets a sink problem interrupt
 * the capture state machine.
 */

type Handler = ((e?: unknown) => void) | null;

class FakeRecorder {
  static isTypeSupported(mime: string) {
    return mime.startsWith('video/');
  }
  state = 'inactive';
  mimeType = 'video/webm;codecs=vp9,opus';
  videoBitsPerSecond = 5_000_000;
  audioBitsPerSecond = 96_000;
  ondataavailable: Handler = null;
  onstart: Handler = null;
  onstop: Handler = null;
  onerror: Handler = null;
  constructor(_stream: unknown, public opts?: { mimeType?: string }) {
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
    this.onstop?.();
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  static lastInstance: FakeRecorder | null = null;
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
  appended: Array<{ bytes: number; activeMs: number }> = [];
  finished = 0;
  fail = false;
  state: RecordingBackupState = 'inactive';
  private listeners = new Set<() => void>();

  begin(): void {
    this.began += 1;
    this.state = 'saving';
    this.listeners.forEach((l) => l());
  }
  append(blob: Blob, activeMs: number): void {
    if (this.fail) {
      this.state = 'unavailable';
    } else {
      this.appended.push({ bytes: blob.size, activeMs });
      this.state = 'saved';
    }
    this.listeners.forEach((l) => l());
  }
  finish(): void {
    this.finished += 1;
    this.state = 'inactive';
    this.listeners.forEach((l) => l());
  }
  getState() {
    return this.state;
  }
  getSessionId() {
    return this.began > 0 ? 'rec-test' : null;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

describe('useRecorder feeds the recovery copy without disturbing capture', () => {
  beforeEach(() => {
    FakeRecorder.lastInstance = null;
    // The codec selection is cached per document; tests stub isTypeSupported
    // differently per case, so each case starts from a clean cache.
    resetRecordingCodecCache();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:http://localhost/${Math.random().toString(36).slice(2)}`),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('MediaRecorder', FakeRecorder);
  });

  it('begins the session, appends every chunk, and finishes at stop', async () => {
    const sink = new MemorySink();
    const { result } = renderHook(({ s }: { s: MediaStream | null }) => useRecorder(s), {
      initialProps: { s: fakeStream() },
    });

    await act(async () => {
      result.current.startRecording(() => {}, () => false, undefined, { countdown: false, recovery: sink });
    });
    expect(result.current.recordingState).toBe('recording');
    expect(sink.began).toBe(1);
    // FakeRecorder emits one chunk at start().
    expect(sink.appended.length).toBe(1);

    await act(async () => {
      result.current.stopRecording();
      await new Promise((r) => setTimeout(r, 100));
    });
    // All chunks (start + the stop's final chunk) were appended; the session
    // closed exactly once.
    expect(sink.appended.length).toBe(2);
    expect(sink.finished).toBe(1);
    expect(result.current.recordingState).toBe('completed');
    expect(result.current.recordingResult?.duration).toBeGreaterThan(0);
    // The format surfaced to the UI is the REAL configuration in use.
    expect(result.current.recordingFormat?.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(result.current.recordingFormat?.videoBitsPerSecond).toBeGreaterThan(0);
    expect(result.current.recordingFormat?.configuredVideoBitrate).toBe(8_000_000);
    expect(result.current.recordingFormat?.actualVideoBitrate).toBe(5_000_000);
    expect(result.current.recordingFormat?.configuredAudioBitrate).toBe(128_000);
    expect(result.current.recordingFormat?.actualAudioBitrate).toBe(96_000);
  });

  it('finishes the session and salvages chunks when MediaRecorder errors', async () => {
    const sink = new MemorySink();
    // A STABLE stream identity: a fresh MediaStream object per render would
    // trip the stream-change effect (which stops an active take).
    const { result } = renderHook(({ s }: { s: MediaStream | null }) => useRecorder(s), {
      initialProps: { s: fakeStream() },
    });
    await act(async () => {
      result.current.startRecording(() => {}, () => false, undefined, { countdown: false, recovery: sink });
    });

    // Fire the encoder-failure path: onerror fires (with chunks already in),
    // onstop never does.
    await act(async () => {
      FakeRecorder.lastInstance?.onerror?.();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(sink.finished).toBe(1);
    expect(result.current.recordingState).toBe('completed');
    expect(result.current.recordingResult?.metadata).toMatchObject({
      requestedWidth: 1920,
      requestedHeight: 1080,
      requestedFps: 30,
      actualWidth: null,
      actualHeight: null,
      actualFps: null,
      configuredVideoBitrate: 8_000_000,
      actualVideoBitrate: 5_000_000,
      configuredAudioBitrate: 128_000,
      actualAudioBitrate: 96_000,
    });
    // Salvaged take carries the chunks accumulated before the error.
    expect(result.current.recordingResult?.blob?.size).toBeGreaterThan(0);
  });

  it('refuses to capture when no supported codec exists (onError surfaces)', async () => {
    class NoCodecs {
      static isTypeSupported() {
        return false;
      }
    }
    vi.stubGlobal('MediaRecorder', NoCodecs);
    const fake = new MemorySink();
    const { result } = renderHook(({ s }: { s: MediaStream | null }) => useRecorder(s), {
      initialProps: { s: fakeStream() },
    });
    const onError = vi.fn();
    await act(async () => {
      result.current.startRecording(() => {}, () => false, undefined, { countdown: false, recovery: fake, onError });
    });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('cannot record video'));
    expect(result.current.recordingState).toBe('idle');
    expect(fake.began).toBe(0);
  });

  it('never lets recovery-unavailability interrupt the take (sink throws)', async () => {
    const explodingSink: RecordingRecoverySink = {
      begin: () => {
        throw new Error('storage exploded');
      },
      append: () => {
        throw new Error('storage exploded');
      },
      finish: () => {
        throw new Error('storage exploded');
      },
      getState: () => 'unavailable',
      getSessionId: () => null,
      subscribe: () => () => {},
    };
    const { result } = renderHook(({ s }: { s: MediaStream | null }) => useRecorder(s), {
      initialProps: { s: fakeStream() },
    });
    await act(async () => {
      result.current.startRecording(() => {}, () => false, undefined, { countdown: false, recovery: explodingSink });
    });
    expect(result.current.recordingState).toBe('recording');
    await act(async () => {
      result.current.stopRecording();
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(result.current.recordingState).toBe('completed');
  });

  it('scroll corrections arrive as elapsed time (dt), not fixed per-tick amounts', async () => {
    // Fake Date together with the interval so elapsed time is deterministic.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const dts: number[] = [];
      const { result } = renderHook(({ s }: { s: MediaStream | null }) => useRecorder(s), {
        initialProps: { s: fakeStream() },
      });
      await act(async () => {
        result.current.startRecording((elapsedMs: number) => dts.push(elapsedMs), () => false, undefined, { countdown: false });
      });
      act(() => {
        vi.advanceTimersByTime(51);
      });
      // The first tick carries the elapsed time since capture start (~50ms);
      // a later throttled tick would carry a LARGER dt — that is the contract.
      expect(dts.length).toBeGreaterThan(0);
      expect(dts[0]).toBeLessThanOrEqual(50);
      expect(dts[0]).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
