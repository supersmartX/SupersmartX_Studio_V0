import { chromium } from '@playwright/test';
import http from 'http';

const PAGE = `<!doctype html><html><body>probe</body></html>`;
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
const out = await page.evaluate(`(async () => {
  const res = { isSecureContext, hasVideoEncoder: typeof VideoEncoder !== 'undefined', hasVideoDecoder: typeof VideoDecoder !== 'undefined', codecs: {} };
  if (!res.hasVideoEncoder) return res;
  const candidates = [
    ['avc1.42001f', 'H.264 baseline'],
    ['avc1.4d0028', 'H.264 main'],
    ['vp8', 'VP8'],
    ['vp09.00.10.08', 'VP9'],
    ['av01.0.04M.08', 'AV1'],
  ];
  for (const [codec, label] of candidates) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: 1080, height: 1920, bitrate: 5000000, framerate: 30 });
      res.codecs[label] = !!s.supported;
    } catch (e) { res.codecs[label] = 'error: ' + (e && e.message); }
  }
  res.mediaRecorder = {};
  for (const t of ['video/mp4;codecs=avc1.42001f', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8']) {
    try { res.mediaRecorder[t] = MediaRecorder.isTypeSupported(t); } catch (e) { res.mediaRecorder[t] = 'error'; }
  }
  return res;
})()`);
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
