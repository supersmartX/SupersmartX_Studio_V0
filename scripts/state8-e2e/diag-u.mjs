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

for (const id of ['youtube-landscape', 'youtube-shorts']) {
  const out = await page.evaluate(`(async () => {
    const { buildMaster, runProductionExport, decodeFrameFor } = State8;
    const { blob: mb } = await buildMaster(1280, 720);
    const master = { id:'m', blob: mb, duration:0.5, hasAudio:false, url:'',
      sourceWidth:1280, sourceHeight:720, createdAt:Date.now(), sizeBytes:mb.size };
    const { blob } = await runProductionExport(master, '${id}');
    const { canvas, ctx } = await decodeFrameFor(blob, 0.15);
    const w = canvas.width, h = canvas.height;
    const d = ctx.getImageData(0, 0, w, h).data;
    const row = Math.round(h / 2);
    const red = [];
    for (let x = 0; x < w; x += Math.max(1, Math.round(w / 32))) {
      red.push(d[(row * w + x) * 4]);
    }
    // Also the master's own mid row
    const mcv = document.createElement('video');
    mcv.muted = true; mcv.src = URL.createObjectURL(mb);
    await new Promise((res, rej) => { mcv.onloadeddata = res; mcv.onerror = rej; });
    const mc = document.createElement('canvas');
    mc.width = mcv.videoWidth; mc.height = mcv.videoHeight;
    const mctx = mc.getContext('2d', { willReadFrequently: true });
    mcv.currentTime = 0.15;
    await new Promise((res) => { mcv.onseeked = res; setTimeout(res, 3000); });
    mctx.drawImage(mcv, 0, 0);
    const md = mctx.getImageData(0, 0, mc.width, mc.height).data;
    const mrow = Math.round(mc.height / 2);
    const mred = [];
    for (let x = 0; x < mc.width; x += Math.max(1, Math.round(mc.width / 32))) {
      mred.push(md[(mrow * mc.width + x) * 4]);
    }
    return { w, h, masterW: mc.width, masterH: mc.height, outRed: red, masterRed: mred };
  })()`);
  console.log(id, `out ${out.w}x${out.h}  master ${out.masterW}x${out.masterH}`);
  console.log('  master red:', out.masterRed.join(','));
  console.log('  output red:', out.outRed.join(','));
}

await browser.close();
server.close();
