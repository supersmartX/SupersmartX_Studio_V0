import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from './helpers';

/**
 * Regression: the transport bar's device chips (mic / camera) rendered UNDER
 * the centred Record button. The bar used two mirrored `flex-1` zones, which
 * hard-split the bar 50/50 — any extra left content (inspector open at
 * 1280–1439px, mode labels at 2xl, the daily-budget indicator) overflowed the
 * left zone into the centre column and swallowed the clicks meant for the
 * chips. The bar is now a `1fr auto 1fr` grid at every width, so the chips row
 * shrinks instead of overlapping, and the primary action stays exactly
 * centred. These assertions pin the geometry that CSS alone cannot guarantee:
 * no interactive control's box may intersect another's, and Record must sit
 * on the bar's centre line.
 *
 * jsdom cannot catch this class of bug (no layout), so it lives in e2e.
 */
async function transportRects(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('footer[aria-label="Recording controls"]');
    if (!bar) return null;
    const barRect = bar.getBoundingClientRect();
    const controls = [...bar.querySelectorAll('button, [role="radio"]')].filter(
      (el) => (el as HTMLElement).offsetParent !== null,
    );
    const rects = controls.map((el) => ({
      name: el.getAttribute('aria-label') || el.textContent?.trim() || '',
      rect: el.getBoundingClientRect(),
    }));
    const overlaps: string[] = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].rect;
        const b = rects[j].rect;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) overlaps.push(`${rects[i].name} <-> ${rects[j].name}`);
      }
    }
    const record = rects.find((r) => r.name === 'Start Recording');
    const offCenter = record
      ? Math.round((record.rect.left + record.rect.right) / 2 - (barRect.left + barRect.width / 2))
      : null;
    return { overlaps, offCenter };
  });
}

test.describe('Transport bar layout', () => {
  for (const width of [1280, 1600]) {
    test(`controls do not overlap the Record button at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/studio');
      await page.waitForLoadState('networkidle');
      await dismissWelcomeModal(page);
      await expect(page.getByLabel('Recording controls')).toBeVisible();
      const result = await transportRects(page);
      expect(result).not.toBeNull();
      expect(result!.overlaps, result!.overlaps.join('; ')).toEqual([]);
    });

    test(`Record button is centred on the bar at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/studio');
      await page.waitForLoadState('networkidle');
      await dismissWelcomeModal(page);
      await expect(page.getByLabel('Recording controls')).toBeVisible();
      const result = await transportRects(page);
      expect(result).not.toBeNull();
      // The mirror grid cell keeps the primary action on the bar's centre
      // line; allow a small optical tolerance rather than pixel zero.
      expect(Math.abs(result!.offCenter ?? 999)).toBeLessThanOrEqual(4);
    });
  }
});
