import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext();
const page = await context.newPage();

// Normal visit: no checkout intent -> welcome modal must still appear.
await page.goto('http://localhost:3000/studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const welcome = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="Welcome"]');
  return !!d;
});
console.log('WELCOME ON NORMAL VISIT:', welcome);

// Dismiss it, then confirm a fresh checkout visit shows auth (new context = fresh sessionStorage).
const context2 = await browser.newContext();
const page2 = await context2.newPage();
await page2.goto('http://localhost:3000/studio?checkout=creator_yearly', { waitUntil: 'domcontentloaded' });
await page2.waitForTimeout(2500);
const dialogs2 = await page2.evaluate(() =>
  Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => d.getAttribute('aria-label')),
);
console.log('CHECKOUT YEARLY DIALOGS:', JSON.stringify(dialogs2));
await browser.close();
