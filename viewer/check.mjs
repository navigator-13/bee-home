import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport:{width:1280,height:900}, deviceScaleFactor:2 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5400/directions.html', { waitUntil:'networkidle' });
await p.waitForTimeout(1500);
const w = await p.evaluate(()=>({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
console.log('horizontal overflow?', w.scroll > w.client, w);
console.log('errors', errs);
for (const [name, y] of [['d-intro',0],['d-nest',900],['d-vision',2000],['d-stock',3050],['d-hybrid',4100]]) {
  await p.evaluate(v => scrollTo(0, v), y);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${process.argv[2]}/${name}.png` });
}
await b.close();
