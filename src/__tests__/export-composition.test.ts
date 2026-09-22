import { describe, it, expect } from 'vitest';
import { computeCanvasSourceRect } from '@/lib/composition';
import { getDefaultCrop } from '@/lib/export/export-config';
import { toMediabunnyCropRect } from '@/lib/export/mediabunny-export-engine';
import type { CropConfig } from '@/types';

const EPS = 1e-6;
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-3;

// Full pipeline simulation for one export: default cover crop for
// (masterW, masterH) -> target, then source rect against actual decoded dims.
function sourceRect(masterW: number, masterH: number, actualW: number, actualH: number, outW: number, outH: number) {
  const crop = getDefaultCrop(masterW, masterH, outW, outH);
  return computeCanvasSourceRect(crop, actualW, actualH, masterW, masterH);
}

describe('export composition rectangles', () => {
  it('1920x1080 -> 1280x720 uses the full source frame', () => {
    const rect = sourceRect(1920, 1080, 1920, 1080, 1280, 720);
    expect(rect.sx).toBe(0);
    expect(rect.sy).toBe(0);
    expect(rect.sw).toBe(1920);
    expect(rect.sh).toBe(1080);
  });

  it('1920x1080 -> 1080x1920 center-crops to 9:16', () => {
    const rect = sourceRect(1920, 1080, 1920, 1080, 1080, 1920);
    expect(rect.sx).toBeCloseTo(656.25, 3);
    expect(rect.sy).toBe(0);
    expect(rect.sw).toBeCloseTo(607.5, 3);
    expect(rect.sh).toBe(1080);
    expect(approx(rect.sw / rect.sh, 9 / 16)).toBe(true);
  });

  it('1920x1080 -> 1080x1080 center-crops to square', () => {
    const rect = sourceRect(1920, 1080, 1920, 1080, 1080, 1080);
    expect(rect.sx).toBe(420);
    expect(rect.sy).toBe(0);
    expect(rect.sw).toBe(1080);
    expect(rect.sh).toBe(1080);
  });

  it('1920x1080 -> 1080x1350 center-crops to 4:5', () => {
    const rect = sourceRect(1920, 1080, 1920, 1080, 1080, 1350);
    expect(rect.sx).toBe(528);
    expect(rect.sy).toBe(0);
    expect(rect.sw).toBe(864);
    expect(rect.sh).toBe(1080);
    expect(approx(rect.sw / rect.sh, 1080 / 1350)).toBe(true);
  });

  it('source-dimension mismatch still maps exactly onto the decoded frame', () => {
    // Crop computed for 1920x1080, actual decoded frame 640x480.
    const rect = sourceRect(1920, 1080, 640, 480, 1280, 720);
    expect(rect.sx).toBe(0);
    expect(rect.sy).toBe(0);
    expect(rect.sw).toBe(640);
    expect(rect.sh).toBe(480);
  });

  it('source rect never overflows the decoded frame (no black-bar geometry)', () => {
    const masters: Array<[number, number]> = [[1920, 1080], [640, 480], [1280, 720]];
    const actuals: Array<[number, number]> = [[1920, 1080], [640, 480], [1280, 720]];
    const targets: Array<[number, number]> = [[1280, 720], [1920, 1080], [1080, 1920], [1080, 1080], [1080, 1350]];
    for (const [mw, mh] of masters) {
      for (const [aw, ah] of actuals) {
        for (const [ow, oh] of targets) {
          const rect = sourceRect(mw, mh, aw, ah, ow, oh);
          expect(rect.sw).toBeGreaterThan(0);
          expect(rect.sh).toBeGreaterThan(0);
          expect(rect.sx).toBeGreaterThanOrEqual(-EPS);
          expect(rect.sy).toBeGreaterThanOrEqual(-EPS);
          // The sampled region must fit inside the decoded frame: overflow is
          // what canvas drawImage turns into unpainted (black) output.
          expect(rect.sx + rect.sw).toBeLessThanOrEqual(aw + EPS);
          expect(rect.sy + rect.sh).toBeLessThanOrEqual(ah + EPS);
          // Cover correctness: when master and decoded frames share an aspect
          // ratio, the scale is uniform and the rect aspect matches the output
          // aspect (no stretch). Mismatched-aspect inputs are garbage-in.
          if (approx(mw / mh, aw / ah)) {
            expect(approx(rect.sw / rect.sh, ow / oh)).toBe(true);
          }
        }
      }
    }
  });

  it('zoomed crops stay inside the decoded frame', () => {
    const base = getDefaultCrop(1920, 1080, 1080, 1920);
    const zoomed: CropConfig = { ...base, zoom: 2 };
    const rect = computeCanvasSourceRect(zoomed, 1920, 1080, 1920, 1080);
    expect(rect.sx).toBeGreaterThanOrEqual(-EPS);
    expect(rect.sy).toBeGreaterThanOrEqual(-EPS);
    expect(rect.sx + rect.sw).toBeLessThanOrEqual(1920 + EPS);
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(1080 + EPS);
  });
});

describe('toMediabunnyCropRect', () => {
  it('maps x/y/width/height to left/top/width/height', () => {
    expect(toMediabunnyCropRect({ x: 0, y: 0, width: 1920, height: 1080 }))
      .toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
  });

  it('rounds fractional cover crops to even integers for H.264', () => {
    // 1920x1080 -> 9:16 cover rect (fractional by design).
    expect(toMediabunnyCropRect({ x: 656.25, y: 0, width: 607.5, height: 1080 }))
      .toEqual({ left: 656, top: 0, width: 608, height: 1080 });
    const mapped = toMediabunnyCropRect({ x: 656.25, y: 0, width: 607.5, height: 1080 });
    expect(mapped.left % 2).toBe(0);
    expect(mapped.top % 2).toBe(0);
    expect(mapped.width % 2).toBe(0);
    expect(mapped.height % 2).toBe(0);
  });

  it('never produces degenerate (zero) dimensions', () => {
    expect(toMediabunnyCropRect({ x: 1, y: 1, width: 3, height: 5 }))
      .toEqual({ left: 2, top: 2, width: 4, height: 6 });
  });
});
