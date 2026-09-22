import type { ExportConfig, MasterRecording } from '@/types';

export interface ExportEngineOptions {
  master: MasterRecording;
  config: ExportConfig;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  watermarkRequired?: boolean;
}

export interface CreatorUploadResult {
  exportId: string | undefined;
  r2Key: string | undefined;
  serverJobId: string | undefined;
}
