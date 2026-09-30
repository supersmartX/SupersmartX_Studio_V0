import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeCodedSourceRect, computePreviewStyle, getPreviewBoxStyle } from '@/lib/composition';
import { createExportConfig, getDefaultCrop } from '@/lib/export/export-config';
import { toMediabunnyCropRect } from '@/lib/export/mediabunny-export-engine';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import { REQUIRED_MATRIX } from '@/lib/export/mp4-metadata';
import type { AspectRatio, CropConfig, PlatformId } from '@/types';

/**
 * STATE 8 — composition accuracy.
 *
 * The invariant under test is a three-way equality, not a spot check:
 *
 *     preview composition == export composition == actual MP4 composition
 *
 * "Composition" is the window of the source the viewer sees, expressed in real
 * video pixels. If any of the three disagrees the user crops their framing to
 * what they saw, and the file does not match.
 *
 * The preview is the hard one to test honestly, because it is produced by CSS
 * (`object-fit: cover` + `object-position` + a box with some aspect ratio)
 * rather than by our code. Re-implementing it here, from the CSS spec and not
 * from the same helper the export uses, is what makes the comparison
 * meaningful — a test that called computeCanvasSourceRect on both sides would
 * pass even if the browser rendered something else entirely.
 *
 * The actual MP4 cannot be checked here: it needs a real browser encode
 * (WebCodecs). What IS checked is the third link's input — that the rect handed
 * to the encoder is exactly the output aspect and lies inside the source, which
 * is the only way a file can be non-black-barred and unstretched.
 */

/* ------------------------------------------------------------------ *
 * An independent model of `object-fit: cover` + `object-position`
 * ------------------------------------------------------------------ */

interface Window { left: number; top: number; width: number; height: number }

/**
 * Reproduces the browser's object-fit:cover + object-position for a replaced
 * element.
 *
 * Per CSS: the content is scaled by max(boxW/contentW, boxH/contentH) — the
 * "cover" scale. The box then shows a window of the content whose size is
 * boxW/scale x boxH/scale, i.e. the box's aspect ratio. object-position p
 * slides that window within the leftover space: the offset is p * (free space),
 * where free space is content minus window.
 */
function coverWindow(
  contentW: number,
  contentH: number,
  boxW: number,
  boxH: number,
  objectPosition: string
): Window {
  const scale = Math.max(boxW / contentW, boxH / contentH);
  const width = boxW / scale;
  const height = boxH / scale;
  const [px, py] = objectPosition.split(/\s+/).map((v) => parseFloat(v) / 100);
  const freeX = contentW - width;
  const freeY = contentH - height;
  return {
    left: Math.min(Math.max(px * freeX, 0), freeX),
    top: Math.min(Math.max(py * freeY, 0), freeY),
    width,
    height,
  };
}

/* ------------------------------------------------------------------ *
 * The two paths, resolved the way the app resolves them
 * ------------------------------------------------------------------ */

/**
 * What the user sees in the Studio review box / export sheet.
 *
 * `masterW/masterH` are the dimensions the app knows the recording as — the
 * same values the crop was computed in and the ones page.tsx / ExportModal
 * hand to computePreviewStyle. The browser then renders the REAL pixels, so the
 * content size here is the coded size, which may differ.
 */
function previewWindow(
  crop: CropConfig,
  codedW: number,
  codedH: number,
  masterW: number,
  masterH: number,
  outputW: number,
  outputH: number
): Window {
  // The box is sized by the app (getPreviewBoxStyle). Model it at a size with
  // the target ratio — the window is scale-invariant, and the box-ratio tests
  // cover the shapes themselves.
  const boxScale = 0.37;
  const boxW = outputW * boxScale;
  const boxH = outputH * boxScale;
  const style = computePreviewStyle(crop, masterW, masterH);
  return coverWindow(codedW, codedH, boxW, boxH, String(style.objectPosition));
}

/** What the encoder is told to crop, after H.264 even-integer rounding. */
function exportWindow(
  crop: CropConfig,
  codedW: number,
  codedH: number,
  masterW: number,
  masterH: number,
  outputW: number,
  outputH: number
): Window {
  const rect = computeCodedSourceRect(crop, codedW, codedH, masterW, masterH, outputW, outputH);
  const even = toMediabunnyCropRect({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  });
  return { left: even.left, top: even.top, width: even.width, height: even.height };
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

// A spread of real source shapes: landscape, 4:3, square, portrait, tall.
const SOURCES: Array<{ label: string; w: number; h: number }> = [
  { label: 'landscape 16:9', w: 1920, h: 1080 },
  { label: 'landscape 4:3', w: 1440, h: 1080 },
  { label: 'square', w: 1080, h: 1080 },
  { label: 'portrait 9:16', w: 1080, h: 1920 },
  { label: 'portrait 4:5', w: 1080, h: 1350 },
  { label: 'ultrawide', w: 2560, h: 1080 },
];

// Subject landmarks as fractions of the source frame. A face sits in the upper
// third; the eye line is the horizontal line the crop must not walk away from.
const EYE_LINE = 0.38;
const FACE_X = 0.5;

/** Where a source-relative point lands inside a window, 0..1. */
function mapPoint(win: Window, srcW: number, srcH: number, fx: number, fy: number) {
  return { u: (fx * srcW - win.left) / win.width, v: (fy * srcH - win.top) / win.height };
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('STATE 8 — preview composition equals export composition', () => {
  it.each(REQUIRED_MATRIX.map((p) => [p.label, p.id, p.width, p.height] as const))(
    '%s: the window is identical for every source shape',
    (_label, platformId, outW, outH) => {
      for (const src of SOURCES) {
        const config = createExportConfig(platformId as PlatformId, src.w, src.h);
        const preview = previewWindow(config.crop, src.w, src.h, src.w, src.h, outW, outH);
        const exported = exportWindow(config.crop, src.w, src.h, src.w, src.h, outW, outH);

        // Even-integer rounding for H.264 may move the window by at most 1px.
        expect(Math.abs(preview.left - exported.left), `${src.label} left`).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(preview.top - exported.top), `${src.label} top`).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(preview.width - exported.width), `${src.label} width`).toBeLessThanOrEqual(2);
        expect(Math.abs(preview.height - exported.height), `${src.label} height`).toBeLessThanOrEqual(2);
      }
    }
  );

  it.each(REQUIRED_MATRIX.map((p) => [p.label, p.id, p.width, p.height] as const))(
    '%s: the window is exactly the output aspect (no stretch, no black bars)',
    (_label, platformId, outW, outH) => {
      for (const src of SOURCES) {
        const crop = getDefaultCrop(src.w, src.h, outW, outH);
        const rect = computeCodedSourceRect(crop, src.w, src.h, src.w, src.h, outW, outH);

        // Aspect must match to floating point: any deviation means the encoder
        // would have to letterbox or stretch to fill the canvas.
        expect(rect.width / rect.height, `${src.label}`).toBeCloseTo(outW / outH, 9);

        // Full-bleed: the window must be able to cover the whole output, so the
        // drawn frame is never smaller than the canvas on either axis.
        const scaleX = outW / rect.width;
        const scaleY = outH / rect.height;
        expect(Math.max(scaleX, scaleY)).toBeCloseTo(Math.min(scaleX, scaleY), 9);

        // And it must lie inside the source, or the encoder pads with black.
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.top).toBeGreaterThanOrEqual(0);
        expect(rect.left + rect.width).toBeLessThanOrEqual(src.w + 1e-6);
        expect(rect.top + rect.height).toBeLessThanOrEqual(src.h + 1e-6);
      }
    }
  );

  it.each(REQUIRED_MATRIX.map((p) => [p.label, p.id, p.width, p.height] as const))(
    '%s: the eye line and face stay where the user framed them',
    (_label, platformId, outW, outH) => {
      for (const src of SOURCES) {
        const config = createExportConfig(platformId as PlatformId, src.w, src.h);
        const preview = previewWindow(config.crop, src.w, src.h, src.w, src.h, outW, outH);
        const exported = exportWindow(config.crop, src.w, src.h, src.w, src.h, outW, outH);

        const pEye = mapPoint(preview, src.w, src.h, FACE_X, EYE_LINE);
        const eEye = mapPoint(exported, src.w, src.h, FACE_X, EYE_LINE);

        // The face must not drift between preview and export — this is the
        // "person remains correctly positioned" requirement, measured.
        expect(Math.abs(pEye.u - eEye.u), `${src.label} face x`).toBeLessThan(0.01);
        expect(Math.abs(pEye.v - eEye.v), `${src.label} eye line y`).toBeLessThan(0.01);

        // A centred crop keeps a centred subject centred in the output.
        expect(eEye.u).toBeCloseTo(0.5, 2);
        // And a centred crop must never cut the face off the top of the frame.
        expect(eEye.v).toBeGreaterThan(0);
        expect(eEye.v).toBeLessThan(1);
      }
    }
  );

  it('4:5 is never silently treated as 9:16', () => {
    const src = { w: 1920, h: 1080 };
    const crop = getDefaultCrop(src.w, src.h, 1080, 1350);
    const rect = computeCodedSourceRect(crop, src.w, src.h, src.w, src.h, 1080, 1350);
    expect(rect.width / rect.height).toBeCloseTo(4 / 5, 9);
    // 9:16 would be a much narrower window from the same source.
    const asNineSixteen = computeCodedSourceRect(crop, src.w, src.h, src.w, src.h, 1080, 1920);
    expect(asNineSixteen.width).toBeLessThan(rect.width);
  });

  it('a portrait source going to landscape is cropped top/bottom, not letterboxed', () => {
    // 1080x1920 -> 16:9: the window must be a full-width horizontal band, so
    // the top and bottom are cropped away rather than black bars appearing.
    const src = { w: 1080, h: 1920 };
    const crop = getDefaultCrop(src.w, src.h, 1920, 1080);
    const rect = computeCodedSourceRect(crop, src.w, src.h, src.w, src.h, 1920, 1080);
    // Full source width: nothing is cut from the sides.
    expect(rect.width).toBeCloseTo(src.w, 6);
    // A horizontal band of the source, centred: 1080 / (16/9) = 607.5 tall.
    expect(rect.height).toBeCloseTo(607.5, 6);
    expect(rect.top).toBeCloseTo((1920 - 607.5) / 2, 6);
    // If instead the whole 1920-tall frame were kept, the output would need
    // pillarbox bars — assert the window really is shorter than the source.
    expect(rect.height).toBeLessThan(src.h);
  });

  it('a landscape source going to portrait is cropped left/right, not letterboxed', () => {
    const src = { w: 1920, h: 1080 };
    const crop = getDefaultCrop(src.w, src.h, 1080, 1920);
    const rect = computeCodedSourceRect(crop, src.w, src.h, src.w, src.h, 1080, 1920);
    // Full source height: nothing is cut from the top or bottom.
    expect(rect.height).toBeCloseTo(src.h, 6);
    // A narrow vertical band, centred: 1080 * (9/16) = 607.5 wide.
    expect(rect.width).toBeCloseTo(607.5, 6);
    expect(rect.left).toBeCloseTo((1920 - 607.5) / 2, 6);
    expect(rect.width).toBeLessThan(src.w);
  });

  it('square to square needs no crop at all', () => {
    const src = { w: 1080, h: 1080 };
    const crop = getDefaultCrop(src.w, src.h, 1080, 1080);
    const rect = computeCodedSourceRect(crop, src.w, src.h, src.w, src.h, 1080, 1080);
    expect(rect).toEqual({ left: 0, top: 0, width: 1080, height: 1080 });
  });
});

describe('STATE 8 — the preview BOX is the platform frame', () => {
  it.each(LAUNCH_PLATFORM_PRESETS.map((p) => [p.label, p.aspectRatio, p.width, p.height] as const))(
    '%s: the box is sized by the binding axis so the ratio cannot be clamped away',
    (_label, aspectRatio, w, h) => {
      const style = getPreviewBoxStyle(aspectRatio as AspectRatio);
      // Exactly the target ratio, taken from the single source of truth.
      expect(style.aspectRatio).toBe(`${w} / ${h}`);
      // Width is min(region width, region height * ratio): whichever axis is
      // tighter wins, and aspect-ratio derives the other. This is what keeps
      // `aspect-ratio` from being inert (both axes definite) or silently
      // clamped (max-w / max-h).
      expect(style.width).toBe(`min(100cqw, calc(100cqh * ${w} / ${h}))`);
      // Critically: no max-width / max-height, which would break the ratio.
      expect(style).not.toHaveProperty('maxWidth');
      expect(style).not.toHaveProperty('maxHeight');
    }
  );

  it('the review box no longer sizes itself with w-full + sm:h-full', () => {
    // Regression guard for the measured defect: `w-full` plus `sm:h-full` makes
    // aspect-ratio inert on desktop, so the 16:9 box took the container's ratio
    // (measured 6.36:1 at 1600x900 and 11.25:1 at 1440x620). The shape now
    // comes from getPreviewBoxStyle, and the sizing classes are gone.
    const source = readFileSync(join(process.cwd(), 'src/components/layout/Canvas.tsx'), 'utf-8');
    expect(source).toContain('getPreviewBoxStyle(activeRatio)');
    expect(source).not.toMatch(/sm:h-full/);
    expect(source).not.toMatch(/max-w-5xl/);
  });
});

describe('STATE 8 — composition survives a mismatched master recording', () => {
  // The recorder falls back to its configured size when the video probe fails,
  // and the engine falls back to 1920x1080 if the coded size cannot be read. A
  // restored take keeps whatever was stored. So master dims can disagree with
  // the real pixels — and the composition must still be the cover crop.
  const MISMATCHES: Array<{ label: string; masterW: number; masterH: number; codedW: number; codedH: number }> = [
    { label: 'master says 16:9, file is portrait', masterW: 1920, masterH: 1080, codedW: 1080, codedH: 1920 },
    { label: 'master says portrait, file is 16:9', masterW: 1080, masterH: 1920, codedW: 1920, codedH: 1080 },
    { label: 'master says 4:3, file is 16:9', masterW: 1440, masterH: 1080, codedW: 1920, codedH: 1080 },
    { label: 'master missing (0x0), file is 16:9', masterW: 0, masterH: 0, codedW: 1920, codedH: 1080 },
  ];

  it.each(MISMATCHES)('$label: still the output aspect, still inside the source', (m) => {
    for (const platform of REQUIRED_MATRIX) {
      // The crop the UI would have produced from the (wrong) master dims.
      const crop = getDefaultCrop(m.masterW || 1920, m.masterH || 1080, platform.width, platform.height);
      const rect = computeCodedSourceRect(crop, m.codedW, m.codedH, m.masterW, m.masterH || 0, platform.width, platform.height);

      expect(rect.width / rect.height, `${platform.label} aspect`).toBeCloseTo(platform.width / platform.height, 9);
      expect(rect.left, `${platform.label} left`).toBeGreaterThanOrEqual(0);
      expect(rect.top, `${platform.label} top`).toBeGreaterThanOrEqual(0);
      expect(rect.left + rect.width, `${platform.label} right`).toBeLessThanOrEqual(m.codedW + 1e-6);
      expect(rect.top + rect.height, `${platform.label} bottom`).toBeLessThanOrEqual(m.codedH + 1e-6);
    }
  });

  it('a mismatched master still lands on the same window the preview shows', () => {
    // The preview always renders the real pixels with object-fit:cover, i.e.
    // the centred cover crop. The export must agree with it even when the
    // master's aspect lies.
    for (const m of MISMATCHES) {
      for (const platform of REQUIRED_MATRIX) {
        const crop = getDefaultCrop(m.masterW || 1920, m.masterH || 1080, platform.width, platform.height);
        const preview = previewWindow(crop, m.codedW, m.codedH, m.masterW || 1920, m.masterH || 1080, platform.width, platform.height);
        const exported = exportWindow(crop, m.codedW, m.codedH, m.masterW, m.masterH, platform.width, platform.height);

        expect(Math.abs(preview.left - exported.left), `${m.label} / ${platform.label} left`).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(preview.top - exported.top), `${m.label} / ${platform.label} top`).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});
