'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WebcamOverlaySettings } from '@/types';
import {
  FALLBACK_CANVAS_HEIGHT,
  FALLBACK_CANVAS_WIDTH,
  drawComposedFrame,
  sizeCanvasForAspect,
} from '@/lib/recording/webcam-overlay';

interface UseScreenCameraCompositionOptions {
  /**
   * The display-capture stream (screen/window/tab). The composited OUTPUT
   * stream is rebuilt only when this identity (or the live audio inputs)
   * change — never on webcam visibility/position changes, so a drag or a
   * hide/show mid-take can never interrupt MediaRecorder.
   */
  screenStream: MediaStream | null;
  /**
   * The camera stream feeding the floating webcam. Video identity changes do
   * NOT rebuild the output stream — the drawing layer re-attaches and the
   * overlay content just follows the new camera.
   */
  cameraStream: MediaStream | null;
  overlay: WebcamOverlaySettings;
  /** Camera frame aspect (width/height); keeps circle/rounded sizing honest. */
  cameraAspect: number;
  /**
   * The RECORDING FORMAT's aspect (width/height). The composed canvas adopts
   * this shape — the screen capture is center-cropped to fill it — so the
   * live preview fills the platform frame edge to edge and the webcam
   * overlay is positioned in the same coordinates the export will keep.
   * Changing it rebuilds the composed stream (idle only; the format picker
   * is closed during a take). Defaults to 16/9.
   */
  canvasAspect?: number;
  enabled: boolean;
}

export interface ScreenCameraComposition {
  /**
   * The canvas the composition is painted onto. Mount it as the preview: the
   * exact surface that is captured is the exact surface the user sees.
   */
  canvasEl: HTMLCanvasElement | null;
  /** The composed MediaStream (canvas video + live audio) for the recorder. */
  composedStream: MediaStream | null;
  /**
   * Imperative readiness for Record: (re)attaches sources, waits for the
   * screen video metadata, sizes the canvas and returns the composed stream.
   * Safe to call repeatedly; the reactive `composedStream` is the same object.
   */
  ensureReady: (overrides?: {
    screenStream?: MediaStream | null;
    cameraStream?: MediaStream | null;
  }) => Promise<MediaStream | null>;
}

const METADATA_TIMEOUT_MS = 3000;

function isTrackLive(track: MediaStreamTrack | null | undefined): boolean {
  return !!track && track.readyState === 'live' && track.enabled !== false;
}

/**
 * Play a hidden source video. jsdom (and some engines) return undefined from
 * play() or reject transiently — neither may ever crash the compositor.
 */
function tryPlay(video: HTMLVideoElement): void {
  try {
    const result = video.play?.();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        // Retry once — a fresh remount can transiently reject play().
        setTimeout(() => {
          try {
            void video.play?.();
          } catch {
            // Environments without media playback.
          }
        }, 500);
      });
    }
  } catch {
    // Environments without media playback.
  }
}

/** requestAnimationFrame is unavailable in some test/jsdom environments. */
function scheduleFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(() => callback(performance.now()), 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, METADATA_TIMEOUT_MS);
    video.addEventListener('loadedmetadata', done);
  });
}

/**
 * Composition layer for Screen + Webcam recording.
 *
 * SOURCE vs COMPOSITION (Phase 6, extended): the screen, camera and microphone
 * remain SEPARATE streams at capture time. This hook only paints them into one
 * canvas each animation frame and exposes `canvas.captureStream()` (plus the
 * live audio tracks) as the single composed stream the EXISTING recorder
 * consumes. Nothing here competes with useRecorder — it produces just another
 * MediaStream for the same pipeline.
 *
 * Recording-interrupt guarantees:
 *  - Webcam visibility/position/shape/mirror changes only affect the DRAW pass
 *    (read through a ref every frame). The output MediaStream identity is
 *    untouched, so the recorder keeps running.
 *  - Camera loss mid-take removes the overlay from the drawn frame (screen
 *    keeps recording) rather than stopping the take.
 *  - The output stream is rebuilt ONLY when the screen stream changes or the
 *    live audio track set changes; a rebuild mid-take ends the take through
 *    the recorder's existing stream-change contract (same as a device switch).
 */
export function useScreenCameraComposition({
  screenStream,
  cameraStream,
  overlay,
  cameraAspect,
  canvasAspect,
  enabled,
}: UseScreenCameraCompositionOptions): ScreenCameraComposition {
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [composedStream, setComposedStream] = useState<MediaStream | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const composedRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const overlayRef = useRef(overlay);
  const cameraAspectRef = useRef(cameraAspect);
  const canvasAspectRef = useRef<number>(canvasAspect ?? 16 / 9);
  const audioSignatureRef = useRef('');
  // Tracks whether the canvas still carries the fallback dims or real source
  // geometry — width-comparison broke once the fallback became aspect-aware.
  const canvasSizedFromSourceRef = useRef(false);

  overlayRef.current = overlay;
  cameraAspectRef.current = cameraAspect;
  canvasAspectRef.current = canvasAspect ?? 16 / 9;

  // Lazily create the canvas + hidden source videos once (client only).
  useEffect(() => {
    if (!enabled) return;
    if (!canvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = FALLBACK_CANVAS_WIDTH;
      canvas.height = FALLBACK_CANVAS_HEIGHT;
      canvasRef.current = canvas;
      const screenVideo = document.createElement('video');
      screenVideo.muted = true;
      screenVideo.playsInline = true;
      screenVideo.preload = 'auto';
      const cameraVideo = document.createElement('video');
      cameraVideo.muted = true;
      cameraVideo.playsInline = true;
      cameraVideo.preload = 'auto';
      screenVideoRef.current = screenVideo;
      cameraVideoRef.current = cameraVideo;
      setCanvasEl(canvas);
    }
  }, [enabled]);

  const stopDrawLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startDrawLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    const draw = () => {
      rafRef.current = scheduleFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cameraVideo = cameraVideoRef.current;
      const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0] ?? null;
      // A disconnected / deliberately turned-off camera (track disabled or
      // ended) leaves the frame screen-only instead of painting black.
      const cameraPaintable =
        cameraVideo &&
        isTrackLive(cameraTrack) &&
        cameraVideo.srcObject !== null &&
        cameraVideo.readyState >= 2
          ? cameraVideo
          : null;
      drawComposedFrame(
        ctx,
        canvas.width,
        canvas.height,
        screenVideoRef.current,
        cameraPaintable,
        overlayRef.current,
        cameraAspectRef.current,
      );
    };
    rafRef.current = scheduleFrame(draw);
  }, []);

  const releaseComposed = useCallback(() => {
    stopDrawLoop();
    const current = composedRef.current;
    composedRef.current = null;
    audioSignatureRef.current = '';
    canvasSizedFromSourceRef.current = false;
    if (current) {
      // Only the compositor's OWN canvas track may be stopped here — the
      // audio tracks belong to the caller's screen/camera streams.
      current.getVideoTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Already stopped.
        }
      });
    }
    setComposedStream(null);
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
  }, [stopDrawLoop]);

  // Latest-value refs so the imperative ensureReady path sees current props
  // without re-creating it (and without effect-order races at Record time).
  const screenStreamRef = useRef(screenStream);
  screenStreamRef.current = screenStream;
  const cameraStreamRef = useRef(cameraStream);
  cameraStreamRef.current = cameraStream;

  const audioSignature = useMemo(() => {
    const ids = [
      ...(screenStream?.getAudioTracks() ?? []),
      ...(cameraStream?.getAudioTracks() ?? []),
    ]
      .filter((t) => t.readyState === 'live')
      .map((t) => t.id);
    return ids.join('|');
  }, [screenStream, cameraStream]);

  const buildComposed = useCallback((): MediaStream | null => {
    const canvas = canvasRef.current;
    const screen = screenStreamRef.current;
    if (!canvas || !screen) return null;
    const [screenVideoTrack] = screen.getVideoTracks();
    if (!screenVideoTrack) return null;

    // A rebuild (audio set changed while idle) must retire the PREVIOUS
    // capture stream: calling captureStream() again creates a second live
    // track off the same canvas, and leaving the old one running would keep
    // it capturing forever.
    const previous = composedRef.current;
    if (previous) {
      previous.getVideoTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Already stopped.
        }
      });
      composedRef.current = null;
    }

    let canvasTrack: MediaStreamTrack | null = null;
    try {
      const captured = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(30) ?? null;
      canvasTrack = captured?.getVideoTracks()[0] ?? null;
    } catch {
      canvasTrack = null;
    }
    if (!canvasTrack) return null;

    const seen = new Set<string>();
    const audioTracks = [
      ...(screen.getAudioTracks() ?? []),
      ...(cameraStreamRef.current?.getAudioTracks() ?? []),
    ].filter((t) => {
      if (t.readyState !== 'live' || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    const composed = new MediaStream([canvasTrack, ...audioTracks]);
    composedRef.current = composed;
    setComposedStream(composed);
    startDrawLoop();
    return composed;
  }, [startDrawLoop]);

  // Crop the screen source's real geometry to the recording format's aspect
  // (center crop, same math the export applies). Track settings are preferred,
  // decoded video metadata is the fallback. Returns false when nothing is
  // known yet — the canvas keeps its fallback dims until geometry arrives.
  const applySourceGeometry = useCallback((screen: MediaStream): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    let width = 0;
    let height = 0;
    try {
      const [videoTrack] = screen.getVideoTracks();
      const settings = videoTrack?.getSettings();
      width = settings?.width ?? 0;
      height = settings?.height ?? 0;
    } catch {
      // Ignore; fall through to video element geometry.
    }
    if (!(width > 0 && height > 0)) {
      const video = screenVideoRef.current;
      width = video?.videoWidth ?? 0;
      height = video?.videoHeight ?? 0;
    }
    const sized = sizeCanvasForAspect(width, height, canvasAspectRef.current);
    if (!sized) return false;
    if (canvas.width !== sized.width || canvas.height !== sized.height) {
      canvas.width = sized.width;
      canvas.height = sized.height;
    }
    canvasSizedFromSourceRef.current = true;
    return true;
  }, []);

  const syncScreen = useCallback((): MediaStream | null => {
    const screen = screenStreamRef.current;
    const canvas = canvasRef.current;
    const screenVideo = screenVideoRef.current;
    if (!enabled || !screen || !canvas || !screenVideo) {
      if (composedRef.current) releaseComposed();
      return null;
    }
    if (screenVideo.srcObject !== screen) {
      screenVideo.srcObject = screen;
      tryPlay(screenVideo);
    }
    // The composition is rebuilt when the audio set OR the recording format's
    // aspect changes (both idle-only events), or when real source geometry
    // arrives for a canvas still on its fallback dims. The canvas is resized
    // only at composition build time, never mid-take (a mid-take resize
    // would corrupt the encoder's track).
    const geometrySignature = `${audioSignature}|${canvasAspectRef.current}`;
    const needsBuild = !composedRef.current || geometrySignature !== audioSignatureRef.current;
    const needsGeometry = !canvasSizedFromSourceRef.current && screenVideo.videoWidth > 0;
    if (needsBuild || needsGeometry) {
      applySourceGeometry(screen);
      buildComposed();
      audioSignatureRef.current = geometrySignature;
    }
    return composedRef.current;
  }, [enabled, audioSignature, applySourceGeometry, buildComposed, releaseComposed]);

  // Attach / detach the screen source reactively (preview needs the composed
  // canvas live even before Record is pressed). `canvasAspect` is included so
  // a recording-format change rebuilds the composition (idle-only event).
  useEffect(() => {
    syncScreen();
  }, [screenStream, enabled, audioSignature, canvasAspect, syncScreen]);

  // Track settings can be empty on some engines; the decoded frame size is
  // the reliable geometry. When it arrives after the first build (canvas
  // still on fallback dims), re-sync so the preview adopts the recording
  // format's shape at the source's real resolution without pressing Record.
  useEffect(() => {
    const video = screenVideoRef.current;
    if (!enabled || !video) return;
    const onMetadata = () => {
      syncScreen();
    };
    video.addEventListener('loadedmetadata', onMetadata);
    return () => video.removeEventListener('loadedmetadata', onMetadata);
  }, [enabled, screenStream, syncScreen]);

  // Attach the camera source. Video identity changes never rebuild the output.
  useEffect(() => {
    const cameraVideo = cameraVideoRef.current;
    if (!cameraVideo) return;
    if (cameraVideo.srcObject !== cameraStream) {
      cameraVideo.srcObject = cameraStream;
      if (cameraStream) {
        tryPlay(cameraVideo);
      }
    }
  }, [cameraStream, enabled]);

  // Camera aspect: keep the ref current without touching the draw loop.
  useEffect(() => {
    cameraAspectRef.current = cameraAspect;
  }, [cameraAspect]);

  const ensureReady = useCallback(async (overrides?: {
    screenStream?: MediaStream | null;
    cameraStream?: MediaStream | null;
  }): Promise<MediaStream | null> => {
    // Record is often pressed in the same task that acquired the screen (the
    // picker resolves, Start continues) — before React has re-rendered and
    // refreshed the refs. The caller hands over the freshest streams here.
    if (overrides && 'screenStream' in overrides) screenStreamRef.current = overrides.screenStream ?? null;
    if (overrides && 'cameraStream' in overrides) cameraStreamRef.current = overrides.cameraStream ?? null;
    const screen = screenStreamRef.current;
    const screenVideo = screenVideoRef.current;
    if (!screen || !screenVideo || !canvasRef.current) return null;
    syncScreen();
    await waitForMetadata(screenVideo);
    // Metadata may have delivered the real geometry after the canvas was
    // sized from track settings; prefer the decoded frame size when the
    // canvas has not been captured yet.
    if (!composedRef.current) {
      syncScreen();
    }
    const composed = composedRef.current;
    if (!composed) return syncScreen();
    if (!canvasSizedFromSourceRef.current && screenVideo.videoWidth > 0) {
      // Track settings were unavailable at build time — adopt the decoded
      // frame size (cropped to the recording format's aspect) now, while the
      // take has not started.
      applySourceGeometry(screen);
    }
    startDrawLoop();
    return composed;
  }, [syncScreen, startDrawLoop, applySourceGeometry]);

  // Full cleanup on disable/unmount: stop the compositor's canvas track and
  // loop, detach the hidden videos. Source streams stay owned by their hooks.
  useEffect(() => {
    if (enabled) return;
    releaseComposed();
  }, [enabled, releaseComposed]);

  useEffect(() => {
    return () => {
      releaseComposed();
      canvasRef.current = null;
      screenVideoRef.current = null;
      cameraVideoRef.current = null;
    };
  }, [releaseComposed]);

  return { canvasEl, composedStream, ensureReady };
}
