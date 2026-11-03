import { test, expect, instrument, blockCloud, grantMediaPermissions, dismissWelcomeModal, studioReady, transport, stopRecording, expectReview } from './helpers';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] } });
test.setTimeout(120_000);

for (const width of [1440, 390]) {
  test(`settings remain usable through recording and pause at ${width}px`, async ({ page, context, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Requires Chromium fake media');
    await page.setViewportSize({ width, height: 900 });
    await instrument(page);
    await blockCloud(page);
    await grantMediaPermissions(context, browserName);
    await page.addInitScript(() => {
      localStorage.setItem('sxs-studio-script', 'A long script keeps the teleprompter scrolling during this test. '.repeat(150));
    });
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);
    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await expect(transport(page).getByRole('button', { name: 'Stop Recording' })).toBeVisible({ timeout: 30_000 });
    const toggle = page.getByRole('button', { name: 'Toggle inspector panel' });
    if (width < 1280) await toggle.click();
    const speed = page.getByRole('slider', { name: /Scroll Speed/ });
    await expect(speed).toBeVisible();
    const scrollRate = () => page.getByTestId('teleprompter-text').evaluate(async (text) => {
      const scroller = text.parentElement!;
      const start = scroller.scrollTop;
      const began = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return (scroller.scrollTop - start) / (performance.now() - began);
    });
    await speed.fill('0.5');
    const slow = await scrollRate();
    await speed.fill('2');
    await expect(speed).toHaveValue('2');
    const fast = await scrollRate();
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow * 2);
    await page.screenshot({ path: testInfo.outputPath('recording-settings.png') });
    await page.getByRole('button', { name: 'Camera & Preview' }).click();
    await expect(page.getByRole('switch', { name: 'Countdown' })).toBeDisabled();
    await page.getByRole('button', { name: 'Close inspector' }).click();
    await transport(page).getByRole('button', { name: 'Pause Recording' }).click();
    await toggle.click();
    await expect(speed).toBeVisible();
    await page.getByRole('button', { name: 'Close inspector' }).click();
    await transport(page).getByRole('button', { name: 'Resume Recording' }).click();
    await toggle.click();
    await expect(speed).toBeVisible();
    await page.getByRole('button', { name: 'Close inspector' }).click();
    await stopRecording(page);
    await expectReview(page);
  });
}
