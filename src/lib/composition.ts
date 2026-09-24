'use client';

import type { CropConfig } from '@/types';
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
