import type { PlanType } from '@/types/db';
import type { PlatformId } from '@/types';

const CREATOR_PLANS: readonly PlanType[] = ['creator_monthly', 'creator_yearly', 'pro_monthly', 'pro_yearly'];

// FINAL pricing contract:
// Free: 10 min TOTAL recording/day, 720p, YouTube 16:9, unlimited local downloads, watermark.
// Creator: unlimited recording, 1080p, all formats, unlimited exports, no watermark.
// NOTE: recording allowance (min/day) and local downloads (unlimited) are different quotas.
export const FREE_MAX_DURATION_SECONDS = 600;
export const FREE_DAILY_RECORDING_SECONDS = 600;
// Free teleprompter: 3 min PER RECORDING SESSION (fresh allowance each take), never more than
// the remaining daily recording budget. When it runs out the prompter hides but the camera
// keeps recording. Teleprompter time does NOT deduct from the 10 min/day recording budget.
export const FREE_SESSION_TELEPROMPTER_SECONDS = 180;
export const FREE_RESOLUTION = { width: 1280, height: 720 } as const;

export interface PlanEntitlements {
  canExport: boolean;
  canDownload: boolean;
  canBatchExport: boolean;
  canCrop: boolean;
  maxResolution: { width: number; height: number };
  // null = unlimited recording duration (Creator)
  maxDurationSeconds: number | null;
  maxDownloads: number | null;
  maxUploads: number | null;
  maxStorageMB: number | null;
  // null = unlimited (Free local downloads are unlimited — no monthly export quota)
  maxExportsPerMonth: number | null;
  watermarkRequired: boolean;
}

// Only Free + Creator are customer-facing.
// Pro entries retained for backward compatibility — not exposed in purchase flows.
const ENTITLEMENTS: Record<PlanType, PlanEntitlements> = {
  free: {
    canExport: true,
    canDownload: true,
    canBatchExport: false,
    canCrop: false,
    maxResolution: { width: FREE_RESOLUTION.width, height: FREE_RESOLUTION.height },
    maxDurationSeconds: FREE_MAX_DURATION_SECONDS,
    maxDownloads: null,
    maxUploads: 3,
    maxStorageMB: 500,
    maxExportsPerMonth: null,
    watermarkRequired: true,
  },
  creator_monthly: {
    canExport: true,
    canDownload: true,
    canBatchExport: false,
    canCrop: true,
    maxResolution: { width: 1920, height: 1080 },
    maxDurationSeconds: null,
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
    maxDurationSeconds: null,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    maxExportsPerMonth: null,
    watermarkRequired: false,
  },
  pro_monthly: {
    canExport: true,
    canDownload: true,
    canBatchExport: false,
    canCrop: true,
    maxResolution: { width: 1920, height: 1080 },
    maxDurationSeconds: null,
    maxDownloads: null,
    maxUploads: null,
    maxStorageMB: null,
    maxExportsPerMonth: null,
    watermarkRequired: false,
  },
  pro_yearly: {
    canExport: true,
    canDownload: true,
    canBatchExport: false,
    canCrop: true,
    maxResolution: { width: 1920, height: 1080 },
    maxDurationSeconds: null,
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

export function isCreatorPlan(plan: string): boolean {
  return (CREATOR_PLANS as readonly string[]).includes(plan);
}

export function isPlatformLockedForUser(platformId: PlatformId, plan: string): boolean {
  return platformId !== 'youtube-landscape' && !isCreatorPlan(plan);
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

// ---------------------------------------------------------------------------
// Server-side daily recording budget (BUS-001 remediation).
// The client (localStorage ledger, duration form field) is a UX hint only.
// The server charges a ledger at export-creation time. Because the server
// cannot parse exact media duration in a serverless function, the charge is
// max(client claim, floor from verified bytes): under-reporting (0,
// negative, short, missing) can never reduce the charge below what the
// verified bytes imply at a generous reference ceiling bitrate.
// ---------------------------------------------------------------------------

// Generous ceiling for 720p H.264 output: the floor only ever charges for
// duration the bytes MUST contain even at implausibly efficient encoding.
// Legitimate encodes (lower bitrate) are charged at or below their claim.
export const RECORDING_FLOOR_BYTES_PER_SECOND = 12_000_000 / 8;

// Daily recording allowance in seconds, or null for unlimited plans.
// Unknown plans fail closed to the free budget.
export function getDailyRecordingAllowanceSeconds(plan: PlanType | string | null | undefined): number | null {
  if (!plan || plan === 'free') return FREE_DAILY_RECORDING_SECONDS;
  if (isCreatorPlan(plan)) return null;
  return FREE_DAILY_RECORDING_SECONDS;
}

// Any non-finite, missing, zero, or negative claim charges nothing by
// itself — the byte floor below still applies. Over-claiming only debits
// the liar's own budget.
export function sanitizeClaimedDuration(duration: unknown): number {
  const n = typeof duration === 'string' ? Number(duration) : (duration as number);
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function computeRecordingChargeSeconds(
  claimedDuration: unknown,
  verifiedBytes: number,
): number {
  const claim = sanitizeClaimedDuration(claimedDuration);
  const floor =
    Number.isFinite(verifiedBytes) && verifiedBytes > 0
      ? verifiedBytes / RECORDING_FLOOR_BYTES_PER_SECOND
      : 0;
  return Math.max(claim, floor);
}
