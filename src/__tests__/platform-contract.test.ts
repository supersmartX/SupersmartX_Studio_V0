import { describe, it, expect } from 'vitest';
import { PLATFORM_PRESETS, ASPECT_RATIO_PRESETS, DEFAULT_PLATFORM_ID } from '@/constants';
import { isPlatformLockedForUser } from '@/lib/entitlements';
import type { PlatformId } from '@/types';

/**
 * Platform contract: preview, export, validation, and library all share
 * PLATFORM_PRESETS as the single source of truth. If a dimension changes
 * here, preview AND export change together — never separately.
 */
describe('platform contract (single source of truth)', () => {
  const expected: Record<string, { w: number; h: number; ratio: string; lockedForFree: boolean }> = {
    'youtube-landscape': { w: 1920, h: 1080, ratio: '16:9', lockedForFree: false },
    'youtube-shorts': { w: 1080, h: 1920, ratio: '9:16', lockedForFree: true },
    'instagram-reels': { w: 1080, h: 1920, ratio: '9:16', lockedForFree: true },
    'instagram-post': { w: 1080, h: 1080, ratio: '1:1', lockedForFree: true },
    'instagram-portrait': { w: 1080, h: 1350, ratio: '4:5', lockedForFree: true },
    tiktok: { w: 1080, h: 1920, ratio: '9:16', lockedForFree: true },
    linkedin: { w: 1080, h: 1920, ratio: '9:16', lockedForFree: true },
  };

  it('every customer-facing platform has the canonical dimensions', () => {
    for (const [id, spec] of Object.entries(expected)) {
      const preset = PLATFORM_PRESETS.find((p) => p.id === (id as PlatformId));
      expect(preset, id).toBeDefined();
      expect({ w: preset!.width, h: preset!.height }, id).toEqual({ w: spec.w, h: spec.h });
      expect(preset!.aspectRatio, id).toBe(spec.ratio);
    }
  });

  it('every preset aspect ratio has a CSS shape class (preview visibly changes)', () => {
    for (const preset of PLATFORM_PRESETS) {
      const css = ASPECT_RATIO_PRESETS[preset.aspectRatio]?.cssClass;
      expect(css, preset.id).toBeTruthy();
    }
    expect(ASPECT_RATIO_PRESETS['16:9'].cssClass).not.toBe(ASPECT_RATIO_PRESETS['9:16'].cssClass);
    expect(ASPECT_RATIO_PRESETS['1:1'].cssClass).not.toBe(ASPECT_RATIO_PRESETS['4:5'].cssClass);
  });

  it('free locks every non-YouTube format; creator unlocks all', () => {
    for (const [id, spec] of Object.entries(expected)) {
      expect(isPlatformLockedForUser(id as PlatformId, 'free'), id).toBe(spec.lockedForFree);
      expect(isPlatformLockedForUser(id as PlatformId, 'creator_monthly'), id).toBe(false);
    }
  });

  it('default platform is free YouTube 16:9', () => {
    expect(DEFAULT_PLATFORM_ID).toBe('youtube-landscape');
  });
});
