import { chromium } from '@playwright/test';
import path from 'path';

const FILE = 'file:///' + path.resolve('C:/Users/HEMAN_~1/AppData/Local/Temp/opencode/state8-css-probe.html').replace(/\\/g, '/');

const cases: Array<{ name: string; w: number; h: number; want: [number, number] }> = [
  { name: 'desktop-wide', w: 1600, h: 900, want: [16 / 9, 9 / 16, 4 / 5, 1] },
  { name: 'desktop-tall', w: 1280, h: 1400, want: [16 / 9, 9 / 16, 4 / 5, 1] },
  { name: 'laptop-short', w: 1440, h: 620, want: [16 / 9, 9 / 16, 4 / 5, 1] },
  { name: 'mobile-narrow', w: 390, h: 780, want: [16 / 9, 9 / 16, 4 / 5, 1] },
];

const browser = await chromium.launch();
for (const c of cases) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h } });
  await page.goto(FILE);
  const out = await page.evaluate(() => {
    const m = (id: string) => {
      const r = document.getElementById(id)!.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), ratio: r.width / r.height };
    };
    return { landscape: m('landscape'), vertical: m('vertical'), fourfive: m('fourfive'), square: m('square') };
  });
  const lines: string[] = [];
  const check = (label: string, actual: number, want: number) => {
    const ok = Math.abs(actual - want) < 0.02;
    lines.push(`${ok ? 'OK  ' : 'BAD '} ${label.padEnd(10)} actual=${actual.toFixed(4)} want=${want.toFixed(4)}`);
  };
  check('landscape', out.landscape.ratio, c.want[0]);
  check('vertical', out.vertical.ratio, c.want[1]);
  check('4:5', out.fourfive.ratio, c.want[2]);
  check('square', out.square.ratio, c.want[3]);
  console.log(`\n== ${c.name} (${c.w}x${c.h})`);
  console.log(`   landscape box = ${out.landscape.w}x${out.landscape.h}`);
  console.log(`   vertical  box = ${out.vertical.w}x${out.vertical.h}`);
  console.log(`   4:5       box = ${out.fourfive.w}x${out.fourfive.h}`);
  console.log(`   square    box = ${out.square.w}x${out.square.h}`);
  console.log(lines.map((l) => '   ' + l).join('\n'));
  await page.close();
}
await browser.close();
