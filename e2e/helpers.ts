import { test, expect, type Page, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { createClient, type Client } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every endpoint that reaches R2 / the export-job server, or a signed-in-only
 * download. Tests that pass through blockCloud() with zero recorded attempts
 * have proven the local path is genuinely independent of the cloud.
 */
export const CLOUD_ENDPOINTS = [
  '/api/export-jobs',
  '/api/export-upload',
  '/api/exports/presigned-put',
  '/api/exports/complete',
  '/api/exports/consume-quota',
  '/api/exports',
  '/api/download',
];

/** The launch matrix that Free is NOT entitled to. YouTube 16:9 is the only unlocked format. */
export const LOCKED_PLATFORMS = [
  { label: 'YouTube Shorts', id: 'youtube-shorts', sublabel: 'Vertical · 9:16' },
  { label: 'Reels', id: 'instagram-reels', sublabel: 'Vertical · 9:16' },
  { label: 'Instagram Square', id: 'instagram-post', sublabel: 'Square · 1:1' },
  { label: 'Instagram Portrait', id: 'instagram-portrait', sublabel: 'Portrait · 4:5' },
  { label: 'TikTok', id: 'tiktok', sublabel: 'Vertical · 9:16' },
  { label: 'LinkedIn', id: 'linkedin', sublabel: 'Vertical · 9:16' },
] as const;

/**
 * True when every named variable holds a value that could actually authenticate.
 *
 * A plain `length > 0` check is not enough. `.env.local` ships with the
 * documented placeholders (`R2_ACCOUNT_ID=your_account_id`, …) already filled
 * in, so a presence check reports the cloud as ready, the suite runs the R2
 * upload, and then blocks for the full request timeout on a presigned PUT that
 * can never be issued — a four-minute hang presented as a product failure.
 *
 * A gate that false-fails is worse than no gate, because it teaches everyone to
 * ignore it. Presence alone must never be read as readiness.
 */
export function hasRealCredentials(keys: string[], lookup: (key: string) => string): boolean {
  return keys.every((key) => {
    const value = lookup(key).trim();
    if (!value) return false;
    // Reject the shapes a placeholder or an unsubstituted template takes.
    if (/^(your|xxx|placeholder|changeme|change_me|todo|tbd|example|dummy|test[-_]?only)/i.test(value)) return false;
    if (/^<.*>$/.test(value)) return false;
    // ...xxxx... style masks, e.g. https://pub-xxxxx.r2.dev
    if (/x{3,}/i.test(value) && !/^[a-f0-9]{40,}$/i.test(value)) return false;
    if (/\{\{.*\}\}/.test(value)) return false;
    return true;
  });
}

/**
 * Presence and placeholder checks alone accept a mistyped Cloudflare account ID
 * (e.g. a 34-character value containing non-hex characters). Cloudflare's edge
 * rejects that host at the TLS handshake, so every presigned PUT fails for a
 * reason no amount of retrying can fix — and the P0 gate would happily run into
 * it. The account ID is the one R2 credential with a fixed, documented shape,
 * so it is checked here rather than left to fail at request time.
 */
export function hasRealR2Credentials(lookup: (key: string) => string): boolean {
  const keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
  if (!hasRealCredentials(keys, lookup)) return false;
  return /^[0-9a-f]{32}$/i.test(lookup('R2_ACCOUNT_ID').trim());
}

/** TransportBar's PauseIcon — the pause button carries no accessible name. */
const PAUSE_ICON = 'path[d^="M10 9v6m4-6v6"]';

/**
 * Instruments the page before any app code runs:
 *  - stashes every MediaStream the app acquires, so "camera actually stops" can
 *    be asserted on real tracks (readyState 'ended') rather than on UI state;
 *  - records every canvas fillText, so a Free watermark can be proven to have
 *    been burned into the exported frames.
 */
export async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __ssxStreams: MediaStream[];
      __ssxCanvasText: string[];
    };
    w.__ssxStreams = [];
    w.__ssxCanvasText = [];

    const md = navigator.mediaDevices;
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await original(constraints);
      w.__ssxStreams.push(stream);
      return stream;
    };

    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      this: CanvasRenderingContext2D,
      text: string,
      ...rest: unknown[]
    ) {
      w.__ssxCanvasText.push(String(text));
      return (originalFillText as (...a: unknown[]) => void).call(this, text, ...rest);
    } as typeof CanvasRenderingContext2D.prototype.fillText;
  });
}

/** Hard-fails the whole cloud/export-job surface and records every attempt. */
export async function blockCloud(page: Page): Promise<string[]> {
  const attempts: string[] = [];
  await page.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (CLOUD_ENDPOINTS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      attempts.push(`${route.request().method()} ${pathname}`);
      return route.abort('failed');
    }
    return route.continue();
  });
  return attempts;
}

export function transport(page: Page) {
  return page.getByLabel('Recording controls');
}

/** The "Preview as" platform switcher shown during review. */
export function switcher(page: Page) {
  return page.getByText('Preview as', { exact: true }).locator('..');
}

/** A Creator-locked platform button. */
export function lockedPlatform(page: Page, label: string) {
  return switcher(page).locator('button[title$="Creator plan required"]').filter({ hasText: label });
}

/** The single unlocked, currently-selected platform button. */
export function unlockedPlatform(page: Page, label: string) {
  return switcher(page).locator(`button[title="${label}"]`);
}

/** Drives the app to the point where a take can be started. */
export async function studioReady(page: Page) {
  const record = transport(page).getByRole('button', { name: 'Start Recording' });
  await record.waitFor({ state: 'visible', timeout: 90_000 });

  // Two gates can be in the way, and a reload can put up either one:
  //   - The Welcome dialog. sessionStorage survives a same-tab reload, so this
  //     reappears after `page.reload()` and its backdrop swallows every click.
  //   - InitOverlay. A fresh document has no camera at all, and this is the only
  //     control that acquires one.
  // Cold dev-server compiles can also mount the dialog late, so poll.
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  const enableCamera = page.getByRole('button', { name: 'Enable Camera & Microphone' });
  const retryCamera = page.getByRole('button', { name: 'Retry', exact: true });

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const getStarted = page.getByRole('button', { name: 'Get Started' });
    if (await getStarted.isVisible().catch(() => false)) {
      await getStarted.click({ timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    for (const ctl of [enableCamera, retryCamera]) {
      if (await ctl.isVisible().catch(() => false)) {
        await ctl.click({ timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
    const enabled = await expect(record).toBeEnabled({ timeout: 4000 }).then(() => true, () => false);
    if (!enabled) continue;

    // Enabling the button is not the same as being able to click it. The
    // dismissing overlay is still mounted (and intercepting pointer events)
    // for a few frames, so returning here makes the caller's first click fail
    // with "subtree intercepts pointer events" rather than a real assertion.
    const clear = !(await welcome.isVisible().catch(() => false)) &&
      !(await enableCamera.isVisible().catch(() => false));
    if (clear) return;
  }
  throw new Error('studio never became ready: Start Recording stayed disabled');
}

/** Clicks through the two-step Stop confirm ("Stop" → "OK?"). */
export async function stopRecording(page: Page) {
  const stop = transport(page).getByRole('button', { name: 'Stop Recording' });
  await stop.click();
  await page.waitForTimeout(200);
  await transport(page).getByRole('button', { name: 'Stop Recording' }).click();
  await stop.waitFor({ state: 'detached', timeout: 30_000 });
}

export async function pauseRecording(page: Page) {
  await transport(page).locator(`button:has(${PAUSE_ICON})`).click();
  await expect(page.getByRole('status').getByText('PAUSED', { exact: true })).toBeVisible();
}

export async function resumeRecording(page: Page) {
  await transport(page).getByRole('button', { name: 'Resume Recording' }).click();
  await expect(page.getByRole('status').getByText('REC', { exact: true })).toBeVisible();
}

export async function recordTake(page: Page, seconds = 6) {
  await studioReady(page);
  await transport(page).getByRole('button', { name: 'Start Recording' }).click();
  // 3-2-1 countdown, then the take.
  await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(seconds * 1000);
  await stopRecording(page);
  await page.getByText('Preview as', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
}

/** The take exists: review canvas is a blob, and the export entry point is live. */
export async function expectReview(page: Page) {
  await expect(page.locator('main video')).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Export recording' })).toBeVisible({ timeout: 30_000 });
}

/** Decoded dimensions + duration of a <video>, proving the blob is real media. */
export async function readVideo(el: import('@playwright/test').Locator) {
  return el.evaluate(async (v) => {
    const video = v as HTMLVideoElement;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1) return resolve();
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      setTimeout(resolve, 8000);
    });
    return { w: video.videoWidth, h: video.videoHeight, duration: video.duration };
  });
}

export async function readTimer(page: Page): Promise<string> {
  return transport(page)
    .locator('span.font-mono')
    .first()
    .innerText()
    .then((t) => t.trim());
}

/** Every track the page has acquired, and how many are still live. */
export function trackState(page: Page) {
  return page.evaluate(() => {
    const streams = (window as unknown as { __ssxStreams: MediaStream[] }).__ssxStreams;
    const tracks = streams.flatMap((s) => s.getTracks());
    return { total: tracks.length, live: tracks.filter((t) => t.readyState === 'live').length };
  });
}

export function readLocalExports(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sxs-studio', 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('local-exports')) {
      db.close();
      return [];
    }
    return new Promise<Array<{ id: string; platform: string; outputWidth: number; outputHeight: number; fileSize: number }>>(
      (resolve) => {
        const tx = db.transaction('local-exports', 'readonly');
        const all = tx.objectStore('local-exports').getAll();
        all.onsuccess = () => {
          db.close();
          resolve(
            all.result.map((r) => ({
              id: r.id,
              platform: r.platform,
              outputWidth: r.outputWidth,
              outputHeight: r.outputHeight,
              fileSize: r.fileSize,
            })),
          );
        };
        all.onerror = () => {
          db.close();
          resolve([]);
        };
      },
    );
  });
}

/**
 * The master recordings actually in the `recordings` object store.
 *
 * Read straight out of IndexedDB rather than off the Library UI, so "the
 * library contains exactly one recording" is a row count. Reading the UI would
 * let a duplicated row hide behind a card that had not finished rendering.
 */
export function readMasterRecordings(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sxs-studio', 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('recordings')) {
      db.close();
      return [];
    }
    return new Promise<Array<{ id: string; createdAt: string; size: number; duration: number }>>(
      (resolve) => {
        const tx = db.transaction('recordings', 'readonly');
        const all = tx.objectStore('recordings').getAll();
        all.onsuccess = () => {
          db.close();
          resolve(
            all.result
              .filter((r) => new Date(r.expiresAt as unknown as string) >= new Date())
              .map((r) => ({
                id: r.id,
                createdAt: r.createdAt as unknown as string,
                size: (r.blob as Blob).size,
                duration: r.duration as unknown as number,
              })),
          );
        };
      all.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  });
}

/**
 * The explicit "New Video" control — the desktop side rail's entry and the
 * compact bottom nav's entry now both carry that exact label (DC-3). The
 * compact "Studio" tab is a pure panel switch and is deliberately NOT
 * matched here: clicking it must never count as starting a new workflow.
 */
export function newVideoButton(page: Page) {
  return page.locator('nav button:visible').filter({ hasText: /^New Video$/ }).first();
}

/** The compact bottom nav's "Studio" tab — navigation only (DC-3). */
export function compactStudioTab(page: Page) {
  return page.getByRole('navigation', { name: 'Compact navigation' }).getByRole('button', { name: 'Studio' });
}

/** The Recordings panel in either rail. */
export function recordingsNav(page: Page) {
  return page.locator('nav button:visible').filter({ hasText: /^Recordings$/ }).first();
}

// ---------------------------------------------------------------------------
// Local dev database (used to mint and clean up throwaway Free accounts).
// ---------------------------------------------------------------------------

let _db: Client | null = null;
export function db(): Client {
  if (!_db) {
    const dataDir = path.resolve(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    _db = createClient({ url: `file:${path.join(dataDir, 'supersmartx.db')}` });
  }
  return _db;
}

export async function apiRegister(request: APIRequestContext, email: string) {
  const csrf = await (await request.get('/api/auth/csrf')).json();
  const res = await request.post('/api/auth/callback/credentials', {
    form: {
      csrfToken: csrf.csrfToken,
      email,
      password: 'Correct-horse-battery-staple-1',
      name: 'E2E User',
      mode: 'register',
      redirect: 'false',
      callbackUrl: '/studio',
      json: 'true',
    },
  });
  expect([200, 302]).toContain(res.status());
}

export async function dbScalar(sql: string, args: (string | number | null)[]): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db().execute({ sql, args });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

export async function cleanupTestUser(email: string): Promise<void> {
  try {
    const rows = await db().execute({ sql: `SELECT id FROM users WHERE email = ?`, args: [email.toLowerCase()] });
    for (const row of rows.rows) {
      const id = row.id as string;
      await db().execute({ sql: `DELETE FROM export_jobs WHERE user_id = ?`, args: [id] }).catch(() => {});
      await db().execute({ sql: `DELETE FROM exports WHERE user_id = ?`, args: [id] }).catch(() => {});
      await db().execute({ sql: `DELETE FROM user_stats WHERE user_id = ?`, args: [id] }).catch(() => {});
      await db().execute({ sql: `DELETE FROM users WHERE id = ?`, args: [id] }).catch(() => {});
    }
  } catch {
    /* best effort */
  }
}

export async function dismissWelcomeModal(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  const welcomeDialog = page.getByRole('dialog', { name: /welcome/i });
  if (await welcomeDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
    const dismissButton = page.getByRole('button', { name: /get started|explore|close|dismiss|skip/i }).first();
    if (await dismissButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dismissButton.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await welcomeDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

export async function dismissAllModals(page: Page) {
  const dialogs = page.getByRole('dialog');
  const count = await dialogs.count();
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

/**
 * Grants camera/microphone to the test context where Playwright supports those
 * permission names.
 *
 * Firefox has no mapping for them: requesting either aborts context creation
 * with "Unknown permission: camera", which kills the entire spec file before a
 * single test body runs — that alone accounted for every Firefox failure in CI.
 * Firefox is given fake media devices, and auto-answered prompts, through the
 * media.navigator.* prefs in playwright.config.ts instead, so there is nothing
 * to grant there.
 */
export async function grantMediaPermissions(context: BrowserContext, browserName: string): Promise<void> {
  if (browserName === 'firefox') return;
  await context.grantPermissions(['camera', 'microphone']);
}

/**
 * Opens the auth modal from the landing page and waits for it.
 *
 * Below the header breakpoint the "Log In" button only exists inside the closed
 * burger menu, so a bare getByRole('Log In') resolves to a node that never
 * becomes actionable and the click times out (this is what failed the
 * mobile-chrome / Pixel 5 project). Wait for the header to settle before
 * choosing a branch: an early isVisible check races hydration and picks wrong.
 */
export async function openAuthFromLanding(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: /supersmartx/i }).first()).toBeVisible();
  const burger = page.getByRole('button', { name: /open menu/i });
  if (await burger.isVisible().catch(() => false)) {
    await burger.click();
    await page.locator('#lsx-mobile-nav').getByRole('button', { name: 'Log In' }).click();
  } else {
    await page.getByRole('button', { name: 'Log In' }).first().click();
  }
  await expect(page.getByRole('dialog')).toBeVisible();
}

// Re-exported so specs can configure fake media devices without importing Playwright twice.
export { test, expect };
