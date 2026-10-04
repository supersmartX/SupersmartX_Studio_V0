/**
 * Workflow ownership, proven through the real browser.
 *
 * The studio has two workflows that used to share one transition:
 *
 *   A. CREATE NEW VIDEO  New Video -> script -> prepare -> record -> review -> export
 *   B. EXISTING VIDEO    Library -> select -> preview -> choose platform -> export
 *
 * Two defects are pinned here:
 *
 *   - "New Video" only switched panels, so the previous take and its review,
 *     platform and export state survived the click and the Studio reopened
 *     showing a recording the user had already finished.
 *   - Opening a library recording ran through the recorder's own "new master"
 *     path, which mints an id AND re-saves the row — so every open forked the
 *     master into a second, identical library item.
 *
 * Every recording assertion counts rows in the `recordings` object store rather
 * than reading the Library UI, so a duplicate cannot hide behind a card that had
 * not finished painting.
 *
 * Platform CHANGES need an entitlement guests do not have (only
 * `youtube-landscape` is unlocked below Creator, see lib/entitlements.ts), and
 * they are proven in src/__tests__/recording-workflow-ownership.test.tsx where
 * the plan can be mocked. This file deliberately stays guest-only and touches
 * no account: the auth route allows 10 attempts per IP per 15 minutes
 * (app/api/auth/[...nextauth]/route.ts), so a suite that registers throwaway
 * accounts from one machine can starve a spec that registers its own.
 */
import {
  test,
  expect,
  instrument,
  blockCloud,
  transport,
  recordTake,
  expectReview,
  dismissWelcomeModal,
  readMasterRecordings,
  newVideoButton,
  recordingsNav,
  grantMediaPermissions,
} from './helpers';
import type { Page, Locator } from '@playwright/test';

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  },
});

test.beforeEach(async ({ page, context, browserName }) => {
  await instrument(page);
  await blockCloud(page);
  await grantMediaPermissions(context, browserName);
});

test.setTimeout(300_000);

// This file drives the recorder through fake Chromium media devices.
test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');

/** The Review surfaces that must not survive a "New Video". */
async function expectCleanCreationSession(page: Page) {
  // No take on the canvas, no review-only platform row, no export entry point.
  await expect(page.getByText('Preview as', { exact: true })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Export recording' })).toHaveCount(0);
  await expect(transport(page).getByRole('button', { name: 'Start Recording' })).toBeVisible({ timeout: 30_000 });
}

/** Library cards, one per stored recording. */
function libraryCards(page: Page) {
  return page.getByRole('button', { name: /^Preview video$/ });
}

async function gotoLibrary(page: Page) {
  await recordingsNav(page).click();
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible({ timeout: 30_000 });
  await expect(libraryCards(page).first()).toBeVisible({ timeout: 30_000 });
}

async function openExistingRecording(page: Page) {
  await libraryCards(page).first().click();
  const dialog = page.getByRole('dialog', { name: 'Existing video' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

/**
 * Platform chips are matched on their title, not their accessible name: the
 * chip renders an icon glyph and (when locked) a lock svg alongside the label,
 * so its computed name is never exactly the platform label.
 */
function unlockedChip(scope: Locator, label: string) {
  return scope.locator(`button[title="${label}"]`);
}

function lockedChip(scope: Locator, label: string) {
  return scope.locator('button[title$="Creator plan required"]').filter({ hasText: label });
}

/** Reveals the platform chips in the existing-recording view. */
async function showPlatformChips(scope: Locator) {
  await scope.getByRole('button', { name: 'Change Platform' }).click();
  await expect(unlockedChip(scope, 'YouTube')).toBeVisible({ timeout: 30_000 });
}

test.describe('TEST 1 — "New Video" starts a clean session and keeps A in the library', () => {
  test('Record A → New Video → clean studio, A still in the library', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);

    await recordTake(page);
    await expectReview(page);

    const afterA = await readMasterRecordings(page);
    expect(afterA, 'the take must be in the library').toHaveLength(1);

    // "New Video" — workflow A, start over.
    await newVideoButton(page).click();
    await expectCleanCreationSession(page);

    const afterNewVideo = await readMasterRecordings(page);
    expect(afterNewVideo, 'New Video must never delete the previous recording').toHaveLength(1);
    expect(afterNewVideo[0].id, 'it must be the very same master, not a copy').toBe(afterA[0].id);

    // ...and it is still reachable through the library, not the studio.
    await gotoLibrary(page);
    await expect(libraryCards(page)).toHaveCount(1);
  });
});

test.describe('TEST 2 & 3 — an existing recording is exported, not re-created', () => {
  test('Library → open A → export → still one master', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await recordTake(page);
    await expectReview(page);

    const afterA = await readMasterRecordings(page);
    expect(afterA).toHaveLength(1);
    const masterA = afterA[0].id;

    await gotoLibrary(page);

    // Open the EXISTING recording. Not a creation workflow — no script, no
    // camera, no "record again": an explicit export surface for what is there.
    const existing = await openExistingRecording(page);
    await expect(existing.getByText('Export this video')).toBeVisible();
    await expect(existing.getByRole('button', { name: 'Change Platform' })).toBeVisible();
    await expect(existing.getByRole('button', { name: /^Export this video/ })).toBeVisible();

    // The platform reads from the one shared selection, not a private copy
    // owned by this view, so it agrees with what the Studio had selected.
    await expect(existing.getByText(/^Preview as: YouTube/)).toBeVisible();

    // Settle first: a duplicate write triggered by opening the take would land
    // asynchronously, and reading too early would pass a real regression.
    await page.waitForTimeout(1_000);
    expect(
      await readMasterRecordings(page),
      'opening an existing recording must not create one',
    ).toHaveLength(1);

    // Export the existing recording.
    await existing.getByRole('button', { name: /^Export this video/ }).click();
    await expect(page.getByRole('dialog', { name: 'Export recording' })).toBeVisible({ timeout: 30_000 });

    const afterExport = await readMasterRecordings(page);
    expect(afterExport, 'exporting an existing recording must not duplicate it').toHaveLength(1);
    expect(afterExport[0].id, 'the master identity is unchanged').toBe(masterA);
  });
});

test.describe('TEST 4 — exporting repeatedly never multiplies recordings', () => {
  test('two export entry points on one take leave a single master', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await recordTake(page);
    await expectReview(page);
    expect(await readMasterRecordings(page)).toHaveLength(1);

    await gotoLibrary(page);

    // Export #1 straight off the card.
    await page.getByRole('button', { name: /^Export video$/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Export recording' });
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await sheet.getByRole('button', { name: 'Close' }).click();

    let recordings = await readMasterRecordings(page);
    expect(recordings).toHaveLength(1);
    const masterA = recordings[0].id;

    // Export #2 through the existing-recording view. Both routes once ran the
    // same "new master" path, which is how one take became two library items.
    const existing = await openExistingRecording(page);
    await existing.getByRole('button', { name: /^Export this video/ }).click();
    await expect(page.getByRole('dialog', { name: 'Export recording' })).toBeVisible({ timeout: 30_000 });

    recordings = await readMasterRecordings(page);
    expect(recordings, 'two exports of one take must not mean two recordings').toHaveLength(1);
    expect(recordings[0].id, 'both exports ran on the same master').toBe(masterA);
  });
});

test.describe('TEST 6 — the platform lock is not weakened in the existing-recording view', () => {
  test('a guest selecting TikTok gets the upgrade path, not a silent switch', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await recordTake(page);
    await expectReview(page);
    expect(await readMasterRecordings(page)).toHaveLength(1);

    await gotoLibrary(page);
    const existing = await openExistingRecording(page);

    await showPlatformChips(existing);

    // The chip is honestly labelled as locked before it is ever clicked.
    await expect(existing.locator('button[title$="Creator plan required"]')).toHaveCount(6);
    await expect(unlockedChip(existing, 'YouTube')).toHaveCount(1);

    await lockedChip(existing, 'TikTok').click();

    const upgrade = page.getByRole('dialog', { name: 'Create for TikTok with Creator' });
    await expect(upgrade).toBeVisible({ timeout: 30_000 });
    await expect(upgrade.getByRole('button', { name: /^(Continue|Buy Creator access)$/ })).toBeVisible();

    // Refusing the change must not quietly switch the platform behind the
    // user's back, and must not disturb the recording it was opened for.
    await page.keyboard.press('Escape');
    await expect(upgrade).toBeHidden({ timeout: 10_000 });
    await expect(existing.getByRole('button', { name: 'Export this video as YouTube' })).toBeVisible();
    expect(await readMasterRecordings(page)).toHaveLength(1);
  });
});

test.describe('TEST 5 — A and B coexist as separate recordings', () => {
  test('New Video → record B → the library holds two distinct masters', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);

    await recordTake(page);
    await expectReview(page);
    const afterA = await readMasterRecordings(page);
    expect(afterA).toHaveLength(1);

    await newVideoButton(page).click();
    await expectCleanCreationSession(page);

    await recordTake(page);
    await expectReview(page);

    const afterB = await readMasterRecordings(page);
    expect(afterB, 'the library holds A and B').toHaveLength(2);
    expect(afterB.map((r) => r.id)).toContain(afterA[0].id);
    expect(new Set(afterB.map((r) => r.id)).size, 'the two takes are distinct masters').toBe(2);

    await gotoLibrary(page);
    await expect(libraryCards(page)).toHaveCount(2);
  });
});

test.describe('TEST 7 — a reload restores the take instead of creating one', () => {
  test('reloading on a stored take keeps exactly one master', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await recordTake(page);
    await expectReview(page);

    const before = await readMasterRecordings(page);
    expect(before).toHaveLength(1);

    await page.reload();
    await dismissWelcomeModal(page);

    // The take survives the document hop — that is the upgrade journey.
    await expect(page.locator('main video')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });

    const after = await readMasterRecordings(page);
    expect(after, 'a reload must not turn a stored take into a new recording').toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].size, 'the same bytes, byte-for-byte').toBe(before[0].size);
  });
});