/** Why does the 16:9 (youtube-landscape) U-axis find zero calibration edges? */
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

for (const id of ['youtube-landscape', 'tiktok']) {
  const out = await page.evaluate(`(async () => {
    const { buildMaster, runProductionExport, decodeFrameFor, findEdges } = State8;
    const { blob: mb } = await buildMaster(1280, 720);
    const master = { id:'m', blob: mb, duration:0.5, hasAudio:false, url:'',
      sourceWidth:1280, sourceHeight:720, createdAt:Date.now(), sizeBytes:mb.size };
    const { blob } = await runProductionExport(master, '${id}');
    const { canvas, ctx } = await decodeFrameFor(blob, 0.15);
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    // Replicate findEdges' profile for U and report its shape.
    const samples = 9, length = w, channel = 0;
    const profile = new Float64Array(length), counted = new Float64Array(length);
    for (let s = 0; s < samples; s += 1) {
      const pos = Math.min(length - 1, Math.max(0, Math.round(((s + 0.5) / samples) * (length - 1))));
      for (let i = 0; i < length; i += 1) {
        profile[i] += data[((pos) * w + i) * 4 + channel];
        counted[i] += 1;
      }
    }
    for (let i = 0; i < length; i += 1) profile[i] /= counted[i] || 1;
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < length; i += 1) { if (profile[i] < mn) mn = profile[i]; if (profile[i] > mx) mx = profile[i]; }
    return {
      w, h, min: mn, max: mx,
      edges: findEdges(data, w, h, 'u', Math.round(h/2), 9),
      sample: Array.from(profile).filter((_, i) => i % 60 === 0).map(v => Math.round(v)),
    };
  })()`);
  console.log(`\n${id}  out ${out.w}x${out.h}`);
  console.log(`  U profile min=${out.min.toFixed(1)} max=${out.max.toFixed(1)}  mid=147.5`);
  console.log(`  U edges found: ${out.edges.length}  ${out.edges.map(e => e.toFixed(3)).join(', ')}`);
  console.log(`  U profile (every 60px): ${out.sample.join(',')}`);
}

await browser.close();
server.close();
