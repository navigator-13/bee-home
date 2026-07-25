import * as THREE from 'three';
import { Stage } from './scene.js';
import {
  LETTERS, POSITIONS, allowedNext, canPlace, exportString, formatId, parseId, validateStack,
} from './design.js';
import { DEFAULT_WOOD, WOODS, finishSpec, woodByKey } from './woods.js';

const state = {
  position: 'standing',
  heightMm: 400,
  stack: ['A', 'P', 'P', 'M'],
  woods: ['birch', 'birch', 'walnut', 'birch'],
  variant: 'a',
  mode: 'timber',
  selected: -1,
};

let index = null;
let rules = null;
let stage = null;

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
};

async function boot() {
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

  stage = new Stage(el('stage'));
  stage.plateWhite = plate.clean;
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

/** How far the stack is lifted off the ground by its mounting. */
function liftMm() {
  if (state.position === 'fixed') return 0;
  const guide = state.position === 'grounded' ? 'spike' : 'leg';
  const shortfall = state.heightMm - stackHeight();
  const natural = index.guides.find((g) => g.name === guide).size_mm[2];
  return Math.max(0, Math.min(shortfall, natural * 4));
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
  if (plate.view && plate.view !== 'iso') stage.setProjection(plate.view);
  document.body.classList.toggle('drawing', state.mode === 'drawing');
  stage.setMode(state.mode);
  stage.setSelected(state.selected);
  refreshReadout();
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

  const modes = el('modes');
  for (const [key, label] of [['drawing', 'Drawing'], ['timber', 'Timber']]) {
    const button = document.createElement('button');
    button.textContent = label;
    button.dataset.mode = key;
    button.className = 'chip';
    button.addEventListener('click', () => {
      state.mode = key;
      document.body.classList.toggle('drawing', key === 'drawing');
      stage.setMode(key);
      stage.setSelected(state.selected);
      syncControls();
    });
    modes.append(button);
  }

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

  for (const button of el('modes').children) {
    button.classList.toggle('active', button.dataset.mode === state.mode);
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
    item.innerHTML = `<span class="dot" style="background:${wood.tint}"></span>`
      + `<span class="letter-tag">${letter}</span><span class="wood-name">${wood.name}</span>`;
    if (i > 0 && !canPlace(state.stack.slice(0, i), letter, rules)) item.classList.add('bad');
    if (i === state.stack.length - 1) item.classList.add('roof');
    if (i === state.selected) item.classList.add('selected');
    item.tabIndex = 0;
    item.addEventListener('click', () => selectStorey(i === state.selected ? -1 : i));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStorey(i); }
    });
    list.prepend(item); // top storey first, matching the model
  });
  el('idInput').value = formatId(state);
}

boot();
