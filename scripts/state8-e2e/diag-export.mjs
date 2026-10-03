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
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error: ' + m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({ content: code });

const out = await page.evaluate(`(async () => {
  const { buildMaster, runProductionExport } = State8;
  const { blob: masterBlob } = await buildMaster();
  const mv = document.createElement('video');
  mv.muted = true; mv.src = URL.createObjectURL(masterBlob);
  await new Promise((res, rej) => { mv.onloadeddata = res; mv.onerror = rej; });

  const master = {
    id: 'm1', blob: masterBlob, duration: 0.5, hasAudio: false, url: '',
    sourceWidth: mv.videoWidth, sourceHeight: mv.videoHeight,
    createdAt: Date.now(), sizeBytes: masterBlob.size,
  };
  const { blob, outputWidth, outputHeight } = await runProductionExport(master, 'youtube-landscape');

  const v = document.createElement('video');
  v.muted = true; v.src = URL.createObjectURL(blob);
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('decode fail')); });

  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const samples = [];
  for (const t of [0, 0.1, 0.2, 0.3]) {
    v.currentTime = t;
    await new Promise((res) => { v.onseeked = res; setTimeout(res, 2500); });
    ctx.drawImage(v, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, max = 0;
    for (let i = 0; i < d.length; i += 4) { const s = d[i] + d[i+1] + d[i+2]; sum += s; if (s > max) max = s; }
    const mid = (c.height >> 1) * c.width + (c.width >> 1);
    samples.push({ t, avg: +(sum / (d.length / 4)).toFixed(1), max, mid: Array.from(d.slice(mid * 4, mid * 4 + 3)) });
  }
  return { declared: [outputWidth, outputHeight], actual: [v.videoWidth, v.videoHeight], duration: v.duration, size: blob.size, samples };
})()`);

console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
