/**
 * Workflow ownership: "create a new video" vs "work with an existing one".
 *
 * The studio has two workflows and they must never share the wrong transition:
 *
 *   A. CREATE NEW VIDEO  New Video -> script -> prepare -> record -> review -> export
 *   B. EXISTING VIDEO    Library -> select -> preview -> choose platform -> export
 *
 * Two defects collapsed them into one. "New Video" only switched panels, so the
 * previous take (and its review, platform and export state) survived the click.
 * And opening a library recording ran through `createMasterRecording`, which
 * mints a fresh `master-<ts>-<rand>` id AND re-saves the row — so every open
 * forked the master into a second, identical library item.
 *
 * These tests drive the real hook and the real LibraryPanel against an
 * in-memory recording store, so "the library contains exactly one recording" is
 * a genuine row count rather than a mock's opinion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { isPlatformLockedForUser, isCreatorPlan, getEntitlements } from '@/lib/entitlements';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import type { StoredRecording } from '@/lib/recording-store';
import type { MasterRecording, PlatformId } from '@/types';

/* A real, Map-backed stand-in for the IndexedDB `recordings` store. Row counts
 * and ids are the assertions that matter, so a spy would assert nothing. */
const { db } = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  return {
    db: {
      rows,
      reset: () => rows.clear(),
      save: async (recording: { id: string }) => {
        rows.set(recording.id, recording);
      },
      remove: async (id: string) => {
        rows.delete(id);
      },
      all: async () =>
        [...rows.values()].sort(
          (a, b) => new Date((b as { createdAt: string }).createdAt).getTime() - new Date((a as { createdAt: string }).createdAt).getTime(),
        ),
      latest: async () => {
        const sorted = await db.all();
        return (sorted[0] as { id: string; blob: Blob } | undefined) ?? null;
      },
    },
  };
});

vi.mock('@/lib/recording-store', () => ({
  saveRecording: (recording: { id: string }) => db.save(recording),
  deleteRecording: (id: string) => db.remove(id),
  getAllRecordings: () => db.all(),
  getLatestRecording: () => db.latest(),
  cleanupExpired: async () => 0,
  getRecording: async (id: string) => (db.rows.get(id) as { id: string } | undefined) ?? null,
  renameRecording: async () => {},
}));

vi.mock('@/lib/local-exports-store', () => ({
  getAllLocalExports: async () => [],
  deleteLocalExport: async () => {},
  saveLocalExport: async () => {},
  cleanupExpiredLocalExports: async () => 0,
}));

import { useMasterRecording } from '@/hooks/useMasterRecording';
import { RecordingsPanel } from '@/components/studio/LibraryPanel';

const TAKE_A = new Blob(['take-a-bytes'], { type: 'video/webm' });
const TAKE_B = new Blob(['take-b-bytes'], { type: 'video/webm' });

function storedRow(id: string, blob: Blob, createdAt: string, name = ''): StoredRecording {
  return {
    id,
    name,
    blob,
    mimeType: 'video/webm',
    extension: 'webm',
    duration: 6.4,
    hasAudio: true,
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    createdAt,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function rowCount(): number {
  return db.rows.size;
}

function rowIds(): string[] {
  return [...db.rows.keys()].sort();
}

// jsdom implements neither static. They are installed once for the whole file
// rather than per-test, because React's unmount cleanup revokes blob URLs after
// the per-test teardown has already run — replacing the whole `URL` constructor
// is avoided so its other statics stay intact.
const RealURL = globalThis.URL;
let objectUrlSeq = 0;
RealURL.createObjectURL = vi.fn(() => `blob:http://localhost/obj-${(objectUrlSeq += 1)}`);
RealURL.revokeObjectURL = vi.fn();

beforeEach(() => {
  db.reset();
  // fetch is only reached by the cloud-exports list, which needs auth.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ exports: [] }) })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ *
 * TEST 1 — Record A → Library contains A → New Video → clean session
 *          → A remains ONLY in the library.
 * ------------------------------------------------------------------ */
describe('TEST 1 — "New Video" starts a clean session and keeps A in the library', () => {
  it('detaches the take without deleting it, and blocks any late restore', async () => {
    const { result } = renderHook(() => useMasterRecording());

    // Record A.
    let masterId = '';
    act(() => {
      const created = result.current.createMasterRecording(TAKE_A, 6.4, true, 1920, 1080);
      masterId = created.id;
    });
    expect(rowCount()).toBe(1);
    expect(result.current.masterRecording?.id).toBe(masterId);

    // New Video.
    act(() => result.current.releaseMasterRecording());

    // A is untouched in the library, and NOT the active recording.
    expect(rowCount()).toBe(1);
    expect(rowIds()).toEqual([masterId]);
    expect(result.current.masterRecording).toBeNull();
    expect(result.current.isRestored).toBe(false);

    // A restore already in flight must not drag A back into the new session.
    await act(async () => {
      const restored = await result.current.restoreMasterRecording();
      expect(restored).toBe(false);
    });
    expect(result.current.masterRecording).toBeNull();
    expect(rowCount()).toBe(1);
  });

  it('release is NOT the discard: only a held take is destroyed by clearMasterRecording', () => {
    const { result } = renderHook(() => useMasterRecording());
    let idA = '';
    act(() => {
      idA = result.current.createMasterRecording(TAKE_A, 6.4, true, 1920, 1080).id;
    });

    act(() => result.current.releaseMasterRecording());
    expect(rowIds(), 'New Video must never delete a library recording').toEqual([idA]);

    // Recording B holds a take again; the explicit discard takes B only.
    let idB = '';
    act(() => {
      idB = result.current.createMasterRecording(TAKE_B, 3.1, true, 1920, 1080).id;
    });
    act(() => result.current.clearMasterRecording());

    expect(rowIds(), 'the discard destroys the held take and nothing else').toEqual([idA]);
    expect(rowIds()).not.toContain(idB);
    expect(result.current.masterRecording).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * TEST 2 — Record A → Library → open A → Export → another platform
 *          → no new library recording.
 * ------------------------------------------------------------------ */
describe('TEST 2 — exporting an existing recording adds nothing to the library', () => {
  it('adopts the stored row and never writes a second one', async () => {
    await db.save(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    const { result } = renderHook(() => useMasterRecording());

    let opened: MasterRecording | null = null;
    act(() => {
      opened = result.current.openStoredRecording(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    });

    expect(opened!.id).toBe('master-A');
    expect(result.current.masterRecording?.id, 'the active master IS the library row').toBe('master-A');
    expect(rowCount(), 'opening must not save anything').toBe(1);
    expect(rowIds()).toEqual(['master-A']);
    // It came out of storage, so it reviews exactly like a restored take.
    expect(result.current.isRestored).toBe(true);
  });

  it('repeating the open leaves one row and one identity', async () => {
    await db.save(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    const { result } = renderHook(() => useMasterRecording());

    act(() => { result.current.openStoredRecording(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z')); });
    act(() => { result.current.openStoredRecording(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z')); });
    act(() => { result.current.openStoredRecording(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z')); });

    expect(rowCount()).toBe(1);
    expect(result.current.masterRecording?.id).toBe('master-A');
  });
});

/* ------------------------------------------------------------------ *
 * TEST 3 / TEST 4 — Change Platform and repeated exports operate on the
 *          SAME master; library keeps exactly one recording.
 * ------------------------------------------------------------------ */
describe('TEST 3 & 4 — changing platform never forks the master', () => {
  /** Drives the real LibraryPanel with platform state owned by the Studio. */
  function LibraryHarness({ onMaster }: { onMaster: (id: string | undefined) => void }) {
    const master = useMasterRecording();
    const [platformId, setPlatformId] = useState<PlatformId | undefined>(undefined);

    onMaster(master.masterRecording?.id);

    return (
      <RecordingsPanel
        isAuthenticated={false}
        userPlan="creator_monthly"
        previewPlatformId={platformId}
        onPreviewPlatformChange={setPlatformId}
        onExportRecording={(recording) => master.openStoredRecording(recording)}
      />
    );
  }

  it('Library → open A → Export → change platform keeps the same master id', async () => {
    await db.save(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    let masterId: string | undefined;
    render(<LibraryHarness onMaster={(id) => { masterId = id; }} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Export video/i })).toBeInTheDocument());

    // Library → open existing recording.
    fireEvent.click(screen.getByRole('button', { name: /Preview video/i }));
    await waitFor(() => expect(screen.getByText('Existing video')).toBeInTheDocument());

    // Change Platform, then pick a different one.
    fireEvent.click(screen.getByRole('button', { name: 'Change Platform' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /TikTok/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /TikTok/ }));

    expect(rowCount(), 'previewing another platform must not create a recording').toBe(1);

    // Export the existing recording.
    fireEvent.click(screen.getByRole('button', { name: /Export video/i }));
    await waitFor(() => expect(masterId).toBe('master-A'));

    expect(rowIds(), 'exporting an existing recording must not duplicate it').toEqual(['master-A']);
    expect(rowCount()).toBe(1);
  });

  it('YouTube then TikTok exports leave one master recording, not duplicates', async () => {
    await db.save(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    let masterId: string | undefined;
    render(<LibraryHarness onMaster={(id) => { masterId = id; }} />);

    const exportButton = await screen.findByRole('button', { name: /Export video/i });

    // Export #1 — YouTube (the default target).
    fireEvent.click(exportButton);
    await waitFor(() => expect(masterId).toBe('master-A'));

    // Change to TikTok and export again.
    fireEvent.click(screen.getByRole('button', { name: /Preview video/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Platform' }));
    fireEvent.click(await screen.findByRole('button', { name: /TikTok/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export video/i }));

    await waitFor(() => expect(masterId).toBe('master-A'));
    expect(rowCount(), 'two platform exports must not mean two recordings').toBe(1);
    expect(rowIds()).toEqual(['master-A']);
  });
});

/* ------------------------------------------------------------------ *
 * TEST 5 — New Video after A exists → record B → library holds A and B.
 * ------------------------------------------------------------------ */
describe('TEST 5 — recording B after New Video yields two separate recordings', () => {
  it('A and B coexist as distinct masters', async () => {
    const { result } = renderHook(() => useMasterRecording());

    let idA = '';
    act(() => { idA = result.current.createMasterRecording(TAKE_A, 6.4, true, 1920, 1080).id; });

    // New Video, then record B.
    act(() => result.current.releaseMasterRecording());
    let idB = '';
    act(() => { idB = result.current.createMasterRecording(TAKE_B, 3.1, true, 1920, 1080).id; });

    expect(idB).not.toBe(idA);
    expect(rowCount()).toBe(2);
    expect(rowIds().sort()).toEqual([idA, idB].sort());
    expect(result.current.masterRecording?.id, 'only the new take is active').toBe(idB);
    expect(result.current.isRestored).toBe(false);

    // A is still openable on its own original identity.
    act(() => { result.current.openStoredRecording(storedRow(idA, TAKE_A, '2026-01-01T00:00:00.000Z')); });
    expect(result.current.masterRecording?.id).toBe(idA);
    expect(rowCount(), 'opening A must not disturb B').toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * TEST 6 — Free/Creator entitlement and platform locks still hold, and
 *          working with an existing recording does not bypass them.
 * ------------------------------------------------------------------ */
describe('TEST 6 — Free/Creator platform locks are unchanged', () => {
  it('still locks every non-YouTube format for Free', () => {
    for (const preset of LAUNCH_PLATFORM_PRESETS) {
      const locked = isPlatformLockedForUser(preset.id, 'free');
      expect(locked, `${preset.label} must be Creator-only on Free`).toBe(preset.id !== 'youtube-landscape');
    }
    for (const preset of LAUNCH_PLATFORM_PRESETS) {
      expect(isPlatformLockedForUser(preset.id, 'creator_monthly'), `${preset.label} must be open on Creator`).toBe(false);
    }
  });

  it('keeps the plan gates the export pipeline branches on', () => {
    expect(getEntitlements('free').watermarkRequired).toBe(true);
    expect(getEntitlements('free').maxResolution).toEqual({ width: 1280, height: 720 });
    expect(getEntitlements('creator_monthly').watermarkRequired).toBe(false);
    expect(getEntitlements('creator_monthly').maxResolution).toEqual({ width: 1920, height: 1080 });
    expect(isCreatorPlan('creator_yearly')).toBe(true);
    expect(isCreatorPlan('free')).toBe(false);
  });

  it('offers the locked-format upgrade prompt from the existing-video view', async () => {
    await db.save(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    const onLockedPlatformClick = vi.fn();
    render(
      <RecordingsPanel
        isAuthenticated
        userPlan="free"
        previewPlatformId="youtube-landscape"
        onPreviewPlatformChange={vi.fn()}
        isPlatformLocked={(id) => isPlatformLockedForUser(id, 'free')}
        onLockedPlatformClick={onLockedPlatformClick}
        onExportRecording={vi.fn()}
      />,
    );

    await screen.findByRole('button', { name: /Preview video/i });
    fireEvent.click(screen.getByRole('button', { name: /Preview video/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Platform' }));

    fireEvent.click(await screen.findByRole('button', { name: /Reels/ }));
    // A locked format must never be silently selected on Free.
    expect(onLockedPlatformClick).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * TEST 7 — a reload must not turn a library recording into a new one.
 * ------------------------------------------------------------------ */
describe('TEST 7 — reloading restores identity instead of creating a session', () => {
  it('a reload restores the same id and saves nothing', async () => {
    await db.save(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    const { result } = renderHook(() => useMasterRecording());

    await act(async () => {
      await result.current.restoreMasterRecording();
    });

    expect(result.current.masterRecording?.id).toBe('master-A');
    expect(rowCount(), 'a reload must not write a new recording').toBe(1);
    expect(rowIds()).toEqual(['master-A']);
  });

  it('a reload of the newest take keeps exactly the recordings that existed', async () => {
    await db.save(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    await db.save(storedRow('master-B', TAKE_B, '2026-01-02T00:00:00.000Z'));

    const { result } = renderHook(() => useMasterRecording());
    await act(async () => {
      await result.current.restoreMasterRecording();
    });

    expect(result.current.masterRecording?.id, 'the latest take is the one under review').toBe('master-B');
    expect(rowCount()).toBe(2);
    expect(rowIds().sort()).toEqual(['master-A', 'master-B']);
  });
});

/* ------------------------------------------------------------------ *
 * The Studio page owns both transitions. Asserted on shipped source, the
 * same technique the state-machine certification already uses.
 * ------------------------------------------------------------------ */
describe('the studio page owns both transitions', () => {
  const source = readStudioPageSource();

  function handler(name: string): string {
    const body = extractHandler(source, name);
    expect(body, `${name} must exist`).toBeTruthy();
    return body!;
  }

  it('"New Video" never deletes a recording and resets the session', () => {
    const newVideo = handler('handleNewVideo');
    expect(newVideo).toContain('releaseMasterRecording');
    expect(newVideo).toContain('recorder.resetRecording');
    expect(newVideo).toContain('clearJobs');
    expect(newVideo).toContain('setExportConfig(null)');
    expect(newVideo).toContain('setPreviewPlatformId(DEFAULT_PLATFORM_ID)');
    expect(newVideo, 'New Video must not destroy a library recording').not.toContain('clearMasterRecording');
    expect(newVideo, 'New Video must not delete the stored take').not.toContain('deleteRecording');
  });

  it('both rails route the studio entry through the New Video transition', () => {
    const panelChange = handler('handlePanelChange');
    expect(panelChange).toContain('handleNewVideo');
  });

  it('opening a library recording adopts the stored master instead of creating one', () => {
    expect(source, 'the studio page must not create a master from a library row').not.toMatch(
      /onExportRecording=\{\(recording\) => \{[^}]*createMasterRecording/,
    );
    expect(source).toContain('openStoredRecording(recording)');
  });

  it('still routes the recorder completion through createMasterRecording', () => {
    // Workflow A's only producer of a new master.
    expect(source).toMatch(/recordingState !== 'completed'/);
    expect(source).toContain('createMasterRecording(');
  });
});

/* ----------------------------- test helpers ----------------------------- */

function readStudioPageSource(): string {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  return readFileSync(join(process.cwd(), 'src', 'app', 'studio', 'page.tsx'), 'utf8');
}

/** Extracts a `const name = useCallback(() => { ... }, [deps]);` body. */
function extractHandler(source: string, name: string): string | null {
  const start = source.indexOf(`const ${name} = useCallback(`);
  if (start === -1) return null;
  const arrow = source.indexOf('=> {', start);
  let depth = 0;
  for (let i = arrow + 3; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(arrow, i + 1);
    }
  }
  return null;
}
