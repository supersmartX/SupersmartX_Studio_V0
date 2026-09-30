'use client';

import type { AspectRatio, CropConfig } from '@/types';
import { ASPECT_RATIO_PRESETS } from '@/constants';
import { getDefaultCrop } from './export/export-config';

// Authoritative composition model — single source for preview + export
// source → target canvas → scale (cover) → crop → focal → zoom → output

export function getEffectiveCrop(crop: CropConfig): CropConfig {
  if (!crop || crop.zoom === 1) return crop;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const effW = crop.width / crop.zoom;
  const effH = crop.height / crop.zoom;
  return {
    x: centerX - effW / 2,
    y: centerY - effH / 2,
    width: effW,
    height: effH,
    zoom: crop.zoom,
  };
}

// Canvas source rect for drawImage — uses effective crop scaled to actual video dimensions
export function computeCanvasSourceRect(
  crop: CropConfig,
  sourceW: number,
  sourceH: number,
  masterSourceW: number,
  masterSourceH: number
): { sx: number; sy: number; sw: number; sh: number } {
  const eff = getEffectiveCrop(crop);
  const scaleX = sourceW / (masterSourceW || sourceW || 1920);
  const scaleY = sourceH / (masterSourceH || sourceH || 1080);
  return {
    sx: eff.x * scaleX,
    sy: eff.y * scaleY,
    sw: eff.width * scaleX,
    sh: eff.height * scaleY,
  };
}

/**
 * The rect the encoder actually crops, in real video pixels, guaranteed to be
 * exactly the output aspect.
 *
 * computeCanvasSourceRect maps the crop from master space into the blob's real
 * pixel space. That is exact only while the master's aspect matches the coded
 * video's aspect — which is the normal case, but not guaranteed: the recorder
 * falls back to its configured size when the video probe fails, a restored take
 * keeps whatever was stored, and the engine falls back to 1920x1080 if
 * getCodedWidth() throws. If the aspects disagree, the scaled crop keeps the
 * MASTER's aspect, and the encoder's own `fit: cover` then crops it a second
 * time — so the file ends up tighter than the preview and off-centre. The user
 * sees a different composition than the one they approved, with the subject
 * drifting toward a cut-off edge.
 *
 * So the window is re-derived from the real pixels: take the cover crop of the
 * coded source at the OUTPUT aspect (what object-fit:cover shows in the
 * preview), then place it so the crop's normalised centre lands on that
 * window's centre. For the only crop production generates (getDefaultCrop,
 * always centred) this reduces exactly to the cover crop — identical to before
 * — and for a non-centred crop it stays inside the source and keeps the output
 * aspect, which is what prevents black bars and stretching.
 */
export function computeCodedSourceRect(
  crop: CropConfig,
  codedW: number,
  codedH: number,
  masterSourceW: number,
  masterSourceH: number,
  outputW: number,
  outputH: number
): { left: number; top: number; width: number; height: number } {
  const outputRatio = outputW / outputH;
  const srcRatio = codedW / codedH;

  // Cover crop of the real pixels at the output aspect — the preview's window.
  let width: number;
  let height: number;
  if (outputRatio > srcRatio) {
    width = codedW;
    height = codedW / outputRatio;
  } else {
    height = codedH;
    width = codedH * outputRatio;
  }

  const mW = masterSourceW || codedW;
  const mH = masterSourceH || codedH;
  const eff = getEffectiveCrop(crop);
  // Where the requested crop's centre sits, as a fraction of the frame.
  const centreX = (eff.x + eff.width / 2) / mW;
  const centreY = (eff.y + eff.height / 2) / mH;

  const left = centreX * codedW - width / 2;
  const top = centreY * codedH - height / 2;

  return {
    // Clamp rather than overflow: a window outside the source would make the
    // encoder pad, which is exactly the black-bar artefact to avoid.
    left: Math.min(Math.max(left, 0), codedW - width),
    top: Math.min(Math.max(top, 0), codedH - height),
    width,
    height,
  };
}

// CSS for a preview video element to reproduce an export crop window inside
// a matching-aspect box with object-fit: cover. With cover, the source is
// scaled to sW×sH and object-position p% aligns p% of the image with p% of
// the box, i.e. offset = p·(box−image). Solving offset = −x·s for the crop
// origin (x,y) gives p = x/(W−cropW): 0% = left/top aligned, 50% = centered,
// 100% = right/bottom aligned. Degenerate (full-bleed) spans fall back to 50%.
export function computePreviewStyle(
  crop: CropConfig,
  sourceW: number,
  sourceH: number
): React.CSSProperties {
  const eff = getEffectiveCrop(crop);
  const spanX = sourceW - eff.width;
  const spanY = sourceH - eff.height;
  const xPct = spanX > 0 ? (eff.x / spanX) * 100 : 50;
  const yPct = spanY > 0 ? (eff.y / spanY) * 100 : 50;
  return {
    objectFit: 'cover' as const,
    objectPosition: `${xPct}% ${yPct}%`,
    // Zoom is already baked into effective crop; no transform needed
  };
}

// Preview geometry derived from the SAME production crop the export uses.
// getDefaultCrop centers, so every platform today yields 50%/50% — but the
// value is computed from the real rect, not assumed. If a positioned crop
// ever becomes producible, preview follows it with no separate algorithm.
export function getPreviewCropGeometry(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number
): { crop: CropConfig; style: React.CSSProperties } {
  const sW = sourceW > 0 ? sourceW : 1920;
  const sH = sourceH > 0 ? sourceH : 1080;
  const crop = getDefaultCrop(sW, sH, targetW, targetH);
  return { crop, style: computePreviewStyle(crop, sW, sH) };
}

/* ------------------------------------------------------------------ *
 * Preview BOX shape — the other half of "preview == export"
 * ------------------------------------------------------------------ *
 * computePreviewStyle picks the right window inside the box, but it can only
 * be right if the box itself has the target aspect: `object-fit: cover` crops
 * to the BOX ratio, so a box that is not the platform ratio shows a different
 * composition than the file the user downloads.
 *
 * Sizing such a box in CSS is subtler than it looks, and getting it wrong is
 * silent:
 *
 *   - `aspect-ratio` is only honoured while an axis is `auto`. Setting both
 *     `w-full` and `h-full` (or `sm:h-full`) makes it inert, and the box
 *     silently takes the container's ratio instead.
 *   - A `max-width` / `max-height` clamp is just as bad: it shrinks ONE axis
 *     after the ratio was applied, so the box is no longer the target ratio.
 *
 * Both failure modes were measured in a real browser: a landscape (16:9) review
 * box rendered at 6.36:1 on a 1600x900 viewport and 11.25:1 on 1440x620, while
 * 9:16 / 4:5 / 1:1 were all exactly right. The landscape case was the broken
 * one precisely because it was the only ratio sized `w-full ... sm:h-full`.
 *
 * The fix sizes the box by the binding axis explicitly: `min(100cqw,
 * 100cqh * ratio)`. Whichever axis is tighter wins, and `aspect-ratio` then
 * derives the other one, so the box is exactly the target ratio and can never
 * overflow. Requires `container-type: size` on the parent (see
 * getPreviewBoxContainerStyle).
 */

/** Style for the element that WRAPS a preview box. Makes cqw/cqh resolvable. */
export function getPreviewBoxContainerStyle(): React.CSSProperties {
  return { containerType: 'size' };
}

/**
 * A box that is exactly `aspectRatio` and always fits its container.
 * Must be rendered inside an element carrying getPreviewBoxContainerStyle().
 */
export function getPreviewBoxStyle(aspectRatio: AspectRatio): React.CSSProperties {
  const preset = ASPECT_RATIO_PRESETS[aspectRatio];
  const w = preset?.width ?? 16;
  const h = preset?.height ?? 9;
  return {
    width: `min(100cqw, calc(100cqh * ${w} / ${h}))`,
    aspectRatio: `${w} / ${h}`,
  };
}

// Focal helpers — map presets to crop positions
export type FocalPosition = 'center' | 'left' | 'right' | 'top' | 'bottom';

export function applyFocal(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
  focal: FocalPosition
): CropConfig {
  const targetRatio = targetW / targetH;
  const sourceRatio = sourceW / sourceH;
  let cropW: number, cropH: number;
  if (targetRatio > sourceRatio) {
    cropW = sourceW;
    cropH = sourceW / targetRatio;
  } else {
    cropH = sourceH;
    cropW = sourceH * targetRatio;
  }
  let x = (sourceW - cropW) / 2;
  let y = (sourceH - cropH) / 2;
  // Adjust for focal
  if (focal === 'left') x = 0;
  if (focal === 'right') x = sourceW - cropW;
  if (focal === 'top') y = 0;
  if (focal === 'bottom') y = sourceH - cropH;
  // center already
  return { x, y, width: cropW, height: cropH, zoom: 1 };
}

// Safe-area inset for vertical/social formats — editor guidance only (not baked into export)
export function getSafeAreaInset(aspectRatio: string): string {
  // 9:16, 4:5 vertical: 6% inset top/bottom, 5% sides for UI chrome
  if (aspectRatio === '9:16') return '6% 5%';
  if (aspectRatio === '4:5') return '5% 5%';
  if (aspectRatio === '1:1') return '4% 4%';
  return '0';
}

// Verify output dimensions by loading blob into video element
export async function verifyExportBlob(
  blob: Blob,
  expectedWidth: number,
  expectedHeight: number,
  timeoutMs = 8000
): Promise<{ ok: boolean; actualWidth?: number; actualHeight?: number; duration?: number; error?: string }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let done = false;
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        cleanup();
        URL.revokeObjectURL(url);
        resolve({ ok: false, error: 'verify timeout' });
      }
    }, timeoutMs);
    video.onloadedmetadata = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const actualWidth = video.videoWidth;
      const actualHeight = video.videoHeight;
      const duration = video.duration;
      cleanup();
      URL.revokeObjectURL(url);
      if (actualWidth === expectedWidth && actualHeight === expectedHeight) {
        resolve({ ok: true, actualWidth, actualHeight, duration });
      } else {
        resolve({
          ok: false,
          actualWidth,
          actualHeight,
          duration,
          error: `dimension mismatch expected ${expectedWidth}x${expectedHeight} got ${actualWidth}x${actualHeight}`,
        });
      }
    };
    video.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      URL.revokeObjectURL(url);
      const code = (video.error as any)?.code;
      resolve({ ok: false, error: `video error code ${code ?? 'unknown'}` });
    };
    video.src = url;
  });
}
