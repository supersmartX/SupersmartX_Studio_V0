'use client';

import { computeCodedSourceRect } from '@/lib/composition';
import { drawWatermark } from './export-watermark';
import { EXPORT_AUDIO_BITRATE, EXPORT_VIDEO_BITRATE } from './export-limits';
import type { EncodeResult, ExportEngineOptions } from './export-types';
import type { Conversion as ConversionInstance } from 'mediabunny';

// Maps a source-space crop rect to Mediabunny's CropRectangle. Values are
// rounded to even integers: H.264 (4:2:0) requires even crop dimensions and
// offsets, and the deviation from the ideal rect stays under one pixel.
export function toMediabunnyCropRect(rect: { x: number; y: number; width: number; height: number }): { left: number; top: number; width: number; height: number } {
  const evenOffset = (v: number) => Math.round(v / 2) * 2;
  const evenSize = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { left: evenOffset(rect.x), top: evenOffset(rect.y), width: evenSize(rect.width), height: evenSize(rect.height) };
}

// Never leak engine internals (e.g. colorSpace null derefs, decoder traces) to users.
// Technical detail goes to console; callers receive the existing friendly error model.
function mapExportError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/colorspace/i.test(message)) {
    return new Error('Video encoding failed due to a browser compatibility issue. Please try updating your browser or graphics drivers.');
  }
  return error instanceof Error ? error : new Error(message);
}

// Mediabunny production engine. Same contract as the legacy WebCodecs engine:
// same options in, video/mp4 Blob out (plus the ground-truth audio decision
// for Phase 3 verification). Composition (computeCanvasSourceRect) and
// watermark (drawWatermark) behavior are reused unchanged.
export async function encodeExportMediabunny({ master, config, signal, onProgress, watermarkRequired = false }: ExportEngineOptions): Promise<EncodeResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const { crop, outputWidth, outputHeight } = config;

  // Dynamic import: mediabunny is browser-only. This keeps it out of the main
  // bundle (code-split chunk) and out of the unit-test module graph. The
  // encode path only ever runs in browsers.
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, InputAudioTrack, Mp4OutputFormat, Output } = await import('mediabunny');

  const input = new Input({ source: new BlobSource(master.blob), formats: ALL_FORMATS });

  const videoTrack = await input.getPrimaryVideoTrack().catch(() => null);
  if (!videoTrack) throw new Error('No video track found in recording.');
  let sourceW = 1920;
  let sourceH = 1080;
  try {
    sourceW = (await videoTrack.getCodedWidth()) || 1920;
    sourceH = (await videoTrack.getCodedHeight()) || 1080;
  } catch {
    // Keep defaults; composition stays defined.
  }

  // Ground-truth audio check against the actual blob, not the hasAudio hint.
  let includeAudio = false;
  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack) includeAudio = await audioTrack.canDecode();
  } catch {
    includeAudio = false;
  }

  const codedCrop = computeCodedSourceRect(
    crop,
    sourceW,
    sourceH,
    master.sourceWidth || 1920,
    master.sourceHeight || 1080,
    outputWidth,
    outputHeight
  );

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context not available.');

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  let conversion: ConversionInstance;
  try {
    conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        codec: 'avc',
        width: outputWidth,
        height: outputHeight,
        fit: 'cover',
        bitrate: EXPORT_VIDEO_BITRATE,
        forceTranscode: true,
        // Source-space crop rectangle derived from the real coded dimensions
        // (not the assumed master size), and already at the output aspect.
        // `fit: cover` then has nothing left to crop, so the frame is always
        // full-bleed: no stretching, no letterboxing, and the same window the
        // preview showed.
        crop: toMediabunnyCropRect({
          x: codedCrop.left,
          y: codedCrop.top,
          width: codedCrop.width,
          height: codedCrop.height,
        }),
        processedWidth: outputWidth,
        processedHeight: outputHeight,
        process: (sample) => {
          const frame = sample.toVideoFrame();
          try {
            // The received frame is already cropped and fitted into the output
            // box: paint it full-bleed so the destination always covers the
            // complete canvas (no stretching, no letterboxing).
            ctx.drawImage(frame, 0, 0, frame.codedWidth, frame.codedHeight, 0, 0, outputWidth, outputHeight);
          } finally {
            frame.close();
          }
          if (watermarkRequired) drawWatermark(ctx, outputWidth, outputHeight);
          return canvas;
        },
      },
      audio: includeAudio
        ? { codec: 'aac', bitrate: EXPORT_AUDIO_BITRATE, forceTranscode: true }
        : { discard: true },
      showWarnings: false,
    });
  } catch (error) {
    throw mapExportError(error);
  }

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((item) => item.reason).join(', ');
    console.error('[Export] Mediabunny conversion invalid:', reasons || 'unknown reason');
    throw new Error('This recording format is not supported for export.');
  }
  // Ground truth for Phase 3 verification: which tracks the conversion will
  // actually mux — evaluated AFTER mediabunny applied its discards, so a
  // source whose audio turned out undecodable/unencodable claims no audio
  // instead of making every export fail an audio check it could never pass.
  // This is what gets uploaded with the claim, never the recorder's hasAudio
  // hint or a UI badge.
  const hasAudio = conversion.utilizedTracks.some((track) => track instanceof InputAudioTrack);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  conversion.onProgress = (progress: number) => {
    onProgress?.(Math.min(Math.max(progress, 0), 1));
  };

  const onAbort = () => { conversion.cancel().catch(() => {}); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    await conversion.execute();
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    console.error('[Export] Mediabunny conversion failed:', error);
    throw mapExportError(error);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    canvas.width = 0;
    canvas.height = 0;
  }

  onProgress?.(1);

  const buffer = output.target.buffer;
  if (!buffer || buffer.byteLength < 100) throw new Error('Export produced an empty file.');
  return { blob: new Blob([buffer], { type: 'video/mp4' }), hasAudio };
}
