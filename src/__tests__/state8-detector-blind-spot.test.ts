/**
 * STATE 7/8 — the calibration edge detector must not be blind to landscape.
 *
 * `scripts/state8-e2e/run.mjs` is the only thing that decodes a real encoded
 * MP4 and measures where the content landed. It reported "only 0 calibration
 * edges found" for every `youtube-landscape` export — which reads like a
 * composition bug in the 16:9 path and was, in fact, a bug in the detector:
 * `findEdges` derived the scanline offsets from the axis being profiled and
 * then used them as the perpendicular coordinate, so on any output wider than
 * it is tall it indexed past the end of the pixel buffer and produced NaN for
 * the entire profile.
 *
 * The damage is worse than one red row. A detector that reports zero edges
 * cannot distinguish "composition is wrong" from "I measured nothing", so the
 * single most common export (16:9) was never actually being checked while the
 * suite still reported a pass rate. These tests pin the detector itself, so the
 * harness cannot silently go blind again.
 */
import { describe, it, expect } from 'vitest';
import { findEdges } from '../../scripts/state8-e2e/driver';

/**
 * Paints the calibration grid the production harness paints: red alternates
 * along U at every 1/8 boundary, green along V, blue is flat.
 */
function paint(w: number, h: number, bands = 8): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const vBand = Math.floor((y * bands) / h);
    for (let x = 0; x < w; x += 1) {
      const uBand = Math.floor((x * bands) / w);
      const i = (y * w + x) * 4;
      data[i] = uBand % 2 === 0 ? 255 : 40;
      data[i + 1] = vBand % 2 === 0 ? 255 : 40;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe('STATE 8 calibration detector — it must actually measure both orientations', () => {
  it('finds the 1/8 U boundaries in a LANDSCAPE frame (w > h)', () => {
    // The regression: this is 16:9 territory and previously returned [].
    const w = 1920;
    const h = 1080;
    const edges = findEdges(paint(w, h), w, h, 'u', Math.round(h / 2), 9);

    expect(edges.length, 'a landscape frame must not measure as zero edges').toBeGreaterThan(0);

    // Interior boundaries sit at k/8; the first and last band edges are clipped
    // by the frame, so the detectable ones are the 7 interior ones.
    for (const k of [1, 2, 3, 4, 5, 6, 7]) {
      const expected = k / 8;
      const nearest = edges.reduce((best, e) => (Math.abs(e - expected) < Math.abs(best - expected) ? e : best), Infinity);
      expect(Math.abs(nearest - expected), `U boundary ${k}/8 must be located`).toBeLessThan(0.005);
    }
  });

  it('finds the 1/8 V boundaries in a PORTRAIT frame (h > w)', () => {
    const w = 1080;
    const h = 1920;
    const edges = findEdges(paint(w, h), w, h, 'v', Math.round(w * 0.15), 9);

    expect(edges.length, 'a portrait frame must not measure as zero edges').toBeGreaterThan(0);
    for (const k of [1, 2, 3, 4, 5, 6, 7]) {
      const expected = k / 8;
      const nearest = edges.reduce((best, e) => (Math.abs(e - expected) < Math.abs(best - expected) ? e : best), Infinity);
      expect(Math.abs(nearest - expected), `V boundary ${k}/8 must be located`).toBeLessThan(0.005);
    }
  });

  it('measures a square frame on both axes', () => {
    const n = 1080;
    const data = paint(n, n);
    expect(findEdges(data, n, n, 'u', Math.round(n / 2), 9).length).toBeGreaterThan(0);
    expect(findEdges(data, n, n, 'v', Math.round(n / 2), 9).length).toBeGreaterThan(0);
  });

  it('never reads outside the pixel buffer in either orientation', () => {
    // The specific failure was an out-of-bounds read producing NaN, which is
    // invisible downstream: the profile becomes all-NaN and the edge count
    // becomes 0 rather than throwing. Assert on the profile's finiteness.
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1280, 720], [720, 1280], [1080, 1080]] as const) {
      const data = paint(w, h);
      for (const axis of ['u', 'v'] as const) {
        const edges = findEdges(data, w, h, axis, 0, 9);
        expect(edges.length, `${w}x${h} axis ${axis} must yield edges`).toBeGreaterThan(0);
        for (const e of edges) {
          expect(Number.isFinite(e), `${w}x${h} axis ${axis} produced a non-finite edge`).toBe(true);
          expect(e).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
