/**
 * PHASE 3 — the one authoritative artifact verification path.
 *
 * A 200 from the upload API, a job marked completed, a non-zero byte count,
 * a plausible filename or a client-supplied Content-Type are none of them
 * proof that the produced media file is correct. This module decides that
 * question from the actual bytes:
 *
 *   ftyp present  → it identifies as ISO-BMFF
 *   moov present  → container metadata parses (dimensions, tracks, duration)
 *   mdat present  → media samples were actually written
 *   video track   → an expected video stream exists
 *   audio track   → required when the source had usable audio
 *   width/height  → matches the server-authoritative expected dimensions
 *   duration      → finite, positive, inside the cap, within tolerance of the
 *                   authoritative recording duration
 *
 * Every production caller — `/api/exports/complete`, `/api/export-upload`, and
 * the client pipeline gate before a download is written — funnels through
 * `verifyExportArtifact`. There is exactly one parser (`mp4-metadata.ts`) and
 * exactly one decision function (here); no route re-implements any of it.
 *
 * Failure codes are mapped to safe, parser-detail-free messages by
 * `describeArtifactFailure`, which is also what a client displays, so an
 * invalid artifact can never become a completed export nor a readable error
 * surface.
 */

import {
  EXPORT_BYTES_PER_SECOND,
  MAX_EXPORT_DURATION_SECONDS,
  exportDurationToleranceSeconds,
} from './export-limits';
import { readMp4Artifact, type Mp4Artifact } from './mp4-metadata';

export type ArtifactFailureCode =
  | 'not_mp4'
  | 'missing_moov'
  | 'missing_mdat'
  | 'no_video_stream'
  | 'dimension_mismatch'
  | 'duration_invalid'
  | 'duration_mismatch'
  | 'missing_audio';

/**
 * Server-authoritative expectations. `width`/`height` come from the platform
 * preset after the entitlement clamp (never from the request body), `duration`
 * is the authoritative recording duration (master/active-clock, C2.7), and
 * `hasAudio` is the encoder's own ground-truth decision from probing the
 * source blob — not a UI badge. Fields that are unknown/absent skip their
 * check rather than guessing.
 */
export interface ArtifactExpectations {
  width: number;
  height: number;
  durationSeconds?: number | null;
  hasAudio?: boolean | null;
  /** Actual byte length of the artifact; used only for the claimless duration floor. */
  sizeBytes?: number;
  maxDurationSeconds?: number;
}

export type ArtifactVerification =
  | { ok: true; artifact: Mp4Artifact }
  | { ok: false; code: ArtifactFailureCode };

/**
 * Container facts observed while collecting bytes for the parse. When the
 * full buffer is available (client blob, multipart upload) they are derived
 * from the buffer itself; the server's ranged reader supplies them because its
 * combined buffer intentionally contains only ftyp+moov and never the (up to
 * 2 GiB) mdat payload.
 */
export interface ContainerFacts {
  ftypSeen?: boolean;
  mdatSeen?: boolean;
}

/**
 * Decides whether the actual bytes are a valid export artifact.
 *
 * `buffer` is the bytes the parser reads — the whole file, or the collected
 * ftyp+moov range from `collectMp4Metadata`. `null` means the bytes could not
 * be obtained or parsed at all and fails as `not_mp4`.
 *
 * Check order matters: structure before semantics (a file without a moov is
 * `missing_moov`, not a dimension problem), video presence before dimension
 * comparison (so an audio-only file reports `no_video_stream` rather than
 * `dimension_mismatch` against a 0x0), duration validity before duration
 * agreement.
 */
export function verifyExportArtifact(
  buffer: ArrayBuffer | null,
  expected: ArtifactExpectations,
  container?: ContainerFacts,
): ArtifactVerification {
  const fail = (code: ArtifactFailureCode): ArtifactVerification => ({ ok: false, code });
  const artifact = buffer ? readMp4Artifact(buffer) : null;
  if (!artifact) return fail('not_mp4');

  const ftypSeen = container?.ftypSeen ?? artifact.hasFtyp;
  const mdatSeen = container?.mdatSeen ?? artifact.hasMdat;
  // ISO-BMFF requires ftyp to be the first box; the parser already reads
  // boxes in order, so absence anywhere means it never identified as MP4.
  if (!ftypSeen) return fail('not_mp4');
  if (!artifact.hasMoov) return fail('missing_moov');
  if (!mdatSeen) return fail('missing_mdat');
  if (artifact.videoTrackCount < 1) return fail('no_video_stream');
  if (artifact.width !== expected.width || artifact.height !== expected.height) return fail('dimension_mismatch');

  // Duration: must be a finite, positive container time inside the encoder
  // cap. The mvhd ratio cannot be Infinity/NaN by construction (this is the
  // artifact-side guarantee of P0-1), but an absent, zero, or unknown-marker
  // duration must never be silently accepted.
  const duration = artifact.durationSeconds;
  const maxDuration = expected.maxDurationSeconds ?? MAX_EXPORT_DURATION_SECONDS;
  if (duration === null || !Number.isFinite(duration) || duration <= 0 || duration > maxDuration) {
    return fail('duration_invalid');
  }

  // Agreement with the authoritative recording duration. When no trustworthy
  // claim is available, fall back to the byte-rate floor already used for
  // quota charging: the artifact cannot contain more bytes than its bitrate
  // allows in less time than size / EXPORT_BYTES_PER_SECOND.
  const claimed = expected.durationSeconds;
  if (typeof claimed === 'number' && Number.isFinite(claimed) && claimed > 0) {
    if (Math.abs(duration - claimed) > exportDurationToleranceSeconds(claimed)) return fail('duration_mismatch');
  } else if (typeof expected.sizeBytes === 'number' && Number.isFinite(expected.sizeBytes) && expected.sizeBytes > 0) {
    if (duration < expected.sizeBytes / EXPORT_BYTES_PER_SECOND) return fail('duration_mismatch');
  }

  // Audio: required only when the source genuinely had decodable audio. An
  // artifact that has audio despite no expectation is never rejected — audio
  // presence can only improve on the claim (and the engine's own probe, not
  // the badge, sets this flag).
  if (expected.hasAudio === true && artifact.audioTrackCount < 1) return fail('missing_audio');

  return { ok: true, artifact };
}

/** Coerces a claimed duration (request body, form field or job config) into a
 * positive finite number, or null when absent/unusable. */
export function normalizeClaimedDuration(value: unknown): number | null {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) && num > 0 ? num : null;
}

/** Coerces a claimed audio flag (boolean or 'true'/'false' form string) into a
 * boolean, or null when absent — null skips the audio requirement instead of
 * guessing. */
export function normalizeClaimedHasAudio(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/**
 * Safe, parser-detail-free rejection messages. Structure, dimension and
 * duration failures reuse the exact response strings the API already returns
 * for the same classes of rejection; `missing_audio` states only what the
 * user can act on. Internal box names, offsets and parser state never reach a
 * client through this function.
 */
export function describeArtifactFailure(code: ArtifactFailureCode): string {
  switch (code) {
    case 'not_mp4':
    case 'missing_moov':
    case 'missing_mdat':
    case 'no_video_stream':
      return 'Uploaded file is not a valid MP4';
    case 'dimension_mismatch':
      return 'Output dimensions do not match the validated export configuration';
    case 'duration_invalid':
    case 'duration_mismatch':
      return 'Export duration does not match the recording';
    case 'missing_audio':
      return 'Export is missing the expected audio track';
  }
}

/**
 * Client-facing form of a failure: the pipeline prepends the same
 * "Export failed verification:" prefix `assertEncodedFrame` uses, so a wrong
 * artifact reads as one family of error whether it was caught by the STATE 7
 * dimension gate or by the Phase 3 full verification.
 */
export function describeArtifactFailureForClient(code: ArtifactFailureCode): string {
  return `Export failed verification: ${describeArtifactFailure(code)}`;
}

/* ------------------------------------------------------------------ *
 * Ranged collection — bounded reads, never the full artifact
 * ------------------------------------------------------------------ */

/**
 * Reads a byte range of an object. Implementations throw on transient
 * failures (network, precondition) and return bytes otherwise; callers treat
 * a throw as "verification unavailable" (retryable) rather than "artifact
 * invalid" (destructive).
 */
export type Mp4RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

export interface CollectedMp4Metadata {
  /** ftyp box followed by the moov box — the entire metadata the parser needs. */
  combined: ArrayBuffer;
  ftypSeen: boolean;
  mdatSeen: boolean;
}

// Bounded on purpose (Part 3.18): the head probe is 16 KiB, a single moov is
// capped at 16 MiB (a 28-minute two-track sample table is under 1 MiB), and
// at most 64 top-level boxes are walked. The mdat payload — up to 2 GiB — is
// never requested: the walk jumps over it by its declared size. Peak memory
// per verification is therefore ~16 MiB regardless of artifact size, and every
// buffer is request-scoped and released on return.
const HEAD_PROBE_BYTES = 16 * 1024;
const MAX_MOOV_BYTES = 16 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 64;

/**
 * Walks the top-level box structure of a stored object with ranged reads and
 * returns the bytes the parser needs: ftyp (identity) and moov (all
 * verification data). Works whether the muxer wrote moov first (faststart) or
 * last (after mdat) by reading 8-byte box headers and skipping mdat payloads
 * entirely.
 *
 * Returns `null` for structural rejections (not an MP4, no moov, no mdat,
 * malformed sizes) — deterministic conditions the caller answers with a safe
 * 400. Reader exceptions (object vanished, precondition failed, network) are
 * deliberately left to propagate: they are not evidence about the artifact.
 */
export async function collectMp4Metadata(
  read: Mp4RangeReader,
  totalSize: number,
): Promise<CollectedMp4Metadata | null> {
  if (!Number.isFinite(totalSize) || totalSize < 16) return null;

  const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const typeOf = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

  const head = await read(0, Math.min(totalSize, HEAD_PROBE_BYTES));
  if (head.byteLength < 16) return null;

  let offset = 0;
  let first = true;
  let ftypSeen = false;
  let mdatSeen = false;
  let ftypBytes: Uint8Array | null = null;
  let moovBytes: Uint8Array | null = null;
  let boxCount = 0;

  while (offset + 8 <= totalSize) {
    if (++boxCount > MAX_TOP_LEVEL_BOXES) return null;
    let header: Uint8Array;
    if (offset + 8 <= head.byteLength) {
      header = head.subarray(offset, offset + 8);
    } else {
      header = await read(offset, 8);
      if (header.byteLength < 8) return null;
    }
    let size = u32(header, 0);
    const type = typeOf(header, 4);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit largesize follows the type — must itself be in bounds before
      // requesting it, or the range read would run past end-of-object.
      if (offset + 16 > totalSize) return null;
      let ext: Uint8Array;
      if (offset + 16 <= head.byteLength) {
        ext = head.subarray(offset + 8, offset + 16);
      } else {
        ext = await read(offset + 8, 8);
        if (ext.byteLength < 8) return null;
      }
      const big = new DataView(ext.buffer, ext.byteOffset, ext.byteLength).getBigUint64(0);
      if (big > BigInt(totalSize)) return null;
      size = Number(big);
      headerSize = 16;
    } else if (size === 0) {
      size = totalSize - offset; // box extends to end of file
    }
    if (size < headerSize || offset + size > totalSize) return null;
    // ISO-BMFF: ftyp must be the very first box. Anything else identifies the
    // object as not an MP4 before we spend reads walking it.
    if (first && type !== 'ftyp') return null;
    first = false;

    if (type === 'ftyp') {
      ftypSeen = true;
      if (size > 1024) return null; // an ftyp this large is malformed
      if (offset + size <= head.byteLength) ftypBytes = head.subarray(offset, offset + size);
      else ftypBytes = await read(offset, size);
      if (ftypBytes.byteLength !== size) return null;
    } else if (type === 'mdat') {
      mdatSeen = true; // payload deliberately never fetched
    } else if (type === 'moov' && !moovBytes) {
      if (size > MAX_MOOV_BYTES) return null;
      if (offset + size <= head.byteLength) moovBytes = head.subarray(offset, offset + size);
      else moovBytes = await read(offset, size);
      if (moovBytes.byteLength !== size) return null;
    }
    offset += size;
    if (offset >= totalSize) break;
  }

  if (!ftypSeen || !ftypBytes || !mdatSeen || !moovBytes) return null;

  // Reassemble ftyp+moov as consecutive top-level boxes. Box sizes are
  // self-describing, so the parser walks the concatenated layout correctly
  // even though mdat was never fetched; container facts for the skipped mdat
  // come back through the returned flags.
  const combined = new Uint8Array(ftypBytes.byteLength + moovBytes.byteLength);
  combined.set(ftypBytes, 0);
  combined.set(moovBytes, ftypBytes.byteLength);
  return {
    combined: combined.buffer,
    ftypSeen,
    mdatSeen,
  };
}
