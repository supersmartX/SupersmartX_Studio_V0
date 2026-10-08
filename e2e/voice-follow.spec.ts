/* Voice speech-follow teleprompter e2e (CR-002, Phase 5).
 *
 * Proves, in a real Chromium layout (Range-based scroll targets, real
 * geometry check for script end):
 *   - entitlement surface: the Voice follow switch is offered ONLY to
 *     Creator accounts with SpeechRecognition support (Free, Guest, and
 *     unsupported browsers never see it);
 *   - speech-follow: spoken (injected) transcripts advance the prompter,
 *     mismatches HOLD the position, interim results need stability;
 *   - hold paths: disabling, and recording pause, freeze the position;
 *   - FC-1.1 §6 Item 8 (DC-2): reading to the end of the script fires the
 *     FROZEN auto-stop path with the exact toast, through the existing
 *     geometry check — the recorder pipeline itself is untouched.
 *
 * Uses a fake native SpeechRecognition injected before any app code runs;
 * no real audio leaves the browser, no network speech service is involved.
 */
import { test, expect, type Page } from '@playwright/test';
import { studioReady, grantMediaPermissions, apiRegister, dbScalar, cleanupTestUser, transport, pauseRecording, resumeRecording } from './helpers';

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

test.setTimeout(420_000);

// Creator accounts are minted through the local dev database.
test.skip(
  !!process.env.TURSO_DATABASE_URL,
  'voice spec needs the local dev database file; skipping against shared DB',
);
test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

const SCRIPT = Array.from(
  { length: 30 },
  (_, i) =>
    `Line ${i + 1} of the voice follow script and every single line here exists to overflow the prompter.`,
).join('\n');

const scriptLines = SCRIPT.split('\n');

/** install a fake native SpeechRecognition before any app code runs. */
async function installFakeSpeech(page: Page) {
  await page.addInitScript(() => {
    interface FakeResult {
      isFinal: boolean;
      length: number;
      0: { transcript: string };
      item: () => { transcript: string };
    }
    const instances: Array<{
      started: boolean;
      onstart: ((ev: Event) => void) | null;
      onresult: ((ev: unknown) => void) | null;
      onerror: ((ev: { name: string; message?: string }) => void) | null;
      onend: ((ev: Event) => void) | null;
      emitFinal: (text: string) => void;
      emitInterim: (text: string) => void;
      emit: (text: string, isFinal: boolean) => void;
    }> = [];

    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: ((ev: Event) => void) | null = null;
      onresult: ((ev: unknown) => void) | null = null;
      onerror: ((ev: { name: string; message?: string }) => void) | null = null;
      onend: ((ev: Event) => void) | null = null;
      started = false;

      constructor() {
        instances.push(this);
      }

      start() {
        this.started = true;
        queueMicrotask(() => this.onstart?.(new Event('start')));
      }

      stop() {
        this.started = false;
      }

      abort() {
        this.started = false;
      }

      emit(text: string, isFinal: boolean) {
        if (!this.onresult) return;
        const alt = { transcript: text, confidence: 1 };
        const result: FakeResult = { isFinal, length: 1, 0: alt, item: () => alt };
        this.onresult({
          resultIndex: 0,
          results: { length: 1, 0: result, item: () => result },
        });
      }

      emitFinal(text: string) {
        this.emit(text, true);
      }

      emitInterim(text: string) {
        this.emit(text, false);
      }
    }

    const w = window as unknown as {
      SpeechRecognition: unknown;
      webkitSpeechRecognition: unknown;
      __ssxSpeech: {
        instances: typeof instances;
        last: () => (typeof instances)[number] | undefined;
        count: () => number;
        lastStarted: () => boolean;
      };
    };
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
    w.__ssxSpeech = {
      instances,
      last: () => instances[instances.length - 1],
      count: () => instances.length,
      lastStarted: () =>
        instances.length > 0 && instances[instances.length - 1].started,
    };
  });
}

/** Remove SpeechRecognition entirely (unsupported-browser surface). */
async function removeSpeechSupport(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });
}

async function upgradeToCreator(email: string) {
  await dbScalar(
    `UPDATE users SET plan = 'creator_monthly', plan_expires_at = ? WHERE email = ?`,
    [FUTURE, email.toLowerCase()],
  );
}

/** Current scrollTop of the teleprompter scroll container (-1 if absent). */
function prompterScroll(page: Page): Promise<number> {
  return page.evaluate(() => {
    const outer = document.querySelector('[aria-label="Teleprompter script"]');
    const inner = outer?.firstElementChild as HTMLElement | null;
    return inner ? inner.scrollTop : -1;
  });
}

/** Emit finals for the given script lines from the active fake instance. */
async function emitFinal(page: Page, lines: string[]) {
  await page.evaluate((texts) => {
    const w = window as unknown as {
      __ssxSpeech: { last: () => { emitFinal: (t: string) => void } | undefined };
    };
    const inst = w.__ssxSpeech.last();
    if (!inst) throw new Error('no recognition instance');
    for (const t of texts) inst.emitFinal(t);
  }, lines);
}

async function emitInterim(page: Page, line: string) {
  await page.evaluate((text) => {
    const w = window as unknown as {
      __ssxSpeech: { last: () => { emitInterim: (t: string) => void } | undefined };
    };
    const inst = w.__ssxSpeech.last();
    if (!inst) throw new Error('no recognition instance');
    inst.emitInterim(text);
  }, line);
}

async function lastRecognitionStarted(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as { __ssxSpeech?: { lastStarted: () => boolean } };
    return w.__ssxSpeech?.lastStarted() ?? false;
  });
}

const voiceSwitch = (page: Page) =>
  page.getByRole('switch', { name: 'Voice follow' });

async function fillScript(page: Page) {
  await page.getByLabel('Script Editor').fill(SCRIPT);
  // The prompter mirrors the editor content.
  await expect(page.locator('[aria-label="Teleprompter script"]')).toContainText(
    'Line 1 of the voice follow script',
  );
}

test('creator: voice follow is offered, follows speech, holds on mismatch, stops on disable', async ({ page }) => {
  const email = `e2evoice${Date.now()}@example.com`;
  try {
    await installFakeSpeech(page);
    await apiRegister(page.request, email);
    await upgradeToCreator(email);
    await page.goto('/studio');
    await studioReady(page);
    await fillScript(page);

    // Entitlement surface: offered to Creator, with live support detection.
    const toggle = voiceSwitch(page);
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    expect(await lastRecognitionStarted(page)).toBe(false);

    // Enable → recognition starts and reports listening.
    await toggle.click();
    await expect(
      page.getByText('Listening — the prompter follows your speech.'),
    ).toBeVisible({ timeout: 10_000 });
    expect(await lastRecognitionStarted(page)).toBe(true);

    // Interim results commit only after stability (two identical sightings).
    const s0 = await prompterScroll(page);
    expect(s0).toBe(0);
    await emitInterim(page, scriptLines[0]);
    await page.waitForTimeout(200);
    expect(await prompterScroll(page)).toBe(s0); // first sighting: holds
    await emitInterim(page, scriptLines[0]); // second sighting: commits line 1
    await page.waitForTimeout(200);
    const s1 = await prompterScroll(page);
    await emitInterim(page, scriptLines[1]);
    await page.waitForTimeout(200);
    expect(await prompterScroll(page)).toBe(s1); // stability not yet met → holds
    await emitInterim(page, scriptLines[1]);
    await expect
      .poll(() => prompterScroll(page), { timeout: 5_000 })
      .toBeGreaterThan(s1); // stable → advances to line 2

    // A matching final advances further…
    const afterInterims = await prompterScroll(page);
    await emitFinal(page, [scriptLines[2]]);
    await expect
      .poll(() => prompterScroll(page), { timeout: 5_000 })
      .toBeGreaterThan(afterInterims);
    const advanced = await prompterScroll(page);

    // …while non-matching speech holds the position (no wild jumping).
    await emitFinal(page, ['completely unrelated words banana phone signal']);
    await page.waitForTimeout(400);
    expect(await prompterScroll(page)).toBe(advanced);

    // Disable: recognition stops, position freezes where it was (no snap-back).
    await toggle.click();
    await expect(
      page.getByText('Speak your script — the prompter follows your words. Pauses hold the position; it never jumps.'),
    ).toBeVisible();
    expect(await lastRecognitionStarted(page)).toBe(false);
    expect(await prompterScroll(page)).toBe(advanced);
  } finally {
    await cleanupTestUser(email);
  }
});

test('creator: voice follow pauses with the recording and reading to the end fires the frozen DC-2 auto-stop', async ({ page }) => {
  const email = `e2evoice2${Date.now()}@example.com`;
  try {
    await installFakeSpeech(page);
    await apiRegister(page.request, email);
    await upgradeToCreator(email);
    await page.goto('/studio');
    await studioReady(page);
    await fillScript(page);

    await voiceSwitch(page).click();
    await expect(
      page.getByText('Listening — the prompter follows your speech.'),
    ).toBeVisible({ timeout: 10_000 });
    // Record with voice follow engaged (timed scroll is inert — voice owns it).
    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });
    expect(await prompterScroll(page)).toBe(0); // handleRecordStart resets to top

    // Speech advances the prompter during the take.
    await emitFinal(page, scriptLines.slice(0, 6));
    await expect.poll(() => prompterScroll(page), { timeout: 5_000 }).toBeGreaterThan(0);
    const beforePause = await prompterScroll(page);

    // Pause → hold: recognition stops with the pause, so even matching
    // speech cannot move the position.
    await pauseRecording(page);
    await emitFinal(page, [scriptLines[6]]);
    await page.waitForTimeout(400);
    expect(await prompterScroll(page)).toBe(beforePause);

    // Resume → a fresh recognition instance is started; speech advances
    // again from where the cursor was (the dropped line is re-read here —
    // forward-only matching needs contiguity inside the lookahead window).
    await resumeRecording(page);
    await expect
      .poll(async () => lastRecognitionStarted(page), { timeout: 10_000 })
      .toBe(true);
    await emitFinal(page, scriptLines.slice(6, 14));
    await expect
      .poll(() => prompterScroll(page), { timeout: 5_000 })
      .toBeGreaterThan(beforePause);

    // Read the rest of the script → scroll to end → the EXISTING geometry
    // check fires the frozen script-end auto-stop with its exact toast.
    await emitFinal(page, scriptLines.slice(14));
    await expect(
      page.getByText('Script ended — recording stopped', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    // The take landed in review through the normal pipeline.
    await page.getByText('Preview as', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Export recording' })).toBeVisible();
  } finally {
    await cleanupTestUser(email);
  }
});

test('guest and free never see the voice follow control', async ({ page }) => {
  const email = `e2evoicefree${Date.now()}@example.com`;
  try {
    await installFakeSpeech(page);

    // Guest: SpeechRecognition exists (Chromium), but there is no entitlement.
    await page.goto('/studio');
    await studioReady(page);
    await expect(voiceSwitch(page)).toHaveCount(0);

    // Free: same — the control is absent, not a dead/locked switch.
    await apiRegister(page.request, email);
    await page.reload();
    await studioReady(page);
    await expect(page.getByRole('button', { name: 'Log In' })).toHaveCount(0);
    await expect(voiceSwitch(page)).toHaveCount(0);
  } finally {
    await cleanupTestUser(email);
  }
});

test('creator without browser SpeechRecognition support: no voice follow control', async ({ page }) => {
  const email = `e2evoicenosup${Date.now()}@example.com`;
  try {
    await apiRegister(page.request, email);
    await upgradeToCreator(email);
    await removeSpeechSupport(page);
    await page.goto('/studio');
    await studioReady(page);
    // Entitled but unsupported → the control is not offered (FC-1.1 §8 lim. 7).
    await expect(voiceSwitch(page)).toHaveCount(0);
  } finally {
    await cleanupTestUser(email);
  }
});
