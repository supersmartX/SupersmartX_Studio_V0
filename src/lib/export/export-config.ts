import { LAUNCH_PLATFORM_PRESETS, PLATFORM_PRESETS } from '@/constants';
import { clampResolution } from '@/lib/entitlements';
import type { CropConfig, ExportConfig, PlatformId } from '@/types';

export const DEFAULT_EXPORT_PLATFORM: PlatformId = 'youtube-landscape';

/**
 * Resolve which platform the export sheet should open on.
 *
 * Unset or non-launch requests fall back to the free default. A request the
 * current identity is not entitled to (Free or guest -> anything but YouTube
 * 16:9) is downgraded to that default rather than presented as a chosen format,
 * so a stale or tampered preference can never hand a locked config to the
 * encoder. The predicate is passed in so the caller owns the entitlement
 * source, and so guests are covered by the same rule as authenticated Free.
 */
export function resolveInitialExportPlatform(
  initialPlatformId: PlatformId | undefined,
  isPlatformLocked: (platformId: PlatformId) => boolean,
): PlatformId {
  const requested =
    initialPlatformId && LAUNCH_PLATFORM_PRESETS.some((p) => p.id === initialPlatformId)
      ? initialPlatformId
      : DEFAULT_EXPORT_PLATFORM;
  if (requested !== DEFAULT_EXPORT_PLATFORM && isPlatformLocked(requested)) {
    return DEFAULT_EXPORT_PLATFORM;
  }
  return requested;
}

export function getDefaultCrop(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): CropConfig {
  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  let cropWidth: number;
  let cropHeight: number;
  if (targetRatio > sourceRatio) {
    cropWidth = sourceWidth;
    cropHeight = sourceWidth / targetRatio;
  } else {
    cropHeight = sourceHeight;
    cropWidth = sourceHeight * targetRatio;
  }
  return { x: (sourceWidth - cropWidth) / 2, y: (sourceHeight - cropHeight) / 2, width: cropWidth, height: cropHeight, zoom: 1 };
}

export function createExportConfig(platformId: PlatformId, sourceWidth: number, sourceHeight: number, maxResolution?: { width: number; height: number }): ExportConfig {
  // Single shared ceiling so the client config can never disagree with the
  // server-side entitlement clamp that validates /api/exports/complete.
  const clamp = (width: number, height: number) =>
    maxResolution ? clampResolution(width, height, maxResolution) : { width, height };
  const preset = PLATFORM_PRESETS.find((item) => item.id === platformId);
  if (!preset) {
    const dimensions = clamp(sourceWidth, Math.round(sourceWidth / (16 / 9)));
    return { platformId: 'custom', aspectRatio: '16:9', outputWidth: dimensions.width, outputHeight: dimensions.height, crop: getDefaultCrop(sourceWidth, sourceHeight, dimensions.width, dimensions.height) };
  }
  const dimensions = clamp(preset.width, preset.height);
  return { platformId, aspectRatio: preset.aspectRatio, outputWidth: dimensions.width, outputHeight: dimensions.height, crop: getDefaultCrop(sourceWidth, sourceHeight, dimensions.width, dimensions.height) };
}
