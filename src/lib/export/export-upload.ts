import type { ExportConfig } from '@/types';
import type { CreatorUploadResult } from './export-types';

// The upload has three network steps that fail for entirely different reasons
// (no entitlement, bucket CORS, signature expiry, quota). Collapsing them into
// one message made every failure look like the user's internet, which is why a
// broken R2 endpoint shipped as "Connection error. Check your connection".
const UPLOAD_STAGES = {
  'requesting upload URL': { failure: 'R2 presigned URL generation failed', phase: 'the presigned URL request' },
  'uploading to storage': { failure: 'R2 upload failed', phase: 'the upload to R2 storage' },
  'finalizing export': { failure: 'R2 export completion failed', phase: 'export finalization' },
} as const;

export type UploadStage = keyof typeof UPLOAD_STAGES;

export class ExportUploadError extends Error {
  readonly stage: UploadStage;
  readonly isNetworkError: boolean;

  constructor(stage: UploadStage, detail: string, isNetworkError: boolean) {
    super(`${UPLOAD_STAGES[stage].failure}: ${detail}`);
    this.name = 'ExportUploadError';
    this.stage = stage;
    this.isNetworkError = isNetworkError;
  }
}

/** User-facing text for an upload failure, keeping the network/offline split honest. */
export function describeUploadError(error: ExportUploadError): string {
  return error.isNetworkError
    ? `Connection error during ${UPLOAD_STAGES[error.stage].phase}. Check your connection and try again.`
    : error.message;
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException) return error.name === 'AbortError';
  return false;
}

export async function uploadCreatorExportToR2(resultBlob: Blob, config: ExportConfig, duration: number, signal: AbortSignal, serverJobId?: string): Promise<CreatorUploadResult> {
  let stage: UploadStage = 'requesting upload URL';
  try {
    const presignedRes = await fetch('/api/exports/presigned-put', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platformId: config.platformId, outputWidth: config.outputWidth, outputHeight: config.outputHeight, duration, crop: config.crop, jobId: serverJobId }), signal });
    if (!presignedRes.ok) { const error = await presignedRes.json().catch(() => ({ error: 'Failed to get upload URL' })); throw new ExportUploadError(stage, error.error || `presigned URL request returned status ${presignedRes.status}`, false); }
    const data = await presignedRes.json();
    const key: string = data.key;
    if (typeof data.jobId === 'string' && data.jobId.length > 0) serverJobId = data.jobId;
    stage = 'uploading to storage';
    const putRes = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: resultBlob, signal });
    if (!putRes.ok) throw new ExportUploadError(stage, `storage rejected the upload (status ${putRes.status})`, false);
    stage = 'finalizing export';
    const completeRes = await fetch('/api/exports/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: serverJobId, key, fileSize: resultBlob.size, mimeType: 'video/mp4', platformId: config.platformId, outputWidth: config.outputWidth, outputHeight: config.outputHeight, duration }), signal });
    if (!completeRes.ok) { const error = await completeRes.json().catch(() => ({ error: 'Completion failed' })); throw new ExportUploadError(stage, error.error || `completion returned status ${completeRes.status}`, false); }
    const completed = await completeRes.json();
    return { exportId: completed.exportId, r2Key: completed.r2Key, serverJobId };
  } catch (error) {
    // A browser-side fetch rejects with TypeError for network, TLS, CORS and
    // blocked-mixed-content alike. There is no way to tell those apart from JS,
    // so the stage is the only actionable signal we can honestly give.
    if (error instanceof ExportUploadError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const detail = error instanceof Error ? error.message : 'Export failed';
    throw new ExportUploadError(stage, detail, isNetworkFailure(error));
  }
}