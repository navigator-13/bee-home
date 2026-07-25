import * as THREE from 'three';
import { Stage } from './scene.js';
import {
  LETTERS, POSITIONS, allowedNext, canPlace, exportString, formatId, parseId, validateStack,
} from './design.js';

const state = {
  position: 'standing',
  heightMm: 400,
  stack: ['A', 'P', 'P', 'M'],
  variant: 'a',
};

let index = null;
let rules = null;
let stage = null;

const el = (id) => document.getElementById(id);

async function boot() {
  [index, rules] = await Promise.all([
    fetch('models/index.json').then((r) => r.json()),
    fetch('storey-rules.json').then((r) => r.json()),
  ]);
  stage = new Stage(el('stage'));
  buildControls();
  await rebuild();
  stage.lookFrom();
  document.body.classList.add('ready');
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
  for (const letter of state.stack) {
    const entry = index.storeys[letter][state.variant];
    const geometry = await stage.load(entry.file);
    stage.add(geometry, new THREE.Vector3(0, y, 0));
    y += entry.size_mm[2] / 1000;
  }

  if (state.position !== 'fixed') {
    const base = index.guides.find((g) => g.name === 'base');
    const baseGeometry = await stage.load(base.file);
    stage.add(baseGeometry, new THREE.Vector3(0, lift - base.size_mm[2] / 1000, 0));
  }

  // Legs and spike are cut to length rather than repeated: the source geometry
  // is a single unit of each, and the ID's height field is what sets how far
  // the stack sits off the ground.
  const baseThickness = index.guides.find((g) => g.name === 'base').size_mm[2] / 1000;
  const supportTop = lift - baseThickness;

  if (state.position === 'standing' && supportTop > 0) {
    const leg = index.guides.find((g) => g.name === 'leg');
    const geometry = await stage.load(leg.file);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const mesh = stage.add(geometry, new THREE.Vector3(sx * 0.048, 0, sz * 0.06));
      mesh.scale.y = (supportTop * 1000) / leg.size_mm[2];
    }
  }

  if (state.position === 'grounded' && supportTop > 0) {
    const spike = index.guides.find((g) => g.name === 'spike');
    const geometry = await stage.load(spike.file);
    const mesh = stage.add(geometry, new THREE.Vector3(0, 0, 0));
    mesh.scale.y = (supportTop * 1000) / spike.size_mm[2];
  }

  stage.frame();
  refreshReadout();
}

function refreshReadout() {
  el('beeId').textContent = formatId(state);
  el('exportString').textContent = exportString(state);
  el('storeyCount').textContent = String(state.stack.length);
  el('stackHeight').textContent = `${Math.round(stackHeight())} mm`;

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
      syncControls();
      await rebuild();
    });
    palette.append(button);
  }

  syncControls();
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

  const list = el('stackList');
  list.textContent = '';
  state.stack.forEach((letter, i) => {
    const item = document.createElement('li');
    item.textContent = letter;
    if (i > 0 && !canPlace(state.stack.slice(0, i), letter, rules)) {
      item.classList.add('bad');
    }
    if (i === state.stack.length - 1) item.classList.add('roof');
    list.prepend(item); // top storey first, matching the model
  });
  el('idInput').value = formatId(state);
}

boot();
