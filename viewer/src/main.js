import * as THREE from 'three';
import { Stage } from './scene.js';
import {
  LETTERS, POSITIONS, allowedNext, canPlace, exportString, formatId, parseId, validateStack,
} from './design.js';
import { DEFAULT_WOOD, WOODS, finishSpec, woodByKey } from './woods.js';
import { makeZip } from './zip.js';
import { buildDxf } from './dxf.js';

const state = {
  position: 'standing',
  // Low by default. A Bee Home on short legs sits in the planting rather than
  // above it, which is both how they are usually set and a better first look.
  heightMm: 180,
  stack: ['A', 'P', 'P', 'M'],
  woods: ['douglas', 'douglas', 'douglas', 'douglas'],
  variant: 'a',
  mode: 'timber',
  selected: -1,
};

let index = null;
let rules = null;
let stage = null;
let preview = null;

const el = (id) => document.getElementById(id);

/**
 * Plate mode: the same builder, driven by the URL, used to draw the measured
 * views that go into the downloadable spec sheet.
 *
 *   ?id=01400APPM&plate=iso&explode=70&clean=1
 *
 * Keeping this in the builder rather than a separate renderer means the
 * drawings in someone's PDF are literally the thing they configured.
 */
const params = new URLSearchParams(location.search);
const plate = {
  view: params.get('plate'),                       // iso | front | plan
  explodeMm: Number(params.get('explode') || 0),   // vertical fan, per storey
  clean: params.get('clean') === '1',
  // Build the whole stack so the camera framing stays fixed, then reveal only
  // the first N storeys. Without this an assembly sequence zooms between
  // frames instead of growing in place.
  show: params.get('show') ? Number(params.get('show')) : null,
};

/**
 * When the builder ships as one self-contained file -- embedded in the
 * landing page, opened from disk, published where sibling requests are
 * blocked -- every mesh, texture and font is inlined ahead of the bundle as a
 * data URI. Three's loaders all resolve through the default manager, so one
 * hook covers the meshes and the timber maps alike.
 */
function useInlineAssets() {
  const assets = window.__BEEHOME_ASSETS__;
  if (!assets) return;
  const keys = Object.keys(assets);
  THREE.DefaultLoadingManager.setURLModifier((url) => {
    const hit = keys.find((key) => String(url).endsWith(key));
    return hit ? assets[hit] : url;
  });
}

async function boot() {
  useInlineAssets();
  [index, rules] = await Promise.all([
    fetch('models/index.json').then((r) => r.json()),
    fetch('storey-rules.json').then((r) => r.json()),
  ]);
  const fromUrl = params.get('id') ? parseId(params.get('id')) : null;
  if (fromUrl) {
    Object.assign(state, fromUrl);
    if (!state.heightMm) state.heightMm = 400;
    state.woods = state.stack.map(() => DEFAULT_WOOD);
  }
  if (params.get('woods')) state.woods = params.get('woods').split(',');
  if (plate.view) state.mode = 'drawing';
  if (plate.clean) document.body.classList.add('clean');
  if (params.get('alpha') === '1') document.body.classList.add('alpha');

  stage = new Stage(el('stage'));
  stage.plateWhite = plate.clean;
  stage.plateAlpha = params.get('alpha') === '1';
  stage.onFrame = positionRail;
  buildControls();
  await rebuild();
  if (plate.view === 'iso' || !plate.view) stage.lookFrom();
  document.body.classList.add('ready');
  document.body.dataset.plateReady = '1';
}

/**
 * Which production cut a storey at position `i` actually is, and the mesh that
 * matches it.
 *
 * The same letter is cut three ways depending on where it lands: the topmost
 * storey is the ROOF cut, the one below it the FIXED cut when the whole thing
 * is wall-mounted, everything else DEFAULT. exportString() has always encoded
 * that in the trailing digits -- this is the same rule, so the model on screen
 * and the profile in the DXF stay the same part. The library only carries a
 * separate mesh where the cut genuinely differs; anything without one falls
 * back to the default.
 */
function cutVariant(i) {
  const top = state.stack.length - 1;
  if (i === top) return '2';
  if (state.position === 'fixed' && i === top - 1) return '1';
  return '0';
}

function storeyEntry(letter, i) {
  const slot = index.storeys[letter];
  if (state.variant === 'b') return slot.b;
  const cut = cutVariant(i);
  return (cut !== '0' && slot['a' + cut]) || slot.a;
}

/** Species for storey `i`, falling back as the stack grows. */
function woodFor(i) {
  return state.woods[i] ?? DEFAULT_WOOD;
}

function selectStorey(index) {
  state.selected = index;
  stage.setSelected(index);
  syncControls();
}

/**
 * A random stack, the same way the original site's shuffle worked: legal at
 * every join, not just legal letters in a random order. Built one storey at a
 * time from `allowedNext`, which already knows what the rules forbid above
 * whatever has been placed so far -- there is no separate validity check
 * afterward because an invalid stack is never reachable in the first place.
 *
 * Length is random too, three to seven, which is a taller spread than most
 * people build by hand and exactly the point: a shuffle is for seeing a
 * configuration you would not have picked.
 */
function shuffleStack() {
  const target = 3 + Math.floor(Math.random() * 5);
  const stack = [];
  while (stack.length < target) {
    const options = allowedNext(stack, rules);
    // The rules can paint a stack into a corner with nothing left to add.
    // Stopping there beats forcing an illegal storey on top just to hit a
    // length nobody asked for.
    if (!options.length) break;
    stack.push(options[Math.floor(Math.random() * options.length)]);
  }
  return stack;
}

/** Total height of the storey stack in millimetres. */
function stackHeight() {
  return state.stack.reduce(
    (total, letter, i) => total + storeyEntry(letter, i).size_mm[2], 0,
  );
}

/**
 * How far the stack is lifted off the ground by its mounting.
 *
 * This used to be `heightMm - stackHeight()`, reading the slider as a total
 * height. Every storey added ate into the mounting, and past about eight
 * storeys the remainder went negative: the lift clamped to zero and the legs
 * and spike silently disappeared, which is why the position buttons looked
 * like they had stopped working on a tall stack. The slider is the mounting
 * height, full stop, and the stack sits on top of whatever it says.
 */
function liftMm() {
  if (state.position === 'fixed') return 0;
  return Math.max(0, state.heightMm);
}

async function rebuild() {
  stage.clear();
  const lift = liftMm() / 1000;

  let y = lift;
  for (const [i, letter] of state.stack.entries()) {
    const entry = storeyEntry(letter, i);
    const geometry = await stage.load(entry.file);
    // The exploded plate fans the storeys apart vertically so every joint and
    // cavity is legible in a single drawing.
    const fan = (plate.explodeMm / 1000) * i;
    stage.add(geometry, new THREE.Vector3(0, y + fan, 0), { wood: woodFor(i), storey: i });
    y += entry.size_mm[2] / 1000;
  }

  // Cap it. Left open, the stack ends on the cavity channels of the top
  // storey, which is not how the object was ever shown.
  const roof = index.guides.find((g) => g.name === 'roof');
  if (roof) {
    const roofGeometry = await stage.load(roof.file);
    const roofMesh = stage.add(roofGeometry, new THREE.Vector3(0, y, 0),
      // Shares the top storey's step: closing the stack is one move, not two.
      { wood: woodFor(state.stack.length - 1), storey: state.stack.length - 1 });
    // But not the top storey's rail chip. The chip's height is the storey's
    // height on screen; measured with the roof included, the top chip came out
    // half again as tall as its neighbours and sat on them.
    roofMesh.userData.roof = true;
    // Its edges too. The drawn views hide the roof to see what is under it,
    // and a hidden slab whose outline stayed behind is the same square.
    roofMesh.userData.lines.userData.roof = true;
  }

  if (state.position !== 'fixed') {
    const base = index.guides.find((g) => g.name === 'base');
    const baseGeometry = await stage.load(base.file);
    stage.add(baseGeometry, new THREE.Vector3(0, lift - base.size_mm[2] / 1000, 0),
      { wood: woodFor(0) });
  }

  // Legs and spike are cut to length rather than repeated: the source geometry
  // is a single unit of each, and the ID's height field is what sets how far
  // the stack sits off the ground.
  const baseThickness = index.guides.find((g) => g.name === 'base').size_mm[2] / 1000;
  const supportTop = lift - baseThickness;

  if (state.position === 'standing' && supportTop > 0) {
    const leg = index.guides.find((g) => g.name === 'leg');
    const geometry = await stage.load(leg.file);
    const stretch = (supportTop * 1000) / leg.size_mm[2];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const mesh = stage.add(geometry, new THREE.Vector3(sx * 0.048, 0, sz * 0.06),
        { wood: woodFor(0) });
      mesh.scale.y = stretch;
      mesh.userData.lines.scale.y = stretch;
    }
  }

  if (state.position === 'grounded' && supportTop > 0) {
    const spike = index.guides.find((g) => g.name === 'spike');
    const geometry = await stage.load(spike.file);
    const mesh = stage.add(geometry, new THREE.Vector3(0, 0, 0), { wood: woodFor(0) });
    const stretch = (supportTop * 1000) / spike.size_mm[2];
    mesh.scale.y = stretch;
    mesh.userData.lines.scale.y = stretch;
  }

  stage.frame();
  if (plate.show !== null) {
    for (const child of stage.root.children) {
      const i = child.userData.storey;
      if (typeof i === 'number' && i >= 0 && i >= plate.show) child.visible = false;
    }
  }
  if (plate.view && plate.view !== 'iso') stage.setProjection(plate.view);
  document.body.classList.toggle('drawing', state.mode === 'drawing');
  stage.setMode(state.mode);
  stage.setSelected(state.selected);
  refreshReadout();
}

/**
 * The display face, as bytes.
 *
 * The pack has to survive being saved and opened somewhere else, so the font
 * travels inside it. Fetched as a plain relative path: that is the string the
 * single-file bundle's fetch shim matches on, and in a served build the same
 * string resolves next to the app. Without it the sheet still prints, in the
 * system sans.
 */
let displayFontUri = null;
async function displayFont() {
  if (displayFontUri !== null) return displayFontUri;
  try {
    const res = await fetch('fonts/S10Beehome-Display.woff2');
    if (!res.ok) throw new Error(String(res.status));
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    displayFontUri = `data:font/woff2;base64,${btoa(bin)}`;
  } catch {
    displayFontUri = '';
  }
  return displayFontUri;
}

const POSITION_LABEL = {
  standing: 'Standing, on legs',
  grounded: 'Grounded, on a spike',
  fixed: 'Wall-fixed',
};

/** Extent of one closed toolpath, in the flat plane it is cut in. */
function pocketBox(segs) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const see = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const seg of segs) {
    if (seg[0] === 'L') { see(seg[1], seg[2]); see(seg[3], seg[4]); continue; }
    // Arcs by their bounding square. Generous by up to a radius on the axes the
    // arc does not reach, which for the 3.2mm corner fillets here is noise.
    const [, cx, cy, r] = seg;
    see(cx - r, cy - r);
    see(cx + r, cy + r);
  }
  return minX === Infinity ? [0, 0] : [maxX - minX, maxY - minY];
}

/**
 * Which of a storey's pockets are nesting channels.
 *
 * Nothing in the source says so. The Grasshopper definition is a binary
 * archive, and the only names in the Rhino files are the layer names, which
 * record the cutter and the depth and nothing about intent. So this is read
 * off the geometry, and the geometry is clear enough:
 *
 *  · Every one of the sixteen letters carries the same 22.6 x 32.6mm pocket
 *    cut the full 30mm through the board. Identical everywhere, open at both
 *    ends -- that is the opening the stack shares, not somewhere to nest.
 *  · Each letter also carries long narrow slots, 6 to 12mm across and 99 to
 *    149mm long, cut 6 to 20mm into a 30mm board. Capped by the underside of
 *    the storey above, a slot like that is a horizontal tunnel of exactly the
 *    bore solitary bees use, at a length that favours female offspring. These
 *    are the cavities.
 *  · What is left is broad and shallow -- 52 x 22 up to 124 x 164 -- which is
 *    the front pattern and the recesses, not tunnels.
 *
 * Worth being plain about the direction of that last point: the 20mm pockets
 * are mostly pattern, and the letters whose deepest cut is 6 or 7mm are the
 * ones full of nesting channels, not the ones without any.
 */
function channels(part) {
  if (!part) return [];
  const thickness = part.size_mm[2];
  const found = [];
  for (const op of part.ops) {
    if (op.op !== 'POCKET-INSIDE' || op.depth_mm >= thickness) continue;
    const [w, h] = pocketBox(op.segs);
    const across = Math.min(w, h);
    const along = Math.max(w, h);
    if (across <= 12.5 && along >= 60) {
      found.push({ across: Math.round(across), along: Math.round(along), deep: op.depth_mm });
    }
  }
  return found;
}

/** The channel column of the cut list: like sizes grouped, one line each. */
function channelCell(part) {
  const found = channels(part);
  if (!found.length) return '—';
  const groups = new Map();
  for (const c of found) {
    const key = `${c.across} × ${c.along} × ${c.deep}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return [...groups].map(([key, n]) => `${n} × ${key}`).join('<br />');
}

/* The sheet is printed for one design, so it can say the one thing that
   applies to it rather than all three. SPACE10's own siting advice, split the
   way the builder splits the mountings. */
const SITING = {
  standing: 'A stable spot with an even surface.',
  grounded: 'Firm soil, with the spike 20 cm into the ground.',
  fixed: 'A wall, at least a metre off the ground, two screws.',
};

/**
 * The build pack, from the browser.
 *
 * The sheet set began as an offline tool driven by Playwright
 * (viewer/tools/make_spec_sheet.mjs) — upstream of the builder, and so only
 * ever as current as the last time somebody ran it. This is that drawing
 * sheet built from the live scene instead: title block, spec row, measured
 * views, and a cut list carrying the profile of every board. Laid out for A4
 * and printed through the browser's own dialog. Two sheets for most designs;
 * a stack tall enough that its profiles would print too small to read gets the
 * cut list on a sheet of its own rather than squeezed or spilled.
 */
async function buildPackHtml() {
  // Fanned for the axonometric, closed for the measured views.
  const views = stage.captureViews({ explodeMm: 64 });
  const plates = stage.capturePlates(state.stack.length);
  const font = await displayFont();

  const id = formatId(state);
  const gh = exportString(state);
  // The sheet describes the folder it travels in, so it has to know whether
  // the DXF made it into that folder.
  const library = await toolpathLibrary();
  const dxf = library ? buildDxf(library, { id, exportString: gh }) : null;
  /* Footprints come from the cutting library where it has an opinion. The
     display meshes ship one shape per letter, but production cuts H 140 deep
     as a storey and 150 as a roof, so a cut list read off the meshes told
     someone to buy stock the DXF then cut past. The export string already
     encodes which production variant each storey is -- 2 topmost, 1 second
     from top under a fixed mounting, 0 otherwise -- so the digits in it are
     the lookup key. */
  const variantDigits = gh.split(',').slice(1).map((f) => f.slice(-1));
  const partFor = (letter, i) => (library
    ? library.parts[letter + (variantDigits[i] || '0')] : null);
  const footprint = (letter, i) => {
    const part = partFor(letter, i);
    return (part && part.size_mm) || index.storeys[letter][state.variant].size_mm;
  };
  const sizes = state.stack.map((l, i) => footprint(l, i));
  const stackMm = Math.round(sizes.reduce((t, s) => t + s[2], 0));
  const overallMm = Math.round(stackHeight() + liftMm());
  const width = Math.max(...sizes.map((s) => s[0]));
  const depth = Math.max(...sizes.map((s) => s[1]));

  const species = [...new Set(state.stack.map((unused, i) => woodByKey(woodFor(i)).name))];
  const timber = species.length === 1 ? species[0] : `Mixed · ${species.length} species`;

  /* What this particular stack offers a bee, totalled. Per-storey detail is a
     column of the cut list; this is the number that decides whether the thing
     works at all, which is worth saying where someone will read it. */
  const perStorey = state.stack.map((letter, i) => channels(partFor(letter, i)));
  const allChannels = perStorey.flat();
  const bores = [...new Set(allChannels.map((c) => c.across))].sort((a, b) => a - b);
  const channelTotal = {
    count: allChannels.length,
    storeys: perStorey.filter((c) => c.length).length,
    bores: bores.join(', '),
    shortest: allChannels.length ? Math.min(...allChannels.map((c) => c.along)) : 0,
    longest: allChannels.length ? Math.max(...allChannels.map((c) => c.along)) : 0,
  };
  const THROUGH_MM = 30;

  /* Which cutters the job needs. Every part in the library is a 6mm job except
     storey D, whose two small pockets are on a T5MM layer -- so a stack with a
     D in it is a tool change, and a sheet that only ever mentions 6mm would
     have someone find that out at the machine. */
  const cutters = [...new Set(state.stack
    .map((letter, i) => partFor(letter, i))
    .filter(Boolean)
    .flatMap((part) => part.ops.map((op) => op.tool_mm)))]
    .sort((a, b) => b - a)
    .join(' & ') || '6';

  /* Every row carries its own drawing. The numbers cannot do this job on
     their own: in a stack of four different letters each one measures
     120 × 160 × 30, and what separates an A from an M is the profile.

     The fronts are not repeated per row. The spec row above says whether this
     design is plain or patterned, and it says it once. */
  const cell = (art) => (art ? `<img src="${art}" alt="" />` : '');
  const rows = state.stack.map((letter, i) => {
    const size = footprint(letter, i);
    return `<tr>
      <td class="n">${String(i + 1).padStart(2, '0')}</td>
      <td class="thumb">${cell(plates[i])}</td>
      <td class="n">${letter}</td>
      <td class="n">${size[0]} × ${size[1]} mm</td>
      <td class="n">${size[2]} mm</td>
      <td class="n">${channelCell(partFor(letter, i))}</td>
      <td>${woodByKey(woodFor(i)).name}</td>
    </tr>`;
  }).join('');

  const roof = index.guides.find((g) => g.name === 'roof');
  const base = index.guides.find((g) => g.name === 'base');
  const hardware = (name, size, wood) => `<tr class="hw">
    <td class="n">—</td><td class="thumb"></td><td>${name}</td>
    <td class="n">${size[0]} × ${size[1]} mm</td><td class="n">${size[2]} mm</td>
    <td class="n">—</td><td>${wood}</td></tr>`;

  const parts = [];
  if (state.position !== 'fixed' && base) {
    parts.push(hardware('Base plate', base.size_mm, woodByKey(woodFor(0)).name));
  }
  if (roof) {
    parts.push(hardware('Roof slab', roof.size_mm,
      woodByKey(woodFor(state.stack.length - 1)).name));
  }
  const support = liftMm();
  if (base && support > 0 && state.position === 'standing') {
    parts.push(hardware('Legs × 4', [15, 30, Math.round(support - base.size_mm[2])],
      woodByKey(woodFor(0)).name));
  }
  if (base && support > 0 && state.position === 'grounded') {
    parts.push(hardware('Ground spike', [30, 30, Math.round(support - base.size_mm[2])],
      woodByKey(woodFor(0)).name));
  }

  const titleBlock = (heading, sub) => `<div class="titleblock">
    <div><h1>${heading}</h1><p class="sub">${sub}</p></div>
    <div class="idblock"><div class="id">${id}</div>
      <div class="meta">Bee Home identification</div></div>
  </div>
  <hr class="rule" />`;

  /* Where the cut list goes, and how big its profile drawings are.

     Everything else on the drawings sheet is fixed -- title block, spec row,
     the three views, the export line and the foot -- which leaves about 91mm
     of printable page for the rows. Divided among the storeys, minus the
     hardware rows, that is the tallest a thumbnail can be there. Below about
     8mm the milled profile stops reading as a shape, and that is the point at
     which the list is better off on a sheet of its own, where a whole page of
     rows is available and the drawings are legible again. The numbers cannot
     do this job alone: in a stack of four different letters every row reads
     120 x 160 x 30, and what separates an A from an M is the profile. */
  const UNDER_DRAWINGS_MM = 91;
  const OWN_SHEET_MM = 232;
  const rowFor = (budget) => (budget - 6.9 * parts.length)
    / Math.max(1, state.stack.length);
  const listAlone = rowFor(UNDER_DRAWINGS_MM) < 11.4;
  const rowMm = rowFor(listAlone ? OWN_SHEET_MM : UNDER_DRAWINGS_MM);
  const thumbMm = Math.round(Math.max(8, Math.min(19, rowMm - 3.4)) * 10) / 10;

  const cutList = `
  ${listAlone ? '' : `<h2>Cut list — ${state.stack.length} storeys, bottom to top</h2>`}
  <table>
    <thead><tr>
      <th style="width:6%">Order</th><th style="width:13%">Profile</th>
      <th style="width:12%">Storey</th><th style="width:17%">Footprint</th>
      <th style="width:10%">Thick</th>
      <th style="width:24%">Channels w × l × d</th><th>Timber</th>
    </tr></thead>
    <tbody>${rows}${parts.join('')}</tbody>
  </table>
  <p class="ghline">Grasshopper export · paste into <b class="mono">BEEHOME.gh</b> to regenerate
    the cutting files &nbsp; <code>${gh}</code></p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Bee Home ${id} — build drawings and cut list</title>
<style>
${font ? `@font-face { font-family:'S10'; src:url(${font}) format('woff2'); }` : ''}
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { margin:0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; color:#2a2920;
  font-size:8.6pt; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.page { page-break-after: always; min-height: 268mm; display:flex; flex-direction:column; }
.page:last-child { page-break-after: auto; }
.mono { font-family:'SFMono-Regular',Menlo,Consolas,monospace; }
.rule { border:0; border-top:1px solid #2a2920; margin:0; }
.hair { border:0; border-top:1px solid #c9c7bc; margin:0; }

.titleblock { display:grid; grid-template-columns: 1fr auto; align-items:flex-end;
  gap:12mm; padding-bottom:2.5mm; }
.titleblock h1 { font-family:'S10','Helvetica Neue',sans-serif; font-weight:400;
  font-size:22pt; margin:0; letter-spacing:.02em; }
.titleblock .sub { color:#7d7d73; font-size:7.6pt; letter-spacing:.14em;
  text-transform:uppercase; margin-top:1mm; }
.idblock { text-align:right; }
.idblock .id { font-family:'SFMono-Regular',Menlo,monospace; font-size:14pt; letter-spacing:.06em; }
.idblock .meta { color:#7d7d73; font-size:7pt; letter-spacing:.1em; text-transform:uppercase; }

.specrow { display:grid; grid-template-columns: repeat(6, 1fr); gap:4mm; padding:2.5mm 0; }
.specrow div span { display:block; color:#7d7d73; font-size:6.6pt; letter-spacing:.14em;
  text-transform:uppercase; }
.specrow div b { font-weight:500; font-size:9pt; font-family:'SFMono-Regular',Menlo,monospace; }

/* A definite height, not a minimum. Left to size themselves the three plates
   took their height from the images inside them -- the render buffer is wider
   than the frame it prints in -- and pushed sheet 1 to 360mm of content in a
   273mm page. */
/* Four columns, not two. Measured on the render, the ink in each plate fills
   22 to 28 per cent of its width and about 90 per cent of its height: every
   drawing here is a tall thin object, and a landscape box around one is mostly
   margin. Narrowed to what they need, the three of them leave room for a panel
   that says what the drawings cannot. */
.drawings { display:grid; grid-template-columns: 1fr 1fr 1fr 1.35fr; gap:5mm;
  margin:4mm 0; height:104mm; }
.key { border:1px solid #d8d6cb; padding:3mm 3.5mm; overflow:hidden; }
.key h3 { font-size:6.4pt; letter-spacing:.14em; text-transform:uppercase; color:#7d7d73;
  font-weight:500; margin:0 0 1mm; }
.key h3 + p { margin-top:0; }
.key p { margin:0 0 2.6mm; font-size:7.2pt; line-height:1.45; }
.key p:last-child { margin-bottom:0; }
.plate { border:1px solid #d8d6cb; position:relative; display:flex; align-items:center;
  justify-content:center; overflow:hidden; min-height:0;
  /* Room at the foot so the caption sits on paper rather than on the legs.
     Two lines of it, set deliberately: at a column this narrow the view name
     and its dimension will not share one. */
  padding:2.5mm 2.5mm 9mm; }
.plate img { width:100%; height:100%; object-fit:contain; }
.plate .cap { position:absolute; left:2mm; bottom:1.6mm; font-size:6.4pt; letter-spacing:.14em;
  text-transform:uppercase; color:#7d7d73; line-height:1.35; }


table { width:100%; border-collapse:collapse; font-size:7.6pt; }
/* A stack tall enough to run the list past the foot of the sheet carries its
   column headings onto the next page rather than leaving bare numbers. */
thead { display:table-header-group; }
tr { break-inside:avoid; page-break-inside:avoid; }
th { text-align:left; font-weight:400; color:#7d7d73; font-size:6.6pt; letter-spacing:.14em;
  text-transform:uppercase; border-bottom:1px solid #2a2920; padding:1.4mm 2mm 1.4mm 0; }
td { padding:1.3mm 2mm 1.3mm 0; border-bottom:1px solid #e6e4da; font-variant-numeric:tabular-nums;
  vertical-align:middle; }
td.n { font-family:'SFMono-Regular',Menlo,monospace; }
td.thumb { width:${thumbMm + 3}mm; padding:1.5mm 2mm 1.5mm 0; }
td.thumb img { display:block; width:${thumbMm}mm; height:${thumbMm}mm; object-fit:contain;
  border:1px solid #e6e4da; }
tr.hw td { color:#57564d; }

.ghline { margin:3mm 0 0; color:#7d7d73; font-size:7pt; letter-spacing:.06em; }
.ghline code { font-family:'SFMono-Regular',Menlo,monospace; color:#2a2920; font-size:7.6pt; }

/* Two columns that fill rather than two columns of fixed width: the second
   page is prose, and a grid gave whichever side held the DXF a full column
   while the other ran out two thirds of the way down. Flowed, the browser
   balances them. Headings stay with the text under them and the callouts stay
   whole; everything else breaks wherever it lands. */
/* A definite height, because a multi-column block without one fragments
   across printed pages instead of balancing inside one: sheet 2 came out three
   pages long with two thirds of each empty. Given a height it balances into
   the space that is actually there. */
.cols { columns:2; column-gap:8mm; flex:1 1 auto; min-height:0; }
.page.prose { font-size:8.2pt; }
h2 { font-size:8.4pt; letter-spacing:.16em; text-transform:uppercase; color:#7d7d73;
  font-weight:500; margin:0 0 2mm; padding-top:3mm; border-top:1px solid #2a2920;
  break-after:avoid; page-break-after:avoid; }
.prose h2 { font-size:9pt; }
ol,ul { margin:0 0 4mm; padding-left:4.5mm; }
li { margin-bottom:1.6mm; }
p { margin:0 0 3mm; }
.note, .warn { break-inside:avoid; page-break-inside:avoid; }
.note { border-left:2px solid #a5b7e6; background:#f2f4fa; padding:2.5mm 3mm; margin:0 0 4mm; }
.warn { border-left:2px solid #c98a3c; background:#faf4ea; padding:2.5mm 3mm; margin:0 0 4mm; }
.foot { margin-top:auto; padding-top:2mm; border-top:1px solid #2a2920; display:flex;
  justify-content:space-between; color:#7d7d73; font-size:6.6pt; letter-spacing:.1em;
  text-transform:uppercase; }
</style></head><body>

<section class="page">
  ${titleBlock('Bee Home', listAlone ? 'Build drawings' : 'Build drawings &amp; cut list')}

  <div class="specrow">
    <div><span>Position</span><b>${POSITION_LABEL[state.position] || state.position}</b></div>
    <div><span>Overall height</span><b>${overallMm} mm</b></div>
    <div><span>Storeys</span><b>${state.stack.length} · ${stackMm} mm</b></div>
    <div><span>Timber</span><b>${timber}</b></div>
    <div><span>Fronts</span><b>${state.variant === 'b' ? 'Plain' : 'Patterned'}</b></div>
    <div><span>Cutters</span><b>${cutters} mm</b></div>
  </div>
  <hr class="hair" />

  <div class="drawings">
    <div class="plate"><img src="${views.iso}" alt="Exploded axonometric" />
      <span class="cap">Exploded axonometric<br />storeys in build order</span></div>
    <div class="plate"><img src="${views.front}" alt="Front elevation" />
      <span class="cap">Front elevation<br />${width} mm wide</span></div>
    <div class="plate"><img src="${views.side}" alt="Side elevation" />
      <span class="cap">Side elevation<br />${depth} mm deep</span></div>
    <div class="key">
      <h3>Nesting channels</h3>
      ${channelTotal.count ? `<p><b>${channelTotal.count}</b> across ${channelTotal.storeys}
        of ${state.stack.length} storeys. Bore ${channelTotal.bores} mm,
        ${channelTotal.shortest}–${channelTotal.longest} mm long.</p>
      <p>Each is a slot milled into the top of a board and closed by the underside
        of the one above it, so a storey only works with its neighbour in place.</p>`
      : `<p><b>None.</b> Every storey in this design is chamber and pattern only.
        Bees will land on it and leave. Add a storey with channels — most letters
        have them — before you cut.</p>`}
      <h3>The opening</h3>
      <p>Every storey carries the same ${THROUGH_MM} mm pocket cut right through the
        board. It is the shared opening, not somewhere to nest.</p>
      <h3>Read this as measured</h3>
      <p>Nothing in the Rhino or Grasshopper files names a pocket's purpose — only
        its cutter and depth. The split above is taken off the cut geometry.</p>
    </div>
  </div>

  ${listAlone ? '' : cutList}
  <div class="foot"><span>Sheet 1 · the drawings</span><span>${id}</span></div>
</section>

${listAlone ? `<section class="page">
  ${titleBlock('Cut list', `${state.stack.length} storeys, bottom to top`)}
  ${cutList}
  <div class="foot"><span>Sheet 2 · the cut list</span><span>${id}</span></div>
</section>` : ''}

<section class="page prose">
  ${titleBlock('The Build and the Bees', 'Everything after the cutting')}

  <div class="cols">
    ${state.variant === 'b' && dxf ? `<div class="warn"><b>Plain fronts are a
      preview.</b> The cutting library holds one set of storey profiles, the patterned
      ones, and that is what the DXF cuts. Nothing in the original production files
      matches the plain option.</div>` : ''}

    <div class="topic">
    <h2>What to hand your maker space</h2>
    <p><b>Email them the whole folder this sheet came in.</b> A maker space is an open
      workshop with a CNC router in it. Most will quote from these files without you
      joining, and most will do the work with you rather than for you.</p>
    <ul>
      ${dxf ? `<li><b>The DXF in the folder</b>,
        <span class="mono">Bee Home ${id} CNC.dxf</span>. The ${dxf.parts.length} sheet
        parts side by side, 1:1 in millimetres, R12. Production cutting geometry out of the
        original Rhino file, not a tracing of the pictures on sheet 1: native lines and
        arcs, with the inside-corner relief a round cutter needs. The original layer names
        carry the depths, so <span class="mono">POCKET-INSIDE_T6MM_20.00MM</span> is an
        inside pocket, 6&nbsp;mm cutter, 20&nbsp;mm deep.</li>` : ''}
      <li><b>This sheet, and the export string on sheet 1.</b> Dropped into
        <span class="mono">BEEHOME.gh</span> it regenerates the cutting files for exactly
        this design. That is the authoritative source; settle any disagreement against
        it.</li>
      <li><b>Untreated hardwood or exterior-grade ply.</b> Nothing chemically preserved.
        It has to be safe for the occupants.</li>
      <li><b>Someone who runs the router.</b> Every storey is cut from a single board.</li>
    </ul>
    ${dxf ? `<div class="warn"><b>Read the layers, do not just plot it.</b> Everything is
      drawn flat at Z=0 and the depth of cut lives in the layer name. The pocket curves are
      finished walls, not tool centrelines: a 6.00&nbsp;mm pocket cut with a 6&nbsp;mm
      cutter is one pass, and the outside profiles match the cut list to the millimetre.
      Which face each depth is measured from is not recorded, so cut one storey and check
      before committing to a full set. No lead-ins, no tabs, no feeds and speeds. The base
      roof slab in it is derived rather than authored: no roof exists in the toolpath
      library, so its outline is the base plate's production profile — the two share a
      140 × 160 footprint where every storey is 120 wide — and its 22 mm thickness is
      measured off the display model. The base plate, legs and spike are not in the DXF
      at all. They are stock rather than sheet parts, and the cut list carries their
      sizes.</div>` : ''}
    <p>No CNC nearby? Every part is a flat profile. It is slower but entirely possible with
      a jigsaw, a drill and a chisel. Print sheet 1 at 100% scale and use the cut list
      profiles as templates.</p>

    </div>

    <div class="topic">
    <h2>Assembly</h2>
    <ol>
      <li>Lay the storeys out in cut-list order, cavities facing the same way.</li>
      <li>Base plate first, then the storeys bottom to top, then the roof slab.</li>
      <li>The parts register on each other. No glue, no screws.</li>
      <li>Fit the ${state.position === 'grounded' ? 'spike' : 'legs'} last.</li>
    </ol>
    <div class="note"><b>It is meant to come apart.</b> If a joint needs forcing, check the
      storey is the right way round before you reach for a mallet.</div>
    </div>

    <div class="topic">
    <h2>Finish and lifespan</h2>
    <p>Natural oil if you want one, and nothing in or around the cavities: bees prefer bare
      wood and will not move into anything that smells of chemistry. Expect five to thirty
      years, depending on the timber, the spot and how well it gets cleaned.</p>

    </div>

    <div class="topic">
    <h2>Where to put it</h2>
    <ul>
      <li><b>${SITING[state.position] || SITING.standing}</b></li>
      <li><b>Facing the morning sun</b>, south to south-east in the northern hemisphere.
        Cold cavities do not get used.</li>
      <li><b>Sheltered from rain and strong wind</b>, under an eave or with the roof
        overhanging well. Keep the cavities horizontal.</li>
      <li><b>Firmly fixed.</b> Anything that swings or rattles gets abandoned.</li>
      <li><b>Flowers within about 300&nbsp;m.</b> Native wildflowers do the most work.</li>
    </ul>

    </div>

    <div class="topic">
    <h2>Every autumn</h2>
    <ol>
      <li>Take it down once the season's activity has stopped.</li>
      <li>Split the storeys apart.</li>
      <li>Brush the cavities out dry. No detergent, no pressure washer.</li>
      <li>Store somewhere cold, dry and mouse-proof; put it back out in early spring.</li>
    </ol>
    <div class="warn"><b>This is not optional.</b> Cavities that are never cleaned build up
      mites and fungal disease, and an uncleaned bee hotel does more harm than no bee hotel
      at all. The joinery exists so that this takes ten minutes.</div>

    </div>

    <div class="topic">
    <h2>What to expect</h2>
    <p>Bees are free-living and nobody can promise they will come; planting for them close
      by is what changes the odds. A used cavity gets sealed shut with mud or chewed leaf.
      Leave it: the young are inside for the winter and break the seal themselves on the
      way out.</p>

    </div>

    <div class="topic">
    <h2>Which bees this helps</h2>
    <p>Cavity-nesting solitary bees: mason bees and leafcutter bees. Every female is a
      queen. They make no honey, so they have nothing to defend, and they are safe around
      children and pets.</p>
    <p>Around seventy per cent of solitary bee species nest in the ground and will never
      use a box like this. Leave them a patch of bare, unmulched, sunny soil.</p>
    </div>
  </div>

  <div class="foot">
    <span>Sheet ${listAlone ? 3 : 2} · the build and the bees</span>
    <span>CC BY 4.0 · SPACE10, Bakken &amp; Bæck, Tanita Klein</span>
  </div>
</section>
</body></html>`;
}

/** The design as a picture, for the folder and for whoever opens it first. */
function renderPng() {
  const previous = { mode: stage.mode, white: stage.plateWhite, selected: stage.selected };
  stage.plateWhite = true;
  stage.setMode('drawing');
  stage.setSelected(-1);
  stage.renderer.render(stage.scene, stage.camera);
  const url = stage.renderer.domElement.toDataURL('image/png');
  stage.plateWhite = previous.white;
  stage.setMode(previous.mode);
  stage.setSelected(previous.selected);
  return url;
}

const dataUriToBytes = (uri) => {
  const bin = atob(uri.slice(uri.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * The folder someone sends to a maker space.
 *
 * The original site did this too, and its shape is worth keeping: one zip with
 * the cutting file, the assembly guide and a picture of your design. That guide
 * is SPACE10's own, unchanged, and it travels with the pack the way it always
 * did. Fetched rather than bundled — it is half a megabyte, and nobody who
 * only wants to look at the builder should pay for it.
 *
 * The DXF slot used to be empty, on the grounds that shipping a file we could
 * not vouch for was worse than shipping none. What goes in it now is not drawn
 * from the meshes on screen — those are a de-featured display copy, and an
 * outline taken off them would not seat. It is the production toolpaths out of
 * BEEHOME GEOMETRIES.3dm, lifted at build time by tools/extract_toolpaths.py
 * and assembled here. Fetched rather than bundled: 190 kB is worth carrying
 * for someone who asks for the pack and not for someone who only wants to look
 * at the builder.
 */
let toolpaths = null;
async function toolpathLibrary() {
  if (toolpaths === undefined) return null;
  if (toolpaths === null) {
    try {
      const res = await fetch('toolpaths.json');
      toolpaths = res.ok ? await res.json() : undefined;
    } catch {
      toolpaths = undefined; // embedded as one file, with nothing alongside
    }
  }
  return toolpaths || null;
}

async function buildPackZip(html) {
  const id = formatId(state);
  const library = await toolpathLibrary();
  const dxf = library
    ? buildDxf(library, { id, exportString: exportString(state) })
    : null;

  /* Fetched before the folder note is written, because the note lists what is
     in the folder. Embedded as one file, the builder has no sibling to fetch
     and the guide is simply absent -- the rest of the pack is worth having
     without it, but the note must not promise it. */
  let guide = null;
  try {
    const res = await fetch('documents/bee-home-assembly-guide.pdf');
    if (res.ok) guide = new Uint8Array(await res.arrayBuffer());
  } catch {
    guide = null;
  }

  const files = [
    { name: `Bee Home ${id} — drawings and cut list.html`, data: html },
    { name: `Bee Home ${id}.png`, data: dataUriToBytes(renderPng()) },
    {
      name: `Bee Home ${id}.txt`,
      data: [
        `Bee Home ${id}`,
        `  ${state.stack.length} storeys · ${state.variant === 'b' ? 'plain' : 'patterned'} fronts`,
        '',
        'WHAT IS IN THIS FOLDER',
        '  · Drawings and cut list, as a web page. Open it in any browser and',
        '    print it, or save it as a PDF from the print dialog.',
        ...(dxf ? ['  · A DXF of the cutting geometry. See below.'] : []),
        '  · A picture of this design.',
        ...(guide
          ? ['  · The Assembly & Maintenance Guide, from the original project.']
          : []),
        '',
        'TO HAVE IT CUT',
        '  Email this whole folder to a maker space — an open workshop with a',
        '  CNC router, found by searching "makerspace", "fab lab" or "hackspace"',
        '  and your city. Most will quote from these files without you joining.',
        '',
        ...(dxf ? [
          'ABOUT THE DXF',
          `  ${dxf.parts.length} storeys laid out side by side, 1:1 in millimetres,`,
          '  DXF R12. This is not a tracing of the 3D preview. It is the',
          '  production cutting geometry out of the original Rhino file, copied',
          '  segment for segment: native lines and arcs, no flattening, and the',
          '  inside-corner relief that lets a round cutter reach a square',
          '  corner. The layer names are the original ones and they carry the',
          '  work, e.g. POCKET-INSIDE_T6MM_20.00MM is an inside pocket, 6 mm',
          '  cutter, 20 mm deep.',
          '',
          '  What your operator still has to settle:',
          '   · Everything is drawn flat at Z=0. Depth is in the layer name and',
          '     nowhere else, so the layers have to be read, not just plotted.',
          '   · Whether each pocket curve is a finished wall or a tool',
          '     centreline, and which face its depth is measured from, are not',
          '     recorded in the file and have not been verified here. The',
          '     outside profile is the part outline. Check the pockets against',
          '     BEEHOME.gh before cutting a full set.',
          '   · No lead-ins, no tabs, no hold-down, no feeds and speeds.',
          '',
          '  Not in the DXF: the base plate, the legs and the spike. The library',
          '  holds a base plate under each storey variant and nothing in it says',
          '  which one goes with which mounting, so rather than guess they are',
          '  left on the cut list as stock sizes.',
          '',
        ] : []),
        'GRASSHOPPER EXPORT',
        `  ${exportString(state)}`,
        '',
        '  Paste that into BEEHOME.gh, from the project repository, to',
        '  regenerate the cutting files for exactly this design.',
        '',
        'LICENCE',
        '  Bee Home is CC BY 4.0 — SPACE10, Bakken & Bæck, Tanita Klein.',
        '  Build it, sell what you build, change it, share it. Credit the',
        '  original authors, say if you changed anything, link the licence.',
        '',
      ].join('\n'),
    },
  ];

  if (dxf) files.splice(1, 0, { name: `Bee Home ${id} CNC.dxf`, data: dxf.text });

  if (guide) {
    files.push({ name: 'Bee Home Assembly & Maintenance Guide.pdf', data: guide });
  }

  return makeZip(files);
}

/**
 * Hand the build pack over.
 *
 * A download started inside the embedded builder is blocked — the builder runs
 * in an iframe — so the zip is built here and posted up, and the page around
 * it does the saving from a context that is allowed to.
 */
async function downloadBuildPack() {
  const html = await buildPackHtml();
  const id = formatId(state);
  const zip = await buildPackZip(html);
  const name = `Bee Home ${id} files.zip`;
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'beehome:buildpack', name, html, zip }, '*');
    return;
  }
  const url = URL.createObjectURL(zip);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function refreshReadout() {
  el('beeId').textContent = formatId(state);
  // The page around the builder names the design its build-pack button will
  // produce, so the button belongs to what is on screen rather than to some
  // generic download.
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'beehome:id', id: formatId(state) }, '*');
  }
  el('exportString').textContent = exportString(state);
  el('storeyCount').textContent = String(state.stack.length);
  el('stackHeight').textContent = `${Math.round(stackHeight())} mm`;
  el('finish').textContent = finishSpec(state.woods.slice(0, state.stack.length));

  const problems = validateStack(state.stack, rules);
  const warning = el('warning');
  if (problems.length) {
    warning.textContent = problems
      .map((p) => `${p.letter} cannot sit on ${p.below}`)
      .join(' · ');
    warning.hidden = false;
  } else {
    warning.hidden = true;
  }
}

function buildControls() {
  const positions = el('positions');
  for (const spec of POSITIONS) {
    const button = document.createElement('button');
    button.textContent = spec.label;
    button.dataset.key = spec.key;
    button.className = 'chip';
    button.addEventListener('click', async () => {
      state.position = spec.key;
      syncControls();
      await rebuild();
    });
    positions.append(button);
  }

  el('height').addEventListener('input', async (event) => {
    state.heightMm = Number(event.target.value);
    el('heightValue').textContent = `${state.heightMm} mm`;
    await rebuild();
  });

  el('variant').addEventListener('change', async (event) => {
    state.variant = event.target.checked ? 'b' : 'a';
    await rebuild();
  });

  const doShuffle = async () => {
    state.stack = shuffleStack();
    state.selected = -1;
    syncControls();
    await rebuild();
  };
  // The same control, twice -- once for the drawer folded away, once inline
  // with Position when it's open. Never both visible at once (CSS hides
  // whichever one is redundant), but both need to work regardless.
  el('shuffleOutside').addEventListener('click', doShuffle);
  el('shuffleInside').addEventListener('click', doShuffle);

  el('remove').addEventListener('click', async () => {
    if (state.stack.length > 1) {
      state.stack.pop();
      syncControls();
      await rebuild();
    }
  });

  el('reset').addEventListener('click', async () => {
    state.stack = ['A', 'P', 'P', 'M'];
    syncControls();
    await rebuild();
  });

  el('idInput').addEventListener('change', async (event) => {
    const parsed = parseId(event.target.value);
    if (!parsed) {
      event.target.classList.add('invalid');
      return;
    }
    event.target.classList.remove('invalid');
    Object.assign(state, parsed);
    if (!state.heightMm) state.heightMm = 400;
    syncControls();
    await rebuild();
  });

  const palette = el('palette');
  for (const letter of LETTERS) {
    const button = document.createElement('button');
    button.textContent = letter;
    button.dataset.letter = letter;
    button.className = 'letter';
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      state.stack.push(letter);
      state.woods[state.stack.length - 1] = woodFor(state.stack.length - 2);
      syncControls();
      await rebuild();
    });
    palette.append(button);
  }

  // The storey preview: its own little renderer, fed the same cached geometry.
  preview = stage.preview(el('previewCanvas'));

  // Drawing/timber lives as one two-state button in the stage corner.
  el('viewToggle').addEventListener('click', () => {
    state.mode = state.mode === 'drawing' ? 'timber' : 'drawing';
    document.body.classList.toggle('drawing', state.mode === 'drawing');
    stage.setMode(state.mode);
    stage.setSelected(state.selected);
  });

  // The page around the builder can ask for the pack too.
  addEventListener('message', (event) => {
    if (event.data && event.data.type === 'beehome:request-buildpack') downloadBuildPack();
  });

  // The drawer starts closed where it would cover the model. Opening it is a
  // choice; the model never has to share a phone screen by default.
  el('panelTab').addEventListener('click', () => {
    document.body.classList.toggle('panelHidden');
  });
  if (matchMedia('(max-width: 820px)').matches) {
    document.body.classList.add('panelHidden');
  }

  /*
   * The model is the control surface, so the drawer answers to it.
   *
   * Reaching for the tab in the corner to change a storey you are already
   * pointing at is a detour. Click the storey itself, or its letter on the
   * rail, and the drawer comes out with that storey selected. Click anywhere
   * that is not a storey and not the drawer, and it folds away again -- which
   * is what dismissing something means everywhere else, and it keeps the model
   * one click from clear at all times.
   *
   * The stage handles its own case further down, on pointerdown, because
   * touch devices can silently drop the click this listener would otherwise
   * get. This one is for everything else: the rail, and the plain page
   * around it.
   */
  // Capture, not bubble. Selecting a storey rebuilds the rail, so a chip is
  // already detached from the list by the time a bubbling listener sees it --
  // closest('.rail li') then finds no .rail ancestor, and the click reads as
  // "outside", which closed the drawer the chip had just asked to open.
  addEventListener('click', (event) => {
    if (event.target.closest('.panel, #panelTab, #stage')) return;

    const chip = event.target.closest('.rail li');
    if (chip) {
      document.body.classList.remove('panelHidden');
      return; // the chip's own handler does the selecting
    }

    document.body.classList.add('panelHidden');
  }, true);

  // Hover: resting the pointer on a storey lights it and its rail chip. No
  // preview here -- orbiting the camera crosses the model constantly, and the
  // turntable is only useful when it is called up on purpose, from the rail.
  let hoverPending = false;
  el('stage').addEventListener('pointermove', (event) => {
    if (hoverPending) return;
    hoverPending = true;
    requestAnimationFrame(() => {
      hoverPending = false;
      const i = stage.pick(event);
      hoverStorey(i, false);
    });
  });
  el('stage').addEventListener('pointerleave', () => hoverStorey(-1, false));

  const woods = el('woods');
  for (const wood of WOODS) {
    const button = document.createElement('button');
    button.className = 'wood';
    button.dataset.wood = wood.key;
    button.title = `${wood.name} — ${wood.note}`;
    button.innerHTML = `<span class="dot" style="background:${wood.tint}"></span><span>${wood.name}</span>`;
    button.addEventListener('click', async () => {
      applyWood(wood.key);
      await rebuild();
      syncControls();
    });
    woods.append(button);
  }

  el('applyAll').addEventListener('click', async () => {
    const key = woodFor(Math.max(0, state.selected));
    state.woods = state.stack.map(() => key);
    await rebuild();
    syncControls();
  });

  // Click a storey in the 3D view to select it; click empty space to deselect.
  //
  // The drawer answers to this event too, not to the window 'click' capture
  // above. OrbitControls calls preventDefault() on the touch sequence while
  // it decides whether a touch is a tap or the start of an orbit drag, and a
  // touchstart with preventDefault called suppresses the synthetic click a
  // browser would otherwise fire on touchend -- so on a phone, tapping the
  // canvas outside the drawer never reached the click listener at all, and
  // the drawer stayed open no matter where you tapped. pointerdown is never
  // suppressed this way, so the same tap that used to vanish now closes it.
  el('stage').addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const i = stage.pick(event);
    selectStorey(i);
    document.body.classList.toggle('panelHidden', i < 0);
  });

  syncControls();
}

/** Apply a species to the selected storey, or to the whole stack if none. */
function applyWood(key) {
  if (state.selected >= 0) {
    state.woods[state.selected] = key;
  } else {
    state.woods = state.stack.map(() => key);
  }
}

function syncControls() {
  for (const button of el('positions').children) {
    button.classList.toggle('active', button.dataset.key === state.position);
  }
  const spec = POSITIONS.find((p) => p.key === state.position);
  el('heightRow').hidden = !spec.hasHeight;
  el('height').value = String(state.heightMm);
  el('heightValue').textContent = `${state.heightMm} mm`;

  // Grey out letters the rules forbid on top of the current stack, so an
  // invalid Bee Home is unreachable rather than merely flagged.
  const allowed = new Set(allowedNext(state.stack, rules));
  for (const button of el('palette').children) {
    button.disabled = !allowed.has(button.dataset.letter);
  }

  const activeWood = state.selected >= 0 ? woodFor(state.selected) : null;
  for (const button of el('woods').children) {
    button.classList.toggle('active', button.dataset.wood === activeWood);
  }
  el('woodScope').textContent = state.selected >= 0
    ? `storey ${state.selected + 1} · ${state.stack[state.selected]}`
    : 'whole stack';

  const list = el('stackList');
  list.textContent = '';
  state.stack.forEach((letter, i) => {
    const item = document.createElement('li');
    const wood = woodByKey(woodFor(i));
    item.innerHTML = `${letter}<span class="dot" style="background:${wood.tint}"></span>`;
    item.dataset.storey = String(i);
    item.title = `Storey ${i + 1} · ${letter} · ${wood.name}`;
    if (i > 0 && !canPlace(state.stack.slice(0, i), letter, rules)) item.classList.add('bad');
    if (i === state.selected) item.classList.add('selected');
    item.tabIndex = 0;
    item.addEventListener('click', () => selectStorey(i === state.selected ? -1 : i));
    item.addEventListener('pointerenter', () => hoverStorey(i));
    item.addEventListener('pointerleave', () => hoverStorey(-1));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStorey(i); }
    });
    list.append(item); // order is irrelevant: each chip is positioned off its storey
  });
  el('idInput').value = formatId(state);
}

/**
 * One place decides what "hovering a storey" means: the model lights up, the
 * rail chip lights up, and -- when the hover started on the rail, not on the
 * model itself -- the preview shows that part alone, turning.
 *
 * Rolling the camera means crossing the model with the pointer constantly, so
 * wiring the turntable to hover-over-the-model popped it up on every orbit
 * drag. It only means something when you are reading down the rail deciding
 * which storey is which; withPreview is false for the model's own pointer
 * events so the highlight still works there without the popup.
 */
async function hoverStorey(i, withPreview = true) {
  stage.setHovered(i);
  for (const item of el('stackList').children) {
    item.classList.toggle('hot', Number(item.dataset.storey) === i && i >= 0);
  }
  if (!preview || !withPreview) return;
  const letter = i >= 0 ? state.stack[i] : null;
  if (!letter) {
    preview.hide();
    el('preview').classList.remove('on');
    return;
  }
  const entry = storeyEntry(letter, i);
  const geometry = await stage.load(entry.file);
  // The pointer may have moved on while that awaited.
  if (stage.hovered !== i) return;
  preview.show(geometry, woodFor(i));
  el('previewLabel').textContent = `${letter} \u00b7 storey ${i + 1}`;
  el('preview').classList.add('on');
}

/**
 * Keep each rail chip level with its own storey. Runs on the stage's frame
 * callback, so the letters ride the model through orbits and rebuilds; the
 * chip's height is the storey's height on screen, clamped to stay legible.
 */
const RAIL_TOP = 118; // clear of the masthead

function positionRail() {
  const list = el('stackList');
  for (const item of list.children) {
    const anchor = stage.storeyAnchor(Number(item.dataset.storey));
    if (!anchor) {
      item.style.display = 'none';
      continue;
    }
    const height = Math.max(20, Math.min(72, anchor.half * 2));
    // Never climb into the masthead. A short stack seen from below puts the
    // top storey near the top of the screen and the chip would land on the
    // title; clamped, the rail simply stops short of it.
    const top = Math.max(RAIL_TOP, anchor.y - height / 2);
    item.style.display = '';
    item.style.height = `${height}px`;
    item.style.top = `${top}px`;
  }
}

boot();
