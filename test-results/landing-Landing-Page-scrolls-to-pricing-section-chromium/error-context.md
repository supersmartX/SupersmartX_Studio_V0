# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: landing.spec.ts >> Landing Page >> scrolls to pricing section
- Location: e2e\landing.spec.ts:27:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Most Popular')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Most Popular')

```

```yaml
- banner:
  - link "SupersmartX Studio":
    - /url: /
    - text: SUPERSMARTX Studio
  - navigation "Primary":
    - link "Studio":
      - /url: "#top"
    - link "How It Works":
      - /url: "#how-it-works"
    - link "Pricing":
      - /url: "#pricing"
  - button "Log In"
  - button "Start Free"
- main:
  - text: Browser-based Teleprompter Studio
  - heading "Record professional videos on your browser in seconds." [level=1]:
    - text: Record
    - emphasis: professional videos
    - text: on your browser in seconds.
  - paragraph: A browser-based teleprompter and recording studio that helps you speak naturally, stay on camera, and create better videos.
  - button "Start Free"
  - button "Log In"
- text: How It Works
- heading "Three steps to better videos" [level=2]
- paragraph: No downloads. No complicated software. Just open your browser and start recording.
- text: "1"
- heading "Write your script" [level=3]
- paragraph: Type, paste, or generate a script with AI. Our built-in teleprompter scrolls at your pace so you never lose your place.
- text: "2"
- heading "Record yourself" [level=3]
- paragraph: Use your webcam with a real-time teleprompter overlay. Pause, resume, and re-record until it feels right.
- text: "3"
- heading "Export & share" [level=3]
- paragraph: Download your video in high quality. Share directly to YouTube, LinkedIn, or any platform.
- text: Pricing
- heading "Start free. Upgrade when ready." [level=2]
- paragraph: PPP-adjusted pricing in 60+ countries. Prices in INR.
- button "Monthly"
- button "Yearly Save 17%"
- heading "Free" [level=3]
- text: $0/forever
- list:
  - listitem: Teleprompter (always free)
  - listitem: Audio recording & download
  - listitem: 3 video downloads free
  - listitem: Videos up to 5 min duration
- button "Get Started"
- text: Popular
- heading "Creator" [level=3]
- text: ₹349/month
- paragraph: PPP-adjusted by region
- list:
  - listitem: Everything in Free
  - listitem: Unlimited video downloads
  - listitem: Unlimited recording length
  - listitem: 1080p export quality
  - listitem: All platform presets
  - listitem: Crop & reframe for each platform
- button "Get Creator"
- heading "Pro" [level=3]
- text: ₹649/month
- paragraph: PPP-adjusted by region
- list:
  - listitem: Everything in Creator
  - listitem: 4K export quality
  - listitem: Batch export (multiple platforms)
  - listitem: Priority support
- button "Get Pro"
- contentinfo:
  - text: © 2026 SupersmartX. All rights reserved.
  - link "Terms":
    - /url: /legal/terms
  - link "Privacy":
    - /url: /legal/privacy
- alert
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Landing Page', () => {
  4  |   test('renders hero section with correct content', async ({ page }) => {
  5  |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  6  |     await expect(page.getByText('Record professional videos on')).toBeVisible();
  7  |     await expect(page.getByRole('button', { name: 'Start Free' }).first()).toBeVisible();
  8  |     await expect(page.getByRole('button', { name: 'Log In' }).first()).toBeVisible();
  9  |   });
  10 | 
  11 |   test('navigates to studio on "Start Free" click', async ({ page }) => {
  12 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  13 |     const startFreeButton = page.getByRole('button', { name: 'Start Free' }).first();
  14 |     await startFreeButton.click();
  15 |     await expect(page).toHaveURL(/\/studio/);
  16 |   });
  17 | 
  18 |   test('opens auth modal on "Log In" click', async ({ page }) => {
  19 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  20 |     const loginButton = page.getByRole('button', { name: 'Log In' }).first();
  21 |     await loginButton.click();
  22 |     const modal = page.getByRole('dialog');
  23 |     await expect(modal).toBeVisible();
  24 |     await expect(modal).toContainText(/Sign in|Log in|Create account/i);
  25 |   });
  26 | 
  27 |   test('scrolls to pricing section', async ({ page }) => {
  28 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  29 |     const menuButton = page.getByRole('button', { name: /menu/i });
  30 |     const isMobile = await menuButton.isVisible().catch(() => false);
  31 |     if (isMobile) {
  32 |       await menuButton.click();
  33 |       await page.waitForTimeout(300);
  34 |     }
  35 |     const pricingNav = page.getByRole('link', { name: 'Pricing' }).first();
  36 |     const isPricingVisible = await pricingNav.isVisible().catch(() => false);
  37 |     if (isPricingVisible) {
  38 |       await pricingNav.click();
> 39 |       await expect(page.getByText('Most Popular')).toBeVisible();
     |                                                    ^ Error: expect(locator).toBeVisible() failed
  40 |     }
  41 |   });
  42 | 
  43 |   test('displays how-it-works steps', async ({ page }) => {
  44 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  45 |     await expect(page.getByText('Write your script')).toBeVisible();
  46 |     await expect(page.getByText('Record yourself')).toBeVisible();
  47 |     await expect(page.getByText('Export & share')).toBeVisible();
  48 |   });
  49 | 
  50 |   test('displays pricing tiers', async ({ page }) => {
  51 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  52 |     await page.waitForSelector('text=Free, text=Pro', { timeout: 10000 }).catch(() => {});
  53 |     const hasFree = await page.getByText('Free').first().isVisible().catch(() => false);
  54 |     const hasPro = await page.getByText('Pro').first().isVisible().catch(() => false);
  55 |     expect(hasFree || hasPro).toBeTruthy();
  56 |   });
  57 | 
  58 |   test('mobile menu toggles correctly', async ({ page }) => {
  59 |     await page.setViewportSize({ width: 375, height: 812 });
  60 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  61 |     const menuButton = page.getByRole('button', { name: /menu/i });
  62 |     await menuButton.click();
  63 |     await expect(page.getByRole('link', { name: 'How It Works' }).first()).toBeVisible();
  64 |   });
  65 | });
  66 | 
  67 | test.describe('Landing Page - Accessibility', () => {
  68 |   test('has no auto-playing video without controls', async ({ page }) => {
  69 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  70 |     const videos = page.locator('video');
  71 |     const count = await videos.count();
  72 |     for (let i = 0; i < count; i++) {
  73 |       const video = videos.nth(i);
  74 |       const autoplay = await video.getAttribute('autoplay');
  75 |       const muted = await video.getAttribute('muted');
  76 |       if (autoplay !== null) {
  77 |         expect(muted).not.toBeNull();
  78 |       }
  79 |     }
  80 |   });
  81 | });
  82 | 
```