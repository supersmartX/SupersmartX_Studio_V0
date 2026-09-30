/**
 * STATE 8 — the actual MP4 leg.
 *
 * Bundles the production export engine and composition math, runs them in real
 * Chromium over synthetic masters whose pixels are known, then decodes each
 * resulting MP4 and measures where the content actually landed.
 *
 * The unit suite proves the numbers agree; this proves the FILE agrees.
 */
import { chromium } from '@playwright/test';
import esbuild from 'esbuild';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const PLATFORMS = [
  { id: 'youtube-landscape', w: 1920, h: 1080 },
  { id: 'youtube-shorts', w: 1080, h: 1920 },
  { id: 'instagram-reels', w: 1080, h: 1920 },
  { id: 'instagram-post', w: 1080, h: 1080 },
  { id: 'instagram-portrait', w: 1080, h: 1350 },
  { id: 'tiktok', w: 1080, h: 1920 },
  { id: 'linkedin', w: 1080, h: 1920 },
];

const MASTERS = [
  { label: '16:9', w: 1280, h: 720 },
  { label: '9:16', w: 720, h: 1280 },
  { label: '1:1', w: 900, h: 900 },
  { label: '4:5', w: 864, h: 1080 },
];

/** How far a decoded calibration crossing may sit from the predicted one. */
const EDGE_TOLERANCE = 0.012;
/** Marker centroid tolerance, as a fraction of the output frame. */
const FACE_TOLERANCE = 0.02;

const bundle = await esbuild.build({
  entryPoints: [path.join(here, 'driver.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'State8',
  platform: 'browser',
  target: 'chrome120',
  write: false,
  alias: { '@': path.join(root, 'src') },
  logLevel: 'warning',
});
const code = bundle.outputFiles[0].text;

const server = http.createServer((_q, res) => {
  res.writeHead(200, { 'Content-Type': 'text/javascript' });
  res.end(code);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`console.error: ${m.text()}`);
});
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({ content: code });

/** Matches each predicted crossing to the nearest detected one, in order. */
function checkAxis(name, predicted, actual, problems) {
  if (actual.length < predicted.length) {
    problems.push(
      `${name}: only ${actual.length} calibration edges found, expected ${predicted.length}`
    );
    return;
  }
  // Detected edges are a superset (compression ringing adds extras), so match
  // greedily in order and report the worst miss.
  let idx = 0;
  let worst = 0;
  for (const p of predicted) {
    let best = Infinity;
    let bestIdx = -1;
    for (let j = idx; j < actual.length; j += 1) {
      const d = Math.abs(actual[j] - p);
      if (d < best) {
        best = d;
        bestIdx = j;
      }
    }
    if (bestIdx === -1 || best > EDGE_TOLERANCE) {
      problems.push(
        `${name}: expected a calibration edge near ${p.toFixed(3)}, nearest was ` +
          `${bestIdx === -1 ? 'none' : actual[bestIdx].toFixed(3)} (off by ${best === Infinity ? 'n/a' : best.toFixed(3)})`
      );
      return;
    }
    worst = Math.max(worst, best);
    idx = bestIdx + 1;
  }
  if (worst > 0) process.stdout.write(` [${name} max err ${worst.toFixed(4)}]`);
}

let failures = 0;
let ran = 0;

try {
  for (const m of MASTERS) {
    console.log(`\nmaster ${m.label} (${m.w}x${m.h})`);
    for (const p of PLATFORMS) {
      const r = await page.evaluate(`(async () => {
        const { buildMaster, inspectPlatform } = State8;
        const { blob, duration } = await buildMaster(${m.w}, ${m.h});
        const master = {
          id: 'm1', blob, duration, hasAudio: false, url: '',
          sourceWidth: ${m.w}, sourceHeight: ${m.h},
          createdAt: Date.now(), sizeBytes: blob.size,
        };
        return await inspectPlatform(master, '${p.id}');
      })()`);

      const problems = [];
      if (r.actual.width !== p.w || r.actual.height !== p.h) {
        problems.push(`file is ${r.actual.width}x${r.actual.height}, expected ${p.w}x${p.h}`);
      }
      if (!r.actual.hasMoov) problems.push('no moov box');
      if (!r.actual.codec || !r.actual.codec.startsWith('avc')) {
        problems.push(`codec is ${r.actual.codec || 'unknown'}, expected avc`);
      }
      if (!r.edgeContent) problems.push('left/right frame edge is black — not full bleed');
      checkAxis('U', r.uEdges.predicted, r.uEdges.actual, problems);
      checkAxis('V', r.vEdges.predicted, r.vEdges.actual, problems);
      if (!r.face) {
        problems.push('marker not found in the decoded frame');
      } else {
        const du = Math.abs(r.face.u - r.predictedFace.u);
        const dv = Math.abs(r.face.v - r.predictedFace.v);
        if (du > FACE_TOLERANCE) {
          problems.push(`marker x off by ${(du * 100).toFixed(1)}% (predicted ${r.predictedFace.u.toFixed(3)}, got ${r.face.u.toFixed(3)})`);
        }
        if (dv > FACE_TOLERANCE) {
          problems.push(`marker y off by ${(dv * 100).toFixed(1)}% (predicted ${r.predictedFace.v.toFixed(3)}, got ${r.face.v.toFixed(3)})`);
        }
      }

      ran += 1;
      if (problems.length) failures += 1;
      console.log(`  ${problems.length ? 'FAIL' : 'ok  '} ${p.id.padEnd(20)} ${p.w}x${p.h}`);
      for (const problem of problems) console.log(`         - ${problem}`);
    }
  }
} catch (e) {
  console.log('ERROR: ' + (e && e.message ? e.message : String(e)));
  failures += 1;
} finally {
  if (logs.length) console.log('\nbrowser logs:\n' + logs.slice(0, 20).join('\n'));
  await browser.close();
  server.close();
}

console.log(`\n${ran - failures}/${ran} exports verified against real MP4 bytes`);
process.exit(failures ? 1 : 0);
