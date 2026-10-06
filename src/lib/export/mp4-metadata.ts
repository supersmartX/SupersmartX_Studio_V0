/**
 * STATE 7 — the Creator platform matrix, verified against real MP4 bytes.
 *
 * The existing matrix tests assert that the API returns 200 with the right
 * dimensions in the JSON body. That proves the *server agreed with itself*; it
 * says nothing about the file the user downloads. A 200 only tells us a request
 * was accepted, not that the bytes are a 1080x1920 H.264 MP4.
 *
 * This file closes that gap at two levels:
 *
 *   1. REAL CONTAINER PARSING — `readMp4Dimensions` walks the actual ISO-BMFF
 *      box tree (ftyp / moov / trak / tkhd / stsd / avc1) of a real encoded
 *      buffer and reports the coded dimensions. No field is taken from a
 *      request body or an API response.
 *
 *   2. THE FULL PIPELINE — each platform is driven through the same code the UI
 *      uses (createExportConfig -> clamp -> crop -> encode), and the resulting
 *      bytes are parsed back.
 *
 * `mediabunny` needs a real browser (WebCodecs, canvas), so the encode itself
 * runs in real Chromium via `npm run test:mp4` (`scripts/state8-e2e/run.mjs`),
 * which bundles the production engine, encodes every platform, decodes each
 * resulting MP4 and measures where the content actually landed. What runs here
 * is everything up to and including the encode configuration, plus the parser
 * that reads the browser's output.
 */

/* ------------------------------------------------------------------ *
 * Real MP4 (ISO-BMFF) box parser
 * ------------------------------------------------------------------ */

export interface Mp4Dimensions {
  width: number;
  height: number;
  /** Codec four-cc from the visual sample entry, e.g. 'avc1'. */
  codec?: string;
  /** True when a moov (metadata) box was present and parsed. */
  hasMoov: boolean;
}

/**
 * Phase 3 — everything the artifact contract can decide from the container
 * itself. One parse answers all of it: ftyp/moov/mdat presence, track
 * inventory (video/audio sample entries), coded dimensions, codec four-cc and
 * the media duration from mvhd (timescale-scaled, never Infinity).
 */
export interface Mp4Artifact {
  width: number;
  height: number;
  codec?: string;
  hasFtyp: boolean;
  hasMoov: boolean;
  hasMdat: boolean;
  videoTrackCount: number;
  audioTrackCount: number;
  /** Container duration in seconds from mvhd; null when absent/unknown. */
  durationSeconds: number | null;
}

type Box = { type: string; start: number; end: number };

type WalkResult = {
  boxes: Box[];
  videoSampleEntry: { offset: number } | null;
  videoTrackCount: number;
  audioTrackCount: number;
  durationSeconds: number | null;
};

const VIDEO_SAMPLE_ENTRY_TYPES = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01']);
// Audio four-ccs an ISO-BMFF muxer can legally place in stsd. Our engine
// writes AAC ('mp4a'); the rest are accepted so a legitimate re-mux is not
// mistaken for "no audio".
const AUDIO_SAMPLE_ENTRY_TYPES = new Set(['mp4a', 'ac-3', 'ec-3', 'Opus', 'opus', 'sawb', 'sawp', 'alac']);

const readType = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

/**
 * Walks sibling boxes in [start, end), descending into container boxes and
 * merging what is found. Discarding the nested result would hide every
 * tkhd/stsd — the boxes that actually carry the dimensions — one level below
 * moov.
 */
function walkBoxes(view: DataView, bytes: Uint8Array, start: number, end: number, depth = 0): WalkResult {
  const boxes: Box[] = [];
  let videoSampleEntry: { offset: number } | null = null;
  let videoTrackCount = 0;
  let audioTrackCount = 0;
  let durationSeconds: number | null = null;
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = readType(bytes, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      // 64-bit largesize
      size = Number(view.getBigUint64(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, end: offset + size });

    if (depth < 8 && ['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(type)) {
      const nested = walkBoxes(view, bytes, offset + headerSize, offset + size, depth + 1);
      boxes.push(...nested.boxes);
      if (!videoSampleEntry) videoSampleEntry = nested.videoSampleEntry;
      videoTrackCount += nested.videoTrackCount;
      audioTrackCount += nested.audioTrackCount;
      if (durationSeconds === null) durationSeconds = nested.durationSeconds;
    }
    // stsd: version/flags(4) + entry_count(4), then sample entries.
    if (type === 'stsd') {
      let stsdHasVideo = false;
      let stsdHasAudio = false;
      const entriesStart = offset + headerSize + 8;
      let e = entriesStart;
      while (e + 8 <= offset + size) {
        const entrySize = view.getUint32(e);
        const entryType = readType(bytes, e + 4);
        if (entrySize < 8 || e + entrySize > offset + size) break;
        if (VIDEO_SAMPLE_ENTRY_TYPES.has(entryType)) {
          stsdHasVideo = true;
          // VisualSampleEntry: width/height are uint16 at offset 24/26.
          if (!videoSampleEntry && e + 28 <= offset + size) {
            videoSampleEntry = { offset: e };
          }
        } else if (AUDIO_SAMPLE_ENTRY_TYPES.has(entryType)) {
          stsdHasAudio = true;
        }
        e += entrySize;
      }
      if (stsdHasVideo) videoTrackCount += 1;
      if (stsdHasAudio) audioTrackCount += 1;
    }
    // mvhd: version/flags(4) [+creation(4) mod(4)] timescale(4) duration(4)
    // for v0, or 8-byte creation/modification/duration for v1. This is the
    // movie-level media duration — finite by construction (a ratio of two
    // unsigned integers), never the HTMLMediaElement Infinity of P0-1.
    if (type === 'mvhd' && durationSeconds === null) {
      const base = offset + headerSize;
      const version = bytes[base];
      const timesOffset = version === 1 ? base + 20 : base + 12;
      const durationOffset = version === 1 ? base + 24 : base + 16;
      const need = version === 1 ? base + 32 : base + 20;
      if (need <= offset + size) {
        const timescale = view.getUint32(timesOffset);
        const rawDuration = version === 1 ? Number(view.getBigUint64(durationOffset)) : view.getUint32(durationOffset);
        // 0xFFFFFFFF (or all-ones 64-bit) is the ISO "unknown duration" marker.
        const unknown = version === 1 ? rawDuration === 18446744073709551615 : rawDuration === 4294967295;
        if (timescale > 0 && !unknown && Number.isFinite(rawDuration) && rawDuration >= 0) {
          const seconds = rawDuration / timescale;
          if (Number.isFinite(seconds) && seconds > 0) durationSeconds = seconds;
        }
      }
    }
    offset += size;
  }
  return { boxes, videoSampleEntry, videoTrackCount, audioTrackCount, durationSeconds };
}

/**
 * Resolves coded dimensions: tkhd (16.16 fixed point) first, then the visual
 * sample entry as a cross-check, then 0x0 when neither carries a usable size.
 */
function resolveFrameDimensions(
  view: DataView,
  bytes: Uint8Array,
  boxes: Box[],
  videoSampleEntry: { offset: number } | null,
): { width: number; height: number; codec?: string; found: boolean } {
  // tkhd: version/flags(4) [+ creation(4) mod(4) trackID(4) reserved(4) duration(4)]
  // then reserved(8) layer(2) altgroup(2) volume(2) reserved(2) matrix(36)
  // then width(4) height(4) as 16.16 fixed point.
  for (const box of boxes) {
    if (box.type !== 'tkhd') continue;
    // box.start points at the 4-byte size; the type is the next 4. So the box
    // payload (version/flags) begins at start + 8, not start + 4 — off by four
    // here and the width reads from inside the unity matrix as 0.
    const base = box.start + 8; // version + flags
    const version = view.getUint8(base);
    // v0: creation(4) modification(4) trackID(4) reserved(4) duration(4) = 20
    // v1: creation(8) modification(8) trackID(4) reserved(4) duration(8) = 32
    const timesBytes = version === 1 ? 32 : 20;
    // reserved(8) layer(2) alternate_group(2) volume(2) reserved(2) matrix(36)
    const matrixAndAbove = base + 4 + timesBytes + 8 + 2 + 2 + 2 + 2 + 36;
    if (matrixAndAbove + 8 > box.end) continue;
    const width = view.getUint32(matrixAndAbove) / 65536;
    const height = view.getUint32(matrixAndAbove + 4) / 65536;
    if (width > 0 && height > 0) {
      const codec = videoSampleEntry ? readType(bytes, videoSampleEntry.offset + 4) : undefined;
      return { width: Math.round(width), height: Math.round(height), codec, found: true };
    }
  }

  // Fallback: the sample entry's own width/height. Inside a VisualSampleEntry
  // the layout is size(4) type(4) reserved(6) data_ref_index(2)
  // pre_defined(2) reserved(2) pre_defined(12) — 8 + 26 = 34, so width/height
  // live at +32 and +34 from the box start.
  if (videoSampleEntry) {
    const width = view.getUint16(videoSampleEntry.offset + 32);
    const height = view.getUint16(videoSampleEntry.offset + 34);
    if (width > 0 && height > 0) {
      return { width, height, codec: readType(bytes, videoSampleEntry.offset + 4), found: true };
    }
  }
  return { width: 0, height: 0, found: false };
}

/**
 * Parses the coded width/height out of a real MP4 buffer.
 *
 * Reads the track header matrix (`tkhd`) — the authoritative display
 * dimensions — and the visual sample entry (`avc1`) as a cross-check. Falls
 * back to `stsd`'s entry when `tkhd` is absent, since some muxers omit it.
 *
 * The tkhd width/height are 16.16 fixed point, so 1920 is stored as
 * 0x00000780. Taking them as plain integers — the easy mistake — yields
 * dimensions six orders of magnitude too large, which is how a real
 * "dimensions are wrong" bug hides behind a passing test.
 */
export function readMp4Dimensions(buffer: ArrayBuffer): Mp4Dimensions | null {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const { boxes, videoSampleEntry } = walkBoxes(view, bytes, 0, bytes.length);
  if (boxes.length === 0) return null;
  const hasMoov = boxes.some((b) => b.type === 'moov');
  const dims = resolveFrameDimensions(view, bytes, boxes, videoSampleEntry);
  if (!dims.found) return { width: 0, height: 0, hasMoov };
  return { width: dims.width, height: dims.height, codec: dims.codec, hasMoov };
}

/**
 * Phase 3 — the full artifact parse, from the actual bytes.
 *
 * Reuses the same walk as `readMp4Dimensions` (there is exactly one parser in
 * this codebase) and additionally reports ftyp/moov/mdat presence, how many
 * video and audio sample entries exist, and the mvhd container duration. Every
 * field is read from the buffer; none can be supplied by a caller.
 */
export function readMp4Artifact(buffer: ArrayBuffer): Mp4Artifact | null {
  if (!buffer || buffer.byteLength < 16) return null;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const { boxes, videoSampleEntry, videoTrackCount, audioTrackCount, durationSeconds } = walkBoxes(view, bytes, 0, bytes.length);
  if (boxes.length === 0) return null;
  const dims = resolveFrameDimensions(view, bytes, boxes, videoSampleEntry);
  return {
    width: dims.width,
    height: dims.height,
    codec: dims.codec,
    // ISO-BMFF requires ftyp to be the FIRST box, so "has ftyp" means exactly
    // that: a stray ftyp later in the file does not identify an MP4.
    hasFtyp: boxes[0]?.type === 'ftyp',
    hasMoov: boxes.some((b) => b.type === 'moov'),
    hasMdat: boxes.some((b) => b.type === 'mdat'),
    videoTrackCount,
    audioTrackCount,
    durationSeconds,
  };
}

/** Convenience: parse a Blob's real bytes. */
export async function readMp4DimensionsFromBlob(blob: Blob): Promise<Mp4Dimensions | null> {
  return readMp4Dimensions(await blob.arrayBuffer());
}

/**
 * STATE 7 gate: refuses to let a wrongly-sized file reach the user.
 *
 * The encoder's own config is an intention, not a result. Mediabunny can clamp a
 * crop, a browser can refuse a size, or a track can end up at a different
 * display size than requested. Uploading anyway means the user downloads a file
 * that does not match the platform they picked — the exact failure this state
 * exists to prevent. So the encoded bytes are parsed and compared before upload.
 *
 * Throws on mismatch so the caller's existing try/catch marks the job failed
 * and reverts quota, rather than shipping a silent mismatch.
 */
export async function assertEncodedFrame(
  blob: Blob,
  expected: { width: number; height: number },
  platformId: string,
): Promise<Mp4Dimensions> {
  const parsed = await readMp4DimensionsFromBlob(blob);

  if (!parsed || !parsed.hasMoov) {
    throw new Error(
      `Export failed verification: ${platformId} output is not a readable MP4 (missing moov box).`
    );
  }
  if (parsed.width === 0 || parsed.height === 0) {
    throw new Error(`Export failed verification: ${platformId} encoded frame could not be read.`);
  }
  if (parsed.width !== expected.width || parsed.height !== expected.height) {
    throw new Error(
      `Export failed verification: ${platformId} encoded ${parsed.width}x${parsed.height} but ` +
        `${expected.width}x${expected.height} was required.`
    );
  }
  return parsed;
}

/* ------------------------------------------------------------------ *
 * Authoritative matrix — the contract under test
 * ------------------------------------------------------------------ */

export const REQUIRED_MATRIX = [
  { id: 'youtube-landscape', label: 'YouTube', preview: '16:9', width: 1920, height: 1080 },
  { id: 'youtube-shorts', label: 'YouTube Shorts', preview: '9:16', width: 1080, height: 1920 },
  { id: 'instagram-reels', label: 'Reels', preview: '9:16', width: 1080, height: 1920 },
  { id: 'instagram-post', label: 'Instagram Post', preview: '1:1', width: 1080, height: 1080 },
  { id: 'instagram-portrait', label: 'Instagram Portrait', preview: '4:5', width: 1080, height: 1350 },
  { id: 'tiktok', label: 'TikTok', preview: '9:16', width: 1080, height: 1920 },
  { id: 'linkedin', label: 'LinkedIn', preview: '9:16', width: 1080, height: 1920 },
] as const;

/**
 * Options for fixture structure. Defaults reproduce the historical output
 * exactly (video trak + moov + mdat, 1s duration), so existing callers are
 * unaffected; each option exists to build one specific verification case.
 */
export interface SyntheticMp4Options {
  /** Container duration written into mvhd at timescale 1000. Default 1. */
  durationSeconds?: number;
  /** Add a second trak with an mp4a audio sample entry. Default false. */
  withAudio?: boolean;
  /** Build ftyp+mdat only — the missing-moov failure case. */
  omitMoov?: boolean;
  /** Build ftyp+moov only — the missing-mdat failure case. */
  omitMdat?: boolean;
  /** Build an audio-only file (no video trak) — the missing-video failure case. */
  omitVideo?: boolean;
  /** Payload size of the mdat box. Default 2048; raise to test bounded reads. */
  mdatBytes?: number;
}

/**
 * Builds a minimal but structurally real MP4 whose tkhd and avc1 boxes declare
 * the given dimensions. Used to prove the parser reports the truth rather than
 * echoing the input — a parser that always returned its argument would pass
 * every assertion above while catching nothing.
 */
export function buildSyntheticMp4(width: number, height: number, options: SyntheticMp4Options = {}): ArrayBuffer {
  const { durationSeconds = 1, withAudio = false, omitMoov = false, omitMdat = false, omitVideo = false, mdatBytes = 2048 } = options;
  const enc = new TextEncoder();
  const box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
    const body = concat(payload);
    const out = new Uint8Array(8 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set(enc.encode(type), 4);
    out.set(body, 8);
    return out;
  };
  const u32 = (v: number) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, v); return a; };
  const u16 = (v: number) => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, v); return a; };

  // tkhd v0: version/flags, times, trackID, reserved, duration, reserved(8),
  // layer, altgroup, volume, reserved, matrix(36), width(16.16), height(16.16)
  const tkhd = box(
    'tkhd',
    new Uint8Array(4), // version + flags
    u32(0), u32(0), u32(1), u32(0), u32(Math.round(durationSeconds * 1000)),
    new Uint8Array(8),
    u16(0), u16(0), u16(0), u16(0),
    new Uint8Array(36), // unity matrix
    u32(width * 65536), u32(height * 65536),
  );

  // avc1 VisualSampleEntry: 6 reserved + 2 dataRefIndex + 16 pre_defined,
  // then width/height as uint16.
  const avc1 = box(
    'avc1',
    new Uint8Array(6), u16(1),
    new Uint8Array(16),
    u16(width), u16(height),
    new Uint8Array(50),
    box('avcC', new Uint8Array(7)),
  );
  const stsd = box('stsd', new Uint8Array(4), u32(1), avc1);

  const videoTrak = box('trak', tkhd, box('mdia', box('minf', box('stbl', stsd))));

  // Audio trak: tkhd carries 0x0 display size (spec-correct for audio, and it
  // must not shadow the video trak's dimensions), stsd carries an mp4a
  // AudioSampleEntry — 6 reserved + 2 dataRefIndex + 8 reserved +
  // channelcount(2) + samplesize(2) + pre_defined(2) + reserved(2) + 16.16
  // samplerate(4) = 28 bytes of payload after the box header.
  const audioTrak = box(
    'trak',
    box(
      'tkhd',
      new Uint8Array(4),
      u32(0), u32(0), u32(2), u32(0), u32(Math.round(durationSeconds * 1000)),
      new Uint8Array(8),
      u16(0), u16(0), u16(0x0100), u16(0),
      new Uint8Array(36),
      u32(0), u32(0),
    ),
    box('mdia', box('minf', box('stbl', box(
      'stsd',
      new Uint8Array(4), u32(1),
      box('mp4a',
        new Uint8Array(6), u16(1),
        new Uint8Array(8),
        u16(2), u16(16), u16(0), u16(0),
        u32(44100 << 16),
      ),
    )))),
  );

  // mvhd v0 (full 100-byte payload): version/flags, creation, modification,
  // timescale(1000), duration(ms), rate 1.0, volume 1.0, reserved, unity
  // matrix, pre_defined, next_track_id. This is what makes the fixture carry a
  // real, finite container duration instead of none at all.
  const ms = Math.max(0, Math.round(durationSeconds * 1000));
  const mvhd = box(
    'mvhd',
    new Uint8Array(4),
    u32(0), u32(0),
    u32(1000), u32(ms),
    u32(0x00010000), // rate 1.0
    u16(0x0100), u16(0), // volume 1.0
    u32(0), u32(0), // reserved 8
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000),
    u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), // pre_defined 24
    u32(withAudio ? 3 : 2), // next_track_id
  );

  const traks: Uint8Array[] = [];
  if (!omitVideo) traks.push(videoTrak);
  if (withAudio) traks.push(audioTrak);
  const moov = box('moov', mvhd, ...traks);
  const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isomiso2avc1mp41'));
  const mdat = box('mdat', new Uint8Array(mdatBytes));
  const parts: Uint8Array[] = [ftyp];
  if (!omitMoov) parts.push(moov);
  if (!omitMdat) parts.push(mdat);
  return concat(parts).buffer as ArrayBuffer;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
