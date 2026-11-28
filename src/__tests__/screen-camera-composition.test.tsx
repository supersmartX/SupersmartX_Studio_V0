import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenCameraComposition } from '@/hooks/useScreenCameraComposition';
import { DEFAULT_WEBCAM_OVERLAY } from '@/lib/recording/webcam-overlay';

/**
 * The composition layer's recording-interrupt guarantees, verified at the hook
 * boundary: the composed MediaStream identity — the thing MediaRecorder binds
 * to — must hold through webcam visibility/position changes and camera loss,
 * and rebuild only when the screen source or audio set actually changes.
 */

function fakeTrack(kind: 'video' | 'audio'): MediaStreamTrack & { stop: ReturnType<typeof vi.fn> } {
  return {
    kind,
    id: `${kind}-${Math.random().toString(36).slice(2)}`,
    readyState: 'live',
    enabled: true,
    label: kind,
    muted: false,
    stop: vi.fn(),
    getSettings: () => (kind === 'video' ? { width: 1280, height: 720, frameRate: 30 } : {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
}

function fakeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream;
}

describe('useScreenCameraComposition', () => {
  let screenVideoTrack: MediaStreamTrack;
  let screenAudioTrack: MediaStreamTrack;
  let micTrack: MediaStreamTrack;
  let cameraVideoTrack: MediaStreamTrack;
  let canvasTrack: MediaStreamTrack;
  let captureStreamSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    screenVideoTrack = fakeTrack('video');
    screenAudioTrack = fakeTrack('audio');
    micTrack = fakeTrack('audio');
    cameraVideoTrack = fakeTrack('video');
    canvasTrack = fakeTrack('video');
    captureStreamSpy = vi.fn(() => fakeStream([canvasTrack]));
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      value: captureStreamSpy,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream;
  });

  function setup(overrides: Partial<Parameters<typeof useScreenCameraComposition>[0]> = {}) {
    const options = {
      screenStream: fakeStream([screenVideoTrack, screenAudioTrack]),
      cameraStream: fakeStream([cameraVideoTrack, micTrack]),
      overlay: { ...DEFAULT_WEBCAM_OVERLAY },
      cameraAspect: 16 / 9,
      enabled: true,
      ...overrides,
    };
    return renderHook((props: typeof options) => useScreenCameraComposition(props), {
      initialProps: options,
    });
  }

  it('composes the canvas track with the live screen + microphone audio', async () => {
    const { result } = await act(async () => setup());
    await act(async () => {
      await result.current.ensureReady();
    });
    expect(result.current.composedStream).not.toBeNull();
    const composed = result.current.composedStream!;
    expect(composed.getVideoTracks()).toHaveLength(1);
    const audioIds = composed.getAudioTracks().map((t) => t.id).sort();
    expect(audioIds).toHaveLength(2);
    expect(audioIds).toContain(screenAudioTrack.id);
    expect(audioIds).toContain(micTrack.id);
  });

  it('keeps the composed stream identity through overlay visibility/position changes', async () => {
    const { result, rerender } = await act(async () => setup());
    await act(async () => {
      await result.current.ensureReady();
    });
    const before = result.current.composedStream;

    rerender({
      screenStream: fakeStream([screenVideoTrack, screenAudioTrack]),
      cameraStream: fakeStream([cameraVideoTrack, micTrack]),
      overlay: { ...DEFAULT_WEBCAM_OVERLAY, visible: false, x: 0.2, y: 0.3, scale: 0.4, shape: 'circle', mirrored: false },
      cameraAspect: 16 / 9,
      enabled: true,
    });

    expect(result.current.composedStream).toBe(before);
  });

  it('rebuilds only when the audio track set changes, retiring the old canvas track', async () => {
    const { result, rerender } = await act(async () => setup());
    await act(async () => {
      await result.current.ensureReady();
    });
    const before = result.current.composedStream!;
    expect(before.getVideoTracks()[0].stop).not.toHaveBeenCalled();

    // The mic dies (device disconnect): a NEW audio signature forces a rebuild.
    const deadMic = { ...fakeTrack('audio'), readyState: 'ended' } as unknown as MediaStreamTrack;
    const nextCameraStream = fakeStream([cameraVideoTrack, deadMic]);
    rerender({
      screenStream: fakeStream([screenVideoTrack, screenAudioTrack]),
      cameraStream: nextCameraStream,
      overlay: { ...DEFAULT_WEBCAM_OVERLAY },
      cameraAspect: 16 / 9,
      enabled: true,
    });

    const after = result.current.composedStream!;
    expect(after).not.toBe(before);
    // The retired canvas track was stopped — the source tracks were NOT.
    expect(before.getVideoTracks()[0].stop).toHaveBeenCalled();
    expect(screenAudioTrack.stop).not.toHaveBeenCalled();
    expect(micTrack.stop).not.toHaveBeenCalled();
  });

  it('keeps the composed stream when the camera video track ends but audio holds', async () => {
    const { result, rerender } = await act(async () => setup());
    await act(async () => {
      await result.current.ensureReady();
    });
    const before = result.current.composedStream;
    // Webcam loss with the mic still live: the drawing layer drops the
    // overlay, the composed stream (and the take) must hold.
    const endedCameraVideo = {
      ...fakeTrack('video'),
      readyState: 'ended',
    } as unknown as MediaStreamTrack;
    rerender({
      screenStream: fakeStream([screenVideoTrack, screenAudioTrack]),
      cameraStream: fakeStream([endedCameraVideo, micTrack]),
      overlay: { ...DEFAULT_WEBCAM_OVERLAY },
      cameraAspect: 16 / 9,
      enabled: true,
    });
    expect(result.current.composedStream).toBe(before);
  });

  it('does not stop source tracks on cleanup — only its own canvas track', async () => {
    const { result, unmount } = await act(async () => setup());
    await act(async () => {
      await result.current.ensureReady();
    });
    unmount();
    expect(screenVideoTrack.stop).not.toHaveBeenCalled();
    expect(screenAudioTrack.stop).not.toHaveBeenCalled();
    expect(micTrack.stop).not.toHaveBeenCalled();
    expect(cameraVideoTrack.stop).not.toHaveBeenCalled();
  });

  it('degrades to preview-only (null stream) when captureStream is unavailable', async () => {
    delete (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream;
    const { result } = await act(async () => setup());
    await act(async () => {
      const stream = await result.current.ensureReady();
      expect(stream).toBeNull();
    });
    expect(result.current.composedStream).toBeNull();
    // The canvas itself still exists for the preview surface.
    expect(result.current.canvasEl).not.toBeNull();
  });

  it('crops the composed canvas to the recording format aspect (no letterbox preview)', async () => {
    // A 1280x720 screen shared into a 9:16 format: the canvas must become
    // 406x720 (center crop), so the preview fills the platform frame and the
    // recording already carries the export's shape.
    const { result } = await act(async () => setup({ canvasAspect: 9 / 16 }));
    await act(async () => {
      await result.current.ensureReady();
    });
    expect(result.current.canvasEl!.width).toBe(406);
    expect(result.current.canvasEl!.height).toBe(720);
  });

  it('rebuilds the composed stream when the recording format changes while idle', async () => {
    const { result, rerender } = await act(async () => setup({ canvasAspect: 16 / 9 }));
    await act(async () => {
      await result.current.ensureReady();
    });
    const before = result.current.composedStream;
    expect(before).not.toBeNull();

    await act(async () => {
      rerender({
        screenStream: fakeStream([screenVideoTrack, screenAudioTrack]),
        cameraStream: fakeStream([cameraVideoTrack, micTrack]),
        overlay: { ...DEFAULT_WEBCAM_OVERLAY },
        cameraAspect: 16 / 9,
        canvasAspect: 1, // square format
        enabled: true,
      });
    });
    const rebuilt = result.current.composedStream;
    expect(rebuilt).not.toBe(before);
    expect(result.current.canvasEl!.width).toBe(720);
    expect(result.current.canvasEl!.height).toBe(720);
    // The retired canvas track was stopped (same contract as a device switch).
    expect(canvasTrack.stop).toHaveBeenCalled();
  });
});
