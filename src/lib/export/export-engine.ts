import type { EncodeResult, ExportEngineOptions } from './export-types';
import { encodeExportMediabunny } from './mediabunny-export-engine';

export type { EncodeResult, ExportEngineOptions } from './export-types';

// Production export entry point. Mediabunny is the only export engine.
// Same options in; out comes the video/mp4 Blob plus the encoder's ground-
// truth audio decision (Phase 3 verification input). The encode behavior
// itself — codecs, bitrates, watermark drawing — is unchanged.
export async function encodeExport(options: ExportEngineOptions): Promise<EncodeResult> {
  return encodeExportMediabunny(options);
}
