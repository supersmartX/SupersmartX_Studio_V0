import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCamera } from '@/hooks/useCamera';

function fakeTrack() {
  return {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    kind: 'video',
    readyState: 'live',
  };
}

function fakeStream(tracks: ReturnType<typeof fakeTrack>[]) {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

describe('useCamera stop lifecycle (camera OFF after Stop)', () => {
  beforeEach(() => {
    const tracks = [fakeTrack(), fakeTrack()];
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
});
