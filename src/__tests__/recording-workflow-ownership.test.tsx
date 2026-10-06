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
  // The Workflow B mark (`sxs-master-origin`) and the New Video latch live in
  // sessionStorage and persist across tests in this file. Each test models a
  // fresh document, so leftovers must not decide another test's origin.
  window.sessionStorage.clear();
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

  it('a take recorded in this session is never a library original', async () => {
    const { result } = renderHook(() => useMasterRecording());

    act(() => {
      result.current.createMasterRecording(TAKE_A, 6.4, true, 1920, 1080);
    });
    expect(
      result.current.isLibraryOriginal,
      "Workflow A's take is the session's own — discardable, not protected",
    ).toBe(false);

    // A document hop restores it as an ordinary take: still not a library
    // original, so "Record Again" after a reload keeps deleting it.
    const reloaded = renderHook(() => useMasterRecording());
    await act(async () => {
      await reloaded.result.current.restoreMasterRecording();
    });
    expect(reloaded.result.current.masterRecording, 'the take waits after the hop').toBeTruthy();
    expect(reloaded.result.current.isLibraryOriginal).toBe(false);
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

  it('marks the opened take as a library original, and the mark survives a reload', async () => {
    await db.save(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    const { result } = renderHook(() => useMasterRecording());

    act(() => {
      result.current.openStoredRecording(storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'));
    });
    expect(
      result.current.isLibraryOriginal,
      'an opened library row is not this session’s to delete',
    ).toBe(true);

    // A document hop (reload / OAuth / payment return) keeps the mark, so the
    // discard decision on the far side still protects the row.
    const reloaded = renderHook(() => useMasterRecording());
    await act(async () => {
      await reloaded.result.current.restoreMasterRecording();
    });
    expect(reloaded.result.current.masterRecording?.id).toBe('master-A');
    expect(reloaded.result.current.isLibraryOriginal, 'the mark crosses the document hop').toBe(true);

    // The mark is about the ACTIVE take only: New Video detaches from it.
    act(() => reloaded.result.current.releaseMasterRecording());
    expect(reloaded.result.current.isLibraryOriginal, 'New Video ends the marked session').toBe(false);
    expect(rowIds(), 'detaching never deletes the original').toEqual(['master-A']);
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
 * TEST 8 — script snapshot (FC-1.0 DC-1, Phase 1 item 7).
 *
 * The script is stored PER VIDEO: captured when the master is created,
 * carried on the row, and displayed again whenever that video is opened or
 * restored. New Video starts empty; draft edits live only in the editor's
 * own draft area and never reach the saved snapshot.
 * ------------------------------------------------------------------ */
describe('TEST 8 — each video keeps its own script snapshot', () => {
  it('creating a master snapshots the script onto its row, and a reload restores it', async () => {
    const { result } = renderHook(() => useMasterRecording());

    let created: MasterRecording | null = null;
    await act(async () => {
      created = result.current.createMasterRecording(TAKE_A, 6, true, 1920, 1080, 'script for video A');
    });

    expect(created!.script).toBe('script for video A');
    expect(
      (db.rows.get(created!.id) as { script?: string }).script,
      'the row is the snapshot\'s permanent home',
    ).toBe('script for video A');

    // Model a document hop: a fresh hook over the same store restores the
    // take WITH its snapshot — this is "reload → script restored".
    const reload = renderHook(() => useMasterRecording());
    await act(async () => {
      await reload.result.current.restoreMasterRecording();
    });
    expect(reload.result.current.masterRecording?.id).toBe(created!.id);
    expect(
      reload.result.current.masterRecording?.script,
      'the restored take must come back with its script',
    ).toBe('script for video A');
    expect(rowCount(), 'restore saves nothing').toBe(1);
  });

  it('opening a library video displays its saved script', async () => {
    await db.save({
      ...storedRow('master-A', TAKE_A, '2026-01-01T00:00:00.000Z'),
      script: 'the original script',
    } as StoredRecording);
    const { result } = renderHook(() => useMasterRecording());

    await act(async () => {
      await result.current.openStoredRecording(db.rows.get('master-A') as StoredRecording);
    });

    expect(result.current.masterRecording?.id).toBe('master-A');
    expect(result.current.masterRecording?.script).toBe('the original script');
  });

  it('draft edits after recording do not mutate the saved snapshot', async () => {
    const { result } = renderHook(() => useMasterRecording());

    let created: MasterRecording | null = null;
    await act(async () => {
      created = result.current.createMasterRecording(TAKE_B, 4, true, 1280, 720, 'take one script');
    });

    // The global editor only ever writes its own draft area (localStorage).
    window.localStorage.setItem('sxs-studio-script', 'draft v2 — edited after recording');
    try {
      expect(
        (db.rows.get(created!.id) as { script?: string }).script,
        'the stored snapshot must be untouched by editor edits',
      ).toBe('take one script');
      expect(created!.script).toBe('take one script');

      // Reopening the same take shows the SNAPSHOT, not the later draft.
      const reopen = renderHook(() => useMasterRecording());
      await act(async () => {
        await reopen.result.current.openStoredRecording(db.rows.get(created!.id) as StoredRecording);
      });
      expect(reopen.result.current.masterRecording?.script).toBe('take one script');
    } finally {
      window.localStorage.removeItem('sxs-studio-script');
    }
  });

  it('a legacy row without a snapshot opens without inventing one', async () => {
    // Rows written before this contract have no `script` field. Opening one
    // must leave the script undefined so the editor keeps its draft instead
    // of being force-cleared.
    await db.save(storedRow('master-legacy', TAKE_A, '2026-01-01T00:00:00.000Z'));
    const { result } = renderHook(() => useMasterRecording());

    await act(async () => {
      await result.current.openStoredRecording(db.rows.get('master-legacy') as StoredRecording);
    });

    expect(result.current.masterRecording?.script).toBeUndefined();
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
    expect(newVideo, 'DC-1: New Video starts with an empty script').toContain('scriptStorage.clearScript');
  });

  it('the desktop rail routes its studio entry through the New Video transition', () => {
    // The IconRail button is explicitly LABELED "New Video" — it promises
    // the reset and must keep running it.
    const panelChange = handler('handlePanelChange');
    expect(panelChange).toContain('handleNewVideo');
  });

  it('the compact "Studio" tab is a pure panel switch (DC-3)', () => {
    // BottomNav's Studio tab is navigation: tapping it used to run the full
    // session reset, silently creating a New Video (clearing the recording,
    // releasing the master) as a side effect of switching panels.
    const compactNav = handler('handleCompactNav');
    expect(compactNav, 'the compact tab only switches panels').toContain('setActivePanel(panel)');
    expect(compactNav, 'the compact tab never starts a new workflow').not.toContain('handleNewVideo');
    expect(compactNav, 'the compact tab never clears a recording').not.toContain('resetRecording');
    expect(compactNav, 'the compact tab never releases the master').not.toContain('releaseMasterRecording');
    expect(compactNav, 'the compact tab never deletes anything').not.toContain('clearMasterRecording');

    // The reset stays reachable on compact layouts — through a control
    // explicitly LABELED "New Video", wired to the same transition.
    expect(source, 'BottomNav must carry the explicit New Video action').toContain(
      'onNewVideo={handleNewVideo}',
    );
    expect(source, 'BottomNav must not receive the reset via the panel switch').toContain(
      'onPanelChange={handleCompactNav}',
    );
  });

  it('capturing a take snapshots the current script into the master (DC-1)', () => {
    // Completion captures the editor's script and passes it into the master,
    // which persists it on the row.
    expect(source, 'completion must capture the script snapshot').toContain('scriptSnapshot');
    expect(source, 'both probe paths must carry the snapshot').toMatch(
      /createMasterRecording\(\s*result\.blob,\s*mediaDuration,[\s\S]{0,200}?scriptSnapshot/,
    );
    expect(source).toMatch(
      /createMasterRecording\(\s*result\.blob,\s*result\.duration,[\s\S]{0,200}?scriptSnapshot/,
    );
    // Attaching any master (completion, library open, reload restore) loads
    // its snapshot back into the editor; draft-only edits do nothing here.
    expect(source, 'the attached take\'s snapshot must drive the editor').toContain(
      'applyMasterScriptSnapshot(masterRecordingData.script)',
    );
  });

  it('start passes the countdown setting and the script-end announcement (items 2 + 8)', () => {
    const start = handler('handleRecordStart');
    expect(start, 'countdown follows the user setting').toContain('countdown: settings.countdownEnabled');
    expect(start, 'the teleprompter end-stop announces itself with FC copy').toContain(
      "showToast('Script ended — recording stopped')",
    );
    expect(start, 'the callback must be the recorder option, not a stray call').toContain('onScriptEnd:');
  });

  it('opening a library recording adopts the stored master instead of creating one', () => {
    expect(source, 'the studio page must not create a master from a library row').not.toMatch(
      /onExportRecording=\{\(recording\) => \{[^}]*createMasterRecording/,
    );
    expect(source).toContain('openStoredRecording(recording)');
  });

  it('"Record Again" protects a library original and confirms the discard it does make', () => {
    const practiceAgain = handler('handlePracticeAgain');
    // Workflow B: the take is a library original — detach via the New Video
    // transition, never through the delete path.
    expect(practiceAgain, 'the discard decision must branch on the origin').toContain('isLibraryOriginal');
    expect(practiceAgain, 'Workflow B must route through the New Video transition').toContain('handleNewVideo');
    // Workflow A: the only branch allowed to delete says so before destroying
    // the single copy of the bytes.
    expect(practiceAgain, 'the delete branch must be confirmed, not silent').toContain('window.confirm');
    expect(practiceAgain).toContain('clearMasterRecording');
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
