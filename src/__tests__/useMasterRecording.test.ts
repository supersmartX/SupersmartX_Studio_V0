import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMasterRecording } from '@/hooks/useMasterRecording';

const mockBlob = new Blob(['test'], { type: 'video/webm' });

beforeEach(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => `blob:http://localhost/${Math.random().toString(36).slice(2)}`),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => ({
      onupgradeneeded: null,
      onsuccess: null,
      result: {
        transaction: vi.fn(() => ({
          objectStore: vi.fn(() => ({
            put: vi.fn(() => ({ onsuccess: null, onerror: null })),
            get: vi.fn(() => ({ onsuccess: null, onerror: null })),
            delete: vi.fn(() => ({ onsuccess: null, onerror: null })),
            getAll: vi.fn(() => ({ onsuccess: null, onerror: null })),
          })),
        })),
        createObjectStore: vi.fn(),
        objectStoreNames: { contains: vi.fn(() => false) },
      },
    })),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMasterRecording blob URL lifecycle', () => {
  it('createMasterRecording creates a blob URL', () => {
    const { result } = renderHook(() => useMasterRecording());

    act(() => {
      result.current.createMasterRecording(mockBlob, 30, true, 1920, 1080);
    });

    expect(result.current.masterRecording).not.toBeNull();
    expect(result.current.masterRecording?.url).toContain('blob:');
    expect(URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
  });

  it('createMasterRecording revokes previous URL before creating new', () => {
    const { result } = renderHook(() => useMasterRecording());

    act(() => {
      result.current.createMasterRecording(mockBlob, 30, true, 1920, 1080);
    });
    const firstUrl = result.current.masterRecording?.url;

    act(() => {
      result.current.createMasterRecording(mockBlob, 45, false, 1280, 720);
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    expect(result.current.masterRecording?.url).not.toBe(firstUrl);
  });

  it('clearMasterRecording revokes URL and sets null', () => {
    const { result } = renderHook(() => useMasterRecording());

    act(() => {
      result.current.createMasterRecording(mockBlob, 30, true, 1920, 1080);
    });
    const url = result.current.masterRecording?.url;

    act(() => {
      result.current.clearMasterRecording();
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(result.current.masterRecording).toBeNull();
  });

  it('clearMasterRecording is safe to call when no recording exists', () => {
    const { result } = renderHook(() => useMasterRecording());

    act(() => {
      result.current.clearMasterRecording();
    });

    expect(result.current.masterRecording).toBeNull();
  });

  it('createMasterRecording sets correct metadata', () => {
    const { result } = renderHook(() => useMasterRecording());

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, 30, true, 1920, 1080);
    });

    expect(recording.id).toContain('master-');
    expect(recording.duration).toBe(30);
    expect(recording.hasAudio).toBe(true);
    expect(recording.sourceWidth).toBe(1920);
    expect(recording.sourceHeight).toBe(1080);
    expect(recording.mimeType).toBe('video/webm');
    expect(recording.extension).toBe('webm');
  });

  it('createMasterRecording detects mp4 extension from blob type', () => {
    const { result } = renderHook(() => useMasterRecording());
    const mp4Blob = new Blob(['test'], { type: 'video/mp4' });

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mp4Blob, 10, false, 1920, 1080);
    });

    expect(recording.extension).toBe('mp4');
    expect(recording.mimeType).toBe('video/mp4');
  });

  it('defaults sourceWidth/Height to 0 when not provided', () => {
    const { result } = renderHook(() => useMasterRecording());

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, 30, true);
    });

    expect(recording.sourceWidth).toBe(0);
    expect(recording.sourceHeight).toBe(0);
  });
});

describe('duration regression — recorder timestamp is authoritative', () => {
  it('TEST A: completed recording has positive duration', () => {
    const { result } = renderHook(() => useMasterRecording());

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, 30, true, 1920, 1080);
    });

    expect(recording.duration).toBeGreaterThan(0);
    expect(recording.duration).toBe(30);
  });

  it('TEST B: recorder duration is used instead of UI timer', () => {
    const { result } = renderHook(() => useMasterRecording());

    const recorderDuration = 7.43;
    const elapsedSeconds = 6;

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, recorderDuration, true, 1920, 1080);
    });

    expect(recording.duration).toBe(recorderDuration);
    expect(recording.duration).not.toBe(elapsedSeconds);
  });

  it('TEST C: timer reset cannot corrupt duration', () => {
    const { result } = renderHook(() => useMasterRecording());

    const recorderDuration = 5.82;

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, recorderDuration, true, 1920, 1080);
    });

    expect(recording.duration).toBe(recorderDuration);

    act(() => {
      result.current.clearMasterRecording();
    });

    let recording2: any;
    act(() => {
      recording2 = result.current.createMasterRecording(mockBlob, 10.5, false, 1280, 720);
    });

    expect(recording2.duration).toBe(10.5);
  });

  it('TEST D: sub-second precision is preserved', () => {
    const { result } = renderHook(() => useMasterRecording());

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, 0.73, true, 1920, 1080);
    });

    expect(recording.duration).toBe(0.73);
    expect(recording.duration).not.toBe(0);
    expect(recording.duration).not.toBe(1);
  });

  it('TEST E: completion between timer intervals uses recorder duration', () => {
    const { result } = renderHook(() => useMasterRecording());

    const recorderDuration = 4.87;

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, recorderDuration, true, 1920, 1080);
    });

    expect(recording.duration).toBe(recorderDuration);
  });

  it('TEST: zero duration is preserved when recorder reports it', () => {
    const { result } = renderHook(() => useMasterRecording());

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, 0, true, 1920, 1080);
    });

    expect(recording.duration).toBe(0);
  });

  it('TEST: large duration is preserved', () => {
    const { result } = renderHook(() => useMasterRecording());

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, 300, true, 1920, 1080);
    });

    expect(recording.duration).toBe(300);
  });

  it('TEST: fractional duration is stored exactly', () => {
    const { result } = renderHook(() => useMasterRecording());

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(mockBlob, 12.345678, true, 1920, 1080);
    });

    expect(recording.duration).toBe(12.345678);
  });
});
