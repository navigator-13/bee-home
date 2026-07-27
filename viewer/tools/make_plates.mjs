/**
 * The four assembly frames the landing page cross-fades.
 *
 * They come out of the builder itself rather than being redrawn, so what the
 * page shows is the geometry someone would actually get. `?show=N` builds the
 * whole stack first and then reveals the first N storeys, which is what keeps
 * the camera still between frames instead of zooming to fit each one.
 *
 *   cd viewer && npx vite dev &
 *   node tools/make_plates.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(repo, 'docs/plates');
const base = process.env.VIEWER_URL || 'http://127.0.0.1:5173/';
// 280mm of leg. The plates were first drawn when the slider meant total
// height, so 400 there left 280 under a 120mm stack; the slider is the
// mounting height now, and 280 is what keeps the hero's proportions.
const ID = '01280APPM';

fs.mkdirSync(out, { recursive: true });

// Let Playwright pick its own browser, with an escape hatch for hosts that
// ship Chromium separately -- this container being one of them.
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
  : {};
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({
  viewport: { width: 760, height: 1284 },
  deviceScaleFactor: 1,
});

for (let n = 1; n <= 4; n++) {
  const url = `${base}?id=${ID}&plate=iso&clean=1&alpha=1&show=${n}`;
  await page.goto(url);
  await page.waitForSelector('body[data-plate-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `bh-${n}.png`), omitBackground: true });
  console.log(`bh-${n}.png`);
}

await browser.close();
