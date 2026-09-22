import type { ExportEngineOptions } from './export-types';
import { encodeExportMediabunny } from './mediabunny-export-engine';

export type { ExportEngineOptions } from './export-types';

// Production export entry point. Mediabunny is the only export engine.
// Same options in, same video/mp4 Blob out — the public contract used by
// useExportPipeline is unchanged.
export async function encodeExport(options: ExportEngineOptions): Promise<Blob> {
  return encodeExportMediabunny(options);
}
