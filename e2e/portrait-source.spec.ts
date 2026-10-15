/* Portrait-source repro (export + playback content geometry).
 *
 * Both green suites share one blind spot: a landscape fake camera. The
 * suspicious branch is portrait source → any target aspect, through
 * computeCodedSourceRect() and the cover composition.
 *
 * Fixture: a GENUINE portrait recording — a 720x1280 canvas with an
 * asymmetric pattern (teal left / orange right / centred white circle),
 * captured via captureStream + MediaRecorder, probed to confirm portrait
 * coded dims, then stored through the real IndexedDB `recordings` row and
 * restored through the real reload-restore path. Synthetic pixels, genuine
 * container + pipeline + restore.
 *
 * Export per target (16:9, 9:16, 1:1, 4:5): real mediabunny encode (R2 edge
 * stubbed same-origin), download the file, decode a frame, assert:
 *   - coded dims equal the preset (no silent fallback),
 *   - full-bleed (corners not black — no letterbox bars),
 *   - centred content (centre bright — the white circle, not background),
 *   - no stretch (white-circle bbox w/h ≈ 1).
 *
 * Playback per review aspect: decoded dims stable, playing, box ratio exact,
 * cover paint, VIDEO on top at centre.
 *
 * No conditional guards: every expect must pass or the test fails loudly.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  studioReady,
  switcher,
  apiRegister,
  db,
  cleanupTestUser,
  grantMediaPermissions,
} from './helpers';

test.use({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
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
test.setTimeout(1_200_000);
test.skip(!!process.env.TURSO_DATABASE_URL, 'needs the local dev database file');
test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();
const FW = 720;
const FH = 1280;

interface FixtureInfo {
  width: number;
  height: number;
  duration: number;
  size: number;
}

/** Paint the portrait pattern, record it, probe it, persist the row. */
async function makePortraitMaster(page: Page): Promise<FixtureInfo> {
  return page.evaluate(
    async ({ w, h }: { w: number; h: number }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      // Asymmetric halves: stretch/crop mistakes move the seam or lose a side.
      ctx.fillStyle = '#008080';
      ctx.fillRect(0, 0, w / 2, h);
      ctx.fillStyle = '#ff8000';
      ctx.fillRect(w / 2, 0, w / 2, h);
      // Centred white circle: roundness proves no stretch, presence proves centring.
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 180, 0, Math.PI * 2);
      ctx.fill();

      const stream = canvas.captureStream(30);
      // captureStream only emits frames when the canvas repaints: a static
      // canvas yields a near-empty file that ends immediately. Repaint every
      // frame (pattern identical, one small marker moving) so the track carries
      // real frames for the whole take.
      let frame = 0;
      let raf = 0;
      const paint = () => {
        ctx.fillStyle = '#008080';
        ctx.fillRect(0, 0, w / 2, h);
        ctx.fillStyle = '#ff8000';
        ctx.fillRect(w / 2, 0, w / 2, h);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 180, 0, Math.PI * 2);
        ctx.fill();
        // Small dark marker far from the circle: forces fresh frames without
        // touching the white bbox or the black-fraction budget meaningfully.
        ctx.fillStyle = '#101010';
        const mx = 40 + ((frame * 7) % 120);
        ctx.fillRect(mx, h - 60, 16, 16);
        frame++;
        raf = requestAnimationFrame(paint);
      };
      paint();
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => {
        try {
          return (window as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder.isTypeSupported(m);
        } catch {
          return false;
        }
      })!;
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const done = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });
      rec.start(200);
      await new Promise((r) => setTimeout(r, 5000));
      rec.stop();
      const blob = await done;
      cancelAnimationFrame(raf);
      if (blob.size < 1000) throw new Error(`fixture blob too small: ${blob.size}`);

      const probe = await new Promise<{ w: number; h: number; d: number }>((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.src = url;
        v.onloadedmetadata = () => {
          const out = { w: v.videoWidth, h: v.videoHeight, d: v.duration };
          URL.revokeObjectURL(url);
          resolve(out);
        };
        v.onerror = () => reject(new Error('fixture probe failed'));
        setTimeout(() => reject(new Error('fixture probe timeout')), 15000);
      });
      if (!(probe.h > probe.w)) throw new Error(`fixture is not portrait: ${probe.w}x${probe.h}`);
      // captureStream webm reports Infinity duration: store a finite fallback so
      // duration-driven UI never formats Infinity. Playback itself is unaffected.
      const finiteDuration = Number.isFinite(probe.d) && probe.d > 0 ? probe.d : 5;

      // Persist through the real recordings row.
      const now = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('sxs-studio', 2);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction('recordings', 'readwrite');
          tx.objectStore('recordings').put({
            id: `master-e2e-portrait`,
            name: '',
            blob,
            mimeType: 'video/webm',
            extension: 'webm',
            duration: finiteDuration,
            hasAudio: false,
            width: probe.w,
            height: probe.h,
            aspectRatio: '9:16',
            createdAt: now,
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          });
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
      return { width: probe.w, height: probe.h, duration: finiteDuration, size: blob.size };
    },
    { w: FW, h: FH },
  );
}

interface FrameFacts {
  w: number;
  h: number;
  blackFrac: number;
  centerMean: number;
  circleRatio: number | null;
  whiteFrac: number;
}

/** Decode first frame of MP4 bytes; measure full-bleed, centre, roundness. */
async function analyseMp4(page: Page, buf: Buffer): Promise<FrameFacts> {
  return page.evaluate(async (b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    try {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = url;
      await new Promise<void>((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error('mp4 metadata error'));
        setTimeout(() => reject(new Error('mp4 metadata timeout')), 30000);
      });
      const w = v.videoWidth;
      const h = v.videoHeight;
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
      await new Promise<void>((resolve, reject) => {
        v.onseeked = () => resolve();
        v.onerror = () => reject(new Error('mp4 seek error'));
        setTimeout(() => reject(new Error('mp4 seek timeout')), 30000);
      });
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let black = 0;
      let white = 0;
      let minX = w;
      let maxX = -1;
      let minY = h;
      let maxY = -1;
      const total = w * h;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          if (r < 20 && g < 20 && b < 20) black++;
          if (r > 200 && g > 200 && b > 200) {
            white++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      // Centre 9x9 mean brightness.
      let cSum = 0;
      let cN = 0;
      for (let y = Math.floor(h / 2) - 4; y <= Math.floor(h / 2) + 4; y++) {
        for (let x = Math.floor(w / 2) - 4; x <= Math.floor(w / 2) + 4; x++) {
          const i = (y * w + x) * 4;
          cSum += (d[i] + d[i + 1] + d[i + 2]) / 3;
          cN++;
        }
      }
      const bw = maxX >= minX ? maxX - minX + 1 : 0;
      const bh = maxY >= minY ? maxY - minY + 1 : 0;
      return {
        w,
        h,
        blackFrac: black / total,
        centerMean: cSum / cN,
        circleRatio: bw > 0 && bh > 0 ? bw / bh : null,
        whiteFrac: white / total,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, buf.toString('base64'));
}

async function reviewVideo(page: Page): Promise<Locator> {
  const video = page.locator('main video');
  await expect(video, 'review video must exist').toHaveAttribute('src', /^blob:/, { timeout: 30000 });
  return video;
}

const EXPORT_CASES = [
  { title: 'YouTube', label: 'YouTube', width: 1920, height: 1080 },
  { title: 'YouTube Shorts', label: 'YouTube Shorts', width: 1080, height: 1920 },
  { title: 'Instagram Square', label: 'Instagram Square', width: 1080, height: 1080 },
  { title: 'Instagram Portrait', label: 'Instagram Portrait', width: 1080, height: 1350 },
] as const;

const REVIEW_CASES = [
  { title: 'YouTube', ratio: 16 / 9 },
  { title: 'YouTube Shorts', ratio: 9 / 16 },
  { title: 'Instagram Square', ratio: 1 },
  { title: 'Instagram Portrait', ratio: 4 / 5 },
] as const;

test('portrait source keeps composition across review and export', async ({ page }) => {
  const email = `e2eportrait${Date.now()}@example.com`;
  try {
    await page.goto('/studio');
    await studioReady(page);
    await apiRegister(page.request, email);
    await db().execute({
      sql: `UPDATE users SET plan = 'creator_monthly', plan_expires_at = ? WHERE email = ?`,
      args: [FUTURE, email.toLowerCase()],
    });

    // Genuine portrait master through the real restore path.
    const fixture = await makePortraitMaster(page);
    console.log(`fixture: ${JSON.stringify(fixture)}`);
    expect(fixture.height).toBeGreaterThan(fixture.width);
    await page.reload();
    await page.getByText('Preview as', { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
    const first = await reviewVideo(page);
    const masterDims = await first.evaluate((v) => ({
      w: (v as HTMLVideoElement).videoWidth,
      h: (v as HTMLVideoElement).videoHeight,
    }));
    expect(masterDims.h, 'restored master must be portrait').toBeGreaterThan(masterDims.w);
    expect(masterDims, 'restored master dims must equal the fixture').toEqual({
      w: fixture.width,
      h: fixture.height,
    });

    // Playback across every review aspect: same master, playing, right box.
    for (const p of REVIEW_CASES) {
      await switcher(page).locator(`button[title="${p.title}"]`).click();
      // The fixture is a few seconds long and loops: sample mid-seam and the
      // element is transiently back at HAVE_METADATA while the loop rebuffers.
      // Wait for genuinely flowing playback instead of a fixed sleep, so a
      // sample can never mistake the loop seam for a broken video. A video
      // that never reaches playing state still fails loudly on timeout.
      const video = await reviewVideo(page);
      await video.evaluate((v) => (v as HTMLVideoElement).play().catch(() => {}));
      await page.waitForFunction(
        (sel) => {
          const el = document.querySelector(sel) as HTMLVideoElement | null;
          return !!el && el.readyState >= 2 && !el.ended && !el.paused && el.currentTime > 0.05;
        },
        'main video',
        { timeout: 20000 },
      );
      const dbg = await video.evaluate((v) => {
        const el = v as HTMLVideoElement;
        return {
          rs: el.readyState,
          ns: el.networkState,
          paused: el.paused,
          ended: el.ended,
          t: el.currentTime.toFixed(2),
          dur: Number.isFinite(el.duration) ? el.duration.toFixed(2) : String(el.duration),
          err: el.error ? (el.error as unknown as { code: number }).code : null,
        };
      });
      console.log(`review @ ${p.title}: ${JSON.stringify(dbg)}`);
      const s = await video.evaluate((v) => {
        const el = v as HTMLVideoElement;
        const r = el.getBoundingClientRect();
        const box = (el.parentElement as HTMLElement).getBoundingClientRect();
        const cs = getComputedStyle(el);
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          readyState: el.readyState,
          paused: el.paused,
          w: el.videoWidth,
          h: el.videoHeight,
          boxW: box.width,
          boxH: box.height,
          objectFit: cs.objectFit,
          hitTag: hit ? hit.tagName : '<none>',
        };
      });
      expect(s.readyState, `portrait review @ ${p.title}: frames decoded`).toBeGreaterThanOrEqual(2);
      expect(s.paused, `portrait review @ ${p.title}: must autoplay`).toBe(false);
      expect({ w: s.w, h: s.h }, `portrait review @ ${p.title}: master dims stable`).toEqual({
        w: fixture.width,
        h: fixture.height,
      });
      expect(
        Math.abs(s.boxW / s.boxH - p.ratio),
        `portrait review @ ${p.title}: box must be the platform ratio`,
      ).toBeLessThan(0.03);
      expect(s.objectFit, `portrait review @ ${p.title}: cover paint`).toBe('cover');
      expect(s.hitTag, `portrait review @ ${p.title}: VIDEO on top`).toBe('VIDEO');
    }

    // Export matrix on the same portrait master.
    await page.route('**/api/exports/presigned-put', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobId: `ej-e2e-${Date.now()}`,
          key: 'e2e/capture.mp4',
          uploadUrl: '/api/e2e-upload-capture',
          expiresIn: 900,
        }),
      }),
    );
    await page.route('**/api/e2e-upload-capture', (route) => route.fulfill({ status: 200, body: '' }));
    await page.route('**/api/exports/complete', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exportId: 'ex-e2e', r2Key: 'e2e/capture.mp4' }),
      }),
    );
    const fs = require('fs') as typeof import('fs');

    for (const c of EXPORT_CASES) {
      await switcher(page).locator(`button[title="${c.title}"]`).click();
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Export recording' });
      await dialog.waitFor({ state: 'visible', timeout: 15000 });
      await expect(dialog.getByText(`${c.width} × ${c.height}`).first()).toBeVisible({
        timeout: 10000,
      });

      const jobPromise = page.waitForResponse(
        (r) => r.url().includes('/api/export-jobs') && r.request().method() === 'POST',
        { timeout: 120000 },
      );
      const donePromise = dialog.getByText('Video exported').waitFor({ timeout: 600000 });
      await dialog.getByRole('button', { name: `Export ${c.label} · ${c.width}×${c.height}` }).click();
      const jobResp = await jobPromise;
      expect(jobResp.status(), `portrait→${c.title}: job POST must succeed`).toBe(201);
      const { jobId } = (await jobResp.json()) as { jobId: string };
      await donePromise;

      const dlPromise = page.waitForEvent('download', { timeout: 60000 });
      await dialog.getByRole('button', { name: 'Download Video' }).click();
      const dl = await dlPromise;
      const dlPath = await dl.path();
      const bytes = fs.readFileSync(dlPath!) as Buffer;
      expect(bytes.length, `portrait→${c.title}: MP4 must not be empty`).toBeGreaterThan(1000);
      const facts = await analyseMp4(page, bytes);
      expect({ w: facts.w, h: facts.h }, `portrait→${c.title}: coded dims must be preset`).toEqual({
        w: c.width,
        h: c.height,
      });
      expect(facts.blackFrac, `portrait→${c.title}: full-bleed, no bars (black=${facts.blackFrac})`).toBeLessThan(
        0.01,
      );
      expect(
        facts.centerMean,
        `portrait→${c.title}: content centred (centre brightness=${facts.centerMean})`,
      ).toBeGreaterThan(100);
      expect(facts.circleRatio, `portrait→${c.title}: circle must survive`).not.toBeNull();
      expect(
        Math.abs(facts.circleRatio! - 1),
        `portrait→${c.title}: no stretch (circle w/h=${facts.circleRatio})`,
      ).toBeLessThan(0.12);

      const patch = await page.request.patch(`/api/export-jobs/${jobId}`, {
        data: { status: 'failed', errorMessage: 'e2e cleanup' },
      });
      expect(patch.status(), `portrait→${c.title}: cleanup PATCH must succeed`).toBe(200);
      await dialog.getByRole('button', { name: 'Export for Another Platform' }).click();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    }
  } finally {
    await cleanupTestUser(email);
  }
});
