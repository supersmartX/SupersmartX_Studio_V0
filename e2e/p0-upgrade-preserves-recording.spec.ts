/* ============================================================================
 * P0 LAUNCH GATE — "Free records → upgrades → the SAME recording must survive"
 * ============================================================================
 *
 * This is the one journey that decides whether we ship. Every arrow in the
 * scenario below is an assertion in this file. If any stage fails, we do not
 * launch — no silent skips inside the journey itself.
 *
 *   Free user
 *     → records a video
 *     → stops, lands on the review screen
 *     → does NOT record again
 *     → clicks Creator → logs in → pays
 *     → Cashfree returns → webhook/verify activates Creator
 *     → studio returns
 *     → THE SAME RECORDED VIDEO IS STILL THERE          <-- the P0 assertion
 *     → selects Instagram Reels → preview becomes 9:16
 *     → export → 1080×1920 MP4, no watermark
 *     → R2 upload → Library → Download
 *
 * Why this file is mostly hermetic, and where the seams are
 * ---------------------------------------------------------
 * The recording lives in IndexedDB (`src/lib/recording-store.ts`), NOT in React
 * state, which is the only reason it can survive the cross-document navigation
 * the payment redirect performs. So the survival assertion is measured on the
 * stored record itself (id + byte size), not on a UI string that could lie.
 *
 * Two legs cannot run without third-party credentials. Both are called out at
 * the exact point they are substituted, and both are assertions in their own
 * right so the substitution still catches regressions:
 *
 *   1. "Cashfree reports the order PAID". `/api/cashfree/verify` and
 *      `/api/cashfree/webhook` both re-fetch authoritative order state from
 *      Cashfree before touching `users.plan`, so no offline substitute exists
 *      that exercises those routes. The verified PAID outcome (the plan write)
 *      is produced directly here, exactly as `fulfillPaidOrder` would, and the
 *      surrounding journey — the real return URL, the real `?payment=success`
 *      handler, the real activation modal, the real verify request, the real
 *      session refresh — runs for real. The "authoritative state, not the
 *      return URL" contract is owned by `src/__tests__/payment-fulfillment.test.ts`.
 *
 *   2. Cloudflare R2. The tail (presigned PUT → complete → library → download)
 *      is only run when real R2 credentials are present, because
 *      `/api/exports/complete` verifies the object with a server-side
 *      `headObject` (`src/app/api/exports/complete/route.ts:87`) that cannot be
 *      satisfied by a browser-side stub. Without credentials this spec SKIPS
 *      loudly rather than passing vacuously.
 *
 * Requires the local dev database (data/supersmartx.db); skipped when a shared
 * TURSO_DATABASE_URL is configured so CI never writes test rows into shared
 * infrastructure. Uses fake camera/mic devices.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type Client } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';
import { hasRealCredentials, hasRealR2Credentials, grantMediaPermissions } from './helpers';

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  },
});

test.beforeEach(async ({ context, browserName }) => {
  await grantMediaPermissions(context, browserName);
});

/* The journey records a short take by default. Duration does not affect any
 * risk this gate covers — what matters is that the SAME blob survives — and a
 * 3-minute real encode in headless Chromium would add minutes of CI flake for
 * no additional signal. Raise it to rehearse the full scenario:
 *   P0_RECORD_SECONDS=180 npx playwright test p0-upgrade-preserves-recording
 * Note a 3-minute take is within the Free allowance: the daily recording budget
 * is 10 min and the Free teleprompter cap is 3 min per take
 * (src/lib/entitlements.ts:11,15). */
const RECORD_SECONDS = Number(process.env.P0_RECORD_SECONDS || '6');

const CREATOR_EMAIL = `p0creator${Date.now()}@example.com`;
const CREATOR_PASSWORD = 'Correct-horse-battery-staple-1';
const PLAN = 'creator_monthly';
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

/* The preset this gate pins: Reels is the vertical Creator-only format. Keep in
 * lockstep with PLATFORM_PRESETS in src/constants/index.ts:60. */
const REELS = { id: 'instagram-reels', label: 'Reels', ratio: '9:16', width: 1080, height: 1920 };

function loadEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  const full = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(full)) return out;
  for (const raw of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/* Next.js loads .env.local inside the dev server; the Playwright process never
 * sees it. Read it here so the R2 gate reflects the environment the app will
 * actually run against instead of always skipping. */
const fileEnv = { ...loadEnvFile('.env.local'), ...loadEnvFile('.env') };
function env(key: string): string {
  return (process.env[key] || fileEnv[key] || '').trim();
}

const R2_READY = hasRealR2Credentials(env);
const CASHFREE_READY = hasRealCredentials(['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY'], env);

let _db: Client | null = null;
function db(): Client {
  if (!_db) {
    const dataDir = path.resolve(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    _db = createClient({ url: `file:${path.join(dataDir, 'supersmartx.db')}` });
  }
  return _db;
}

let orderId = `sxs-${PLAN}-p0-${Date.now()}`;

async function cleanupTestData(email: string) {
  try {
    const r = await db().execute({ sql: `SELECT id FROM users WHERE email = ?`, args: [email.toLowerCase()] });
    for (const row of r.rows) {
      const id = row.id as string;
      await db().execute({ sql: `DELETE FROM export_jobs WHERE user_id = ?`, args: [id] }).catch(() => {});
      await db().execute({ sql: `DELETE FROM exports WHERE user_id = ?`, args: [id] }).catch(() => {});
      await db().execute({ sql: `DELETE FROM user_stats WHERE user_id = ?`, args: [id] }).catch(() => {});
      await db().execute({ sql: `DELETE FROM users WHERE id = ?`, args: [id] }).catch(() => {});
    }
  } catch {}
}

/* Stand in for the settled Cashfree webhook: the PAID order that activates
 * Creator. This is precisely what `fulfillPaidOrder` writes
 * (src/lib/cashfree-fulfillment.ts:126-137) once Cashfree reports PAID. The
 * pending_orders row is seeded too, so the client's own verify call finds a
 * real order instead of 404-ing. */
async function activateCreatorForCashfreePaid(email: string) {
  const r = await db().execute({ sql: `SELECT id FROM users WHERE email = ?`, args: [email.toLowerCase()] });
  const userId = r.rows[0]?.id as string | undefined;
  if (!userId) throw new Error(`no user row for ${email} — registration did not land`);

  await db().execute({
    sql: `INSERT OR REPLACE INTO pending_orders (order_id, user_id, plan, amount, currency, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    args: [orderId, userId, PLAN, 7.99, 'USD'],
  });
  await db().execute({
    sql: `UPDATE users SET plan = ?, plan_expires_at = ? WHERE id = ?`,
    args: [PLAN, FUTURE, userId],
  });
  return userId;
}

/* The recovery path for a webhook that has not landed yet: the browser's return
 * trip re-verifies the order itself. Reaching this call with the right order_id
 * is the assertion — it proves the client wires the order into verification
 * rather than trusting the return URL. Must be armed BEFORE navigating, since
 * the studio fires it on mount. */
function armVerifyRecorder(page: Page) {
  const calls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/cashfree/verify')) calls.push(req.url());
  });
  return async () => {
    await expect
      .poll(() => calls.length, { timeout: 30_000, message: 'the return trip must re-verify the order with the server' })
      .toBeGreaterThan(0);
    expect(calls[0]).toContain(`order_id=${encodeURIComponent(orderId)}`);
  };
}

/* ------------------------------------------------------------------ *
 * IndexedDB probes — the ground truth for "the same video is still there"
 * ------------------------------------------------------------------ */

type StoredRecord = { id: string; size: number; duration: number; mimeType: string; createdAt: string };

async function readRecordings(page: Page): Promise<StoredRecord[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sxs-studio');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains('recordings')) { db.close(); return []; }
    const rows = await new Promise<Array<StoredRecord & { blob: Blob }>>((resolve) => {
      const request = db.transaction('recordings', 'readonly').objectStore('recordings').getAll();
      request.onsuccess = () => resolve(request.result as Array<StoredRecord & { blob: Blob }>);
      request.onerror = () => resolve([]);
    });
    db.close();
    return rows.map((row) => ({
      id: row.id,
      size: row.blob?.size ?? 0,
      duration: row.duration,
      mimeType: row.mimeType,
      createdAt: row.createdAt,
    }));
  });
}

/* The watermark is not a separate code path — `watermarkRequired` is the flag
 * that routes an export to the local, watermarked store instead of R2
 * (src/hooks/useExportPipeline.ts:112-145). "No watermark" is therefore
 * equivalent to "nothing landed in the local-exports store". */
async function readLocalExportCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sxs-studio');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains('local-exports')) { db.close(); return 0; }
    const count = await new Promise<number>((resolve) => {
      const request = db.transaction('local-exports', 'readonly').objectStore('local-exports').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
    db.close();
    return count;
  });
}

/* A marker on `window` that cannot survive a document swap. Reading it back is
 * how we prove login did NOT navigate the user away from their take. */
async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __p0Take: string }).__p0Take = 'alive';
  });
}

async function documentIsAlive(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __p0Take?: string }).__p0Take === 'alive');
}

/* ------------------------------------------------------------------ *
 * Studio driving helpers
 * ------------------------------------------------------------------ */

async function ensureStudioReady(page: Page) {
  const recordBtn = page.getByLabel('Recording controls').getByRole('button', { name: 'Start Recording' });
  await recordBtn.waitFor({ state: 'visible', timeout: 60000 });
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (await dismissWelcomeIfPresent(page)) continue;
    try {
      await expect(recordBtn).toBeEnabled({ timeout: 8000 });
      return;
    } catch {
      // Not ready yet: the welcome modal may still be mounting.
    }
  }
  throw new Error('studio never became ready: record button stayed disabled');
}

/* A real user dismisses onboarding and carries on, so that is what this helper
 * does. It is now a no-op: `useWelcomeModal` writes a per-tab dismissal flag on
 * every close (sessionStorage, which survives the payment redirect in this same
 * tab), so onboarding can no longer stack over "You're a Creator" on the return
 * trip. Kept because a stale flag from an earlier run, or a fresh profile, must
 * not be allowed to swallow the "Continue creating" click this gate depends on.
 *
 * Returns true when a dismissal actually happened. */
async function dismissWelcomeIfPresent(page: Page): Promise<boolean> {
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  const getStarted = welcome.getByRole('button', { name: 'Get Started' });
  if (!(await getStarted.isVisible().catch(() => false))) return false;
  await getStarted.click({ timeout: 15000 });
  await welcome.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  return true;
}

const previewSwitcher = (page: Page) => page.getByText('Preview as', { exact: true }).locator('..');
const lockedIn = (page: Page) => previewSwitcher(page).locator('button[title*="Creator plan required"]');
const unlockedIn = (page: Page, label: string) => previewSwitcher(page).locator(`button[title="${label}"]`);

test.setTimeout(600_000);

test.skip(!!process.env.TURSO_DATABASE_URL, 'P0 gate needs the local dev database file; skipping against shared DB');
test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');
test.skip(!R2_READY, 'P0 gate needs real R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME) — the R2 upload → Library → Download tail cannot be faked, because /api/exports/complete verifies the object server-side with headObject');

test('P0: Free records, upgrades, and the same recording survives all the way to a downloaded 1080×1920 Reel', async ({ page }) => {
  let recorded: StoredRecord | null = null;

  try {
    /* ================================================================
     * 1. FREE USER RECORDS A VIDEO AND STOPS ON THE REVIEW SCREEN
     * ================================================================ */
    await test.step('Free user records and reaches the review screen', async () => {
      await page.goto('/studio');
      await page.waitForTimeout(3000);
      await ensureStudioReady(page);

      const controls = page.getByLabel('Recording controls');
      await controls.getByRole('button', { name: 'Start Recording' }).click();
      await page.waitForTimeout(RECORD_SECONDS * 1000);
      const stop = controls.getByRole('button', { name: 'Stop Recording' });
      await stop.click();
      await page.waitForTimeout(1000);
      await stop.click();

      // The review screen: the take is playable and exportable.
      await page.getByRole('button', { name: 'Export recording' }).waitFor({ state: 'visible', timeout: 30000 });

      // Persisted to IndexedDB, which is what has to survive everything below.
      await expect
        .poll(async () => (await readRecordings(page)).length, { timeout: 30_000 })
        .toBeGreaterThan(0);
      const [rec] = await readRecordings(page);
      recorded = rec;
      expect(rec.size, 'the take must be non-trivial bytes, not an empty blob').toBeGreaterThan(1000);

      // Free is Free: Reels is Creator-only, and no watermark-free export exists.
      await expect(lockedIn(page)).toHaveCount(6);
      await expect(unlockedIn(page, REELS.label)).toHaveCount(0);
      await markDocument(page);
    });

    /* ================================================================
     * 2. CLICKS CREATOR → LOGS IN — WITHOUT RE-RECORDING
     * ================================================================ */
    await test.step('Login happens on top of the existing take, with no navigation and no re-record', async () => {
      // Reach the upgrade prompt the way a Free user does: tap a locked format.
      await previewSwitcher(page).locator(`button[title^="${REELS.label}"]`).click();
      const upgradePrompt = page.getByRole('dialog', { name: `Create for ${REELS.label} with Creator` });
      await upgradePrompt.waitFor({ state: 'visible', timeout: 15000 });
      // The prompt is format-specific, so this is also the proof that the tap
      // registered on Reels and not on some neighbouring button.
      await expect(upgradePrompt.getByRole('heading', { name: `Create for ${REELS.label}` })).toBeVisible();
      // Guests get the consequence-bearing "Create account to purchase"; only
      // signed-in Free users get "Buy Creator access".
      await upgradePrompt.getByRole('button', { name: /^(Create account to purchase|Buy Creator access)$/ }).click();

      // Checkout demands an identity first → the real registration form.
      const authDialog = page.getByRole('dialog', { name: 'Create New Profile' });
      await authDialog.waitFor({ state: 'visible', timeout: 15000 });
      await authDialog.getByPlaceholder('John').fill('P0');
      await authDialog.getByPlaceholder('Doe').fill('User');
      await authDialog.getByPlaceholder('you@example.com').fill(CREATOR_EMAIL);
      await authDialog.getByPlaceholder('Enter password').fill(CREATOR_PASSWORD);
      await authDialog.getByRole('button', { name: 'Create Account' }).click();

      // The take must not have been discarded to get here.
      expect(await documentIsAlive(page), 'login must not navigate away — that is what would destroy the in-memory review state').toBe(true);

      const after = await readRecordings(page);
      expect(after).toHaveLength(1);
      expect(after[0].id, 'the very same recording must be in storage after login').toBe(recorded!.id);
      expect(after[0].size).toBe(recorded!.size);
    });

    /* ================================================================
     * 3. PAYS → CASHFREE RETURNS → WEBHOOK/VERIFY ACTIVATES CREATOR
     * ================================================================ */
    await test.step('Creator is on offer immediately after login', async () => {
      const pricing = page.getByRole('dialog', { name: 'Choose Plan' });
      await pricing.waitFor({ state: 'visible', timeout: 30000 });
      await expect(pricing.getByText('Creator', { exact: true }).first()).toBeVisible({ timeout: 10000 });
      // The two promises this gate goes on to hold the product to.
      await expect(pricing.getByText('1080p with no watermark')).toBeVisible();
      await expect(pricing.getByText('Cloud Library')).toBeVisible();
      await page.keyboard.press('Escape');
      await pricing.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    });

    await test.step('Cashfree returns and the plan is activated', async () => {
      if (CASHFREE_READY) {
        // Establish a real order through the real route so the order_id below is
        // genuine; Cashfree still will not mark it PAID without a real payment.
        const created = await page.request
          .post('/api/cashfree/order', {
            data: { plan: PLAN, country: 'US' },
          })
          .catch(() => null);
        if (created && created.ok()) {
          const body = (await created.json()) as { orderId?: string };
          if (typeof body.orderId === 'string' && body.orderId) orderId = body.orderId;
        }
      }

      await activateCreatorForCashfreePaid(CREATOR_EMAIL);

      // Armed before navigating: the studio fires verify on mount.
      const verifyWasCalled = armVerifyRecorder(page);

      // The real return URL the order route hands Cashfree
      // (src/app/api/cashfree/order/route.ts:70) — a genuine cross-document
      // navigation, which is exactly what destroys naive in-memory state.
      await page.goto(`/studio?payment=success&order_id=${encodeURIComponent(orderId)}&plan=${PLAN}`);
      await page.waitForTimeout(3000);

      const activated = page.getByRole('dialog', { name: 'Creator plan activated' });
      await activated.waitFor({ state: 'visible', timeout: 30000 });
      await expect(activated.getByText("You're a Creator")).toBeVisible();
      await verifyWasCalled();

      // See dismissWelcomeIfPresent: onboarding must not be stacked over this
      // modal on the return trip. Clear it the way a user would.
      await dismissWelcomeIfPresent(page);

      await activated.getByRole('button', { name: 'Continue creating' }).click();
      await activated.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
    });

    /* ================================================================
     * 4. THE SAME RECORDED VIDEO IS STILL THERE  <-- the P0 assertion
     * ================================================================ */
    await test.step('THE SAME RECORDED VIDEO IS STILL THERE', async () => {
      const after = await readRecordings(page);
      expect(after, 'the take must survive the payment round trip').toHaveLength(1);
      expect(after[0].id, 'byte-identical record, not a re-record or a new id').toBe(recorded!.id);
      expect(after[0].size).toBe(recorded!.size);
      expect(after[0].duration).toBe(recorded!.duration);

      // And it is restored into the live review surface, not merely on disk.
      // The blob alone is not enough: the review surfaces resolve through
      // `isReview` (src/lib/review-state.ts), which must accept a take that
      // came back from IndexedDB — `recorder.recordingState` is plain React
      // state (src/hooks/useRecorder.ts:35) that no cross-document navigation
      // can carry. This is the assertion that fails if the restore path is
      // ever narrowed back to 'completed' alone.
      const exportCta = page.getByRole('button', { name: 'Export recording' });
      await expect(exportCta, [
        'THE SAME RECORDED VIDEO IS NOT THERE.',
        '',
        'The blob survived: the record above is byte-identical in IndexedDB.',
        'The studio just offers no way to reach it. Every review surface routes',
        'through isReview / resolveStudioPhase in src/lib/review-state.ts, and',
        'that rule must accept a restored take (isRestored) as well as one the',
        'capture engine finished in this document. If it does not:',
        '',
        '  src/lib/review-state.ts            isReviewState — the rule itself',
        '  src/hooks/useMasterRecording.ts    isRestored must stay true after restore',
        '',
        'Net effect after a payment return: a user cannot reach ANY Creator',
        'format on the take they just paid to export, and must discard and',
        're-record to recover.',
      ].join('\n')).toBeVisible({ timeout: 30000 });

      // The strongest form of the assertion: open the review sheet and confirm
      // it is playing the original take, at its original length and byte size.
      // Both labels are derived from the restored record, so a re-record or a
      // fresh upload would have to match both to slip through.
      await exportCta.click();
      const review = page.getByRole('dialog', { name: 'Export recording' });
      await review.waitFor({ state: 'visible', timeout: 15000 });

      const mm = String(Math.floor(recorded!.duration / 60)).padStart(2, '0');
      const ss = String(Math.floor(recorded!.duration % 60)).padStart(2, '0');
      await expect(review.getByText(`${mm}:${ss}`, { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(
        review.getByText(`${(recorded!.size / (1024 * 1024)).toFixed(1)} MB`, { exact: true })
      ).toBeVisible({ timeout: 10000 });

      const playable = await review.locator('video').first().evaluate((el) => {
        const video = el as HTMLVideoElement;
        return { src: video.getAttribute('src') ?? '' };
      });
      expect(playable.src, 'the review sheet must play a live blob, not a stale path').toMatch(/^blob:/);

      await review.getByRole('button', { name: 'Close' }).click();
      await review.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

      // Creator entitlement is live: every launch format is now selectable.
      await expect(lockedIn(page)).toHaveCount(0);
      await expect(unlockedIn(page, REELS.label)).toBeVisible({ timeout: 15000 });
    });

    /* ================================================================
     * 5. SELECTS INSTAGRAM REELS → PREVIEW BECOMES 9:16
     * ================================================================ */
    await test.step('Reels selects and the preview becomes 9:16', async () => {
      await unlockedIn(page, REELS.label).click();
      await page.waitForTimeout(1000);

      await page.getByRole('button', { name: 'Export recording' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export recording' });
      await dialog.waitFor({ state: 'visible', timeout: 15000 });

      await expect(dialog.getByText(`${REELS.ratio} · ${REELS.width} × ${REELS.height}`)).toBeVisible({ timeout: 10000 });
      await expect(dialog.getByRole('button', { name: new RegExp(`^Export ${REELS.label}\\s*·\\s*${REELS.width}×${REELS.height}`) })).toBeVisible();

      // The Free-tier upsell copy must be gone now that the user is a Creator.
      await expect(dialog.getByText(/Other formats need Creator/i)).toHaveCount(0);
      await expect(dialog.getByText(/Exports include a watermark/i)).toHaveCount(0);
    });

    /* ================================================================
     * 6. EXPORT → 1080×1920 MP4, NO WATERMARK, R2 UPLOAD
     * ================================================================ */
    await test.step('Export produces a watermarked-free 1080×1920 MP4 on R2', async () => {
      const dialog = page.getByRole('dialog', { name: 'Export recording' });

      const presigned = page.waitForResponse(
        (r) => r.url().includes('/api/exports/presigned-put') && r.request().method() === 'POST',
        { timeout: 60000 }
      );
      const putToStorage = page.waitForRequest(
        (r) => r.method() === 'PUT' && !!r.headers()['content-type']?.includes('video/mp4'),
        { timeout: 120000 }
      );
      const complete = page.waitForResponse(
        (r) => r.url().includes('/api/exports/complete') && r.request().method() === 'POST',
        { timeout: 120000 }
      );

      await dialog.getByRole('button', { name: new RegExp(`^Export ${REELS.label}`) }).click();

      const presignedRes = await presigned;
      expect(presignedRes.status(), 'a Creator must be able to request an upload slot').toBe(200);
      const presignedBody = (await presignedRes.json()) as {
        uploadUrl: string;
        outputWidth: number;
        outputHeight: number;
      };
      expect(presignedBody.outputWidth, 'the server clamps to the preset, not the client').toBe(REELS.width);
      expect(presignedBody.outputHeight).toBe(REELS.height);

      // The file leaves the browser as a real MP4.
      await putToStorage;

      const completeRes = await complete;
      expect(completeRes.status(), 'server-side HEAD must confirm the uploaded object').toBe(200);
      const completed = (await completeRes.json()) as { exportId: string; r2Key: string };
      expect(completed.r2Key).toContain('/');

      await dialog.getByText('Video exported').waitFor({ state: 'visible', timeout: 180000 });
      await expect(dialog.getByText(`${REELS.width} × ${REELS.height}`, { exact: false }).first()).toBeVisible();

      // No watermark: the watermarked branch is the local-only one, so an empty
      // local-exports store after a paid export is the proof.
      expect(await readLocalExportCount(page), 'a Creator export must never touch the watermarked local path').toBe(0);

      // The encoded file really is 1080×1920 — measured on the finished blob,
      // not on the label above it.
      const dimensions = await dialog.locator('video').last().evaluate(
        (el) =>
          new Promise<{ width: number; height: number }>((resolve, reject) => {
            const video = el as HTMLVideoElement;
            const done = () => resolve({ width: video.videoWidth, height: video.videoHeight });
            if (video.readyState >= 1) return done();
            video.addEventListener('loadedmetadata', done, { once: true });
            video.addEventListener('error', () => reject(new Error('exported video failed to load')), { once: true });
            setTimeout(() => reject(new Error('exported video metadata never arrived')), 30000);
          })
      );
      expect(dimensions).toEqual({ width: REELS.width, height: REELS.height });
    });

    /* ================================================================
     * 7. LIBRARY → DOWNLOAD
     * ================================================================ */
    await test.step('The export is in the cloud library and downloads', async () => {
      const userId = await (async () => {
        const r = await db().execute({ sql: `SELECT id FROM users WHERE email = ?`, args: [CREATOR_EMAIL.toLowerCase()] });
        return r.rows[0].id as string;
      })();

      // The server is the record of truth for what was stored.
      const stored = await db().execute({
        sql: `SELECT platform, output_width, output_height, file_size, mime_type, status
              FROM exports WHERE user_id = ?`,
        args: [userId],
      });
      expect(stored.rows.length, 'the export must be persisted server-side').toBeGreaterThan(0);
      const row = stored.rows[0] as Record<string, unknown>;
      expect(row.platform).toBe(REELS.id);
      expect(row.output_width).toBe(REELS.width);
      expect(row.output_height).toBe(REELS.height);
      expect(row.mime_type).toBe('video/mp4');
      expect(row.status).toBe('completed');
      expect(Number(row.file_size)).toBeGreaterThan(1000);

      // Close the sheet, then go to the library the way the user does.
      await page.getByRole('button', { name: 'Close' }).last().click();
      await page.waitForTimeout(500);
      await page.getByRole('navigation', { name: 'Main navigation' }).getByText('Recordings').first().click();

      const savedExports = page.getByText('Saved exports');
      await savedExports.waitFor({ state: 'visible', timeout: 20000 });

      // The cloud row is labelled with the format and the real dimensions.
      const cloudRow = page.locator('div').filter({ hasText: new RegExp(`${REELS.width}×${REELS.height}`) }).last();
      await expect(cloudRow.getByText(`${REELS.width}×${REELS.height}`)).toBeVisible({ timeout: 30000 });

      const downloadResponse = page.waitForResponse(
        (r) => r.url().includes('/api/download') && r.request().method() === 'GET',
        { timeout: 60000 }
      );
      const download = page.waitForEvent('download', { timeout: 120000 });

      await page.locator('div')
        .filter({ hasText: new RegExp(`${REELS.width}×${REELS.height}`) })
        .last()
        .getByRole('button', { name: 'Download', exact: true })
        .click();

      const dlRes = await downloadResponse;
      expect(dlRes.status(), 'a Creator with a completed export must get a signed URL').toBe(200);
      const dlBody = (await dlRes.json()) as { url: string };
      expect(dlBody.url).toBeTruthy();

      const file = await download;
      expect(file.suggestedFilename()).toMatch(/\.mp4$/i);

      const savedTo = path.join(test.info().outputDir, 'downloaded-reel.mp4');
      await file.saveAs(savedTo);
      const bytes = fs.readFileSync(savedTo);
      expect(bytes.length, 'the downloaded file must carry real bytes').toBeGreaterThan(1000);
      // 'ftyp' at byte 4 is the ISO-BMFF box every MP4 starts with.
      expect(bytes.subarray(4, 8).toString('latin1'), 'the download must be an MP4 container').toBe('ftyp');
    });

    /* ================================================================
     * 8. NOTHING WAS RE-RECORDED ALONG THE WAY
     * ================================================================ */
    await test.step('The original take is still the one and only recording', async () => {
      const final = await readRecordings(page);
      expect(final, 'exactly one recording: the user never re-recorded').toHaveLength(1);
      expect(final[0].id).toBe(recorded!.id);
      expect(final[0].size).toBe(recorded!.size);
    });
  } finally {
    await cleanupTestData(CREATOR_EMAIL);
  }
});
