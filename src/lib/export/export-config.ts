import { PLATFORM_PRESETS } from '@/constants';
import { clampResolution } from '@/lib/entitlements';
import type { CropConfig, ExportConfig, PlatformId } from '@/types';

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
