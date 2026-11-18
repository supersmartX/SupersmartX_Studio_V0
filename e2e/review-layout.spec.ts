import { test, expect, instrument, blockCloud, grantMediaPermissions, recordTake } from './helpers';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] } });
test.setTimeout(180_000);
test('review frame stays fully visible beside or above the controls', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'requires fake capture devices');
  await instrument(page);
  await blockCloud(page);
  // UI-only Creator session fixture unlocks every aspect ratio; cloud calls
  // remain blocked and no account or database is modified.
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    user: { id: 'layout-fixture', name: 'Layout test', email: 'layout@example.test', plan: 'creator_monthly' },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } }));
  await grantMediaPermissions(context, browserName);
  await page.setViewportSize({ width: 1440, height: 620 });
  await page.goto('/studio');
  await recordTake(page, 2);
  for (const viewport of [{ width: 1440, height: 620 }, { width: 1024, height: 600 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const format of [/YouTube$/, /YouTube Shorts/, /Instagram Square/, /Instagram Portrait/]) {
      const chip = page.locator('[data-platform-switcher]').getByRole('button', { name: format });
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => page.locator('main video').evaluate((video) => {
        const frame = video.closest('[style*="aspect-ratio"]')!;
        const r = frame.getBoundingClientRect();
        const tray = document.querySelector('[data-review-tray]')!.getBoundingClientRect();
        const ratio = getComputedStyle(frame).aspectRatio.split('/').map(Number);
        return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 &&
          r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 &&
          Math.abs(r.width / r.height - ratio[0] / ratio[1]) < 0.01 &&
          (r.right <= tray.left + 1 || r.bottom <= tray.top + 1);
      })).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`review-${viewport.width}-${format.source.replace(/[^a-z]/gi, '')}.png`) });
    }
  }
});
