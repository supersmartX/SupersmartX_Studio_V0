import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ExportModal } from '@/components/dialogs/ExportModal';
import { PostDownloadEngagement } from '@/components/dialogs/PostDownloadEngagement';
import { DISCORD_COMMUNITY_URL } from '@/constants';
import type { ExportConfig, ExportJob, MasterRecording } from '@/types';

/**
 * The engagement popup is allowed to appear only after the browser has been
 * handed the file, must not appear twice inside the frequency window, and must
 * never ask a paid user to upgrade to the plan they already hold.
 */

const EXPORT_CONFIG = {
  platformId: 'youtube-landscape',
  aspectRatio: '16:9',
  outputWidth: 1280,
  outputHeight: 720,
  crop: { x: 0, y: 0, width: 1280, height: 720 },
} as unknown as ExportConfig;

const MASTER = {
  id: 'master-1',
  blob: new Blob(['video'], { type: 'video/mp4' }),
  url: 'blob:master-1',
  mimeType: 'video/mp4',
  extension: 'mp4',
  duration: 6,
  hasAudio: true,
  sourceWidth: 1920,
  sourceHeight: 1080,
  createdAt: new Date().toISOString(),
} as MasterRecording;

const HEADING = 'Keep creating with SupersmartX';

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PostDownloadEngagement', () => {
  it('offers the community and the existing upgrade flow to Free users', () => {
    const onExploreCreator = vi.fn();
    const onClose = vi.fn();
    render(
      <PostDownloadEngagement
        isOpen
        onClose={onClose}
        isCreator={false}
        onExploreCreator={onExploreCreator}
        onOpenLibrary={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: HEADING });
    const discord = within(dialog).getByRole('link', { name: /Join Discord/ });
    expect(discord).toHaveAttribute('href', DISCORD_COMMUNITY_URL);
    expect(discord).toHaveAttribute('target', '_blank');
    expect(discord.getAttribute('rel')).toContain('noopener');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Explore Creator Pro' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onExploreCreator).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByRole('button', { name: 'Open My Library' })).toBeNull();
  });

  it('does not offer an upgrade to a paid user, and offers a useful action instead', () => {
    const onOpenLibrary = vi.fn();
    const onClose = vi.fn();
    render(
      <PostDownloadEngagement
        isOpen
        onClose={onClose}
        isCreator
        onExploreCreator={vi.fn()}
        onOpenLibrary={onOpenLibrary}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: HEADING });
    expect(within(dialog).getByRole('link', { name: /Join Discord/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Explore Creator Pro' })).toBeNull();
    expect(within(dialog).getByText(/Your Creator Pro tools are unlocked/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open My Library' }));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the popup and dismisses with Escape', async () => {
    const onClose = vi.fn();
    render(
      <PostDownloadEngagement
        isOpen
        onClose={onClose}
        isCreator={false}
        onExploreCreator={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: HEADING });
    expect(document.activeElement).toBe(within(dialog).getByRole('link', { name: /Join Discord/ }));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('ExportModal post-download gating', () => {
  function renderModal(overrides: Partial<ComponentProps<typeof ExportModal>> = {}) {
    const props: ComponentProps<typeof ExportModal> = {
      isVisible: true,
      masterRecording: MASTER,
      onClose: vi.fn(),
      onPracticeAgain: vi.fn(),
      onOpenLibrary: vi.fn(),
      onShare: vi.fn(),
      showToast: vi.fn(),
      isAuthenticated: true,
      userPlan: 'free',
      onAuthRequired: vi.fn(),
      onDownloadLimitReached: vi.fn(),
      exportConfig: EXPORT_CONFIG,
      onSelectPlatform: vi.fn(() => EXPORT_CONFIG),
      onStartExport: vi.fn(async () => ({
        id: 'job-1',
        masterId: 'master-1',
        config: EXPORT_CONFIG,
        status: 'done',
        resultBlob: new Blob(['file'], { type: 'video/mp4' }),
      }) as ExportJob),
      ...overrides,
    };
    render(<ExportModal {...props} />);
    return props;
  }

  async function exportAndDownload() {
    fireEvent.click(screen.getByRole('button', { name: /^Export YouTube/ }));
    const download = await screen.findByRole('button', { name: 'Download Video' });
    fireEvent.click(download);
    return download;
  }

  it('opens the popup only after a successful local download', async () => {
    const props = renderModal();
    expect(screen.queryByRole('dialog', { name: HEADING })).toBeNull();

    await exportAndDownload();

    const popup = await screen.findByRole('dialog', { name: HEADING });
    expect(within(popup).getByRole('link', { name: /Join Discord/ })).toBeInTheDocument();
    expect(props.showToast).toHaveBeenCalledWith(expect.stringContaining('Downloaded:'));
  });

  it('keeps the export sheet open when the popup is dismissed', async () => {
    const props = renderModal();
    await exportAndDownload();

    await screen.findByRole('dialog', { name: HEADING });
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: HEADING })).toBeNull());
    // The nested popup owns Escape; the export sheet underneath must survive.
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Export recording' })).toBeInTheDocument();
  });

  it('does not open the popup when the server download fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Plan has expired' }) }) as unknown as Response),
    );
    const props = renderModal({
      onStartExport: vi.fn(async () => ({
        id: 'job-1',
        masterId: 'master-1',
        config: EXPORT_CONFIG,
        status: 'done',
        exportId: 'export-1',
      }) as ExportJob),
    });

    await exportAndDownload();

    await waitFor(() => expect(props.showToast).toHaveBeenCalledWith('Plan has expired'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: HEADING })).toBeNull());
  });

  it('does not open the popup when a guest is asked to sign in', async () => {
    const props = renderModal({
      isAuthenticated: false,
      onStartExport: vi.fn(async () => ({
        id: 'job-1',
        masterId: 'master-1',
        config: EXPORT_CONFIG,
        status: 'done',
        exportId: 'export-1',
      }) as ExportJob),
    });

    await exportAndDownload();

    await waitFor(() => expect(props.onAuthRequired).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: HEADING })).toBeNull();
  });

  it('respects the frequency cap on a later download', async () => {
    window.localStorage.setItem('sxs-post-download-engagement', JSON.stringify({ lastShownAt: Date.now() }));
    const props = renderModal();

    await exportAndDownload();

    await waitFor(() => expect(props.showToast).toHaveBeenCalledWith(expect.stringContaining('Downloaded:')));
    expect(screen.queryByRole('dialog', { name: HEADING })).toBeNull();
  });

  it('shows its own Creator actions to a paid user', async () => {
    const props = renderModal({ userPlan: 'creator_monthly' });
    await exportAndDownload();

    const popup = await screen.findByRole('dialog', { name: HEADING });
    expect(within(popup).queryByRole('button', { name: 'Explore Creator Pro' })).toBeNull();
    fireEvent.click(within(popup).getByRole('button', { name: 'Open My Library' }));
    expect(props.onOpenLibrary).toHaveBeenCalledTimes(1);
  });
});
