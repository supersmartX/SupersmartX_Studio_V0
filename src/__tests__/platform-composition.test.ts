import { describe, it, expect } from 'vitest';
import { getDefaultCrop } from '@/lib/export/export-config';
import { createExportConfig } from '@/lib/export/export-config';
import { computePreviewStyle, getPreviewCropGeometry } from '@/lib/composition';
import { PLATFORM_PRESETS } from '@/constants';
import { FREE_RESOLUTION } from '@/lib/entitlements';
import type { PlatformId } from '@/types';

/**
 * Platform composition matrix: every launch format derives preview AND
 * export from the same production crop math (getDefaultCrop). No second
 * algorithm, no duplicated dimensions.
 */
const MATRIX: Array<{ id: PlatformId; ratio: string; w: number; h: number }> = [
  { id: 'youtube-landscape', ratio: '16:9', w: 1920, h: 1080 },
  { id: 'youtube-shorts', ratio: '9:16', w: 1080, h: 1920 },
  { id: 'instagram-reels', ratio: '9:16', w: 1080, h: 1920 },
  { id: 'instagram-post', ratio: '1:1', w: 1080, h: 1080 },
  { id: 'instagram-portrait', ratio: '4:5', w: 1080, h: 1350 },
  { id: 'tiktok', ratio: '9:16', w: 1080, h: 1920 },
  { id: 'linkedin', ratio: '9:16', w: 1080, h: 1920 },
];

describe('platform composition matrix (shared geometry)', () => {
  it.each(MATRIX)('$id composes a centered in-bounds crop at the exact target ratio', ({ w, h }) => {
    // Typical camera source; the math must hold for any source (also probed below).
    const crop = getDefaultCrop(1920, 1080, w, h);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1920 + 1e-6);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1080 + 1e-6);
    expect(crop.width / crop.height).toBeCloseTo(w / h, 6);
    // Centered: symmetric margins on the cropped axis.
    expect(crop.x).toBeCloseTo((1920 - crop.width) / 2, 6);
    expect(crop.y).toBeCloseTo((1080 - crop.height) / 2, 6);
  });

  it.each(MATRIX)('$id export target matches the preset (creator, unclamped)', ({ id, ratio, w, h }) => {
    const config = createExportConfig(id, 1920, 1080);
    expect(config.platformId).toBe(id);
    expect(config.aspectRatio).toBe(ratio);
    expect(config.outputWidth).toBe(w);
    expect(config.outputHeight).toBe(h);
    // The stored crop IS the production crop for these exact dims.
    expect(config.crop).toEqual(getDefaultCrop(1920, 1080, w, h));
  });

  it.each(MATRIX)('$id free export keeps aspect while respecting the 720p clamp', ({ id, ratio }) => {
    const config = createExportConfig(id, 1920, 1080, { ...FREE_RESOLUTION });
    expect(config.aspectRatio).toBe(ratio);
    expect(config.outputWidth).toBeLessThanOrEqual(FREE_RESOLUTION.width);
    expect(config.outputHeight).toBeLessThanOrEqual(FREE_RESOLUTION.height);
    // Aspect preserved by the uniform clamp (entitlement behavior unchanged).
    expect(config.outputWidth / config.outputHeight).toBeCloseTo(
      PLATFORM_PRESETS.find((p) => p.id === id)!.width /
        PLATFORM_PRESETS.find((p) => p.id === id)!.height,
      1,
    );
  });

  it.each(MATRIX)('$id preview style derives from the same crop (centered → 50%/50%)', ({ w, h }) => {
    const { crop, style } = getPreviewCropGeometry(1920, 1080, w, h);
    expect(crop).toEqual(getDefaultCrop(1920, 1080, w, h));
    expect(style.objectFit).toBe('cover');
    expect(style.objectPosition).toBe('50% 50%');
  });

  it('switching platforms leaves no stale state (each selection is self-contained)', () => {
    const order: PlatformId[] = [
      'youtube-landscape',
      'youtube-shorts',
      'instagram-reels',
      'instagram-post',
      'instagram-portrait',
      'tiktok',
      'linkedin',
      'youtube-landscape',
    ];
    let previous: PlatformId | null = null;
    for (const id of order) {
      const config = createExportConfig(id, 1920, 1080);
      expect(config.platformId).toBe(id);
      if (previous) expect(config.platformId).not.toBe(previous === id ? 'impossible' : previous);
      const spec = MATRIX.find((m) => m.id === id)!;
      expect(config.outputWidth).toBe(spec.w);
      expect(config.outputHeight).toBe(spec.h);
      previous = id;
    }
  });

  it('offset (non-centered) crops map to exact object-position percentages', () => {
    // Left-aligned window in a 1920-wide source cropped to 1080 wide.
    const left = computePreviewStyle({ x: 0, y: 0, width: 1080, height: 1080, zoom: 1 }, 1920, 1080);
    expect(left.objectPosition).toBe('0% 50%');
    const right = computePreviewStyle({ x: 840, y: 0, width: 1080, height: 1080, zoom: 1 }, 1920, 1080);
    expect(right.objectPosition).toBe('100% 50%');
    // Full-bleed (no crop) falls back to center, never NaN.
    const full = computePreviewStyle({ x: 0, y: 0, width: 1920, height: 1080, zoom: 1 }, 1920, 1080);
    expect(full.objectPosition).toBe('50% 50%');
  });

  it('geometry holds across varied source dimensions', () => {
    const sources: Array<[number, number]> = [[1280, 720], [1080, 1920], [3840, 2160], [640, 480]];
    for (const [sw, sh] of sources) {
      for (const { w, h } of MATRIX) {
        const { crop, style } = getPreviewCropGeometry(sw, sh, w, h);
        expect(crop.x).toBeGreaterThanOrEqual(-1e-6);
        expect(crop.y).toBeGreaterThanOrEqual(-1e-6);
        expect(crop.x + crop.width).toBeLessThanOrEqual(sw + 1e-6);
        expect(crop.y + crop.height).toBeLessThanOrEqual(sh + 1e-6);
        expect(style.objectFit).toBe('cover');
      }
    }
  });
});
