import { chromium } from '@playwright/test';

const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');

const browser = await chromium.launch();

const viewports = [
  { name: 'desktop-wide 1600x900', w: 1600, h: 900 },
  { name: 'desktop-tall 1280x1400', w: 1280, h: 1400 },
  { name: 'laptop-short 1440x620', w: 1440, h: 620 },
  { name: 'mobile-narrow 390x780', w: 390, h: 780 },
];

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });

  // current
  await page.goto(fileUrl('C:/Users/HEMAN_~1/AppData/Local/Temp/opencode/state8-fix.html'));
  const cur = await page.evaluate(`(() => {
    const r = document.getElementById('cur-landscape').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), ratio: r.width / r.height };
  })()`);

  // fixed
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;height:100%}
    .region{height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;box-sizing:border-box}
    .box{background:#333;position:relative;width:100%;max-width:64rem;aspect-ratio:16/9}
    @media (min-width:640px){.box{height:100%;width:auto}}
  </style></head><body><div class="region"><div class="box" id="b"></div></div></body></html>`);
  const fix = await page.evaluate(`(() => {
    const r = document.getElementById('b').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), ratio: r.width / r.height };
  })()`);

  const flag = (r) => (Math.abs(r - 16 / 9) < 0.02 ? 'OK ' : 'BAD');
  console.log(`\n== ${vp.name}`);
  console.log(`   current: ${cur.w}x${cur.h} ratio=${cur.ratio.toFixed(4)} ${flag(cur.ratio)} (want 1.7778)`);
  console.log(`   fixed  : ${fix.w}x${fix.h} ratio=${fix.ratio.toFixed(4)} ${flag(fix.ratio)} (want 1.7778)`);
  // does it fit inside the padded region?
  console.log(`   fixed fits region? ${fix.w <= vp.w - 64 && fix.h <= vp.h - 64 ? 'yes' : 'NO (overflow)'}`);
  await page.close();
}
await browser.close();
