import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCamera } from '@/hooks/useCamera';

type FakeTrack = {
  kind: 'video' | 'audio';
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  readyState: string;
  __ended: ((event?: Event) => void) | null;
};

function fakeTrack(kind: 'video' | 'audio' = 'video'): FakeTrack {
  const track: FakeTrack = {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    kind,
    readyState: 'live',
    __ended: null,
  };
  track.addEventListener.mockImplementation(
    (type: string, listener: (event?: Event) => void) => {
      if (type === 'ended') track.__ended = listener;
    },
  );
  return track;
}

function fakeStream(tracks: FakeTrack[]) {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

describe('useCamera stop lifecycle (camera OFF after Stop)', () => {
  beforeEach(() => {
    const tracks = [fakeTrack('video'), fakeTrack('audio')];
    const mockDevices = {
      getUserMedia: vi.fn(async () => fakeStream(tracks)),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      __tracks: tracks,
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: mockDevices,
    });
    // Default: permissions are not the problem, so error-name mapping wins.
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      writable: true,
      value: { query: vi.fn(async () => ({ state: 'granted' })) },
    });
  });

  function tracks() {
    return (navigator.mediaDevices as unknown as { __tracks: ReturnType<typeof fakeTrack>[] }).__tracks;
  }

  it('stop() halts every track and clears camera state', async () => {
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.initialize();
    });
    expect(result.current.stream).not.toBeNull();
    expect(result.current.isInitialized).toBe(true);

    act(() => {
      result.current.stop();
    });

    for (const t of tracks()) {
      expect(t.stop).toHaveBeenCalledTimes(1);
      expect(t.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    }
    expect(result.current.stream).toBeNull();
    expect(result.current.isInitialized).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('starting again acquires a clean new stream', async () => {
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.initialize();
    });
    const first = result.current.stream;
    act(() => {
      result.current.stop();
    });
    await act(async () => {
      await result.current.initialize();
    });
    expect(result.current.stream).not.toBeNull();
    expect(result.current.stream).not.toBe(first);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('stop() is safe with no active stream', () => {
    const { result } = renderHook(() => useCamera());
    expect(() => act(() => {
      result.current.stop();
    })).not.toThrow();
    expect(result.current.stream).toBeNull();
  });

  it('hasInitialized distinguishes released camera from never-enabled', async () => {
    const { result } = renderHook(() => useCamera());
    expect(result.current.hasInitialized).toBe(false);
    await act(async () => {
      await result.current.initialize();
    });
    expect(result.current.hasInitialized).toBe(true);
    act(() => {
      result.current.stop();
    });
    expect(result.current.hasInitialized).toBe(true);
    expect(result.current.isInitialized).toBe(false);
  });

  it('a camera track ending releases both devices and names the camera', async () => {
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.initialize();
    });
    const [video, audio] = tracks();

    await act(async () => {
      video.__ended?.({ target: video } as unknown as Event);
      await Promise.resolve();
    });

    expect(video.stop).toHaveBeenCalledTimes(1);
    expect(
      audio.stop,
      'the still-live microphone must not be left running behind a dead stream',
    ).toHaveBeenCalledTimes(1);
    expect(video.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    expect(audio.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    expect(result.current.stream).toBeNull();
    expect(result.current.isInitialized).toBe(false);
    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toMatch(/camera was disconnected/i);
  });

  it('a microphone track ending names the microphone and releases the camera too', async () => {
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.initialize();
    });
    const [video, audio] = tracks();

    await act(async () => {
      audio.__ended?.({ target: audio } as unknown as Event);
      await Promise.resolve();
    });

    expect(video.stop).toHaveBeenCalledTimes(1);
    expect(audio.stop).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toMatch(/microphone was disconnected/i);
    expect(result.current.errorMessage).not.toMatch(/camera was disconnected/i);
  });

  it('explains a non-secure context (plain TypeError) instead of using the generic message', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new TypeError('mediaDevices is undefined'));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.initialize();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toMatch(/HTTPS or a supported browser/i);
  });

  it('a failed re-initialization clears the stale stream state', async () => {
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.initialize();
    });
    expect(result.current.stream).not.toBeNull();

    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('gone', 'NotFoundError'));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });

    await act(async () => {
      await result.current.initialize();
    });

    expect(result.current.isInitialized).toBe(false);
    expect(result.current.status).toBe('error');
    expect(result.current.stream, 'a dead stream must not be handed to Start').toBeNull();
  });

  it('reports a track that dies without an ended event', async () => {
    // track.stop() (script, driver, or a lost device the browser does not
    // announce) sets readyState to 'ended' and fires nothing. Without the
    // watchdog this stream kept rolling under a REC badge.
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.initialize();
    });
    const [video, audio] = tracks();
    video.readyState = 'ended';

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });

    expect(result.current.status).toBe('error');
    expect(result.current.stream).toBeNull();
    expect(result.current.errorMessage).toMatch(/camera was disconnected/i);
    expect(audio.stop, 'the live microphone must not be left running').toHaveBeenCalledTimes(1);
  });

  it('names a blocked site permission instead of blaming the device', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Not supported', 'NotSupportedError'));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      writable: true,
      value: {
        query: vi.fn(async ({ name }: { name: string }) => ({
          state: name === 'microphone' ? 'denied' : 'granted',
        })),
      },
    });

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.initialize();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.permissionBlocked).toBe(true);
    expect(result.current.errorMessage).toMatch(/Microphone access is blocked for this site/);
    expect(result.current.errorMessage, 'a blocked permission is not a device fault').not.toMatch(
      /connected and not in use/i,
    );
  });

  it('retries lower quality while preserving selected camera and microphone IDs', async () => {
    const tracks = [fakeTrack('video'), fakeTrack('audio')];
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('unsupported dimensions', 'OverconstrainedError'))
      .mockResolvedValueOnce(fakeStream(tracks));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.initialize({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, deviceId: { exact: 'camera-selected' } },
        audio: { deviceId: { exact: 'mic-selected' } },
      });
    });

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ video: { deviceId: { exact: 'camera-selected' } } });
    expect(getUserMedia.mock.calls[1][0]).toMatchObject({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24 }, deviceId: { exact: 'camera-selected' } },
      audio: { deviceId: { exact: 'mic-selected' } },
    });
    expect(result.current.stream).not.toBeNull();
  });
});
