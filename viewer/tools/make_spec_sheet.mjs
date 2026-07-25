/**
 * Generate the download bundle for a configured Bee Home.
 *
 *   cd viewer && node tools/make_spec_sheet.mjs 01400APPM [outdir]
 *
 * Produces a two-page PDF plus the build files. The drawings are captured from
 * the builder itself in plate mode, so what someone prints is literally the
 * thing they configured — there is no second model to drift out of sync.
 *
 * Lives inside viewer/ because it depends on the viewer's build output and on
 * playwright from its node_modules. Run `npm run build` first.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(ROOT, 'viewer/dist');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 5411;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const file = join(DIST, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

/** Parse a Bee Home ID the same way the builder does. */
function parseId(id) {
  const m = /^(\d{2})(\d*)([A-P]+)$/i.exec(id.trim());
  if (!m) throw new Error(`not a Bee Home ID: ${id}`);
  const position = { '01': 'Standing', '02': 'Grounded', '03': 'Fixed' }[m[1]];
  if (!position) throw new Error(`unknown position code ${m[1]}`);
  return { position, heightMm: m[2] ? Number(m[2]) : null, stack: m[3].toUpperCase().split('') };
}

function exportString(id) {
  const { position, stack } = parseId(id);
  const base = { Standing: 'BASE_STANDING', Grounded: 'BASE_GROUNDED', Fixed: 'BASE_FIXED' }[position];
  const parts = [...stack];
  if (position === 'Fixed' && parts.length >= 2) parts[parts.length - 2] += '1';
  if (parts.length) parts[parts.length - 1] += '2';
  return [base, ...parts.map((p) => (p.length === 1 ? `${p}0` : p))].join(',');
}

async function capture(browser, url, size) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 3 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.plateReady === '1', { timeout: 30000 });
  await page.waitForTimeout(1200);
  const shot = await page.screenshot({ type: 'png' });
  await page.close();
  return `data:image/png;base64,${shot.toString('base64')}`;
}

function sheet({ id, spec, plates, font, cutList, totals }) {
  // Deliberately a drawing sheet, not a brochure: title block, sheet numbers,
  // measured views. But the language stays plain — the reader is as likely to
  // be a first-time maker as a CNC operator.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family:'S10'; src:url(${font}) format('woff2'); }
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { margin:0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; color:#2a2920;
  font-size:8.6pt; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.page { page-break-after: always; height: 273mm; display:flex; flex-direction:column; }
.page:last-child { page-break-after: auto; }
.mono { font-family:'SFMono-Regular',Menlo,Consolas,monospace; }
.rule { border:0; border-top:1px solid #2a2920; margin:0; }
.hair { border:0; border-top:1px solid #c9c7bc; margin:0; }

.titleblock { display:grid; grid-template-columns: 1fr auto; align-items:flex-end; gap:12mm; padding-bottom:2.5mm; }
.titleblock h1 { font-family:'S10',sans-serif; font-weight:400; font-size:22pt; margin:0; letter-spacing:.02em; }
.titleblock .sub { color:#7d7d73; font-size:7.6pt; letter-spacing:.14em; text-transform:uppercase; margin-top:1mm; }
.idblock { text-align:right; }
.idblock .id { font-family:'SFMono-Regular',Menlo,monospace; font-size:14pt; letter-spacing:.06em; }
.idblock .meta { color:#7d7d73; font-size:7pt; letter-spacing:.1em; text-transform:uppercase; }

.specrow { display:grid; grid-template-columns: repeat(4, 1fr); gap:4mm; padding:2.5mm 0; }
.specrow div span { display:block; color:#7d7d73; font-size:6.6pt; letter-spacing:.14em; text-transform:uppercase; }
.specrow div b { font-weight:500; font-size:9pt; font-family:'SFMono-Regular',Menlo,monospace; }

.drawings { display:grid; grid-template-columns: 1.5fr 1fr; gap:6mm; flex:1; min-height:0; padding:4mm 0; }
.plate { border:1px solid #d8d6cb; position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.plate img { width:100%; height:100%; object-fit:contain; }
.plate .cap { position:absolute; left:2mm; bottom:1.6mm; font-size:6.4pt; letter-spacing:.14em; text-transform:uppercase; color:#7d7d73; }
.stackviews { display:grid; grid-template-rows:1fr 1fr; gap:6mm; min-height:0; }

table { width:100%; border-collapse:collapse; font-size:7.6pt; }
th { text-align:left; font-weight:400; color:#7d7d73; font-size:6.6pt; letter-spacing:.14em;
  text-transform:uppercase; border-bottom:1px solid #2a2920; padding:1.4mm 2mm 1.4mm 0; }
td { padding:1.3mm 2mm 1.3mm 0; border-bottom:1px solid #e6e4da; font-variant-numeric:tabular-nums; }
td.n { font-family:'SFMono-Regular',Menlo,monospace; }

.cols { display:grid; grid-template-columns:1fr 1fr; gap:8mm; }
h2 { font-size:8.4pt; letter-spacing:.16em; text-transform:uppercase; color:#7d7d73;
  font-weight:500; margin:0 0 2mm; padding-top:3mm; border-top:1px solid #2a2920; }
ol,ul { margin:0 0 4mm; padding-left:4.5mm; }
li { margin-bottom:1.6mm; }
.note { border-left:2px solid #a5b7e6; background:#f2f4fa; padding:2.5mm 3mm; margin:0 0 4mm; }
.warn { border-left:2px solid #c98a3c; background:#faf4ea; padding:2.5mm 3mm; margin:0 0 4mm; }
.foot { margin-top:auto; padding-top:2mm; border-top:1px solid #2a2920; display:flex;
  justify-content:space-between; color:#7d7d73; font-size:6.6pt; letter-spacing:.1em; text-transform:uppercase; }
</style></head><body>

<section class="page">
  <div class="titleblock">
    <div>
      <h1>Bee Home</h1>
      <p class="sub">Build drawings &amp; cut list</p>
    </div>
    <div class="idblock">
      <div class="id">${id}</div>
      <div class="meta">Bee Home identification</div>
    </div>
  </div>
  <hr class="rule" />

  <div class="specrow">
    <div><span>Position</span><b>${spec.position}</b></div>
    <div><span>Overall height</span><b>${totals.overall} mm</b></div>
    <div><span>Storeys</span><b>${spec.stack.length} &middot; ${totals.stackOnly} mm</b></div>
    <div><span>Material</span><b>${totals.thickness} mm sheet</b></div>
  </div>
  <hr class="hair" />

  <div class="drawings">
    <div class="plate"><img src="${plates.iso}" alt="Exploded axonometric" /><span class="cap">Exploded axonometric &middot; storeys fanned in build order</span></div>
    <div class="stackviews">
      <div class="plate"><img src="${plates.front}" alt="Front elevation" /><span class="cap">Front elevation &middot; ${totals.width} mm wide &middot; stack ${totals.stackOnly} mm</span></div>
      <div class="plate"><img src="${plates.plan}" alt="Plan" /><span class="cap">Plan &middot; ${totals.width} &times; ${totals.depth} mm</span></div>
    </div>
  </div>

  <h2>Cut list &mdash; ${cutList.length} storey parts, bottom to top</h2>
  <table>
    <thead><tr><th style="width:14%">Order</th><th style="width:16%">Storey</th><th style="width:26%">Footprint</th><th style="width:16%">Thickness</th><th>Notes</th></tr></thead>
    <tbody>${cutList.map((r) => `<tr>
      <td class="n">${r.order}</td><td class="n">${r.letter}</td>
      <td class="n">${r.w} &times; ${r.d} mm</td><td class="n">${r.h} mm</td><td>${r.note}</td></tr>`).join('')}
    </tbody>
  </table>

  <div class="foot"><span>Sheet 1 of 2 &middot; the build</span><span>${id}</span></div>
</section>

<section class="page">
  <div class="titleblock">
    <div><h1>Make it, site it, keep it</h1><p class="sub">Everything after the cutting</p></div>
    <div class="idblock"><div class="id">${id}</div><div class="meta">Bee Home identification</div></div>
  </div>
  <hr class="rule" />

  <div class="cols">
    <div>
      <h2>What to hand your maker space</h2>
      <p>Send the whole folder. Three things matter to whoever runs the machine:</p>
      <ul>
        <li><b class="mono">bee-home-${id}.dxf</b> &mdash; the nested cutting file, already laid out on one sheet.</li>
        <li><b>${totals.thickness} mm hardwood or exterior-grade ply.</b> Untreated. Nothing chemically preserved &mdash; it has to be safe for the occupants.</li>
        <li><b>A 6 mm cutter, climb-cut avoided on the pockets.</b> Pockets are dimensioned in the layer names, e.g. <span class="mono">POCKET-INSIDE_T6MM_20.00MM</span>.</li>
      </ul>
      <p>No CNC nearby? Every part is a flat profile. It is slower but entirely possible with a jigsaw, a drill and a chisel &mdash; print the elevation on sheet 1 at 100%&nbsp;scale and use it as a template.</p>

      <h2>Assembly</h2>
      <ol>
        <li>Lay out the storeys in the order on sheet 1, cavities facing the same way.</li>
        <li>Thread the spine through each storey from the bottom.</li>
        <li>Drop the key into the slot at the top and tap it home. No glue, no screws.</li>
        <li>Fit the base plate, then the legs or spike.</li>
      </ol>
      <div class="note"><b>It is meant to come apart.</b> If a joint needs forcing, check the storey is the right way round before you reach for a mallet.</div>
    </div>

    <div>
      <h2>Where to put it</h2>
      <ul>
        <li><b>Facing the morning sun</b> &mdash; south to south-east in the northern hemisphere. Cold cavities do not get used.</li>
        <li><b>Sheltered from rain</b>, under an eave or with the roof storey overhanging well.</li>
        <li><b>Firmly fixed.</b> Anything that swings or rattles gets abandoned.</li>
        <li><b>1&ndash;2 m off the ground</b>, with flowers within about 300 m.</li>
      </ul>

      <h2>Every autumn</h2>
      <ol>
        <li>Take it down once the season's activity has stopped.</li>
        <li>Split the storeys apart at the spine.</li>
        <li>Brush the cavities out dry. No detergent, no pressure washer.</li>
        <li>Store somewhere cold, dry and mouse-proof; put it back out in early spring.</li>
      </ol>
      <div class="warn"><b>This is not optional.</b> Cavities that are never cleaned build up mites and fungal disease, and an uncleaned bee hotel does more harm than no bee hotel at all. The joinery exists so that this takes ten minutes.</div>

      <h2>Which bees this actually helps</h2>
      <p>Cavity-nesting solitary bees &mdash; mason and leafcutter bees. Around seventy per cent of solitary bee species nest in the ground instead and will never use a box like this. If you want to help those too, leave a patch of bare, unmulched, sunny soil undisturbed.</p>
    </div>
  </div>

  <div class="foot">
    <span>Sheet 2 of 2 &middot; make, site, maintain</span>
    <span>CC BY 4.0 &middot; SPACE10, Bakken &amp; B&aelig;ck, Tanita Klein</span>
  </div>
</section>
</body></html>`;
}

async function main() {
  const id = process.argv[2] ?? '01400APPM';
  const outDir = process.argv[3] ?? join(ROOT, `docs/exports/${id}`);
  if (!existsSync(DIST)) throw new Error('viewer/dist missing — run `npm run build` in viewer/');

  const spec = parseId(id);
  const index = JSON.parse(await readFile(join(DIST, 'models/index.json'), 'utf8'));
  await mkdir(outDir, { recursive: true });

  const server = await serve();
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const base = `http://localhost:${PORT}/?id=${id}&clean=1`;
  const plates = {
    iso: await capture(browser, `${base}&plate=iso&explode=64`, { width: 900, height: 1180 }),
    front: await capture(browser, `${base}&plate=front`, { width: 760, height: 620 }),
    plan: await capture(browser, `${base}&plate=plan`, { width: 760, height: 620 }),
  };

  const sizes = spec.stack.map((l) => index.storeys[l].a.size_mm);
  const totals = {
    width: Math.max(...sizes.map((s) => s[0])),
    depth: Math.max(...sizes.map((s) => s[1])),
    // For a standing or grounded home the ID's height field is the overall
    // height; a fixed one is just the stack, since it has no support under it.
    stackOnly: Math.round(sizes.reduce((t, s) => t + s[2], 0)),
    overall: spec.heightMm ?? Math.round(sizes.reduce((t, s) => t + s[2], 0)),
    thickness: 6,
  };
  const cutList = spec.stack.map((letter, i) => ({
    order: String(i + 1).padStart(2, '0'),
    letter,
    w: index.storeys[letter].a.size_mm[0],
    d: index.storeys[letter].a.size_mm[1],
    h: index.storeys[letter].a.size_mm[2],
    note: i === spec.stack.length - 1 ? 'Roof cut — overhangs the storey below' : 'Standard cut',
  }));

  const font = `data:font/woff2;base64,${(await readFile(join(ROOT, 'docs/reference/fonts/S10Beehome-Display.woff2'))).toString('base64')}`;
  const html = sheet({ id, spec, plates, font, cutList, totals });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.pdf({
    path: join(outDir, `bee-home-${id}-guide.pdf`),
    format: 'A4', printBackground: true,
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
  });
  await page.close();
  await browser.close();
  server.close();

  await writeFile(join(outDir, 'bee-home.txt'),
    `Bee Home ${id}\n\nGrasshopper export string:\n${exportString(id)}\n\n`
    + `Paste that into BEEHOME.gh to regenerate the cutting files.\n`
    + `Licensed CC BY 4.0 — SPACE10, Bakken & Bæck, Tanita Klein.\n`);

  console.log(`wrote ${outDir}/bee-home-${id}-guide.pdf`);
}

main();
