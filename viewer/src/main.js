import * as THREE from 'three';
import { Stage } from './scene.js';
import {
  LETTERS, POSITIONS, allowedNext, canPlace, exportString, formatId, parseId, validateStack,
} from './design.js';
import { DEFAULT_WOOD, WOODS, finishSpec, woodByKey } from './woods.js';

const state = {
  position: 'standing',
  // Low by default. A Bee Home on short legs sits in the planting rather than
  // above it, which is both how they are usually set and a better first look.
  heightMm: 180,
  stack: ['A', 'P', 'P', 'M'],
  woods: ['birch', 'birch', 'walnut', 'birch'],
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

/** Species for storey `i`, falling back as the stack grows. */
function woodFor(i) {
  return state.woods[i] ?? DEFAULT_WOOD;
}

function selectStorey(index) {
  state.selected = index;
  stage.setSelected(index);
  syncControls();
}

/** Total height of the storey stack in millimetres. */
function stackHeight() {
  return state.stack.reduce(
    (total, letter) => total + index.storeys[letter][state.variant].size_mm[2], 0,
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
    const entry = index.storeys[letter][state.variant];
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
    stage.add(roofGeometry, new THREE.Vector3(0, y, 0),
      // Shares the top storey's step: closing the stack is one move, not two.
      { wood: woodFor(state.stack.length - 1), storey: state.stack.length - 1 });
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
 * The build pack, from the browser. Until now the two-page spec sheet only
 * existed as an offline tool (viewer/tools/make_spec_sheet.mjs, driven by
 * Playwright) — upstream of the builder, not part of it. This is the real
 * thing: the live scene is captured to three measured views and laid out as
 * two A4 pages, and the print dialog does the PDF.
 */
function buildPackHtml() {
  const views = stage.captureViews();
  const id = formatId(state);
  const gh = exportString(state);
  const woods = state.woods.slice(0, state.stack.length);

  const rows = state.stack.map((letter, i) => {
    const size = index.storeys[letter][state.variant].size_mm;
    return `<tr><td>${i + 1}</td><td>${letter}${state.variant === 'b' ? ' · plain' : ''}</td>`
      + `<td>${size[0]} × ${size[1]} × ${size[2]}</td><td>${woodByKey(woodFor(i)).name}</td></tr>`;
  }).join('');

  const roof = index.guides.find((g) => g.name === 'roof');
  const base = index.guides.find((g) => g.name === 'base');
  const parts = [];
  if (state.position !== 'fixed' && base) {
    parts.push(`<tr><td>—</td><td>Base plate</td><td>${base.size_mm.join(' × ')}</td><td>${woodByKey(woodFor(0)).name}</td></tr>`);
  }
  if (roof) {
    parts.push(`<tr><td>—</td><td>Roof slab</td><td>${roof.size_mm.join(' × ')}</td><td>${woodByKey(woodFor(state.stack.length - 1)).name}</td></tr>`);
  }
  const support = liftMm();
  if (state.position === 'standing' && support > 0) {
    parts.push(`<tr><td>—</td><td>Legs × 4</td><td>15 × 30 × ${Math.round(support - base.size_mm[2])}</td><td>${woodByKey(woodFor(0)).name}</td></tr>`);
  }
  if (state.position === 'grounded' && support > 0) {
    parts.push(`<tr><td>—</td><td>Ground spike</td><td>30 × 30 × ${Math.round(support - base.size_mm[2])}</td><td>${woodByKey(woodFor(0)).name}</td></tr>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Bee Home ${id} — build pack</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.5 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #2a2920; }
  .sheet { page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  h1 { font-size: 21px; font-weight: 400; margin: 0; }
  h2 { font-size: 10px; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase;
       color: #7d7d73; margin: 18px 0 6px; }
  .meta { display: flex; gap: 28px; margin: 6px 0 14px; padding-bottom: 10px;
          border-bottom: 1px solid #d3d3ce; }
  .meta code { font: 12px/1.4 Menlo, Consolas, monospace; }
  .meta span { display: block; font-size: 8px; letter-spacing: 0.14em; text-transform: uppercase;
               color: #7d7d73; }
  .views { display: grid; grid-template-columns: 1.35fr 1fr; gap: 6mm; align-items: start; }
  .views img { width: 100%; border: 1px solid #e3e3dc; }
  .views figure { margin: 0 0 4mm; }
  .views figcaption { font: 8px/1.4 Menlo, monospace; letter-spacing: 0.14em;
                      text-transform: uppercase; color: #7d7d73; margin-top: 2mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 8px; letter-spacing: 0.14em; text-transform: uppercase;
       color: #7d7d73; font-weight: 500; padding: 3px 8px 3px 0; border-bottom: 1px solid #2a2920; }
  td { padding: 4px 8px 4px 0; border-bottom: 1px solid #e3e3dc; font-size: 11px; }
  .cols { columns: 2; column-gap: 10mm; }
  .cols p { margin: 0 0 8px; break-inside: avoid; }
  .foot { margin-top: 10mm; padding-top: 3mm; border-top: 1px solid #d3d3ce;
          font: 8px/1.6 Menlo, monospace; letter-spacing: 0.08em; color: #7d7d73; }
</style></head><body>
<div class="sheet">
  <h1>Bee Home</h1>
  <div class="meta">
    <div><span>Bee Home ID</span><code>${id}</code></div>
    <div><span>Grasshopper export</span><code>${gh}</code></div>
    <div><span>Height overall</span><code>${Math.round(stackHeight() + liftMm())} mm</code></div>
  </div>
  <div class="views">
    <figure><img src="${views.iso}" alt=""><figcaption>Axonometric</figcaption></figure>
    <div>
      <figure><img src="${views.front}" alt=""><figcaption>Elevation</figcaption></figure>
      <figure><img src="${views.plan}" alt=""><figcaption>Plan</figcaption></figure>
    </div>
  </div>
  <h2>Cut list — dimensions in mm, storeys bottom first</h2>
  <table>
    <tr><th>No.</th><th>Part</th><th>W × D × H</th><th>Timber</th></tr>
    ${rows}${parts.join('')}
  </table>
</div>
<div class="sheet">
  <h1>Making it</h1>
  <div class="meta"><div><span>Bee Home ID</span><code>${id}</code></div></div>
  <h2>At the makerspace</h2>
  <div class="cols">
    <p>Share this pack and the design files with a local makerspace — an open workshop
    where you pay per visit or hold a membership. You need a CNC milling machine and
    someone who runs it; most spaces will do this with you rather than for you.</p>
    <p>Cut each storey from a single board. The letters are the storeys, bottom
    first; the ID above encodes the whole design, so anyone with it can check the
    stack against this sheet.</p>
  </div>
  <h2>Assembly</h2>
  <div class="cols">
    <p>Base plate first, then the storeys in the order of the cut list, then the
    roof slab. The parts register on each other and need no fixings — assembling it
    requires just your hands and a few minutes of your time.</p>
    <p>To mount the wall-fixed version, use a drill and two screws through the back
    plate. Keep the bore holes horizontal at all times.</p>
  </div>
  <h2>Where it goes</h2>
  <div class="cols">
    <p>Facing the morning sun, within 300 metres of flowers, protected from strong
    wind. Anywhere outside works — a rooftop, a balcony or a garden.</p>
    <p>Plant native wildflowers nearby. Solitary bees are friendly: they produce no
    honey, have nothing to defend, and are safe around kids and pets.</p>
  </div>
  <h2>Each autumn</h2>
  <div class="cols">
    <p>Brush the fronts clean and clear any cavity that stayed empty two seasons
    running. A Bee Home lasts anywhere between five and thirty years, depending on
    the wood, the location, and how well you look after it.</p>
  </div>
  <p class="foot">Bee Home — open source, CC BY 4.0 · SPACE10, Bakken &amp; Bæck, Tanita Klein ·
  drawings generated from the design geometry, not to scale · beehome.design</p>
</div>
<script>addEventListener('load', () => setTimeout(() => print(), 150));<\/script>
</body></html>`;
}

/**
 * Hand the build pack over as a file.
 *
 * window.open is blocked inside the embedded builder, which is why the button
 * did nothing on the page: the builder runs in an iframe. So the document is
 * built here and downloaded as a file -- and when there is a parent page, it
 * is posted up instead, so the button that lives outside the iframe can do
 * the download from a context that is allowed to.
 */
function downloadBuildPack() {
  const html = buildPackHtml();
  const name = `bee-home-${formatId(state)}.html`;
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'beehome:buildpack', name, html }, '*');
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function refreshReadout() {
  el('beeId').textContent = formatId(state);
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

  // Hover: resting the pointer on a storey lights it and its rail chip.
  let hoverPending = false;
  el('stage').addEventListener('pointermove', (event) => {
    if (hoverPending) return;
    hoverPending = true;
    requestAnimationFrame(() => {
      hoverPending = false;
      const i = stage.pick(event);
      hoverStorey(i);
    });
  });
  el('stage').addEventListener('pointerleave', () => hoverStorey(-1));

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
  el('stage').addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    selectStorey(stage.pick(event));
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
 * rail chip lights up, and the preview shows that part alone, turning.
 */
async function hoverStorey(i) {
  stage.setHovered(i);
  for (const item of el('stackList').children) {
    item.classList.toggle('hot', Number(item.dataset.storey) === i && i >= 0);
  }
  if (!preview) return;
  const letter = i >= 0 ? state.stack[i] : null;
  if (!letter) {
    preview.hide();
    el('preview').classList.remove('on');
    return;
  }
  const entry = index.storeys[letter][state.variant];
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
