import type { ExportConfig } from '@/types';
import type { CreatorUploadResult } from './export-types';

export async function uploadCreatorExportToR2(resultBlob: Blob, config: ExportConfig, duration: number, signal: AbortSignal, serverJobId?: string): Promise<CreatorUploadResult> {
  const presignedRes = await fetch('/api/exports/presigned-put', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platformId: config.platformId, outputWidth: config.outputWidth, outputHeight: config.outputHeight, duration, crop: config.crop, jobId: serverJobId }), signal });
  if (!presignedRes.ok) { const error = await presignedRes.json().catch(() => ({ error: 'Failed to get upload URL' })); throw new Error(error.error || 'Failed to get upload URL'); }
  const data = await presignedRes.json();
  const key: string = data.key;
  if (typeof data.jobId === 'string' && data.jobId.length > 0) serverJobId = data.jobId;
  const putRes = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: resultBlob, signal });
  if (!putRes.ok) throw new Error('Direct upload to storage failed');
  const completeRes = await fetch('/api/exports/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: serverJobId, key, fileSize: resultBlob.size, mimeType: 'video/mp4', platformId: config.platformId, outputWidth: config.outputWidth, outputHeight: config.outputHeight }), signal });
  if (!completeRes.ok) { const error = await completeRes.json().catch(() => ({ error: 'Completion failed' })); throw new Error(error.error || 'Completion failed'); }
  const completed = await completeRes.json();
  return { exportId: completed.exportId, r2Key: completed.r2Key, serverJobId };
}
