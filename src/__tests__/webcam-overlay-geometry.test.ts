import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WEBCAM_OVERLAY,
  WEBCAM_SCALE_MAX,
  WEBCAM_SCALE_MIN,
  clampOverlayCenter,
  clampScale,
  computeWebcamRect,
  cornerOverlayPosition,
  drawComposedFrame,
  fitContainRect,
  sanitizeWebcamOverlay,
  sizeCanvasForAspect,
  webcamNormalizedSize,
} from '@/lib/recording/webcam-overlay';

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const CAMERA_ASPECT = 16 / 9;

describe('webcam overlay geometry', () => {
  describe('computeWebcamRect', () => {
    it('places a centered rounded overlay at the requested scale', () => {
      const rect = computeWebcamRect(
        CANVAS_W,
        CANVAS_H,
        { ...DEFAULT_WEBCAM_OVERLAY, x: 0.5, y: 0.5, scale: 0.25, shape: 'rounded' },
        CAMERA_ASPECT,
      );
      // Height = 25% of canvas height; width = height * camera aspect.
      expect(rect.h).toBeCloseTo(CANVAS_H * 0.25, 6);
      expect(rect.w).toBeCloseTo(CANVAS_H * 0.25 * CAMERA_ASPECT, 6);
      // Centered.
      expect(rect.x + rect.w / 2).toBeCloseTo(CANVAS_W / 2, 6);
      expect(rect.y + rect.h / 2).toBeCloseTo(CANVAS_H / 2, 6);
    });

    it('makes circle overlays square in pixels regardless of camera aspect', () => {
      const rect = computeWebcamRect(
        CANVAS_W,
        CANVAS_H,
        { ...DEFAULT_WEBCAM_OVERLAY, x: 0.5, y: 0.5, scale: 0.2, shape: 'circle' },
        4 / 3,
      );
      expect(rect.w).toBeCloseTo(rect.h, 6);
    });

    it('keeps the overlay fully inside the canvas at every corner', () => {
      for (const x of [0, 1]) {
        for (const y of [0, 1]) {
          const rect = computeWebcamRect(
            CANVAS_W,
            CANVAS_H,
            { ...DEFAULT_WEBCAM_OVERLAY, x, y, scale: WEBCAM_SCALE_MAX, shape: 'rounded' },
            CAMERA_ASPECT,
          );
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w).toBeLessThanOrEqual(CANVAS_W);
          expect(rect.y + rect.h).toBeLessThanOrEqual(CANVAS_H);
        }
      }
    });

    it('is resolution-independent: same normalized settings, same layout', () => {
      const small = computeWebcamRect(
        640,
        360,
        { ...DEFAULT_WEBCAM_OVERLAY, x: 0.8, y: 0.8, scale: 0.3, shape: 'rounded' },
        CAMERA_ASPECT,
      );
      const large = computeWebcamRect(
        1920,
        1080,
        { ...DEFAULT_WEBCAM_OVERLAY, x: 0.8, y: 0.8, scale: 0.3, shape: 'rounded' },
        CAMERA_ASPECT,
      );
      const norm = (r: ReturnType<typeof computeWebcamRect>, w: number, h: number) => ({
        x: r.x / w,
        y: r.y / h,
        w: r.w / w,
        h: r.h / h,
      });
      const a = norm(small, 640, 360);
      const b = norm(large, 1920, 1080);
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
      expect(a.w).toBeCloseTo(b.w, 6);
      expect(a.h).toBeCloseTo(b.h, 6);
    });
  });

  describe('clampOverlayCenter', () => {
    it('pulls the center inside so the whole rect fits', () => {
      const clamped = clampOverlayCenter(-5, 5, 0.3, 'rounded', CAMERA_ASPECT, 16 / 9);
      const rect = computeWebcamRect(
        CANVAS_W,
        CANVAS_H,
        { ...DEFAULT_WEBCAM_OVERLAY, ...clamped, scale: 0.3, shape: 'rounded' },
        CAMERA_ASPECT,
      );
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
    });

    it('centers an overlay that cannot fit at all (degenerate canvas)', () => {
      const clamped = clampOverlayCenter(0.5, 0.5, 0.9, 'rounded', CAMERA_ASPECT, 16 / 9);
      // scale 0.9 exceeds the canvas: the clamp must not produce NaN/negatives.
      expect(Number.isFinite(clamped.x)).toBe(true);
      expect(Number.isFinite(clamped.y)).toBe(true);
    });
  });

  describe('cornerOverlayPosition', () => {
    it('places each preset inside the canvas with its rect', () => {
      const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
      for (const corner of corners) {
        const { x, y } = cornerOverlayPosition(corner, 0.3, 'rounded', CAMERA_ASPECT, 16 / 9);
        const rect = computeWebcamRect(
          CANVAS_W,
          CANVAS_H,
          { ...DEFAULT_WEBCAM_OVERLAY, x, y, scale: 0.3, shape: 'rounded' },
          CAMERA_ASPECT,
        );
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(CANVAS_W);
        expect(rect.y + rect.h).toBeLessThanOrEqual(CANVAS_H);
      }
    });

    it('bottom-right preset sits in the bottom-right quadrant', () => {
      const { x, y } = cornerOverlayPosition('bottom-right', 0.25, 'rounded', CAMERA_ASPECT, 16 / 9);
      expect(x).toBeGreaterThan(0.75);
      expect(y).toBeGreaterThan(0.75);
    });
  });

  describe('clampScale / webcamNormalizedSize', () => {
    it('clamps scale into the supported range', () => {
      expect(clampScale(0.01)).toBe(WEBCAM_SCALE_MIN);
      expect(clampScale(5)).toBe(WEBCAM_SCALE_MAX);
      expect(clampScale(Number.NaN)).toBeGreaterThan(0);
    });

    it('normalized width for a circle equals scale only in square canvas units', () => {
      const square = webcamNormalizedSize(0.2, 'circle', 1, 1);
      expect(square.w).toBeCloseTo(square.h, 6);
      const wide = webcamNormalizedSize(0.2, 'circle', 1, 16 / 9);
      expect(wide.w).toBeLessThan(wide.h);
    });
  });

  describe('fitContainRect', () => {
    it('letterboxes a wider canvas inside a taller box', () => {
      const fit = fitContainRect(500, 500, 16 / 9);
      expect(fit.w).toBeCloseTo(500, 6);
      expect(fit.h).toBeCloseTo(281.25, 6);
      expect(fit.y).toBeCloseTo((500 - 281.25) / 2, 6);
      expect(fit.x).toBeCloseTo(0, 6);
    });

    it('pillarboxes a narrower canvas inside a wider box', () => {
      const fit = fitContainRect(1000, 500, 9 / 16);
      expect(fit.h).toBeCloseTo(500, 6);
      expect(fit.w).toBeCloseTo(281.25, 6);
    });

    it('survives zero and nonsense inputs', () => {
      expect(fitContainRect(0, 0, 16 / 9).w).toBe(0);
      expect(Number.isFinite(fitContainRect(100, 100, Number.NaN).w)).toBe(true);
    });
  });

  describe('sanitizeWebcamOverlay', () => {
    it('repairs malformed persisted values', () => {
      const fixed = sanitizeWebcamOverlay({
        visible: 'yes',
        x: 'left',
        y: Number.NaN,
        scale: 99,
        shape: 'blob',
        mirrored: 1,
        deviceId: 42,
      } as unknown as Record<string, unknown>);
      expect(fixed.visible).toBe(DEFAULT_WEBCAM_OVERLAY.visible);
      expect(fixed.x).toBe(DEFAULT_WEBCAM_OVERLAY.x);
      expect(fixed.y).toBe(DEFAULT_WEBCAM_OVERLAY.y);
      expect(fixed.shape).toBe(DEFAULT_WEBCAM_OVERLAY.shape);
      expect(fixed.mirrored).toBe(DEFAULT_WEBCAM_OVERLAY.mirrored);
      expect(fixed.deviceId).toBe('');
      // Out-of-range scale clamps instead of passing through.
      expect(fixed.scale).toBe(WEBCAM_SCALE_MAX);
    });

    it('clamps out-of-range scale and keeps valid values', () => {
      const fixed = sanitizeWebcamOverlay({ ...DEFAULT_WEBCAM_OVERLAY, scale: 0.9, x: 0.3, y: 0.7, shape: 'circle' });
      expect(fixed.scale).toBe(WEBCAM_SCALE_MAX);
      expect(fixed.x).toBe(0.3);
      expect(fixed.shape).toBe('circle');
    });
  });

  describe('drawComposedFrame', () => {
    it('paints the camera layer only when visible and both videos ready', () => {
      const calls: string[] = [];
      const ctx = {
        fillStyle: '',
        fillRect: () => calls.push('fill'),
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        beginPath: () => calls.push('path'),
        clip: () => calls.push('clip'),
        translate: () => calls.push('translate'),
        scale: () => calls.push('scale'),
        drawImage: () => calls.push('draw'),
        arc: () => calls.push('arc'),
        roundRect: () => calls.push('roundRect'),
        closePath: () => calls.push('close'),
        moveTo: () => {},
        lineTo: () => {},
        arcTo: () => {},
      } as unknown as CanvasRenderingContext2D;
      const video = () =>
        ({ videoWidth: 640, videoHeight: 480, readyState: 2 }) as unknown as HTMLVideoElement;

      drawComposedFrame(ctx, CANVAS_W, CANVAS_H, video(), video(), { ...DEFAULT_WEBCAM_OVERLAY, visible: true, shape: 'circle' }, 4 / 3);
      expect(calls.filter((c) => c === 'draw').length).toBe(2);
      expect(calls).toContain('arc');

      calls.length = 0;
      drawComposedFrame(ctx, CANVAS_W, CANVAS_H, video(), video(), { ...DEFAULT_WEBCAM_OVERLAY, visible: false }, CAMERA_ASPECT);
      expect(calls.filter((c) => c === 'draw').length).toBe(1);

      // A not-yet-decodable camera video (readyState < 2) must be skipped.
      calls.length = 0;
      drawComposedFrame(ctx, CANVAS_W, CANVAS_H, video(), { ...video(), readyState: 0 } as unknown as HTMLVideoElement, { ...DEFAULT_WEBCAM_OVERLAY, visible: true }, CAMERA_ASPECT);
      expect(calls.filter((c) => c === 'draw').length).toBe(1);
    });
  });
});

describe('sizeCanvasForAspect', () => {
  it('keeps a matching-aspect source untouched', () => {
    expect(sizeCanvasForAspect(1280, 720, 16 / 9)).toEqual({ width: 1280, height: 720 });
  });

  it('crops the sides of a landscape screen into a portrait format', () => {
    // 9:16 from a 1280x720 capture: height wins, width is cropped to 405.
    expect(sizeCanvasForAspect(1280, 720, 9 / 16)).toEqual({ width: 406, height: 720 });
  });

  it('crops top/bottom of a tall screen into a landscape format', () => {
    expect(sizeCanvasForAspect(720, 1280, 16 / 9)).toEqual({ width: 720, height: 406 });
  });

  it('returns even dimensions for encoder compatibility', () => {
    const sized = sizeCanvasForAspect(1081, 721, 16 / 9)!;
    expect(sized.width % 2).toBe(0);
    expect(sized.height % 2).toBe(0);
  });

  it('returns null when the source geometry is unknown', () => {
    expect(sizeCanvasForAspect(0, 0, 16 / 9)).toBeNull();
    expect(sizeCanvasForAspect(Number.NaN, 720, 16 / 9)).toBeNull();
  });

  it('falls back to 16:9 for a degenerate target aspect', () => {
    expect(sizeCanvasForAspect(1280, 720, Number.NaN)).toEqual({ width: 1280, height: 720 });
  });
});
