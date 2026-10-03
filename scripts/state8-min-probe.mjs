import { chromium } from '@playwright/test';

const viewports = [
  { name: 'desktop-wide 1600x900', w: 1600, h: 900 },
  { name: 'desktop-tall 1280x1400', w: 1280, h: 1400 },
  { name: 'laptop-short 1440x620', w: 1440, h: 620 },
  { name: 'mobile-narrow 390x780', w: 390, h: 780 },
  { name: 'ultrawide 2560x1080', w: 2560, h: 1080 },
  { name: 'tiny 320x568', w: 320, h: 568 },
];

const ratios = [
  { key: '16/9', label: 'landscape' },
  { key: '9/16', label: 'vertical  ' },
  { key: '4/5', label: '4:5       ' },
  { key: '1/1', label: 'square    ' },
];

const browser = await chromium.launch();
let allOk = true;

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;height:100%}
    .studio{display:flex;flex-direction:column;height:100vh}
    .region{flex:1 1 0%;min-height:0;container-type:size;display:flex;align-items:center;justify-content:center;padding:32px;box-sizing:border-box;background:#111}
    .box{background:#333}
  </style></head><body><div class="studio"><div class="region" id="r"></div></div></body></html>`);

  const results = {};
  for (const r of ratios) {
    const num = r.key.split('/');
    const rw = Number(num[0]);
    const rh = Number(num[1]);
    await page.evaluate(
      `(() => {
        const reg = document.getElementById('r');
        reg.innerHTML = '<div class="box" id="b" style="width: min(100cqw, calc(100cqh * ${rw} / ${rh})); aspect-ratio: ${rw} / ${rh};"></div>';
      })()`
    );
    const m = await page.evaluate(`(() => {
      const el = document.getElementById('b');
      const rect = el.getBoundingClientRect();
      const reg = document.getElementById('r').getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height), ratio: rect.width / rect.height,
               regW: Math.round(reg.width), regH: Math.round(reg.height),
               padW: Math.round(reg.width - 64), padH: Math.round(reg.height - 64) };
    })()`);
    const want = rw / rh;
    const okRatio = Math.abs(m.ratio - want) < 0.01;
    const okFit = m.w <= m.padW + 1 && m.h <= m.padH + 1;
    if (!okRatio || !okFit) allOk = false;
    results[r.label.trim()] = { ...m, okRatio, okFit, want };
  }
  console.log(`\n== ${vp.name}`);
  for (const r of ratios) {
    const v = results[r.label.trim()];
    console.log(
      `   ${r.label} ${String(v.w).padStart(5)}x${String(v.h).padStart(5)} ratio=${v.ratio.toFixed(4)} want=${v.want.toFixed(4)} ` +
        `ratio:${v.okRatio ? 'OK' : 'BAD'} fit:${v.okFit ? 'OK' : 'BAD'}(fits ${v.padW}x${v.padH})`
    );
  }
  await page.close();
}
await browser.close();
console.log(`\nALL OK: ${allOk ? 'yes' : 'NO'}`);
