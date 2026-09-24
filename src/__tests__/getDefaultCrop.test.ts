import { describe, it, expect } from 'vitest';
import { getDefaultCrop } from '@/lib/export/export-config';

// These tests exercise the REAL shipped crop function used by export
// (createExportConfig). A local reimplementation here would pass even if
// production broke — never duplicate the algorithm in tests.

describe('getDefaultCrop', () => {
  it('returns full source when aspect ratios match', () => {
    const crop = getDefaultCrop(1920, 1080, 1920, 1080);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.width).toBe(1920);
    expect(crop.height).toBe(1080);
    expect(crop.zoom).toBe(1);
  });

  it('crops height for wider target (16:9 source → 21:9 target)', () => {
    const crop = getDefaultCrop(1920, 1080, 2560, 1080);
    expect(crop.width).toBe(1920);
    expect(crop.height).toBeLessThan(1080);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeGreaterThan(0);
  });

  it('crops width for taller target (16:9 source → 9:16 target)', () => {
    const crop = getDefaultCrop(1920, 1080, 1080, 1920);
    expect(crop.height).toBe(1080);
    expect(crop.width).toBeLessThan(1920);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.y).toBe(0);
  });

  it('centers crop on 1:1 square from 16:9 source', () => {
    const crop = getDefaultCrop(1920, 1080, 1080, 1080);
    expect(crop.width).toBe(1080);
    expect(crop.height).toBe(1080);
    expect(crop.x).toBe(420);
    expect(crop.y).toBe(0);
  });

  it('handles 9:16 source → 16:9 target (portrait to landscape)', () => {
    const crop = getDefaultCrop(1080, 1920, 1920, 1080);
    expect(crop.width).toBe(1080);
    expect(crop.height).toBe(607.5);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeGreaterThan(0);
  });

  it('handles 1:1 source → 9:16 target', () => {
    const crop = getDefaultCrop(1080, 1080, 1080, 1920);
    expect(crop.height).toBe(1080);
    expect(crop.width).toBe(607.5);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.y).toBe(0);
  });

  it('handles 4:5 Instagram Portrait from 16:9 source', () => {
    const crop = getDefaultCrop(1920, 1080, 1080, 1350);
    expect(crop.width).toBeLessThanOrEqual(1920);
    expect(crop.height).toBeLessThanOrEqual(1080);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
  });

  it('handles very wide source (21:9) → 16:9 target', () => {
    const crop = getDefaultCrop(2560, 1080, 1920, 1080);
    expect(crop.width).toBeLessThan(2560);
    expect(crop.height).toBe(1080);
    expect(crop.x).toBeGreaterThan(0);
  });

  it('handles very tall source (9:21) → 9:16 target', () => {
    const crop = getDefaultCrop(1080, 2560, 1080, 1920);
    expect(crop.height).toBeLessThan(2560);
    expect(crop.width).toBe(1080);
    expect(crop.y).toBeGreaterThan(0);
  });

  it('crop coordinates are non-negative', () => {
    const sizes = [
      [1920, 1080, 1080, 1920],
      [1080, 1920, 1920, 1080],
      [3840, 2160, 1080, 1080],
      [640, 480, 1920, 1080],
    ];
    for (const [sw, sh, tw, th] of sizes) {
      const crop = getDefaultCrop(sw, sh, tw, th);
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.width).toBeGreaterThan(0);
      expect(crop.height).toBeGreaterThan(0);
    }
  });
});
