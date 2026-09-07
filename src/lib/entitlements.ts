import type { PlanType } from '@/types/db';

export interface PlanEntitlements {
  canExport: boolean;
  canDownload: boolean;
  canBatchExport: boolean;
  maxResolution: { width: number; height: number };
  maxDurationSeconds: number;
  maxDownloads: number | null;
  maxUploads: number | null;
  maxStorageMB: number | null;
  watermarkRequired: boolean;
}

const ENTITLEMENTS: Record<PlanType, PlanEntitlements> = {
  free: {
    canExport: false,
    canDownload: false,
    canBatchExport: false,
    maxResolution: { width: 1920, height: 1080 },
    maxDurationSeconds: 300,
    maxDownloads: 3,
    maxUploads: 3,
    maxStorageMB: 500,
    watermarkRequired: true,
  },
  creator_monthly: {
    canExport: true,
    canDownload: true,
    canBatchExport: false,
    maxResolution: { width: 1920, height: 1080 },
    maxDurationSeconds: Infinity,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    watermarkRequired: false,
  },
  creator_yearly: {
    canExport: true,
    canDownload: true,
    canBatchExport: false,
    maxResolution: { width: 1920, height: 1080 },
    maxDurationSeconds: Infinity,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    watermarkRequired: false,
  },
  pro_monthly: {
    canExport: true,
    canDownload: true,
    canBatchExport: true,
    maxResolution: { width: 3840, height: 2160 },
    maxDurationSeconds: Infinity,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    watermarkRequired: false,
  },
  pro_yearly: {
    canExport: true,
    canDownload: true,
    canBatchExport: true,
    maxResolution: { width: 3840, height: 2160 },
    maxDurationSeconds: Infinity,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    watermarkRequired: false,
  },
};

export function getEntitlements(plan: PlanType): PlanEntitlements {
  return ENTITLEMENTS[plan] || ENTITLEMENTS.free;
}

export function isPlanActive(expiresAt?: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt) > new Date();
}

export function clampResolution(
  width: number,
  height: number,
  maxResolution: { width: number; height: number },
): { width: number; height: number } {
  if (width <= maxResolution.width && height <= maxResolution.height) {
    return { width, height };
  }
  const scale = Math.min(maxResolution.width / width, maxResolution.height / height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
