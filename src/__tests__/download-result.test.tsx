import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { classifyDownloadResponse } from '@/components/studio/LibraryPanel';
import { RecordingsPanel } from '@/components/studio/LibraryPanel';
import { middleware } from '@/middleware';

vi.mock('@/lib/recording-store', () => ({
  getAllRecordings: vi.fn(async () => []),
  deleteRecording: vi.fn(async () => {}),
  renameRecording: vi.fn(async () => {}),
}));

vi.mock('@/lib/local-exports-store', () => ({
  getAllLocalExports: vi.fn(async () => []),
  deleteLocalExport: vi.fn(async () => {}),
}));

const CLOUD_EXPORT = {
  id: 'export-1',
  r2Key: 'exports/user-1/export-1.mp4',
  platform: 'youtube-landscape',
  outputWidth: 1280,
  outputHeight: 720,
  fileSize: 1024 * 1024,
  createdAt: new Date().toISOString(),
  status: 'completed',
};

function stubFetch(downloadHandler: () => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/api/download')) {
        const { status, body } = downloadHandler();
        return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
      }
      if (url.includes('/api/exports')) {
        return { ok: true, status: 200, json: async () => ({ exports: [CLOUD_EXPORT] }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }),
  );
}

describe('classifyDownloadResponse', () => {
  it('200 with url downloads', () => {
    expect(classifyDownloadResponse(200, { url: 'https://cdn.test/x.mp4' }))
      .toEqual({ kind: 'download', url: 'https://cdn.test/x.mp4' });
  });

  it('200 without url is an error, never a silent success', () => {
    const outcome = classifyDownloadResponse(200, {});
    expect(outcome.kind).toBe('error');
  });

  it('401 (missing, expired, or revoked session) becomes reauth', () => {
    expect(classifyDownloadResponse(401, { error: 'Unauthorized' })).toEqual({ kind: 'reauth' });
    expect(classifyDownloadResponse(401, { error: 'User not found' })).toEqual({ kind: 'reauth' });
    expect(classifyDownloadResponse(401, {})).toEqual({ kind: 'reauth' });
  });

  it('403/404/429/500 surface the server message', () => {
    expect(classifyDownloadResponse(403, { error: 'Plan has expired' }))
      .toEqual({ kind: 'error', message: 'Plan has expired' });
    expect(classifyDownloadResponse(404, { error: 'Export not found' }))
      .toEqual({ kind: 'error', message: 'Export not found' });
    expect(classifyDownloadResponse(429, {}))
      .toEqual({ kind: 'error', message: 'Download failed. Please try again.' });
    expect(classifyDownloadResponse(500, { error: 42 }))
      .toEqual({ kind: 'error', message: 'Download failed. Please try again.' });
  });
});

describe('RecordingsPanel cloud download', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function renderPanel(downloadHandler: () => { status: number; body: unknown }, onAuthRequired: () => void) {
    stubFetch(downloadHandler);
    render(
      <RecordingsPanel
        isAuthenticated
        userPlan="creator_monthly"
        onAuthRequired={onAuthRequired}
      />,
    );
    const buttons = await screen.findAllByRole('button', { name: 'Download' });
    fireEvent.click(buttons[0]);
  }

  it('401 shows a session-expired message and triggers sign-in (never silent)', async () => {
    const onAuthRequired = vi.fn();
    await renderPanel(() => ({ status: 401, body: { error: 'Unauthorized' } }), onAuthRequired);
    await screen.findByText('Your session expired. Sign in again to download.');
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it('403 shows the server message without sign-in prompt', async () => {
    const onAuthRequired = vi.fn();
    await renderPanel(() => ({ status: 403, body: { error: 'Plan has expired' } }), onAuthRequired);
    await screen.findByText('Plan has expired');
    expect(onAuthRequired).not.toHaveBeenCalled();
  });

  it('200 triggers the download without any error text', async () => {
    const onAuthRequired = vi.fn();
    await renderPanel(() => ({ status: 200, body: { url: 'https://cdn.test/x.mp4', expiresIn: 3600 } }), onAuthRequired);
    await waitFor(() => {
      expect(screen.queryByText('Your session expired. Sign in again to download.')).toBeNull();
      expect(screen.queryByText('Download failed. Please try again.')).toBeNull();
    });
    expect(onAuthRequired).not.toHaveBeenCalled();
  });
});

describe('download middleware boundary', () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'test-secret-that-is-long-enough-32';
  });

  it('missing session cookie yields 401 Unauthorized (never User not found)', async () => {
    const res = await middleware(new NextRequest('http://localhost/api/download?exportId=export-1'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('undecodable cookie (expired or forged shape) yields the same 401', async () => {
    const req = new NextRequest('http://localhost/api/download?exportId=export-1', {
      headers: { cookie: 'next-auth.session-token=deleted-or-garbage' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });
});
