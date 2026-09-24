import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecorder } from '@/hooks/useRecorder';

// Regression test for a live-probe-proven defect: when the audio-only
// re-encode failed to start inside MediaRecorder.onstop, the exception
// skipped setRecordingState('completed') — stranding the UI in "recording"
// with no review, no blob, and a released camera. The take must complete
// even when the audio extra cannot start.
describe('useRecorder completion survives audio-extra start failure', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:http://localhost/${Math.random().toString(36).slice(2)}`),
      revokeObjectURL: vi.fn(),
    });

    type Handler = ((e?: unknown) => void) | null;

    class FakeRecorder {
      static isTypeSupported(mime: string) {
        return mime.startsWith('video/');
      }
      state = 'inactive';
      ondataavailable: Handler = null;
      onstop: Handler = null;
      onerror: Handler = null;
      mime: string;
      constructor(_stream: unknown, opts?: { mimeType?: string }) {
        this.mime = opts?.mimeType || '';
      }
      start() {
        if (this.mime.startsWith('audio/')) {
          throw new Error('There was an error starting the MediaRecorder.');
        }
        this.state = 'recording';
        this.ondataavailable?.({ data: new Blob(['chunk']) } as unknown);
      }
      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }
      pause() {
        this.state = 'paused';
      }
      resume() {
        this.state = 'recording';
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
  });

  // NOTE: no unstub in afterEach — the hook's unmount cleanup revokes object
  // URLs after test teardown, and unstubbing first would restore jsdom's URL
  // (which lacks revokeObjectURL). Mocks are file-scoped, so this is safe.

  function fakeStream() {
    const track = { kind: 'audio', readyState: 'live', stop: vi.fn(), clone: () => track, enabled: true } as unknown as MediaStreamTrack;
    return {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
  }

  it('reaches completed with a result when the audio extra throws on start', async () => {
    const { result } = renderHook(({ s }: { s: MediaStream | null }) => useRecorder(s), {
      initialProps: { s: fakeStream() },
    });

    await act(async () => {
      result.current.startRecording(
        () => {},
        () => false,
      );
      // 3-2-1 countdown ticks every 800ms (4 ticks to start)
      await new Promise((r) => setTimeout(r, 3800));
    });
    expect(result.current.recordingState).toBe('recording');

    await act(async () => {
      result.current.stopRecording();
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(result.current.recordingState).toBe('completed');
    expect(result.current.recordingResult).not.toBeNull();
    expect(result.current.recordingResult?.blob.size).toBeGreaterThan(0);
    expect(result.current.videoUrl.startsWith('blob:')).toBe(true);
  });
});
