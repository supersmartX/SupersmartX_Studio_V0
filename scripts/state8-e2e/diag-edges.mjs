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
  const { buildMaster, runProductionExport, decodeFrameFor, profileAt, findEdges } = State8;
  const dataProbe = (d) => ({ len: d.length, ctor: d.constructor.name, first: d[0] });
  const { blob: mb } = await buildMaster(1280, 720);
  const master = { id:'m', blob: mb, duration:0.5, hasAudio:false, url:'',
    sourceWidth:1280, sourceHeight:720, createdAt:Date.now(), sizeBytes:mb.size };
  const { blob } = await runProductionExport(master, 'youtube-landscape');
  const { canvas, ctx } = await decodeFrameFor(blob, 0.15);
  const w = canvas.width, h = canvas.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  const prof = profileAt(d, w, h, 'u', 9);
  const edges = findEdges(d, w, h, 'u', Math.round(h/2), 9);
  const sample = [];
  for (let i = 0; i < prof.length; i += Math.max(1, Math.round(prof.length / 40))) sample.push(Math.round(prof[i]));
  return {
    dLen: d.length, dType: d.constructor.name, d0: d[0], d1: d[1], typed: dataProbe(d),
    w, h, len: prof.length,
    min: Math.min(...prof), max: Math.max(...prof),
    nanCount: prof.filter(Number.isNaN).length,
    sample: sample.join(','),
    edges,
  };
})()`);

console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
