import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useExportPipeline } from '@/hooks/useExportPipeline';
import { encodeExport } from '@/lib/export/export-engine';
import type { ExportJob, MasterRecording } from '@/types';

vi.mock('@/lib/export/export-engine', () => ({ encodeExport: vi.fn() }));

const mockEncode = vi.mocked(encodeExport);

interface FetchCall {
  url: string;
  init: RequestInit & { body?: string };
}

let fetchCalls: FetchCall[];

function stubFetch() {
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init: (init || {}) as FetchCall['init'] });
      if (url === '/api/export-jobs' && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ jobId: 'ej-server-1' }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }),
  );
}

function failedPatches() {
  return fetchCalls.filter(
    (c) =>
      c.url.includes('/api/export-jobs/ej-server-1') &&
      c.init.method === 'PATCH' &&
      (JSON.parse(c.init.body || '{}') as { status?: string }).status === 'failed',
  );
}

function hangUntilAbort(): void {
  mockEncode.mockImplementation(
    (opts) =>
      new Promise<never>((_, reject) => {
        opts.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      }),
  );
}

const master: MasterRecording = {
  id: 'master-1',
  blob: new Blob(['x'], { type: 'video/webm' }),
  url: 'blob:http://localhost/master-1',
  mimeType: 'video/webm',
  extension: 'webm',
  duration: 5,
  hasAudio: false,
  sourceWidth: 1920,
  sourceHeight: 1080,
  createdAt: new Date().toISOString(),
};

describe('server job finalization on export failure', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:http://localhost/preview'),
      revokeObjectURL: vi.fn(),
    });
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function startHangingExport() {
    const utils = renderHook(() => useExportPipeline());
    act(() => {
      utils.result.current.selectPlatform('youtube-landscape', 1920, 1080);
    });
    let promise: Promise<ExportJob> | undefined;
    act(() => {
      promise = utils.result.current.startExport(master);
    });
    await waitFor(() => {
      expect(utils.result.current.exportJobs[0]?.serverJobId).toBe('ej-server-1');
    });
    return { utils, promise: promise! };
  }

  it('failed encode reports the server job as failed with a live signal', async () => {
    const { result } = renderHook(() => useExportPipeline());
    act(() => {
      result.current.selectPlatform('youtube-landscape', 1920, 1080);
    });
    mockEncode.mockRejectedValueOnce(new Error('encode boom'));
    let job: ExportJob | undefined;
    await act(async () => {
      job = await result.current.startExport(master);
    });
    expect(job?.status).toBe('error');
    const patches = failedPatches();
    expect(patches.length).toBeGreaterThanOrEqual(1);
    // The terminal PATCH must not ride the aborted export signal.
    for (const p of patches) {
      expect(p.init.signal?.aborted).toBe(false);
    }
  });

  it('cancelled export reports the server job as failed', async () => {
    hangUntilAbort();
    const { utils, promise } = await startHangingExport();
    const jobId = utils.result.current.exportJobs[0].id;
    act(() => {
      utils.result.current.cancelExport(jobId);
    });
    await act(async () => {
      await promise;
    });
    expect(failedPatches().length).toBeGreaterThanOrEqual(1);
  });

  it('unmount during export reports the server job as failed', async () => {
    hangUntilAbort();
    const { utils } = await startHangingExport();
    utils.unmount();
    await waitFor(() => {
      expect(failedPatches().length).toBeGreaterThanOrEqual(1);
    });
  });
});
