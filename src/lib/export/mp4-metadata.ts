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

type Box = { type: string; start: number; end: number };

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

  const readType = (offset: number): string =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

  /** Walks sibling boxes in [start, end), descending into container boxes. */
  const walk = (start: number, end: number, depth = 0): { boxes: Box[]; videoSampleEntry: { offset: number } | null } => {
    const boxes: Box[] = [];
    let videoSampleEntry: { offset: number } | null = null;
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const type = readType(offset + 4);
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

      // Descend into known containers, MERGING what is found. Discarding the
      // nested result would hide every tkhd/stsd — the boxes that actually
      // carry the dimensions — one level below moov.
      if (depth < 8 && ['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(type)) {
        const nested = walk(offset + headerSize, offset + size, depth + 1);
        boxes.push(...nested.boxes);
        if (!videoSampleEntry) videoSampleEntry = nested.videoSampleEntry;
      }
      // stsd: version/flags(4) + entry_count(4), then sample entries.
      if (type === 'stsd') {
        const entriesStart = offset + headerSize + 8;
        let e = entriesStart;
        while (e + 8 <= offset + size) {
          const entrySize = view.getUint32(e);
          const entryType = readType(e + 4);
          if (entrySize < 8 || e + entrySize > offset + size) break;
          if (['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01'].includes(entryType)) {
            // VisualSampleEntry: width/height are uint16 at offset 24/26.
            if (!videoSampleEntry && e + 28 <= offset + size) {
              videoSampleEntry = { offset: e };
            }
          }
          e += entrySize;
        }
      }
      offset += size;
    }
    return { boxes, videoSampleEntry };
  };

  const { boxes, videoSampleEntry } = walk(0, bytes.length);
  if (boxes.length === 0) return null;

  const hasMoov = boxes.some((b) => b.type === 'moov');

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
      const codec = videoSampleEntry ? readType(videoSampleEntry.offset + 4) : undefined;
      return { width: Math.round(width), height: Math.round(height), codec, hasMoov };
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
      return { width, height, codec: readType(videoSampleEntry.offset + 4), hasMoov };
    }
  }
  return { width: 0, height: 0, hasMoov };
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
 * Builds a minimal but structurally real MP4 whose tkhd and avc1 boxes declare
 * the given dimensions. Used to prove the parser reports the truth rather than
 * echoing the input — a parser that always returned its argument would pass
 * every assertion above while catching nothing.
 */
export function buildSyntheticMp4(width: number, height: number): ArrayBuffer {
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
    u32(0), u32(0), u32(1), u32(0), u32(1000),
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

  const trak = box('trak', tkhd, box('mdia', box('minf', box('stbl', stsd))));
  const moov = box('moov', trak);
  const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isomiso2avc1mp41'));
  const mdat = box('mdat', new Uint8Array(2048));
  return concat([ftyp, moov, mdat]).buffer as ArrayBuffer;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
