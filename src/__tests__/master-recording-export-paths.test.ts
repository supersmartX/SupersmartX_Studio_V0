import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * STATE 21 — the master recording survives the export lifecycle.
 *
 * `useExportPipeline` reads the master and must never write to the recording
 * store. The store is the *only* copy of the take: nothing in this codebase
 * uploads a master to R2, and `src/app/api/recordings/route.ts` is a read-only
 * lister. So a single stray `deleteRecording` on a failed or cancelled export
 * is not a cache miss — it is the recording, gone, with the user still looking
 * at a preview built from a Blob handle that will not survive a reload.
 *
 * Both hooks are driven together here on purpose. Asserting `useExportPipeline`
 * in isolation proved nothing: the defect class is "some other code path reached
 * the store", so the take has to actually be loaded and then exported.
 */

const { store } = vi.hoisted(() => ({
  store: {
    getLatestRecording: vi.fn(async (): Promise<unknown> => null),
    saveRecording: vi.fn(async (_recording: unknown): Promise<void> => {}),
    cleanupExpired: vi.fn(async (): Promise<number> => 0),
    deleteRecording: vi.fn(async (_id: string): Promise<void> => {}),
  },
}));

vi.mock('@/lib/recording-store', () => ({
  getLatestRecording: () => store.getLatestRecording(),
  saveRecording: (rec: unknown) => store.saveRecording(rec),
  cleanupExpired: () => store.cleanupExpired(),
  deleteRecording: (id: string) => store.deleteRecording(id),
}));

vi.mock('@/lib/export/export-engine', () => ({ encodeExport: vi.fn() }));

// jsdom has neither WebCodecs nor a 2d canvas, so the STATE 20 gate would
// refuse first and these tests would never reach the paths they are about.
vi.mock('@/lib/export/browser-support', () => ({
  assertExportSupported: vi.fn().mockResolvedValue(undefined),
  UnsupportedBrowserError: class UnsupportedBrowserError extends Error {},
  getExportSupport: vi.fn(() => ({ supported: true })),
  UNSUPPORTED_BROWSER_MESSAGE: "Your browser can't complete this export. Please try Chrome or Edge.",
}));

// The real byte gate is covered by state7-platform-matrix; here it would only
// need a hand-built MP4 to let a synthetic blob through.
vi.mock('@/lib/export/mp4-metadata', () => ({ assertEncodedFrame: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/local-exports-store', () => ({ saveLocalExport: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/export/export-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/export/export-upload')>()),
  uploadCreatorExportToR2: vi.fn().mockResolvedValue({ exportId: 'export-1', r2Key: 'exports/u/x.mp4' }),
}));
vi.mock('@/lib/export/export-thumbnail', () => ({ generateExportThumbnail: vi.fn() }));

import { useMasterRecording } from '@/hooks/useMasterRecording';
import { useExportPipeline } from '@/hooks/useExportPipeline';
import { encodeExport } from '@/lib/export/export-engine';
import { assertExportSupported, UnsupportedBrowserError } from '@/lib/export/browser-support';
import type { ExportJob } from '@/types';

const mockEncode = vi.mocked(encodeExport);
const STORED_BLOB = new Blob(['the-original-take'], { type: 'video/webm' });

function storedRecording() {
  return {
    id: 'master-1',
    name: '',
    blob: STORED_BLOB,
    mimeType: 'video/webm',
    extension: 'webm',
    duration: 6.4,
    hasAudio: true,
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
}

/** Large enough to clear the pipeline's `size < 100` empty-file check. */
function encodedMp4(): Blob {
  return new Blob([new Uint8Array(2048)], { type: 'video/mp4' });
}

function hangingEncode() {
  mockEncode.mockImplementation(
    (opts) =>
      new Promise<never>((_, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      }),
  );
}

let fetchCalls: Array<{ url: string; init: RequestInit & { body?: string } }>;

beforeEach(() => {
  store.getLatestRecording.mockReset().mockImplementation(async () => storedRecording());
  store.saveRecording.mockClear();
  store.cleanupExpired.mockClear();
  store.deleteRecording.mockClear();
  mockEncode.mockReset();
  vi.mocked(assertExportSupported).mockResolvedValue(undefined);

  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:http://localhost/preview'),
    revokeObjectURL: vi.fn(),
  });

  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init: (init || {}) as { body?: string } });
      if (url === '/api/export-jobs' && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ jobId: 'ej-1' }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }),
  );
});

afterEach(() => {
  // Deliberately not `unstubAllGlobals()`: Testing Library's auto-cleanup
  // unmounts after this hook, and useMasterRecording's unmount calls
  // URL.revokeObjectURL. Vitest runs afterEach in reverse registration order, so
  // removing the stub here would break cleanup for the test that just finished.
  vi.clearAllMocks();
});

/** A restored take plus a selected platform, wired the way the studio wires them. */
async function mountRestoredMaster() {
  const utils = renderHook(() => ({
    master: useMasterRecording(),
    pipeline: useExportPipeline(),
  }));

  await act(async () => {
    await utils.result.current.master.restoreMasterRecording();
  });
  act(() => {
    utils.result.current.pipeline.selectPlatform('youtube-landscape', 1920, 1080);
  });

  return utils;
}

function expectTakeUntouched() {
  expect(store.deleteRecording).not.toHaveBeenCalled();
  // A second row would mean the take was re-persisted rather than reused, which
  // is how a surviving take silently becomes a duplicate.
  expect(store.saveRecording).not.toHaveBeenCalled();
  expect(store.cleanupExpired).not.toHaveBeenCalled();
}

describe('a restored take is the same take after every export outcome', () => {
  it('keeps the master identical through a successful export', async () => {
    mockEncode.mockResolvedValue(encodedMp4());
    const { result } = await mountRestoredMaster();

    let job: ExportJob | undefined;
    await act(async () => {
      job = await result.current.pipeline.startExport(result.current.master.masterRecording!);
    });

    expect(job?.status).toBe('done');
    expect(result.current.master.masterRecording?.id).toBe('master-1');
    expect(result.current.master.masterRecording?.blob).toBe(STORED_BLOB);
    expect(result.current.master.isRestored).toBe(true);
    expectTakeUntouched();
  });

  it('keeps the master after a failed export, so Retry still has a source', async () => {
    mockEncode.mockRejectedValueOnce(new Error('encode boom'));
    const { result } = await mountRestoredMaster();

    let job: ExportJob | undefined;
    await act(async () => {
      job = await result.current.pipeline.startExport(result.current.master.masterRecording!);
    });

    expect(job?.status).toBe('error');
    // The job failed; the take did not. These are different objects and the
    // product treats them differently.
    expect(result.current.master.masterRecording?.id).toBe('master-1');
    expect(result.current.master.masterRecording?.blob).toBe(STORED_BLOB);
    expectTakeUntouched();
  });

  it('re-exports from the very same take after a failure', async () => {
    mockEncode.mockRejectedValueOnce(new Error('encode boom'));
    const { result } = await mountRestoredMaster();

    await act(async () => {
      await result.current.pipeline.startExport(result.current.master.masterRecording!);
    });

    // Retry. This is the user-visible meaning of the invariant: the second
    // attempt must encode the same bytes it started from.
    mockEncode.mockResolvedValueOnce(encodedMp4());
    let retried: ExportJob | undefined;
    await act(async () => {
      retried = await result.current.pipeline.startExport(result.current.master.masterRecording!);
    });

    expect(retried?.status).toBe('done');
    expect(retried?.masterId).toBe('master-1');
    expect(mockEncode.mock.calls[0][0].master.id).toBe('master-1');
    expect(mockEncode.mock.calls[1][0].master.id).toBe('master-1');
    expect(result.current.master.masterRecording?.blob).toBe(STORED_BLOB);
    expectTakeUntouched();
  });

  it('keeps the master after a cancelled export', async () => {
    hangingEncode();
    const { result } = await mountRestoredMaster();

    let promise: Promise<ExportJob> | undefined;
    act(() => {
      promise = result.current.pipeline.startExport(result.current.master.masterRecording!);
    });
    await waitFor(() => {
      expect(result.current.pipeline.exportJobs[0]?.serverJobId).toBe('ej-1');
    });

    const jobId = result.current.pipeline.exportJobs[0].id;
    act(() => {
      result.current.pipeline.cancelExport(jobId);
    });
    await act(async () => {
      await promise;
    });

    // Cancelling an encode is not "discard my recording". The take is the
    // user's; the job was the attempt.
    expect(result.current.master.masterRecording?.id).toBe('master-1');
    expect(result.current.master.masterRecording?.blob).toBe(STORED_BLOB);
    expectTakeUntouched();
  });

  it('keeps the master when the whole pipeline is torn down mid-export', async () => {
    hangingEncode();
    const { result, unmount } = await mountRestoredMaster();

    act(() => {
      void result.current.pipeline.startExport(result.current.master.masterRecording!);
    });
    await waitFor(() => {
      expect(result.current.pipeline.exportJobs[0]?.serverJobId).toBe('ej-1');
    });

    unmount();
    await waitFor(() => {
      expect(
        fetchCalls.some(
          (c) =>
            c.url.includes('/api/export-jobs/ej-1') &&
            (JSON.parse(c.init.body || '{}') as { status?: string }).status === 'failed',
        ),
      ).toBe(true);
    });

    expectTakeUntouched();
  });

  it('refuses an unsupported browser without spending the take', async () => {
    // The capability gate is the other early-exit in this pipeline, and it sits
    // on the same path. A refusal must not be mistaken for a discard.
    vi.mocked(assertExportSupported).mockRejectedValueOnce(new UnsupportedBrowserError());
    mockEncode.mockResolvedValue(encodedMp4());

    const { result } = await mountRestoredMaster();
    let job: ExportJob | undefined;
    await act(async () => {
      job = await result.current.pipeline.startExport(result.current.master.masterRecording!);
    });

    expect(job?.status).toBe('error');
    expect(result.current.master.masterRecording?.id).toBe('master-1');
    expect(result.current.master.masterRecording?.blob).toBe(STORED_BLOB);
    // The gate runs before the job is created server-side, so no export row
    // and no concurrency slot are consumed by a refusal.
    expect(fetchCalls.some((c) => c.url === '/api/export-jobs' && c.init.method === 'POST')).toBe(false);
    expectTakeUntouched();
  });
});
