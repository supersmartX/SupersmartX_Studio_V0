import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PHASE 3 — the real artifact is what gets verified.
 *
 * A 200, a `completed` job, a non-zero byte count, a plausible filename or a
 * client-supplied Content-Type are none of them proof that the produced media
 * file is correct. This suite exercises the ONE authoritative verification
 * path (`collectMp4Metadata` -> `verifyExportArtifact`) against structurally
 * real MP4 bytes — including the two route entry points, where the verifier is
 * NOT mocked: every rejection below is production parsing of production
 * fixtures deciding the outcome.
 *
 * Split of coverage:
 *   - unit: parser truthfulness, each failure code, tolerance math, the
 *     bounded ranged walk (a 5 MiB mdat payload is never fetched), safe
 *     message mapping, claim normalizers, the artifact-level platform matrix;
 *   - route: /api/exports/complete and /api/export-upload against real bytes —
 *     structural rejection consumes nothing and stays retryable (Part 3.11),
 *     the Free resolution ceiling holds at byte level, and the verdict runs
 *     before any claim, quota or DB write (Part 3.10/3.13).
 *
 * Watermark presence cannot be asserted from container bytes in jsdom (it is a
 * pixel property); the decoded-pixel proof lives in `npm run test:mp4`
 * (scripts/state8-e2e: wm-on vs wm-off pill-region diff), and the geometry/
 * fillText expectations stay in the export-watermark unit tests.
 */

process.env.TURSO_DATABASE_URL = 'file::memory:';

// Phase 3: the complete route walks the stored object with ranged reads, so
// the r2 mock serves real byte ranges of a staged fixture (sliced exactly as
// the S3 Range GET would return them).
const r2State = vi.hoisted(() => ({ artifact: null as Uint8Array | null }));

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/r2', () => ({
  isR2Configured: () => true,
  getR2ConfigurationError: () => null,
  headObject: vi.fn(),
  copyRecording: vi.fn(async () => undefined),
  deleteRecording: vi.fn(async () => undefined),
  generateFinalExportKey: (userId: string, jobId: string) => `exports/${userId}/${jobId}.mp4`,
  uploadRecording: vi.fn(async () => undefined),
  getObjectRange: vi.fn(async (_key: string, start: number, endInclusive: number) => {
    const bytes = r2State.artifact;
    if (!bytes) throw new Error('no artifact bytes staged for this test');
    if (start >= bytes.byteLength) return new Uint8Array(0);
    return bytes.subarray(start, Math.min(endInclusive + 1, bytes.byteLength));
  }),
}));

import { auth } from '@/auth';
import { headObject, deleteRecording, getObjectRange } from '@/lib/r2';
import { POST as completePOST } from '@/app/api/exports/complete/route';
import { POST as uploadPOST } from '@/app/api/export-upload/route';
import { resetDb, getDb } from '@/lib/db/driver';
import {
  setMigrated,
  createUser,
  createExportJob,
  updateUserPlanById,
  findExportJobByIdAndUser,
  getDailyRecordedSeconds,
  setExportJobStagingKey,
} from '@/lib/db';
import { buildSyntheticMp4, readMp4Artifact } from '@/lib/export/mp4-metadata';
import {
  collectMp4Metadata,
  describeArtifactFailure,
  describeArtifactFailureForClient,
  normalizeClaimedDuration,
  normalizeClaimedHasAudio,
  verifyExportArtifact,
  type ArtifactFailureCode,
} from '@/lib/export/artifact-verification';
import {
  EXPORT_BYTES_PER_SECOND,
  EXPORT_DURATION_TOLERANCE_SECONDS,
  MAX_EXPORT_DURATION_SECONDS,
  MAX_EXPORT_SIZE_MB,
  exportDurationToleranceSeconds,
} from '@/lib/export/export-limits';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';

/* ------------------------------------------------------------------ *
 * Fixtures and helpers
 * ------------------------------------------------------------------ */

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

let n = 0;
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

/** Stands in for the S3 Range GET: exact sub-slices of the staged object. */
function readerFor(bytes: Uint8Array, log?: { requested: number }) {
  return async (offset: number, length: number): Promise<Uint8Array> => {
    if (log) log.requested += length;
    if (offset >= bytes.byteLength) return new Uint8Array(0);
    return bytes.subarray(offset, Math.min(offset + length, bytes.byteLength));
  };
}

/** A `free` box in front of a valid file: ISO-BMFF requires ftyp first. */
function ftypNotFirst(): ArrayBuffer {
  const prefix = new Uint8Array(16);
  new DataView(prefix.buffer).setUint32(0, 16);
  prefix.set(new TextEncoder().encode('free'), 4);
  const synth = new Uint8Array(buildSyntheticMp4(1920, 1080));
  const out = new Uint8Array(prefix.byteLength + synth.byteLength);
  out.set(prefix, 0);
  out.set(synth, prefix.byteLength);
  return out.buffer as ArrayBuffer;
}

function parseOrFail(buffer: ArrayBuffer) {
  const artifact = readMp4Artifact(buffer);
  if (!artifact) throw new Error('fixture did not parse');
  return artifact;
}

async function exportCount(userId: string): Promise<number> {
  const r = await getDb().execute({
    sql: 'SELECT COUNT(*) AS cnt FROM exports WHERE user_id = ?',
    args: [userId],
  });
  return Number(r.rows[0]?.cnt) || 0;
}

async function uploadCount(userId: string): Promise<number> {
  const r = await getDb().execute({
    sql: 'SELECT upload_count FROM user_stats WHERE user_id = ?',
    args: [userId],
  });
  return Number(r.rows[0]?.upload_count ?? 0);
}

function stageArtifact(bytes: Uint8Array) {
  r2State.artifact = bytes;
  vi.mocked(headObject).mockResolvedValue({
    size: bytes.byteLength,
    contentType: 'video/mp4',
    eTag: '"etag-artifact"',
  });
}

async function seedComplete(
  plan: 'free' | 'creator_monthly' = 'creator_monthly',
  configOverrides: Record<string, unknown> = {},
) {
  n += 1;
  const user = await createUser(`av-${n}@example.com`, 'Av', 'hash');
  if (plan === 'creator_monthly') {
    await updateUserPlanById(user.id, 'creator_monthly', FUTURE);
  }
  const job = await createExportJob(
    user.id,
    JSON.stringify({ platformId: 'youtube-landscape', ...configOverrides }),
  );
  const stagingKey = `staging/${user.id}/${job.id}/source.mp4`;
  await setExportJobStagingKey(job.id, user.id, stagingKey);
  vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
  return { user, job, stagingKey };
}

function completeBody(
  jobId: string,
  key: string,
  extra: Record<string, unknown> = {},
  plan: 'free' | 'creator_monthly' = 'creator_monthly',
  fileSize?: number,
): NextRequest {
  // The declared frame must be the clamped preset for the plan, or the
  // pre-verification dimension check (not the artifact) would answer first.
  const dims =
    plan === 'free'
      ? { outputWidth: 1280, outputHeight: 720 }
      : { outputWidth: 1920, outputHeight: 1080 };
  return new NextRequest('http://localhost/api/exports/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      key,
      fileSize: fileSize ?? r2State.artifact?.byteLength ?? 1,
      mimeType: 'video/mp4',
      platformId: 'youtube-landscape',
      ...dims,
      ...extra,
    }),
  });
}

async function seedUploader() {
  n += 1;
  const user = await createUser(`up-${n}@example.com`, 'Up', 'hash');
  await updateUserPlanById(user.id, 'creator_monthly', FUTURE);
  const job = await createExportJob(user.id, JSON.stringify({ platformId: 'youtube-landscape' }));
  vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
  return { user, job };
}

/**
 * jsdom's `Request.formData()` cannot decode a multipart body, so only the
 * body decoding is stubbed — the handler below is the real route.
 */
function uploadRequest(fields: Record<string, string | File>): NextRequest {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  const request = new NextRequest('http://localhost/api/export-upload', { method: 'POST' });
  Object.defineProperty(request, 'formData', { value: async () => formData });
  return request;
}

beforeEach(() => {
  cleanTestData();
  vi.clearAllMocks();
  r2State.artifact = null;
  vi.mocked(headObject).mockResolvedValue(null);
});

afterEach(() => {
  cleanTestData();
});

/* ------------------------------------------------------------------ *
 * 1. The parser reports the bytes, never the input
 * ------------------------------------------------------------------ */

describe('readMp4Artifact: one parser, reading the actual container', () => {
  it('reports frame, structure, tracks and duration from a 1080x1350 fixture', () => {
    const artifact = parseOrFail(buildSyntheticMp4(1080, 1350, { durationSeconds: 3.5, withAudio: true }));
    expect(artifact.width).toBe(1080);
    expect(artifact.height).toBe(1350);
    expect(artifact.codec).toBe('avc1');
    expect(artifact.hasFtyp).toBe(true);
    expect(artifact.hasMoov).toBe(true);
    expect(artifact.hasMdat).toBe(true);
    expect(artifact.videoTrackCount).toBe(1);
    expect(artifact.audioTrackCount).toBe(1);
    expect(artifact.durationSeconds).toBeCloseTo(3.5, 2);
  });

  it('a second fixture reports ITS frame — a parser echoing its input would fail here', () => {
    const portrait = parseOrFail(buildSyntheticMp4(1080, 1920));
    const landscape = parseOrFail(buildSyntheticMp4(1920, 1080));
    expect(portrait.width).toBe(1080);
    expect(portrait.height).toBe(1920);
    expect(landscape.width).toBe(1920);
    expect(landscape.height).toBe(1080);
    expect(landscape.width).not.toBe(portrait.width);
  });

  it('returns null for buffers too small, and junk bytes fail the verdict as not_mp4', () => {
    expect(readMp4Artifact(new Uint8Array(8).buffer)).toBeNull();
    // A larger junk buffer parses as one size-0 box but never identifies as
    // MP4 — the parser need not throw, the verdict is what must hold.
    const junk = new Uint8Array(64).buffer;
    expect(verifyExportArtifact(junk, { width: 1920, height: 1080 })).toEqual({
      ok: false,
      code: 'not_mp4',
    });
  });
});

/* ------------------------------------------------------------------ *
 * 2. The single verdict: structure, duration, audio
 * ------------------------------------------------------------------ */

describe('verifyExportArtifact: one authoritative verdict from the bytes', () => {
  const frame = { width: 1920, height: 1080 };

  it('accepts a structurally real artifact whose claims all hold', () => {
    const buffer = buildSyntheticMp4(1920, 1080, { durationSeconds: 1, withAudio: true });
    const result = verifyExportArtifact(buffer, {
      ...frame,
      durationSeconds: 1,
      hasAudio: true,
      sizeBytes: buffer.byteLength,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects null bytes as not an MP4', () => {
    expect(verifyExportArtifact(null, frame)).toEqual({ ok: false, code: 'not_mp4' });
  });

  it('rejects a file whose first box is not ftyp (not an ISO-BMFF)', () => {
    expect(verifyExportArtifact(ftypNotFirst(), frame)).toEqual({ ok: false, code: 'not_mp4' });
  });

  it('rejects ftyp+mdat with no container metadata', () => {
    const buffer = buildSyntheticMp4(1920, 1080, { omitMoov: true });
    expect(verifyExportArtifact(buffer, frame)).toEqual({ ok: false, code: 'missing_moov' });
  });

  it('rejects ftyp+moov with no media data', () => {
    const buffer = buildSyntheticMp4(1920, 1080, { omitMdat: true });
    expect(verifyExportArtifact(buffer, frame)).toEqual({ ok: false, code: 'missing_mdat' });
  });

  it('rejects an audio-only file before any dimension comparison', () => {
    const buffer = buildSyntheticMp4(1920, 1080, { omitVideo: true, withAudio: true });
    expect(verifyExportArtifact(buffer, frame)).toEqual({ ok: false, code: 'no_video_stream' });
  });

  it('rejects an artifact whose coded frame differs from the validated one', () => {
    const buffer = buildSyntheticMp4(1280, 720);
    expect(verifyExportArtifact(buffer, frame)).toEqual({ ok: false, code: 'dimension_mismatch' });
  });

  describe('duration', () => {
    it('rejects an absent/zero container duration', () => {
      const buffer = buildSyntheticMp4(1920, 1080, { durationSeconds: 0 });
      const result = verifyExportArtifact(buffer, {
        ...frame,
        durationSeconds: 1,
        sizeBytes: buffer.byteLength,
      });
      expect(result).toEqual({ ok: false, code: 'duration_invalid' });
    });

    it('rejects a duration beyond the encoder cap', () => {
      const beyond = MAX_EXPORT_DURATION_SECONDS + 100;
      const buffer = buildSyntheticMp4(1920, 1080, { durationSeconds: beyond });
      const result = verifyExportArtifact(buffer, {
        ...frame,
        durationSeconds: beyond,
        sizeBytes: buffer.byteLength,
      });
      expect(result).toEqual({ ok: false, code: 'duration_invalid' });
    });

    it('rejects a duration that disagrees with the claim beyond tolerance', () => {
      const buffer = buildSyntheticMp4(1920, 1080, { durationSeconds: 2 });
      const result = verifyExportArtifact(buffer, {
        ...frame,
        durationSeconds: 10,
        sizeBytes: buffer.byteLength,
      });
      expect(result).toEqual({ ok: false, code: 'duration_mismatch' });
    });

    it('accepts a duration inside the tolerance window', () => {
      const buffer = buildSyntheticMp4(1920, 1080, { durationSeconds: 9.5 });
      const result = verifyExportArtifact(buffer, {
        ...frame,
        durationSeconds: 10,
        sizeBytes: buffer.byteLength,
      });
      expect(result.ok).toBe(true);
    });

    it('claimless: falls back to the byte-rate floor and rejects a duration too short for the size', () => {
      const buffer = buildSyntheticMp4(1920, 1080, { durationSeconds: 1 });
      const result = verifyExportArtifact(buffer, {
        ...frame,
        sizeBytes: EXPORT_BYTES_PER_SECOND * 2,
      });
      expect(result).toEqual({ ok: false, code: 'duration_mismatch' });
    });

    it('claimless: accepts when the artifact size fits its parsed duration', () => {
      const buffer = buildSyntheticMp4(1920, 1080, { durationSeconds: 1 });
      const result = verifyExportArtifact(buffer, {
        ...frame,
        sizeBytes: EXPORT_BYTES_PER_SECOND * 0.5,
      });
      expect(result.ok).toBe(true);
    });

    it('the tolerance is a 1s floor growing with 1% of the claim', () => {
      expect(EXPORT_DURATION_TOLERANCE_SECONDS).toBe(1);
      expect(exportDurationToleranceSeconds(10)).toBe(1);
      expect(exportDurationToleranceSeconds(1000)).toBe(10);
      expect(exportDurationToleranceSeconds(0)).toBe(1);
    });
  });

  describe('audio, only when the source genuinely had it', () => {
    it('rejects an artifact missing the expected audio stream', () => {
      const buffer = buildSyntheticMp4(1920, 1080);
      const result = verifyExportArtifact(buffer, { ...frame, durationSeconds: 1, hasAudio: true });
      expect(result).toEqual({ ok: false, code: 'missing_audio' });
    });

    it('accepts the same claims when the artifact carries the audio stream', () => {
      const buffer = buildSyntheticMp4(1920, 1080, { withAudio: true });
      const result = verifyExportArtifact(buffer, { ...frame, durationSeconds: 1, hasAudio: true });
      expect(result.ok).toBe(true);
    });

    it('never rejects an artifact that has audio the claim never asked for', () => {
      const buffer = buildSyntheticMp4(1920, 1080, { withAudio: true });
      const result = verifyExportArtifact(buffer, { ...frame, durationSeconds: 1, hasAudio: false });
      expect(result.ok).toBe(true);
    });

    it('skips the requirement when no claim is available at all', () => {
      const buffer = buildSyntheticMp4(1920, 1080);
      expect(
        verifyExportArtifact(buffer, { ...frame, durationSeconds: 1, hasAudio: null }).ok,
      ).toBe(true);
      expect(verifyExportArtifact(buffer, { ...frame, durationSeconds: 1 }).ok).toBe(true);
    });
  });

  describe('container facts from ranged collection (server path)', () => {
    // The server's combined buffer is ftyp+moov only — the mdat payload is
    // never buffered — so the facts observed during the ranged walk stand in
    // for what is not in the buffer.
    it('accepts a ftyp+moov buffer when the walk reports mdat was seen', () => {
      const buffer = buildSyntheticMp4(1920, 1080, { omitMdat: true });
      const result = verifyExportArtifact(
        buffer,
        { ...frame, durationSeconds: 1, sizeBytes: buffer.byteLength },
        { ftypSeen: true, mdatSeen: true },
      );
      expect(result.ok).toBe(true);
    });

    it('rejects the same buffer when the walk saw no mdat', () => {
      const buffer = buildSyntheticMp4(1920, 1080, { omitMdat: true });
      const result = verifyExportArtifact(
        buffer,
        { ...frame, durationSeconds: 1, sizeBytes: buffer.byteLength },
        { ftypSeen: true, mdatSeen: false },
      );
      expect(result).toEqual({ ok: false, code: 'missing_mdat' });
    });
  });
});

/* ------------------------------------------------------------------ *
 * 3. The bounded ranged walk over a stored object
 * ------------------------------------------------------------------ */

describe('collectMp4Metadata: bounded ranged reads, never the payload', () => {
  it('collects ftyp+moov from a moov-first file; the facts complete the verdict', async () => {
    const file = new Uint8Array(buildSyntheticMp4(1080, 1920));
    const collected = await collectMp4Metadata(readerFor(file), file.byteLength);
    if (!collected) throw new Error('collection failed');
    expect(collected.ftypSeen).toBe(true);
    expect(collected.mdatSeen).toBe(true);
    const artifact = readMp4Artifact(collected.combined);
    if (!artifact) throw new Error('combined buffer did not parse');
    expect(artifact.hasMoov).toBe(true);
    expect(artifact.width).toBe(1080);
    expect(artifact.height).toBe(1920);
    const result = verifyExportArtifact(
      collected.combined,
      { width: 1080, height: 1920, durationSeconds: 1, sizeBytes: file.byteLength },
      { ftypSeen: collected.ftypSeen, mdatSeen: collected.mdatSeen },
    );
    expect(result.ok).toBe(true);
  });

  it('finds a moov sitting AFTER a 5 MiB mdat without ever fetching the payload', async () => {
    const mdatBytes = 5 * 1024 * 1024;
    const withMoov = new Uint8Array(buildSyntheticMp4(1920, 1080, { omitMdat: true }));
    const withMdat = new Uint8Array(
      buildSyntheticMp4(1920, 1080, { omitMoov: true, mdatBytes }),
    );
    const ftypSize = new DataView(withMoov.buffer, withMoov.byteOffset, 4).getUint32(0);
    // Layout: [ftyp, moov] and [ftyp, mdat] -> assemble ftyp + mdat + moov.
    const ftyp = withMoov.subarray(0, ftypSize);
    const moov = withMoov.subarray(ftypSize);
    const mdat = withMdat.subarray(ftypSize);
    const file = new Uint8Array(ftyp.byteLength + mdat.byteLength + moov.byteLength);
    file.set(ftyp, 0);
    file.set(mdat, ftyp.byteLength);
    file.set(moov, ftyp.byteLength + mdat.byteLength);
    expect(file.byteLength).toBeGreaterThan(mdatBytes);

    const log = { requested: 0 };
    const collected = await collectMp4Metadata(readerFor(file, log), file.byteLength);
    if (!collected) throw new Error('collection failed');
    expect(collected.mdatSeen).toBe(true);
    // 16 KiB head probe + the far moov box — versus a 5 MiB payload. A
    // collector that copied the object would request >= 5 MiB here.
    expect(log.requested).toBeLessThan(64 * 1024);
    const result = verifyExportArtifact(
      collected.combined,
      { width: 1920, height: 1080, durationSeconds: 1, sizeBytes: file.byteLength },
      { ftypSeen: collected.ftypSeen, mdatSeen: collected.mdatSeen },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a file that does not identify as MP4 (first box is not ftyp)', async () => {
    const file = new Uint8Array(ftypNotFirst());
    expect(await collectMp4Metadata(readerFor(file), file.byteLength)).toBeNull();
  });

  it('rejects ftyp+mdat with no moov to parse', async () => {
    const file = new Uint8Array(buildSyntheticMp4(1920, 1080, { omitMoov: true }));
    expect(await collectMp4Metadata(readerFor(file), file.byteLength)).toBeNull();
  });

  it('rejects an object too small to be a container', async () => {
    const file = new Uint8Array(8);
    expect(await collectMp4Metadata(readerFor(file), 8)).toBeNull();
  });

  it('propagates reader failures — an unavailable read is not evidence against the artifact', async () => {
    const file = new Uint8Array(buildSyntheticMp4(1920, 1080));
    const reader = async (): Promise<Uint8Array> => {
      throw new Error('r2 network');
    };
    await expect(collectMp4Metadata(reader, file.byteLength)).rejects.toThrow('r2 network');
  });
});

/* ------------------------------------------------------------------ *
 * 4. What a client may learn from a rejection
 * ------------------------------------------------------------------ */

describe('failure messaging and claim normalizers', () => {
  const expected: Record<ArtifactFailureCode, string> = {
    not_mp4: 'Uploaded file is not a valid MP4',
    missing_moov: 'Uploaded file is not a valid MP4',
    missing_mdat: 'Uploaded file is not a valid MP4',
    no_video_stream: 'Uploaded file is not a valid MP4',
    dimension_mismatch: 'Output dimensions do not match the validated export configuration',
    duration_invalid: 'Export duration does not match the recording',
    duration_mismatch: 'Export duration does not match the recording',
    missing_audio: 'Export is missing the expected audio track',
  };

  it('maps every code to the safe message already used for that class of rejection', () => {
    for (const [code, message] of Object.entries(expected) as [ArtifactFailureCode, string][]) {
      expect(describeArtifactFailure(code)).toBe(message);
    }
  });

  it('no message leaks parser internals (box names, offsets, entry types)', () => {
    for (const code of Object.keys(expected) as ArtifactFailureCode[]) {
      const message = describeArtifactFailure(code);
      expect(message).not.toMatch(/moov|mdat|mvhd|stsd|tkhd|avc1|mp4a|\bbox\b|\boffset\b/i);
    }
  });

  it('client failures carry the same "Export failed verification" family as STATE 7', () => {
    expect(describeArtifactFailureForClient('not_mp4')).toBe(
      'Export failed verification: Uploaded file is not a valid MP4',
    );
  });

  it('normalizeClaimedDuration keeps only positive finite numbers', () => {
    expect(normalizeClaimedDuration(12.5)).toBe(12.5);
    expect(normalizeClaimedDuration('12.5')).toBe(12.5);
    expect(normalizeClaimedDuration(0)).toBeNull();
    expect(normalizeClaimedDuration(-3)).toBeNull();
    expect(normalizeClaimedDuration(NaN)).toBeNull();
    expect(normalizeClaimedDuration(Infinity)).toBeNull();
    expect(normalizeClaimedDuration(undefined)).toBeNull();
    expect(normalizeClaimedDuration(null)).toBeNull();
    expect(normalizeClaimedDuration('')).toBeNull();
    expect(normalizeClaimedDuration('abc')).toBeNull();
  });

  it('normalizeClaimedHasAudio parses booleans and form strings, else no claim', () => {
    expect(normalizeClaimedHasAudio(true)).toBe(true);
    expect(normalizeClaimedHasAudio('true')).toBe(true);
    expect(normalizeClaimedHasAudio(false)).toBe(false);
    expect(normalizeClaimedHasAudio('false')).toBe(false);
    expect(normalizeClaimedHasAudio(undefined)).toBeNull();
    expect(normalizeClaimedHasAudio('yes')).toBeNull();
    expect(normalizeClaimedHasAudio(1)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 5. The launch matrix, verified from bytes (Part 3.14)
 * ------------------------------------------------------------------ */

describe('artifact-level platform matrix', () => {
  for (const preset of LAUNCH_PLATFORM_PRESETS) {
    it(`a real artifact at ${preset.width}x${preset.height} (${preset.id}) passes its own frame check`, () => {
      const buffer = buildSyntheticMp4(preset.width, preset.height);
      const result = verifyExportArtifact(buffer, {
        width: preset.width,
        height: preset.height,
        durationSeconds: 1,
        sizeBytes: buffer.byteLength,
      });
      expect(result.ok).toBe(true);
    });
  }

  it('a portrait artifact is rejected against a landscape frame', () => {
    const buffer = buildSyntheticMp4(1080, 1920);
    expect(
      verifyExportArtifact(buffer, { width: 1920, height: 1080, durationSeconds: 1 }),
    ).toEqual({ ok: false, code: 'dimension_mismatch' });
  });

  it('a square artifact is rejected against a portrait frame', () => {
    const buffer = buildSyntheticMp4(1080, 1080);
    expect(
      verifyExportArtifact(buffer, { width: 1080, height: 1920, durationSeconds: 1 }),
    ).toEqual({ ok: false, code: 'dimension_mismatch' });
  });

  it('a 4:5 artifact is rejected against a square frame', () => {
    const buffer = buildSyntheticMp4(1080, 1350);
    expect(
      verifyExportArtifact(buffer, { width: 1080, height: 1080, durationSeconds: 1 }),
    ).toEqual({ ok: false, code: 'dimension_mismatch' });
  });

  it('a landscape artifact is rejected against a vertical frame', () => {
    const buffer = buildSyntheticMp4(1920, 1080);
    expect(
      verifyExportArtifact(buffer, { width: 1080, height: 1920, durationSeconds: 1 }),
    ).toEqual({ ok: false, code: 'dimension_mismatch' });
  });
});

/* ------------------------------------------------------------------ *
 * 6. /api/exports/complete verifies the stored bytes (real verifier)
 * ------------------------------------------------------------------ */

describe('POST /api/exports/complete parses the actual artifact', () => {
  it('accepts a structurally real artifact at the claimed frame', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080)));

    const res = await completePOST(completeBody(job.id, stagingKey));

    expect(res.status).toBe(200);
    expect((await res.json()).exportId).toBeDefined();
    expect(await exportCount(user.id)).toBe(1);
    const stored = await findExportJobByIdAndUser(job.id, user.id);
    expect(stored?.status).toBe('completed');
  });

  it('rejects corrupt bytes with a safe message, removes staging, records nothing, claims nothing', async () => {
    const { user, job, stagingKey } = await seedComplete();
    const garbage = new TextEncoder().encode(
      'not an mp4 at all: plain ascii padding, comfortably non-zero, unparseable as a container........',
    );
    stageArtifact(garbage);

    const res = await completePOST(completeBody(job.id, stagingKey));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Uploaded file is not a valid MP4');
    expect(vi.mocked(deleteRecording)).toHaveBeenCalledWith(stagingKey);
    expect(await exportCount(user.id)).toBe(0);
    const stored = await findExportJobByIdAndUser(job.id, user.id);
    expect(stored?.status).toBe('pending');
  });

  it('a corrected artifact completes the SAME job after a structural rejection (retry path)', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new TextEncoder().encode('garbage bytes, definitely not a container................'));
    expect((await completePOST(completeBody(job.id, stagingKey))).status).toBe(400);

    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080)));
    const retry = await completePOST(completeBody(job.id, stagingKey));

    expect(retry.status).toBe(200);
    expect(await exportCount(user.id)).toBe(1);
  });

  it('rejects an artifact whose frame contradicts the validated configuration', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new Uint8Array(buildSyntheticMp4(1280, 720)));

    const res = await completePOST(completeBody(job.id, stagingKey));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'Output dimensions do not match the validated export configuration',
    );
    expect(vi.mocked(deleteRecording)).toHaveBeenCalledWith(stagingKey);
    expect(await exportCount(user.id)).toBe(0);
  });

  it('enforces the Free resolution ceiling against the BYTES, not the claim', async () => {
    const { user, job, stagingKey } = await seedComplete('free');
    // Declared frame is the free-clamped 1280x720 (passes the pre-verification
    // check); the stored object is a 1080p file — only byte parsing catches it.
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080)));

    const res = await completePOST(completeBody(job.id, stagingKey, {}, 'free'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'Output dimensions do not match the validated export configuration',
    );
    expect(await exportCount(user.id)).toBe(0);
  });

  it('rejects a duration claim the artifact cannot back', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080, { durationSeconds: 2 })));

    const res = await completePOST(completeBody(job.id, stagingKey, { duration: 10 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Export duration does not match the recording');
    expect(await exportCount(user.id)).toBe(0);
    expect((await findExportJobByIdAndUser(job.id, user.id))?.status).toBe('pending');
  });

  it('accepts a duration claim inside the tolerance window', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080, { durationSeconds: 9.5 })));

    const res = await completePOST(completeBody(job.id, stagingKey, { duration: 10 }));

    expect(res.status).toBe(200);
    expect(await exportCount(user.id)).toBe(1);
  });

  it('falls back to the job-config duration claim when the body carries none', async () => {
    const { user, job, stagingKey } = await seedComplete('creator_monthly', { duration: 10 });
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080, { durationSeconds: 2 })));

    const res = await completePOST(completeBody(job.id, stagingKey));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Export duration does not match the recording');
    expect(await exportCount(user.id)).toBe(0);
  });

  it('requires the audio stream the encoder claimed in the body', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080)));

    const res = await completePOST(completeBody(job.id, stagingKey, { hasAudio: true }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Export is missing the expected audio track');
    expect(vi.mocked(deleteRecording)).toHaveBeenCalledWith(stagingKey);
    expect(await exportCount(user.id)).toBe(0);
  });

  it('requires the audio stream stored in the job config by presigned-put', async () => {
    const { user, job, stagingKey } = await seedComplete('creator_monthly', { hasAudio: true });
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080)));

    const res = await completePOST(completeBody(job.id, stagingKey));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Export is missing the expected audio track');
    expect(await exportCount(user.id)).toBe(0);
  });

  it('accepts an audio-bearing artifact under an audio claim', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080, { withAudio: true })));

    const res = await completePOST(completeBody(job.id, stagingKey, { hasAudio: true }));

    expect(res.status).toBe(200);
    expect(await exportCount(user.id)).toBe(1);
  });

  it('replaying a completed job echoes the same export and creates no second row', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080)));

    const first = await completePOST(completeBody(job.id, stagingKey));
    expect(first.status).toBe(200);
    const { exportId } = await first.json();

    const replay = await completePOST(completeBody(job.id, stagingKey));
    expect(replay.status).toBe(200);
    expect((await replay.json()).exportId).toBe(exportId);
    expect(await exportCount(user.id)).toBe(1);
  });

  it('refuses another user\u2019s job', async () => {
    const { job, stagingKey } = await seedComplete();
    n += 1;
    const stranger = await createUser(`stranger-${n}@example.com`, 'St', 'hash');
    vi.mocked(auth).mockResolvedValue({ user: { id: stranger.id } } as never);

    const res = await completePOST(completeBody(job.id, stagingKey));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid job');
  });

  it('refuses a key that belongs to a foreign staging object', async () => {
    const { user, job } = await seedComplete();
    n += 1;
    const stranger = await createUser(`stranger-${n}@example.com`, 'St', 'hash');
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080)));

    const res = await completePOST(
      completeBody(job.id, `staging/${stranger.id}/elsewhere/source.mp4`),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Key mismatch');
    expect(await exportCount(user.id)).toBe(0);
  });

  it('refuses when the R2 object does not exist', async () => {
    const { user, job, stagingKey } = await seedComplete();
    vi.mocked(headObject).mockResolvedValue(null); // object absent

    const res = await completePOST(completeBody(job.id, stagingKey, {}, 'creator_monthly', 1024));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Object not found, upload first');
    expect(vi.mocked(deleteRecording)).not.toHaveBeenCalled();
    expect(await exportCount(user.id)).toBe(0);
  });

  it('rejects an object over the size cap before verification, with cleanup', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080)));
    vi.mocked(headObject).mockResolvedValue({
      size: (MAX_EXPORT_SIZE_MB + 50) * 1024 * 1024,
      contentType: 'video/mp4',
      eTag: '"etag-huge"',
    });

    const res = await completePOST(completeBody(job.id, stagingKey, {}, 'creator_monthly', 1024));

    expect(res.status).toBe(413);
    expect(vi.mocked(deleteRecording)).toHaveBeenCalledWith(stagingKey);
    expect(await exportCount(user.id)).toBe(0);
  });

  it('a failed range read is retryable 500: staging kept, no claim, nothing recorded', async () => {
    const { user, job, stagingKey } = await seedComplete();
    stageArtifact(new Uint8Array(buildSyntheticMp4(1920, 1080)));
    vi.mocked(getObjectRange).mockRejectedValueOnce(new Error('r2 unavailable'));

    const res = await completePOST(completeBody(job.id, stagingKey));

    expect(res.status).toBe(500);
    expect(vi.mocked(deleteRecording)).not.toHaveBeenCalled();
    expect(await exportCount(user.id)).toBe(0);
    expect((await findExportJobByIdAndUser(job.id, user.id))?.status).toBe('pending');
  });

  it('a rejected artifact consumes no daily recording allowance (free ledger intact)', async () => {
    const { user, job, stagingKey } = await seedComplete('free');
    stageArtifact(new Uint8Array(buildSyntheticMp4(1280, 720, { durationSeconds: 2 })));

    const res = await completePOST(completeBody(job.id, stagingKey, { duration: 10 }, 'free'));

    expect(res.status).toBe(400);
    expect(await getDailyRecordedSeconds(user.id)).toBe(0);
    expect(await exportCount(user.id)).toBe(0);
    expect((await findExportJobByIdAndUser(job.id, user.id))?.status).toBe('pending');
  });
});

/* ------------------------------------------------------------------ *
 * 7. /api/export-upload verifies the received bytes (real verifier)
 * ------------------------------------------------------------------ */

describe('POST /api/export-upload parses the actual upload', () => {
  it('accepts a structurally real artifact at the platform frame', async () => {
    const { user, job } = await seedUploader();

    const res = await uploadPOST(
      uploadRequest({
        file: new File([buildSyntheticMp4(1920, 1080)], 'export.mp4', { type: 'video/mp4' }),
        platformId: 'youtube-landscape',
        jobId: job.id,
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).exportId).toBeDefined();
    expect(await exportCount(user.id)).toBe(1);
    expect(await uploadCount(user.id)).toBe(1);
  });

  it('rejects corrupt bytes before any quota is taken, then accepts a corrected upload', async () => {
    const { user, job } = await seedUploader();
    const garbage = new TextEncoder().encode(
      'not an mp4 at all: plain ascii padding, comfortably non-zero, unparseable as a container........',
    );

    const rejected = await uploadPOST(
      uploadRequest({
        file: new File([garbage], 'export.mp4', { type: 'video/mp4' }),
        platformId: 'youtube-landscape',
        jobId: job.id,
      }),
    );

    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toBe('Uploaded file is not a valid MP4');
    expect(await exportCount(user.id)).toBe(0);
    expect(await uploadCount(user.id)).toBe(0);
    expect((await findExportJobByIdAndUser(job.id, user.id))?.status).toBe('uploading');

    const retry = await uploadPOST(
      uploadRequest({
        file: new File([buildSyntheticMp4(1920, 1080)], 'export.mp4', { type: 'video/mp4' }),
        platformId: 'youtube-landscape',
        jobId: job.id,
      }),
    );

    expect(retry.status).toBe(200);
    expect(await exportCount(user.id)).toBe(1);
    expect(await uploadCount(user.id)).toBe(1);
  });

  it('rejects an artifact whose frame differs from the preset-derived expectation', async () => {
    const { user, job } = await seedUploader();

    const res = await uploadPOST(
      uploadRequest({
        file: new File([buildSyntheticMp4(1280, 720)], 'export.mp4', { type: 'video/mp4' }),
        platformId: 'youtube-landscape',
        jobId: job.id,
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'Output dimensions do not match the validated export configuration',
    );
    expect(await exportCount(user.id)).toBe(0);
    expect(await uploadCount(user.id)).toBe(0);
  });
});
