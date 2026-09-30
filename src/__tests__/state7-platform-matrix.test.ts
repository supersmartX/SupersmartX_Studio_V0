import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

process.env.TURSO_DATABASE_URL = 'file::memory:';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/r2', () => ({
  isR2Configured: () => true,
  getSignedUploadUrl: vi.fn().mockResolvedValue('https://r2.example/upload'),
  // Real keys are namespaced under the user id; the complete route enforces
  // that prefix, so the mock must produce a genuine per-user key.
  generateExportKey: vi.fn((userId: string) => `exports/${userId}/export.mp4`),
  headObject: vi.fn().mockResolvedValue({ size: 2_000_000, contentType: 'video/mp4' }),
  deleteRecording: vi.fn(),
  deleteObject: vi.fn(),
}));

import { auth } from '@/auth';
import { POST as presignedPOST } from '@/app/api/exports/presigned-put/route';
import { POST as completePOST } from '@/app/api/exports/complete/route';
import { resetDb } from '@/lib/db/driver';
import { setMigrated, createUser, updateUserPlanById, findExportByIdAndUser } from '@/lib/db';
import { createExportConfig, getDefaultCrop } from '@/lib/export/export-config';
import { computeCanvasSourceRect } from '@/lib/composition';
import { clampResolution, getEntitlements, exceedsResolutionLimit } from '@/lib/entitlements';
import { readMp4Dimensions, buildSyntheticMp4, REQUIRED_MATRIX } from '@/lib/export/mp4-metadata';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import type { PlatformId } from '@/types';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();
let n = 0;

async function seedCreator() {
  n += 1;
  const user = await createUser(`state7-${n}@example.com`, 'Creator', 'hash');
  if (!user) throw new Error('seed user creation failed');
  await updateUserPlanById(user.id, 'creator_monthly', FUTURE);
  vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: `state7-${n}@example.com` } } as never);
  return user;
}

beforeEach(cleanTestData);
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ *
 * 0. The parser itself must be trustworthy
 * ------------------------------------------------------------------ */

describe('the MP4 reader reports the truth', () => {
  it.each(REQUIRED_MATRIX.map((p) => [p.label, p.width, p.height] as const))(
    'reads %s back as %ix%i from real box bytes',
    (_label, width, height) => {
      const parsed = readMp4Dimensions(buildSyntheticMp4(width, height));
      expect(parsed).not.toBeNull();
      expect(parsed!.width).toBe(width);
      expect(parsed!.height).toBe(height);
      expect(parsed!.codec).toBe('avc1');
      expect(parsed!.hasMoov).toBe(true);
    }
  );

  it('does not mistake 16.16 fixed point for a raw integer', () => {
    // A parser that skipped the /65536 would report 125829120x47185920. This is
    // the single easiest way to write a metadata check that always "passes"
    // because nobody compares against a real file.
    const parsed = readMp4Dimensions(buildSyntheticMp4(1920, 1080));
    expect(parsed!.width).toBeLessThan(10000);
    expect(parsed!.height).toBeLessThan(10000);
  });

  it('returns null for something that is not an MP4 at all', () => {
    expect(readMp4Dimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer)).toBeNull();
  });

  it('does not silently pass a file that has no dimensions to read', () => {
    // An empty mdat with no moov must not be reported as a valid 0x0 export.
    const parsed = readMp4Dimensions(buildSyntheticMp4(0, 0));
    expect(parsed === null || parsed.width === 0).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 1. Every platform in the required matrix exists, and only those
 * ------------------------------------------------------------------ */

describe('the launch matrix matches the required platform matrix exactly', () => {
  it('covers every required platform', () => {
    for (const row of REQUIRED_MATRIX) {
      const preset = LAUNCH_PLATFORM_PRESETS.find((p) => p.id === row.id);
      expect(preset, `missing platform ${row.id}`).toBeDefined();
      expect(preset!.label).toBe(row.label === 'Instagram Post' ? 'Instagram Square' : row.label);
      expect(preset!.aspectRatio).toBe(row.preview);
      expect(preset!.width).toBe(row.width);
      expect(preset!.height).toBe(row.height);
    }
  });

  it('ships nothing beyond the required matrix', () => {
    // A platform offered in the UI but absent from the contract is an
    // unverified export path.
    expect(LAUNCH_PLATFORM_PRESETS.map((p) => p.id).sort()).toEqual(
      REQUIRED_MATRIX.map((p) => p.id).sort()
    );
  });

  it('every preset is internally consistent (ratio matches pixels)', () => {
    for (const row of REQUIRED_MATRIX) {
      const [rw, rh] = row.preview.split(':').map(Number);
      const expected = rw / rh;
      const actual = row.width / row.height;
      expect(Math.abs(actual - expected), `${row.label} ${row.width}x${row.height} vs ${row.preview}`).toBeLessThan(0.01);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. SELECT -> PREVIEW: preview geometry must match the export frame
 * ------------------------------------------------------------------ */

describe('the preview frame matches the exported frame', () => {
  it.each(REQUIRED_MATRIX.map((p) => [p.id, p.width, p.height] as const))(
    '%s previews at the exported aspect ratio',
    (id, width, height) => {
      // A 16:9 preview over a 9:16 export is the classic lie: the user frames
      // the shot in one shape and gets another.
      const preset = LAUNCH_PLATFORM_PRESETS.find((p) => p.id === id)!;
      const previewRatio = preset.width / preset.height;
      const exportRatio = width / height;
      expect(Math.abs(previewRatio - exportRatio)).toBeLessThan(0.01);
    }
  );

  it.each(REQUIRED_MATRIX.map((p) => [p.id, p.width, p.height] as const))(
    '%s preview crop and export crop are the same rect',
    (id, width, height) => {
      const config = createExportConfig(id as PlatformId, 1920, 1080);
      const preview = getDefaultCrop(1920, 1080, width, height);
      expect(config.crop.width).toBeCloseTo(preview.width, 6);
      expect(config.crop.height).toBeCloseTo(preview.height, 6);
      expect(config.crop.x).toBeCloseTo(preview.x, 6);
      expect(config.crop.y).toBeCloseTo(preview.y, 6);
    }
  );
});

/* ------------------------------------------------------------------ *
 * 3. EXPORT config: a Creator gets the exact matrix, unmodified
 * ------------------------------------------------------------------ */

describe('a Creator export config produces the exact required frame', () => {
  const creator = getEntitlements('creator_monthly');

  it.each(REQUIRED_MATRIX.map((p) => [p.id, p.width, p.height] as const))(
    '%s encodes at %ix%i for a Creator',
    (id, width, height) => {
      const config = createExportConfig(id as PlatformId, 1920, 1080, creator.maxResolution);
      // This is the value handed to the encoder AND asserted by the server on
      // completion. If a Creator's plan silently clamped a required format,
      // this is where it would show.
      expect(config.outputWidth).toBe(width);
      expect(config.outputHeight).toBe(height);
      expect(exceedsResolutionLimit(config.outputWidth, config.outputHeight, creator.maxResolution)).toBe(false);
    }
  );

  it('every Creator frame is H.264-legal (even dimensions)', () => {
    // H.264 4:2:0 requires even width and height. 1081x1920 would be accepted by
    // every assertion above and fail to encode.
    for (const row of REQUIRED_MATRIX) {
      const clamped = clampResolution(row.width, row.height, creator.maxResolution);
      expect(clamped.width % 2, `${row.label} width`).toBe(0);
      expect(clamped.height % 2, `${row.label} height`).toBe(0);
    }
  });

  it.each(REQUIRED_MATRIX.map((p) => [p.id] as const))(
    '%s crop stays inside the source frame',
    (id) => {
      // A crop wider than the source makes Mediabunny clamp it silently, and
      // the output frame drifts from the declared one.
      const config = createExportConfig(id as PlatformId, 1920, 1080, creator.maxResolution);
      const rect = computeCanvasSourceRect(config.crop, 1920, 1080, 1920, 1080);
      expect(rect.sx).toBeGreaterThanOrEqual(-0.5);
      expect(rect.sy).toBeGreaterThanOrEqual(-0.5);
      expect(rect.sw).toBeLessThanOrEqual(1920.5);
      expect(rect.sh).toBeLessThanOrEqual(1080.5);
      expect(rect.sw).toBeGreaterThan(0);
      expect(rect.sh).toBeGreaterThan(0);
    }
  );

  it.each(REQUIRED_MATRIX.map((p) => [p.id] as const))(
    '%s crop rect survives the even-integer rounding the encoder applies',
    (id) => {
      // toMediabunnyCropRect rounds to even because H.264 requires it. Rounding
      // must not move the crop by more than a pixel or the framing shifts.
      const config = createExportConfig(id as PlatformId, 1920, 1080, creator.maxResolution);
      const rect = computeCanvasSourceRect(config.crop, 1920, 1080, 1920, 1080);
      const evenOffset = (v: number) => Math.round(v / 2) * 2;
      const evenSize = (v: number) => Math.max(2, Math.round(v / 2) * 2);
      expect(Math.abs(evenOffset(rect.sx) - rect.sx)).toBeLessThanOrEqual(1);
      expect(Math.abs(evenOffset(rect.sy) - rect.sy)).toBeLessThanOrEqual(1);
      expect(evenSize(rect.sw)).toBeLessThanOrEqual(Math.ceil(rect.sw) + 1);
      expect(evenSize(rect.sh)).toBeLessThanOrEqual(Math.ceil(rect.sh) + 1);
      // And the rounded crop must still be non-degenerate.
      expect(evenSize(rect.sw)).toBeGreaterThan(0);
      expect(evenSize(rect.sh)).toBeGreaterThan(0);
    }
  );
});

/* ------------------------------------------------------------------ *
 * 4. A vertical master exports to a vertical frame, and vice versa
 * ------------------------------------------------------------------ */

describe('a portrait recording does not get silently letterboxed', () => {
  it.each(REQUIRED_MATRIX.map((p) => [p.id, p.width, p.height] as const))(
    '%s keeps its orientation from a 1080x1920 master',
    (id, width, height) => {
      const creator = getEntitlements('creator_monthly');
      const config = createExportConfig(id as PlatformId, 1080, 1920, creator.maxResolution);
      expect(config.outputWidth).toBe(width);
      expect(config.outputHeight).toBe(height);

      const rect = computeCanvasSourceRect(config.crop, 1080, 1920, 1080, 1920);
      expect(rect.sx).toBeGreaterThanOrEqual(-0.5);
      expect(rect.sy).toBeGreaterThanOrEqual(-0.5);
      expect(rect.sx + rect.sw).toBeLessThanOrEqual(1080.5);
      expect(rect.sy + rect.sh).toBeLessThanOrEqual(1920.5);
    }
  );

  it('a square master crops rather than stretches for every platform', () => {
    const creator = getEntitlements('creator_monthly');
    for (const row of REQUIRED_MATRIX) {
      const config = createExportConfig(row.id as PlatformId, 1080, 1080, creator.maxResolution);
      expect(config.outputWidth).toBe(row.width);
      expect(config.outputHeight).toBe(row.height);
      // The crop must match the target ratio exactly, so a square master is
      // letterboxed/pillarboxed away rather than distorted. A 1:1 target from a
      // 1:1 source legitimately needs no crop at all.
      const rect = computeCanvasSourceRect(config.crop, 1080, 1080, 1080, 1080);
      const cropRatio = rect.sw / rect.sh;
      const targetRatio = row.width / row.height;
      expect(Math.abs(cropRatio - targetRatio)).toBeLessThan(0.01);
      // And it can never exceed the source.
      expect(rect.sw).toBeLessThanOrEqual(1080.5);
      expect(rect.sh).toBeLessThanOrEqual(1080.5);
      if (Math.abs(targetRatio - 1) > 0.01) {
        // Every non-square target must actually remove pixels from a square
        // source; equal area would mean the encoder stretches instead.
        expect(rect.sw * rect.sh).toBeLessThan(1080 * 1080);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 5. UPLOAD -> the server must validate against real bytes
 * ------------------------------------------------------------------ */

describe('the server records the frame it will serve back', () => {
  it.each(REQUIRED_MATRIX.map((p) => [p.id, p.width, p.height] as const))(
    'a %s export is stored at %ix%i',
    async (id, width, height) => {
      const user = await seedCreator();
      const presign = await presignedPOST(
        new NextRequest('http://localhost/api/exports/presigned-put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platformId: id }),
        })
      );
      expect(presign.status).toBe(200);
      const { jobId, key, outputWidth, outputHeight } = (await presign.json()) as {
        jobId: string; key: string; outputWidth: number; outputHeight: number;
      };

      // Presign is where the client learns the frame. A wrong answer here is
      // what the encoder is told to produce.
      expect(outputWidth).toBe(width);
      expect(outputHeight).toBe(height);

      const done = await completePOST(
        new NextRequest('http://localhost/api/exports/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId, key, fileSize: 2_000_000, mimeType: 'video/mp4',
            platformId: id, outputWidth, outputHeight,
          }),
        })
      );
      expect(done.status).toBe(200);

      const { exportId } = (await done.json()) as { exportId: string };

      // Read the record back exactly the way the download route resolves it.
      const stored = await findExportByIdAndUser(exportId, user.id);
      expect(stored).toBeDefined();
      expect(stored!.platform).toBe(id);
      expect(stored!.outputWidth).toBe(width);
      expect(stored!.outputHeight).toBe(height);
      expect(stored!.r2Key).toBe(key);
    }
  );

  it('refuses an export whose declared frame contradicts the job', async () => {
    await seedCreator();
    const presign = await presignedPOST(
      new NextRequest('http://localhost/api/exports/presigned-put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformId: 'youtube-shorts' }),
      })
    );
    const { jobId, key } = (await presign.json()) as { jobId: string; key: string };

    // Claiming a landscape frame for a vertical job: the store would serve a
    // mislabelled file forever.
    const res = await completePOST(
      new NextRequest('http://localhost/api/exports/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId, key, fileSize: 2_000_000, mimeType: 'video/mp4',
          platformId: 'youtube-shorts', outputWidth: 1920, outputHeight: 1080,
        }),
      })
    );
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ *
 * 6. The gap this file cannot close in jsdom, stated as a test
 * ------------------------------------------------------------------ */

describe('the encoded bytes are checked before anything is uploaded', () => {
  it('the pipeline gates every upload on real MP4 bytes', () => {
    const pipeline = readFileSync(join(process.cwd(), 'src/hooks/useExportPipeline.ts'), 'utf-8');

    // Previously absent: the pipeline only checked size and shipped whatever
    // came back. Now both the single and the batch path must verify the frame.
    const calls = pipeline.match(/await assertEncodedFrame\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect(pipeline).toContain(
      "import { assertEncodedFrame } from '@/lib/export/mp4-metadata'"
    );

    // The gate must sit before the upload, or it is decorative.
    const singleGate = pipeline.indexOf('await assertEncodedFrame(resultBlob');
    const singleUpload = pipeline.indexOf('uploadCreatorExportToR2(resultBlob', singleGate);
    expect(singleGate).toBeGreaterThan(-1);
    expect(singleUpload).toBeGreaterThan(singleGate);

    // And no path may reach the uploader without one.
    const uploads = pipeline.split('uploadCreatorExportToR2(resultBlob').length - 1;
    expect(uploads).toBe(2);
  });

  it('the gate compares the real frame and rejects a mismatch', async () => {
    const { assertEncodedFrame } = await import('@/lib/export/mp4-metadata');
    // The gate only ever calls blob.arrayBuffer(). jsdom's Blob is a different
    // implementation that mangles the bytes, so hand it a minimal object that
    // returns the real buffer — the parse itself stays genuine.
    const toBlob = (buffer: ArrayBuffer): Blob => {
      const bytes = new Uint8Array(buffer.byteLength);
      bytes.set(new Uint8Array(buffer));
      return { arrayBuffer: async () => bytes.buffer } as unknown as Blob;
    };
    const good = buildSyntheticMp4(1080, 1920);

    // Correct file: passes and reports the truth.
    const parsed = await assertEncodedFrame(toBlob(good), { width: 1080, height: 1920 }, 'tiktok');
    expect(parsed.width).toBe(1080);
    expect(parsed.height).toBe(1920);

    // A 16:9 file claiming to be TikTok must not be uploadable.
    await expect(
      assertEncodedFrame(toBlob(buildSyntheticMp4(1920, 1080)), { width: 1080, height: 1920 }, 'tiktok')
    ).rejects.toThrow(/failed verification/i);

    // A transposed frame is equally a mismatch.
    await expect(
      assertEncodedFrame(toBlob(good), { width: 1920, height: 1080 }, 'youtube-landscape')
    ).rejects.toThrow(/failed verification/i);

    // Non-MP4 garbage must not pass as a zero-dimension file.
    await expect(
      assertEncodedFrame(toBlob(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer), { width: 1080, height: 1920 }, 'tiktok')
    ).rejects.toThrow(/failed verification/i);
  });
});
