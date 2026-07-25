/**
 * The Bee Home configuration model.
 *
 * Two things live here, both faithful to the original project:
 *
 *  - The **Bee Home ID** grammar documented in ReadMe.pdf. It is the
 *    compatibility contract with the Grasshopper definition in this repo, so a
 *    design produced here can still be fabricated by the original toolchain.
 *  - The **stacking rules**, loaded from storey-rules.json — recovered verbatim
 *    from the original site's bundle, because ReadMe.pdf states them twice and
 *    the two versions disagree.
 */

export const LETTERS = 'ABCDEFGHIJKLMNOP'.split('');

export const POSITIONS = [
  { code: '01', key: 'standing', label: 'Standing', base: 'BASE_STANDING', hasHeight: true },
  { code: '02', key: 'grounded', label: 'Grounded', base: 'BASE_GROUNDED', hasHeight: true },
  { code: '03', key: 'fixed', label: 'Fixed', base: 'BASE_FIXED', hasHeight: false },
];

/** Storey sets, per ReadMe.pdf — how the parts are grouped when cut. */
export const SETS = [['A', 'B'], ['C'], ['D', 'E', 'F'], ['G', 'H'], ['I', 'J'], ['K', 'L'], ['M'], ['N', 'O', 'P']];

/**
 * Which letters may not be placed directly above a given stack.
 *
 * Rules key on the *tail* of the current stack, and both single letters and
 * whole sets can match. Every matching rule contributes, so the result is the
 * union — in the recovered data the overlapping rules agree, but taking the
 * union means a future edit can only ever tighten the constraint, never
 * silently loosen it.
 */
export function disallowedAbove(stack, rules) {
  const blocked = new Set();
  for (const rule of rules) {
    const tail = stack.slice(-rule.values.length).map((l) => l.toLowerCase());
    if (tail.length !== rule.values.length) continue;
    if (tail.every((letter, i) => letter === rule.values[i])) {
      for (const letter of rule.disallowedNextLetters) blocked.add(letter.toUpperCase());
    }
  }
  return blocked;
}

export function canPlace(stack, letter, rules) {
  return !disallowedAbove(stack, rules).has(letter.toUpperCase());
}

/** Every letter that could legally be appended to `stack`. */
export function allowedNext(stack, rules) {
  const blocked = disallowedAbove(stack, rules);
  return LETTERS.filter((letter) => !blocked.has(letter));
}

/** True when every adjacent pair in the stack satisfies the rules. */
export function validateStack(stack, rules) {
  const problems = [];
  for (let i = 1; i < stack.length; i += 1) {
    if (!canPlace(stack.slice(0, i), stack[i], rules)) {
      problems.push({ index: i, letter: stack[i], below: stack[i - 1] });
    }
  }
  return problems;
}

/**
 * Format a Bee Home ID: position code, height in mm (omitted when fixed), then
 * the storey letters bottom-to-top. e.g. `01196APPM`.
 */
export function formatId({ position, heightMm, stack }) {
  const spec = POSITIONS.find((p) => p.key === position) ?? POSITIONS[0];
  const height = spec.hasHeight ? String(Math.round(heightMm)) : '';
  return `${spec.code}${height}${stack.join('').toUpperCase()}`;
}

export function parseId(id) {
  const match = /^(\d{2})(\d*)([A-P]+)$/i.exec(id.trim());
  if (!match) return null;
  const spec = POSITIONS.find((p) => p.code === match[1]);
  if (!spec) return null;
  return {
    position: spec.key,
    heightMm: match[2] ? Number(match[2]) : 0,
    stack: match[3].toUpperCase().split(''),
  };
}

/**
 * The string the original site handed to Grasshopper via ShapeDiver.
 *
 * Each letter carries a variant digit: `0` normally, `2` for the topmost
 * storey (the roof cut), and — under BASE_FIXED only — `1` for the storey
 * directly beneath the top. Recovered from the original bundle's
 * `floorsExportString`.
 */
export function exportString({ position, stack }) {
  const spec = POSITIONS.find((p) => p.key === position) ?? POSITIONS[0];
  const parts = stack.map((letter) => letter.toUpperCase());
  if (spec.key === 'fixed' && parts.length >= 2) {
    parts[parts.length - 2] += '1';
  }
  if (parts.length) {
    parts[parts.length - 1] += '2';
  }
  return [spec.base, ...parts.map((p) => (p.length === 1 ? `${p}0` : p))].join(',');
}
