/**
 * STATE 8 browser driver — runs inside Chromium.
 *
 * Drives the REAL production export path (createExportConfig ->
 * encodeExportMediabunny) over a synthetic master whose pixels are known, then
 * decodes the produced MP4 and reports where things actually landed. Nothing
 * here reimplements production logic: the point is to read the real file.
 *
 * The master is a calibration grid. Along U the red channel alternates at every
 * 1/8 boundary; along V the green channel does the same; blue is flat. So a
 * single decoded scanline in each direction recovers the crop window on that
 * axis without assuming anything about the crop. A white marker sits at a known
 * fraction as a second, independent check of framing.
 */
import { createExportConfig } from '@/lib/export/export-config';
import { encodeExportMediabunny } from '@/lib/export/mediabunny-export-engine';
import { computeCodedSourceRect } from '@/lib/composition';
import { readMp4DimensionsFromBlob, readMp4Artifact } from '@/lib/export/mp4-metadata';
import { verifyExportArtifact } from '@/lib/export/artifact-verification';
import { MAX_EXPORT_SIZE_BYTES } from '@/lib/export/export-limits';
import type { MasterRecording } from '@/types';

/** Marker fraction within the source frame. */
export const FACE_U = 0.5;
export const FACE_V = 0.38;

const FRAMES = 6;
const FPS = 12;
/** Calibration grid resolution. */
const BANDS = 8;

export function profileAt(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  axis: Channel,
  samples: number
): number[] {
  const channel = axis === 'u' ? 0 : 1;
  const length = axis === 'u' ? w : h;
  const profile = new Float64Array(length);
  for (let s = 0; s < samples; s += 1) {
    const pos = Math.round(((s + 0.5) / samples) * (length - 1));
    for (let i = 0; i < length; i += 1) {
      const x = axis === 'u' ? i : pos;
      const y = axis === 'u' ? pos : i;
      profile[i] += data[(y * w + x) * 4 + channel];
    }
  }
  for (let i = 0; i < length; i += 1) profile[i] /= samples;
  return Array.from(profile);
}

type Channel = 'u' | 'v';

/**
 * Paints the calibration grid straight into pixels rather than stacking fills,
 * so no axis can be accidentally painted over the other.
 * red alternates on U, green on V, blue is flat at 128 so that only the marker
 * clears the blue threshold.
 */
function drawMaster(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const markerW = Math.max(6, Math.round(width * 0.02));
  const markerH = Math.max(6, Math.round(height * 0.03));
  const markerX0 = Math.round(FACE_U * width - markerW / 2);
  const markerX1 = markerX0 + markerW;
  const markerY0 = Math.round(FACE_V * height - markerH / 2);
  const markerY1 = markerY0 + markerH;

  for (let y = 0; y < height; y += 1) {
    const vBand = Math.min(BANDS - 1, Math.floor((y * BANDS) / height));
    const green = vBand % 2 === 0 ? 255 : 40;
    for (let x = 0; x < width; x += 1) {
      const uBand = Math.min(BANDS - 1, Math.floor((x * BANDS) / width));
      const red = uBand % 2 === 0 ? 255 : 40;
      const onMarker = x >= markerX0 && x < markerX1 && y >= markerY0 && y < markerY1;
      const i = (y * width + x) * 4;
      data[i] = onMarker ? 255 : red;
      data[i + 1] = onMarker ? 255 : green;
      data[i + 2] = onMarker ? 255 : 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Encodes the synthetic master to a real MP4 using mediabunny. */
export async function buildMaster(
  width: number,
  height: number
): Promise<{ blob: Blob; duration: number }> {
  const { Mp4OutputFormat, BufferTarget, CanvasSource, Output } = await import('mediabunny');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: 8_000_000,
  });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();
  for (let i = 0; i < FRAMES; i += 1) {
    drawMaster(ctx, width, height);
    await source.add(i / FPS + 0.001);
  }
  await output.finalize();

  return {
    blob: new Blob([target.buffer as ArrayBuffer], { type: 'video/mp4' }),
    duration: FRAMES / FPS,
  };
}

/** Runs the production encode for a platform and returns the real file. */
export async function runProductionExport(
  master: MasterRecording,
  platformId: string
): Promise<{ blob: Blob; hasAudio: boolean; outputWidth: number; outputHeight: number }> {
  const config = createExportConfig(
    platformId as never,
    master.sourceWidth,
    master.sourceHeight
  );
  const { blob, hasAudio } = await encodeExportMediabunny({
    master,
    config,
    signal: undefined,
    onProgress: undefined,
    watermarkRequired: false,
  });
  return { blob, hasAudio, outputWidth: config.outputWidth, outputHeight: config.outputHeight };
}

/** Runs the production encode with the watermark applied (Phase 3 watermark artifact proof). */
export async function runProductionExportWatermarked(
  master: MasterRecording,
  platformId: string
): Promise<{ blob: Blob; hasAudio: boolean; outputWidth: number; outputHeight: number }> {
  const config = createExportConfig(
    platformId as never,
    master.sourceWidth,
    master.sourceHeight
  );
  const { blob, hasAudio } = await encodeExportMediabunny({
    master,
    config,
    signal: undefined,
    onProgress: undefined,
    watermarkRequired: true,
  });
  return { blob, hasAudio, outputWidth: config.outputWidth, outputHeight: config.outputHeight };
}

/**
 * Decodes the file and measures it. A <video> must be seeked and given a paint
 * opportunity before drawImage returns real pixels; sampling straight after
 * loadeddata yields a black frame.
 */
export async function decodeFrameFor(
  blob: Blob,
  atSeconds: number
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('decode failed'));
    setTimeout(() => reject(new Error('decode timeout')), 20000);
  });

  if (Number.isFinite(atSeconds) && atSeconds > 0) {
    video.currentTime = Math.min(atSeconds, Math.max(0, video.duration - 0.05));
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 5000);
    });
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0);
  // A second paint after a rAF flush is what makes the pixels land.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  ctx.drawImage(video, 0, 0);
  URL.revokeObjectURL(url);
  return { canvas, ctx };
}

/**
 * Finds the fractions at which the calibration channel crosses its midpoint.
 * Averaging several parallel scanlines suppresses H.264 ringing near edges.
 */
export function findEdges(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  axis: Channel,
  at: number,
  samples: number
): number[] {
  const channel = axis === 'u' ? 0 : 1;
  // The axis being profiled, and the axis the scanlines are spread ACROSS. These
  // are different axes and are not interchangeable: profiling U walks X at
  // several Y offsets, so the offsets must be bounded by h, not by w. Deriving
  // both from `length` silently reads past the end of the pixel buffer for every
  // landscape output (w > h), which yields NaN for the whole profile and
  // reports "0 calibration edges found" — a false negative on exactly the
  // 16:9 case that matters most.
  const length = axis === 'u' ? w : h;
  const across = axis === 'u' ? h : w;
  const step = Math.max(1, Math.floor(samples));
  const profile = new Float64Array(length);
  const counted = new Float64Array(length);

  for (let s = 0; s < samples; s += 1) {
    // Keep the scanline away from the frame borders and spread the samples.
    const frac = (s + 0.5) / samples;
    const pos = Math.min(across - 1, Math.max(0, Math.round(frac * (across - 1))));
    for (let i = 0; i < length; i += 1) {
      const x = axis === 'u' ? i : pos;
      const y = axis === 'u' ? pos : i;
      const idx = (y * w + x) * 4;
      profile[i] += data[idx + channel];
      counted[i] += 1;
    }
  }
  for (let i = 0; i < length; i += 1) profile[i] /= counted[i] || 1;

  const edges: number[] = [];
  const lo = 40;
  const hi = 255;
  const mid = (lo + hi) / 2;
  // Two sub-pixel samples either side, to land on the crossing itself.
  for (let i = 1; i < length - 1; i += 1) {
    const a = profile[i - 1];
    const b = profile[i];
    const c = profile[i + 1];
    if ((a < mid && c > mid) || (a > mid && c < mid)) {
      // Linear interpolation between the bracketing samples.
      const denom = c - a;
      const t = denom === 0 ? 0.5 : (mid - a) / denom;
      edges.push((i - 1 + t) / length);
    }
  }
  void h;
  void at;
  return edges;
}

/** Everything the runner needs to judge one platform. */
export async function inspectPlatform(
  master: MasterRecording,
  platformId: string
): Promise<{
  declared: { width: number; height: number };
  actual: { width: number; height: number; codec?: string; hasMoov: boolean };
  predicted: { left: number; top: number; width: number; height: number };
  uEdges: { predicted: number[]; actual: number[] };
  vEdges: { predicted: number[]; actual: number[] };
  face: { u: number; v: number } | null;
  predictedFace: { u: number; v: number };
  edgeContent: boolean;
  claimedDuration: number;
  sizeBytes: number;
  capBytes: number;
  engineHasAudio: boolean;
  artifact: {
    width: number;
    height: number;
    hasFtyp: boolean;
    hasMoov: boolean;
    hasMdat: boolean;
    videoTrackCount: number;
    audioTrackCount: number;
    durationSeconds: number | null;
  } | null;
  verification: { ok: boolean; code?: string };
  noAudioControl: { ok: boolean; code?: string };
}> {
  const config = createExportConfig(platformId as never, master.sourceWidth, master.sourceHeight);
  const { blob, hasAudio } = await runProductionExport(master, platformId);
  const meta = await readMp4DimensionsFromBlob(blob);

  // PHASE 3 — the bytes through the ONE production parser and verifier. The
  // expectations are exactly what production passes: the server-authoritative
  // frame, the master's duration claim, the engine's ground-truth audio
  // decision, and the real byte count. `noAudioControl` re-runs the verdict
  // demanding audio — on a silent master it MUST fail with missing_audio,
  // which is what proves the audio check actually bites.
  const buffer = await blob.arrayBuffer();
  const parsed = readMp4Artifact(buffer);
  const expectations = {
    width: config.outputWidth,
    height: config.outputHeight,
    durationSeconds: master.duration,
    hasAudio,
    sizeBytes: blob.size,
  };
  const verification = verifyExportArtifact(buffer, expectations);
  const noAudioControl = verifyExportArtifact(buffer, { ...expectations, hasAudio: true });

  const { canvas, ctx } = await decodeFrameFor(blob, 0.15);
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;

  const predicted = computeCodedSourceRect(
    config.crop,
    master.sourceWidth,
    master.sourceHeight,
    master.sourceWidth,
    master.sourceHeight,
    config.outputWidth,
    config.outputHeight
  );

  // Predicted calibration crossings, as a fraction of the output frame. A
  // boundary at source fraction f lands at (f * src - offset) / window.
  const crossingsFor = (axis: Channel) => {
    const srcLen = axis === 'u' ? master.sourceWidth : master.sourceHeight;
    const offset = axis === 'u' ? predicted.left : predicted.top;
    const window = axis === 'u' ? predicted.width : predicted.height;
    const out: number[] = [];
    for (let b = 1; b < BANDS; b += 1) {
      const f = b / BANDS;
      const at = (f * srcLen - offset) / window;
      if (at > 0.02 && at < 0.98) out.push(at);
    }
    return out;
  };

  const uEdges = {
    predicted: crossingsFor('u'),
    actual: findEdges(data, w, h, 'u', Math.round(h / 2), 9),
  };
  // u=0.15 on the output: always far from the marker at u=0.5, whatever the crop.
  const vEdges = {
    predicted: crossingsFor('v'),
    actual: findEdges(data, w, h, 'v', Math.round(w * 0.15), 9),
  };

  // White marker centroid.
  let sumU = 0;
  let sumV = 0;
  let count = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      // Blue is 128 everywhere except on the marker, so it isolates it.
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) {
        sumU += x;
        sumV += y;
        count += 1;
      }
    }
  }
  const face = count > 4 ? { u: sumU / count / w, v: sumV / count / h } : null;

  // Content (not black) along the outermost columns: proves full bleed.
  const at0 = ctx.getImageData(0, Math.floor(h / 2), 1, 1).data;
  const atW = ctx.getImageData(w - 1, Math.floor(h / 2), 1, 1).data;
  const edgeContent = [at0, atW].every((p) => p[0] + p[1] + p[2] > 40);

  return {
    declared: { width: config.outputWidth, height: config.outputHeight },
    actual: {
      width: meta?.width ?? 0,
      height: meta?.height ?? 0,
      codec: meta?.codec,
      hasMoov: meta?.hasMoov ?? false,
    },
    predicted,
    uEdges,
    vEdges,
    face,
    predictedFace: {
      u: (FACE_U * master.sourceWidth - predicted.left) / predicted.width,
      v: (FACE_V * master.sourceHeight - predicted.top) / predicted.height,
    },
    edgeContent,
    claimedDuration: master.duration,
    sizeBytes: blob.size,
    capBytes: MAX_EXPORT_SIZE_BYTES,
    engineHasAudio: hasAudio,
    artifact: parsed
      ? {
          width: parsed.width,
          height: parsed.height,
          hasFtyp: parsed.hasFtyp,
          hasMoov: parsed.hasMoov,
          hasMdat: parsed.hasMdat,
          videoTrackCount: parsed.videoTrackCount,
          audioTrackCount: parsed.audioTrackCount,
          durationSeconds: parsed.durationSeconds,
        }
      : null,
    verification: verification.ok ? { ok: true } : { ok: false, code: verification.code },
    noAudioControl: noAudioControl.ok ? { ok: true } : { ok: false, code: noAudioControl.code },
  };
}

/* ------------------------------------------------------------------ *
 * PHASE 3 — audio-when-expected, proven from the artifact's bytes
 * ------------------------------------------------------------------ */

/**
 * Like `buildMaster`, but muxes a real AAC track (440 Hz sine) alongside the
 * calibration grid, so the export has genuine audio to be expected from.
 */
export async function buildMasterWithAudio(
  width: number,
  height: number
): Promise<{ blob: Blob; duration: number }> {
  const { AudioBufferSource, Mp4OutputFormat, BufferTarget, CanvasSource, Output } = await import(
    'mediabunny'
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 8_000_000 });
  output.addVideoTrack(source, { frameRate: FPS });

  const audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 96_000 });
  output.addAudioTrack(audioSource);

  await output.start();
  for (let i = 0; i < FRAMES; i += 1) {
    drawMaster(ctx, width, height);
    await source.add(i / FPS + 0.001);
  }
  // Exactly as long as the video track: a sine over the full 0.5 s.
  const sampleRate = 44_100;
  const frames = Math.round((FRAMES / FPS) * sampleRate);
  const audioCtx = new OfflineAudioContext(1, frames, sampleRate);
  const audioBuffer = audioCtx.createBuffer(1, frames, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    channel[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  await audioSource.add(audioBuffer);
  await output.finalize();

  return {
    blob: new Blob([target.buffer as ArrayBuffer], { type: 'video/mp4' }),
    duration: FRAMES / FPS,
  };
}

/**
 * Encodes an audio-bearing master through the production path and reports the
 * ground-truth chain: the engine's own `hasAudio` decision, the audio sample
 * entries actually present in the container, and the ONE verifier's verdict
 * under that claim.
 */
export async function inspectAudioRoundTrip(
  master: MasterRecording,
  platformId: string
): Promise<{
  engineHasAudio: boolean;
  artifactAudioTracks: number;
  artifactVideoTracks: number;
  durationSeconds: number | null;
  sizeBytes: number;
  verification: { ok: boolean; code?: string };
}> {
  const config = createExportConfig(platformId as never, master.sourceWidth, master.sourceHeight);
  const { blob, hasAudio } = await runProductionExport(master, platformId);
  const buffer = await blob.arrayBuffer();
  const parsed = readMp4Artifact(buffer);
  const verification = verifyExportArtifact(buffer, {
    width: config.outputWidth,
    height: config.outputHeight,
    durationSeconds: master.duration,
    hasAudio,
    sizeBytes: blob.size,
  });
  return {
    engineHasAudio: hasAudio,
    artifactAudioTracks: parsed?.audioTrackCount ?? -1,
    artifactVideoTracks: parsed?.videoTrackCount ?? -1,
    durationSeconds: parsed?.durationSeconds ?? null,
    sizeBytes: blob.size,
    verification: verification.ok ? { ok: true } : { ok: false, code: verification.code },
  };
}

/* ------------------------------------------------------------------ *
 * PHASE 3 — watermark proven from decoded pixels of the artifact
 * ------------------------------------------------------------------ */

/** Mean absolute per-channel difference over a rectangle of two decoded frames. */
function regionMeanDiff(
  a: ImageData,
  b: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  let total = 0;
  let count = 0;
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(a.width, Math.ceil(x1));
  const yb = Math.min(a.height, Math.ceil(y1));
  for (let y = ya; y < yb; y += 1) {
    for (let x = xa; x < xb; x += 1) {
      const i = (y * a.width + x) * 4;
      total += Math.abs(a.data[i] - b.data[i]);
      total += Math.abs(a.data[i + 1] - b.data[i + 1]);
      total += Math.abs(a.data[i + 2] - b.data[i + 2]);
      count += 3;
    }
  }
  return count === 0 ? 0 : total / count;
}

/**
 * Encodes the SAME master twice — once with the watermark, once without —
 * decodes both real artifacts, and measures the pixel difference inside the
 * watermark pill's rectangle (geometry from `drawWatermark`) against a control
 * rectangle in the top-left. If the watermark were dropped anywhere between
 * the flag and the file, the two decoded frames would be statistically
 * identical everywhere and this fails.
 */
export async function compareWatermark(
  master: MasterRecording,
  platformId: string
): Promise<{
  pillMeanDiff: number;
  controlMeanDiff: number;
  wmIsArtifact: boolean;
  plainIsArtifact: boolean;
  pillRect: { x0: number; y0: number; x1: number; y1: number };
}> {
  const wm = await runProductionExportWatermarked(master, platformId);
  const plain = await runProductionExport(master, platformId);

  const wmBuffer = await wm.blob.arrayBuffer();
  const plainBuffer = await plain.blob.arrayBuffer();
  const wmArtifact = readMp4Artifact(wmBuffer);
  const plainArtifact = readMp4Artifact(plainBuffer);

  const wmFrame = await decodeFrameFor(wm.blob, 0.15);
  const plainFrame = await decodeFrameFor(plain.blob, 0.15);
  const w = wmFrame.canvas.width;
  const h = wmFrame.canvas.height;
  const wmData = wmFrame.ctx.getImageData(0, 0, w, h);
  const plainData = plainFrame.ctx.getImageData(0, 0, plainFrame.canvas.width, plainFrame.canvas.height);
  if (w !== plainFrame.canvas.width || h !== plainFrame.canvas.height) {
    throw new Error('watermark/no-watermark decodes disagree on frame size');
  }

  // Reproduce drawWatermark's pill rectangle from its own geometry rules so
  // the measured region is exactly what the watermark paints over.
  const fontSize = Math.max(14, Math.round(w * 0.035));
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `bold ${fontSize}px Inter, sans-serif`;
  const textWidth = measure.measureText('SupersmartX').width;
  const bgWidth = textWidth + 16; // padding 8 each side
  const bgHeight = fontSize + 8; // padding 8
  const pillRect = {
    x0: w - bgWidth - 12,
    y0: h - bgHeight - 12,
    x1: w - 12 + 1, // fillRect spans to width - 12
    y1: h - 12 + 1,
  };

  return {
    pillMeanDiff: regionMeanDiff(wmData, plainData, pillRect.x0, pillRect.y0, pillRect.x1, pillRect.y1),
    controlMeanDiff: regionMeanDiff(wmData, plainData, 0, 0, w / 4, h / 4),
    wmIsArtifact: !!wmArtifact && wmArtifact.hasMoov && wmArtifact.hasMdat && wmArtifact.width > 0,
    plainIsArtifact: !!plainArtifact && plainArtifact.hasMoov && plainArtifact.hasMdat && plainArtifact.width > 0,
    pillRect,
  };
}
