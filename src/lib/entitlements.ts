import type { PlanType } from '@/types/db';

export const FREE_MAX_DURATION_SECONDS = 180;
export const CREATOR_MAX_DURATION_SECONDS = 1800;
export const FREE_MONTHLY_EXPORT_LIMIT = 3;

export interface PlanEntitlements {
  canExport: boolean;
  canDownload: boolean;
  canBatchExport: boolean;
  canCrop: boolean;
  maxResolution: { width: number; height: number };
  maxDurationSeconds: number;
  maxDownloads: number | null;
  maxUploads: number | null;
  maxStorageMB: number | null;
  maxExportsPerMonth: number | null;
  watermarkRequired: boolean;
}

// Launch entitlements: Only Free + Creator are customer-facing.
// Pro entries retained for backward compatibility — not exposed in purchase flows.
const ENTITLEMENTS: Record<PlanType, PlanEntitlements> = {
  free: {
    canExport: true,
    canDownload: true,
    canBatchExport: false,
    canCrop: false,
    maxResolution: { width: 1920, height: 1080 },
    maxDurationSeconds: FREE_MAX_DURATION_SECONDS,
    maxDownloads: null,
    maxUploads: 3,
    maxStorageMB: 500,
    maxExportsPerMonth: FREE_MONTHLY_EXPORT_LIMIT,
    watermarkRequired: true,
  },
  creator_monthly: {
    canExport: true,
    canDownload: true,
    canBatchExport: false,
    canCrop: true,
    maxResolution: { width: 1920, height: 1080 },
    maxDurationSeconds: CREATOR_MAX_DURATION_SECONDS,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    maxExportsPerMonth: null,
    watermarkRequired: false,
  },
  creator_yearly: {
    canExport: true,
    canDownload: true,
    canBatchExport: false,
    canCrop: true,
    maxResolution: { width: 1920, height: 1080 },
    maxDurationSeconds: CREATOR_MAX_DURATION_SECONDS,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    maxExportsPerMonth: null,
    watermarkRequired: false,
  },
  pro_monthly: {
    canExport: true,
    canDownload: true,
    canBatchExport: true,
    canCrop: true,
    maxResolution: { width: 3840, height: 2160 },
    maxDurationSeconds: CREATOR_MAX_DURATION_SECONDS,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    maxExportsPerMonth: null,
    watermarkRequired: false,
  },
  pro_yearly: {
    canExport: true,
    canDownload: true,
    canBatchExport: true,
    canCrop: true,
    maxResolution: { width: 3840, height: 2160 },
    maxDurationSeconds: CREATOR_MAX_DURATION_SECONDS,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    maxExportsPerMonth: null,
    watermarkRequired: false,
  },
};

export function getEntitlements(plan: PlanType): PlanEntitlements {
  return ENTITLEMENTS[plan] || ENTITLEMENTS.free;
}

export function isPlanActive(
  expiresAt: string | null | undefined,
  plan?: PlanType | null
): boolean {
  // Free plan: no expiry needed — always active
  if (!plan || plan === 'free') return true;
  // Paid plan without expiry: treat as inactive (grace period expired or data missing)
  if (!expiresAt) return false;
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
