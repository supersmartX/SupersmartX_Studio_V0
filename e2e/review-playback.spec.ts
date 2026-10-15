/* Track 2 — recorded playback/background repro.
 *
 * Records a real take with fake media, then asserts the ACTUAL video element
 * state (not mere visibility) across: initial review, every platform switch,
 * and a reload-driven remount + IndexedDB restore.
 *
 * A "visible" <video> can still be broken: zero dims, frozen frame, wrong
 * crop, covered by the background, or sitting outside its box. Every state
 * below asserts decoded frames (readyState), flowing playback (currentTime
 * advances, not paused), geometry (rects, box aspect), paint (object-fit,
 * stacking at the video centre), and source health.
 *
 * No conditional guards: every expect must pass or the test fails loudly.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  studioReady,
  transport,
  stopRecording,
  switcher,
  apiRegister,
  db,
  cleanupTestUser,
  grantMediaPermissions,
} from './helpers';

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
test.setTimeout(600000);
test.skip(!!process.env.TURSO_DATABASE_URL, 'needs the local dev database file');
test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

interface VideoState {
  src: string;
  currentSrc: string;
  readyState: number;
  networkState: number;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  paused: boolean;
  ended: boolean;
  rect: { x: number; y: number; w: number; h: number };
  boxRect: { x: number; y: number; w: number; h: number };
  style: {
    objectFit: string;
    objectPosition: string;
    display: string;
    visibility: string;
    opacity: string;
    zIndex: string;
  };
  hitTag: string;
}

async function readVideoState(video: Locator): Promise<VideoState> {
  return video.evaluate((v) => {
    const el = v as HTMLVideoElement;
    const r = el.getBoundingClientRect();
    const box = (el.parentElement as HTMLElement).getBoundingClientRect();
    const cs = getComputedStyle(el);
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      src: el.getAttribute('src') ?? '',
      currentSrc: el.currentSrc,
      readyState: el.readyState,
      networkState: el.networkState,
      videoWidth: el.videoWidth,
      videoHeight: el.videoHeight,
      currentTime: el.currentTime,
      paused: el.paused,
      ended: el.ended,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      boxRect: { x: box.x, y: box.y, w: box.width, h: box.height },
      style: {
        objectFit: cs.objectFit,
        objectPosition: cs.objectPosition,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        zIndex: cs.zIndex,
      },
      hitTag: hit ? hit.tagName : '<none>',
    };
  });
}

/** Full health assertion for one review state. Throws loudly on any defect. */
async function expectHealthyPlayback(
  page: Page,
  label: string,
  boxRatio: number,
  baselineDims: { w: number; h: number } | null,
): Promise<{ w: number; h: number }> {
  const video = page.locator('main video');
  await expect(video, `${label}: review video element must exist`).toHaveAttribute(
    'src',
    /^blob:/,
    { timeout: 30000 },
  );

  const s = await readVideoState(video);

  // Source health.
  expect(s.currentSrc.startsWith('blob:'), `${label}: currentSrc must be the blob take`).toBe(true);
  expect(s.networkState, `${label}: networkState must not be NETWORK_NO_SOURCE(3)`).not.toBe(3);
  expect(s.readyState, `${label}: readyState must carry current data (>=2), got ${s.readyState}`).toBeGreaterThanOrEqual(2);

  // Decoded frames, stable across states.
  expect(s.videoWidth, `${label}: decoded width must be > 0`).toBeGreaterThan(0);
  expect(s.videoHeight, `${label}: decoded height must be > 0`).toBeGreaterThan(0);
  if (baselineDims) {
    expect(
      { w: s.videoWidth, h: s.videoHeight },
      `${label}: decoded take dims must match baseline (same master)`,
    ).toEqual(baselineDims);
  }

  // Flowing playback, not a frozen poster. Wrap-aware: a short looping take
  // may wrap between reads, so any movement counts — identical means frozen.
  expect(s.paused, `${label}: review must autoplay (paused=false)`).toBe(false);
  const t2 = await video
    .evaluate((v) => (v as HTMLVideoElement).currentTime)
    .then(async (t1) => {
      await page.waitForTimeout(1500);
      const t = await video.evaluate((v) => (v as HTMLVideoElement).currentTime);
      return { t1, t2: t };
    });
  expect(t2.t2 === t2.t1, `${label}: currentTime frozen at ${t2.t1}`).toBe(false);

  // Geometry: the video must fill its box (absolute inset-0 cover).
  expect(s.rect.w, `${label}: video rect width must be > 0`).toBeGreaterThan(0);
  expect(s.rect.h, `${label}: video rect height must be > 0`).toBeGreaterThan(0);
  expect(
    Math.abs(s.rect.w - s.boxRect.w),
    `${label}: video must span the box width (${s.rect.w} vs box ${s.boxRect.w})`,
  ).toBeLessThan(2);
  expect(
    Math.abs(s.rect.h - s.boxRect.h),
    `${label}: video must span the box height (${s.rect.h} vs box ${s.boxRect.h})`,
  ).toBeLessThan(2);

  // The box itself must be the platform ratio (the silent 16:9-box bug class).
  const actualRatio = s.boxRect.w / s.boxRect.h;
  expect(
    Math.abs(actualRatio - boxRatio),
    `${label}: box aspect ${actualRatio.toFixed(3)} must equal platform ${boxRatio.toFixed(3)}`,
  ).toBeLessThan(0.03);

  // Paint: cover crop, rendered, and on top at its own centre.
  expect(s.style.objectFit, `${label}: object-fit must be cover`).toBe('cover');
  expect(s.style.display, `${label}: display must not be none`).not.toBe('none');
  expect(s.style.visibility, `${label}: visibility must be visible`).toBe('visible');
  expect(s.style.opacity, `${label}: opacity must be 1`).toBe('1');
  expect(s.hitTag, `${label}: video centre must hit VIDEO, not a covering layer (got ${s.hitTag})`).toBe(
    'VIDEO',
  );

  return { w: s.videoWidth, h: s.videoHeight };
}

const PLATFORMS = [
  { title: 'YouTube', ratio: 16 / 9 },
  { title: 'YouTube Shorts', ratio: 9 / 16 },
  { title: 'Instagram Square', ratio: 1 },
  { title: 'Instagram Portrait', ratio: 4 / 5 },
] as const;

test('recorded review plays correctly across platforms and a remount', async ({ page }) => {
  const email = `e2ereview${Date.now()}@example.com`;
  try {
    await page.goto('/studio');
    await studioReady(page);
    await apiRegister(page.request, email);
    await db().execute({
      sql: `UPDATE users SET plan = 'creator_monthly', plan_expires_at = ? WHERE email = ?`,
      args: [FUTURE, email.toLowerCase()],
    });
    await page.reload();
    await studioReady(page);

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page)
      .getByRole('button', { name: 'Stop Recording' })
      .waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(8000);
    await stopRecording(page);
    await page.getByText('Preview as', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });

    // Baseline on the default 16:9 review.
    const baseline = await expectHealthyPlayback(page, 'initial 16:9 review', 16 / 9, null);

    // Single-audible-player discipline: opening the export drawer pauses the
    // review take (the drawer has its own click-to-play preview); closing it
    // resumes where it left off. Same master, no background audio.
    await page.getByRole('button', { name: 'Export recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await expect
      .poll(
        async () => page.locator('main video').evaluate((v) => (v as HTMLVideoElement).paused),
        { timeout: 10000 },
      )
      .toBe(true);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    await expect
      .poll(
        async () =>
          page.locator('main video').evaluate((v) => {
            const el = v as HTMLVideoElement;
            return !el.paused && el.readyState >= 2;
          }),
        { timeout: 15000 },
      )
      .toBe(true);

    // Every platform switch must keep the same master playing in the right box.
    for (const p of PLATFORMS) {
      await switcher(page).locator(`button[title="${p.title}"]`).click();
      await page.waitForTimeout(1000);
      await expectHealthyPlayback(page, `review @ ${p.title}`, p.ratio, baseline);
    }

    // Leaving the studio panel (library) must also pause the take.
    await page.getByRole('navigation', { name: 'Main navigation' }).getByText('Recordings').first().click();
    await expect
      .poll(
        async () => page.locator('main video').evaluate((v) => (v as HTMLVideoElement).paused),
        { timeout: 10000 },
      )
      .toBe(true);

    // Full remount + IndexedDB restore: the take must come back playing.
    // Platform choice is session state, so review reopens on the default 16:9.
    await page.reload();
    await page.getByText('Preview as', { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
    await expectHealthyPlayback(page, 'restored review after reload', 16 / 9, baseline);
  } finally {
    await cleanupTestUser(email);
  }
});
