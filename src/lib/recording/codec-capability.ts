'use client';

/**
 * Recording codec selection (Phase 5/15).
 *
 * MediaRecorder output quality and browser support both hinge on the container
 * + codec pair, and support differs sharply between Chromium, Firefox and
 * Safari. Every candidate below is gated by `MediaRecorder.isTypeSupported`
 * before it is offered — nothing here is assumed to work based on the
 * detected browser (a capability layer, not browser-name hacks).
 *
 * The ladder is deterministic: WebM/VP9 (best quality per bit, supported by
 * Chrome/Edge/Firefox) → WebM/VP8 → WebM (browser default codecs) →
 * MP4/H.264+AAC (Safari, some Chromium builds) → plain MP4. The first
 * supported entry wins, and the result is cached per document because codec
 * support does not change mid-session.
 *
 * `null` means no recording MIME survived the check: capture cannot record
 * in this browser. Callers must surface that as a real preflight failure
 * rather than constructing a MediaRecorder that throws.
 */

export interface SelectedRecordingCodec {
  mimeType: string;
  extension: string;
  container: 'webm' | 'mp4';
}

const CANDIDATES: SelectedRecordingCodec[] = [
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm', container: 'webm' },
  { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm', container: 'webm' },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm', container: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', extension: 'webm', container: 'webm' },
  { mimeType: 'video/webm', extension: 'webm', container: 'webm' },
  { mimeType: 'video/mp4;codecs=h264,aac', extension: 'mp4', container: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4', container: 'mp4' },
];

let cached: SelectedRecordingCodec | null | undefined;

function isSupported(mimeType: string): boolean {
  try {
    return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType);
  } catch {
    return false;
  }
}

export function selectRecordingCodec(): SelectedRecordingCodec | null {
  if (cached !== undefined) return cached;
  cached = CANDIDATES.find((candidate) => isSupported(candidate.mimeType)) ?? null;
  return cached;
}

/** Test hook: forget the cached selection so a stubbed isTypeSupported is re-read. */
export function resetRecordingCodecCache(): void {
  cached = undefined;
}

/**
 * A high-quality video bitrate for the ACTUAL capture geometry (Phase 5).
 *
 * Browsers pick conservative MediaRecorder defaults (~2.5 Mbps at 1080p) that
 * visibly crush detail in talking-head footage, so the studio pins bitrate
 * explicitly, scaled to the real track settings — not a fixed value dressed
 * up as adaptive. 8 Mbps at 1080p/30 as the anchor; scales with pixels × fps
 * and is clamped to a floor (720p-ish minimum quality) and a ceiling (no
 * 4K-by-default spend, Phase 5 says avoid automatic 4K).
 */
export function bitrateForDimensions(
  width?: number,
  height?: number,
  frameRate?: number,
): number {
  const ANCHOR_AREA = 1920 * 1080;
  const ANCHOR_FPS = 30;
  const ANCHOR_BITRATE = 8_000_000;
  const MIN_BITRATE = 2_500_000;
  const MAX_BITRATE = 20_000_000;

  if (!width || !height) return ANCHOR_BITRATE;

  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const fps = Math.max(1, Math.round(frameRate || ANCHOR_FPS));

  const scale = (w * h * fps) / (ANCHOR_AREA * ANCHOR_FPS);
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, ANCHOR_BITRATE * scale)));
}

/**
 * Audio bitrate for the recording. 128 kbps Opus (or AAC where the container
 * demands it) comfortably preserves speech at the settings the mic track is
 * configured with (echo cancellation + noise suppression stay ON for the
 * teleprompter use case); higher totals add bytes without audible gain.
 */
export const RECORDING_AUDIO_BITRATE = 128_000;

/** True when this browser can construct a MediaRecorder at all. */
export function isMediaRecorderSupported(): boolean {
  return typeof MediaRecorder !== 'undefined';
}
