import { chromium } from '@playwright/test';
import esbuild from 'esbuild';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const bundle = await esbuild.build({
  entryPoints: [path.join(here, 'driver.ts')],
  bundle: true, format: 'iife', globalName: 'State8',
  platform: 'browser', target: 'chrome120', write: false,
  alias: { '@': path.join(root, 'src') }, logLevel: 'warning',
});
const code = bundle.outputFiles[0].text;

const server = http.createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(code); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({ content: code });

const out = await page.evaluate(`(async () => {
  const { buildMaster } = State8;
  const { blob } = await buildMaster();
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true; v.src = url;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('decode fail')); });

  // Sample the MASTER at several times to see whether it has content at all.
  const samples = [];
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (const t of [0, 0.1, 0.25, 0.4]) {
    v.currentTime = t;
    await new Promise((res) => { v.onseeked = res; setTimeout(res, 2000); });
    ctx.drawImage(v, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let max = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { const s = d[i] + d[i+1] + d[i+2]; sum += s; if (s > max) max = s; }
    samples.push({ t, avg: +(sum / (d.length / 4)).toFixed(1), max, mid: Array.from(d.slice(((c.height>>1) * c.width + (c.width>>1)) * 4, ((c.height>>1) * c.width + (c.width>>1)) * 4 + 3)) });
  }
  return { duration: v.duration, w: v.videoWidth, h: v.videoHeight, size: blob.size, samples };
})()`);

console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
