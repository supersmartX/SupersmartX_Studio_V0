import type { ExportConfig, MasterRecording } from '@/types';

export interface ExportEngineOptions {
  master: MasterRecording;
  config: ExportConfig;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  watermarkRequired?: boolean;
}

/**
 * Phase 3 — what the encoder actually produced. `hasAudio` is the engine's
 * ground-truth probe against the source blob (canDecode), not the recorder's
 * hasAudio hint or a UI badge; the upload/verification chain passes it on so
 * the server can require the artifact to genuinely contain the audio stream
 * the source had.
 */
export interface EncodeResult {
  blob: Blob;
  hasAudio: boolean;
}

export interface CreatorUploadResult {
  exportId: string | undefined;
  r2Key: string | undefined;
  serverJobId: string | undefined;
}
