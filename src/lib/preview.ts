'use client';

/**
 * Maximum preview duration for unauthenticated (guest) users.
 *
 * NOTE: This is a UX limitation, NOT a security control. The full recording
 * is captured client-side and can be accessed via browser DevTools. The 15-second
 * limit is enforced purely in the UI layer to encourage sign-up. Server-side
 * entitlements (via DB) are the authoritative access control for exports, downloads,
 * and storage.
 */
export const GUEST_PREVIEW_MAX_SECONDS = 15;

export interface PreviewOptions {
  maxSeconds?: number;
  watermarkText?: string;
}

export async function trimBlobToSeconds(
  blob: Blob,
  _maxSeconds: number
): Promise<Blob> {
  // Intentionally no byte-slicing — slicing an MP4/WebM by bytes corrupts the container.
  // Guest preview limit is enforced at UI level via VideoPlayer timeupdate (15s clamp),
  // not by truncating the Blob. Return original blob intact.
  return blob;
}

export function createWatermarkOverlay(
  text: string,
  _position: 'corner' | 'center' = 'corner'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
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
