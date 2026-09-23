/* Launch-contract lifecycle tests (Guest/Free/Creator + anti-lockout).
 * Requires the local dev database (data/supersmartx.db); skipped when a
 * shared TURSO_DATABASE_URL is configured so CI never writes test rows
 * into shared infrastructure. Uses fake camera/mic devices.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createClient, type Client } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';

test.use({
  permissions: ['camera', 'microphone'],
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

test.setTimeout(420_000);

test.skip(
  !!process.env.TURSO_DATABASE_URL,
  'lifecycle spec needs the local dev database file; skipping against shared DB',
);

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

let _db: Client | null = null;
function db(): Client {
  if (!_db) {
    const dataDir = path.resolve(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    _db = createClient({ url: `file:${path.join(dataDir, 'supersmartx.db')}` });
  }
  return _db;
}

async function ensureStudioReady(page: Page) {
  // The welcome modal (and its Get Started camera init) can appear late on
  // cold dev-server compiles. Poll: dismiss whenever visible, succeed when
  // the record button enables.
  const recordBtn = page.getByLabel('Recording controls').getByRole('button', { name: 'Start Recording' });
  await recordBtn.waitFor({ state: 'visible', timeout: 60000 });
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const getStarted = page.getByRole('button', { name: 'Get Started' });
    if (await getStarted.isVisible().catch(() => false)) {
      await getStarted.click({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    try {
      await expect(recordBtn).toBeEnabled({ timeout: 8000 });
      return;
    } catch {
      // Not ready yet: loop again (modal may still be mounting).
    }
  }
  throw new Error('studio never became ready: record button stayed disabled');
}

async function recordShort(page: Page) {
  await ensureStudioReady(page);
  const recordBtn = page.getByLabel('Recording controls').getByRole('button', { name: 'Start Recording' });
  await recordBtn.waitFor({ state: 'visible', timeout: 30000 });
  await recordBtn.click();
  await page.waitForTimeout(8000);
  const stopBtn = page.getByLabel('Recording controls').getByRole('button', { name: 'Stop Recording' });
  await stopBtn.click();
  await page.waitForTimeout(1000);
  await stopBtn.click();
  await page.getByRole('button', { name: 'Export recording' }).waitFor({ state: 'visible', timeout: 30000 });
}

async function apiRegister(request: APIRequestContext, email: string) {
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

async function dbScalar(sql: string, args: (string | number | null)[]): Promise<void> {
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

async function upgradeToCreator(email: string) {
  await dbScalar(`UPDATE users SET plan = 'creator_monthly', plan_expires_at = ? WHERE email = ?`, [FUTURE, email.toLowerCase()]);
}

async function userIdByEmail(email: string): Promise<string> {
  const r = await db().execute({ sql: `SELECT id FROM users WHERE email = ?`, args: [email.toLowerCase()] });
  if (r.rows.length === 0) throw new Error(`no user row for ${email}`);
  return r.rows[0].id as string;
}

async function seedStuckJobs(userId: string, count: number) {
  // Aged 7h so they qualify as abandoned (staleness window is 6h).
  // Fresh active jobs must STILL count — only stale ones are ignored.
  const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  for (let i = 0; i < count; i++) {
    await db().execute({
      sql: `INSERT INTO export_jobs (id, user_id, config_json, status, progress, retry_count, created_at) VALUES (?, ?, ?, 'encoding', 10, 0, ?)`,
      args: [`ej-e2e-${Date.now()}-${i}`, userId, '{"platformId":"youtube-landscape"}', old],
    });
  }
}

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

const PLATFORM_LABELS = ['YouTube', 'YouTube Shorts', 'Reels', 'Instagram Square', 'Instagram Portrait', 'TikTok', 'LinkedIn'];

test('guest locks + guest→auth preserves work', async ({ page }) => {
  const email = `e2eguest${Date.now()}@example.com`;
  try {
    await page.goto('/studio');
    await page.waitForTimeout(3000);
    await ensureStudioReady(page);
    await recordShort(page);

    // Guest lock matrix: non-16:9 gated, 16:9 available.
    await page.getByRole('button', { name: 'Export recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await expect(dialog.getByText('SIGN IN').first()).toBeVisible({ timeout: 10000 });
    await dialog.getByRole('button', { name: /Continue with YouTube/ }).waitFor({ state: 'visible', timeout: 10000 });

    // Register without closing the modal (closing asks to discard the take):
    // login must not clobber the open export UI state.
    await apiRegister(page.request, email);
    await dialog.getByText('Choose a platform').waitFor({ state: 'visible', timeout: 15000 });
    // Modal still functional post-register: platform cards remain interactive.
    await dialog.getByRole('button', { name: /Continue with YouTube/ }).waitFor({ state: 'visible', timeout: 10000 });

    // Reload: session authenticated + recording persisted in the local library.
    // (Review UI is session-state; the library is the durable cross-reload path.)
    await page.reload();
    await page.waitForTimeout(3000);
    await ensureStudioReady(page);
    await expect(page.getByRole('button', { name: 'Log In' })).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByText('Recordings').first().click();
    await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    const dialog2 = page.getByRole('dialog', { name: 'Export recording' });
    await dialog2.waitFor({ state: 'visible', timeout: 15000 });
    await dialog2.getByText('Choose a platform').waitFor({ state: 'visible', timeout: 15000 });
  } finally {
    await cleanupTestData(email);
  }
});

test('creator matrix + stuck jobs do not block single export', async ({ page }) => {
  const email = `e2ecreator${Date.now()}@example.com`;
  try {
    await page.goto('/studio');
    await page.waitForTimeout(3000);
    await ensureStudioReady(page);
    await apiRegister(page.request, email);
    await upgradeToCreator(email);
    await page.reload();
    await page.waitForTimeout(3000);
    await recordShort(page);

    await page.getByRole('button', { name: 'Export recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    for (const label of PLATFORM_LABELS) {
      await expect(dialog.getByText(label, { exact: false }).first()).toBeVisible({ timeout: 10000 });
    }
    await expect(dialog.getByText('SIGN IN')).toHaveCount(0);
    await expect(dialog.getByText('CREATOR', { exact: true })).toHaveCount(0);

    // Seed 3 abandoned jobs, then export: must proceed (201), not 429.
    const userId = await userIdByEmail(email);
    await seedStuckJobs(userId, 3);
    const jobsResponse = page.waitForResponse(
      (r) => r.url().includes('/api/export-jobs') && r.request().method() === 'POST',
      { timeout: 60000 },
    );
    await dialog.getByRole('button', { name: /Continue with YouTube/ }).click();
    const resp = await jobsResponse;
    expect(resp.status(), 'stuck jobs must not block (expect 201, pre-fix 429)').toBe(201);
    await dialog.getByText('Exporting...').waitFor({ state: 'visible', timeout: 30000 });
  } finally {
    await cleanupTestData(email);
  }
});

test('free locked formats show upgrade prompt, send no export', async ({ page }) => {
  const email = `e2efree${Date.now()}@example.com`;
  try {
    await page.goto('/studio');
    await page.waitForTimeout(3000);
    await ensureStudioReady(page);
    await apiRegister(page.request, email);
    await page.reload();
    await page.waitForTimeout(3000);
    await recordShort(page);

    await page.getByRole('button', { name: 'Export recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await expect(dialog.getByText('CREATOR', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    // Click a locked platform (Shorts card) → upgrade prompt, no encoding.
    await dialog.getByText('Shorts', { exact: false }).first().click();
    await page.getByRole('button', { name: 'Upgrade to Creator' }).waitFor({ state: 'visible', timeout: 15000 });
    await expect(dialog.getByText('Exporting...')).toHaveCount(0);
  } finally {
    await cleanupTestData(email);
  }
});
