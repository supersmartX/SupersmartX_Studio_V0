'use client';

export const GUEST_PREVIEW_MAX_SECONDS = 15;

export interface PreviewOptions {
  maxSeconds?: number;
  watermarkText?: string;
}

export async function trimBlobToSeconds(
  blob: Blob,
  maxSeconds: number
): Promise<Blob> {
  const video = document.createElement('video');
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    video.preload = 'metadata';
    video.muted = true;

    video.onloadedmetadata = () => {
      const totalDuration = video.duration;
      URL.revokeObjectURL(url);

      if (totalDuration <= maxSeconds || !isFinite(totalDuration)) {
        resolve(blob);
        return;
      }

      const trimmed = blob.slice(0, blob.size * (maxSeconds / totalDuration), blob.type);
      resolve(trimmed);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };

    video.src = url;
  });
}

export function createWatermarkOverlay(
  text: string,
  _position: 'corner' | 'center' = 'corner'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.font = '14px sans-serif';
  ctx.fillText(text, 0, 0);

  return `url(${canvas.toDataURL()})`;
}

export function isGuestPreview(duration: number, isAuthenticated: boolean): boolean {
  if (isAuthenticated) return false;
  return duration > GUEST_PREVIEW_MAX_SECONDS;
}

export async function createGuestPreviewBlob(
  originalBlob: Blob
): Promise<Blob> {
  return trimBlobToSeconds(originalBlob, GUEST_PREVIEW_MAX_SECONDS);
}

export function getMaxPreviewDuration(
  totalDuration: number,
  isAuthenticated: boolean
): number {
  if (isAuthenticated) return totalDuration;
  return Math.min(totalDuration, GUEST_PREVIEW_MAX_SECONDS);
}

export function canDownload(isAuthenticated: boolean, plan: string): boolean {
  return isAuthenticated && plan !== 'free';
}
