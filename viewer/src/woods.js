/**
 * Timber species, selectable per storey.
 *
 * The original configurator had no material choice at all — it drew the Bee
 * Home as hairline axonometric line art, so wood never entered the picture.
 * This is a deliberate addition: the design is meant to be cut from whatever
 * hardwood is local to whoever is building it, and a stack mixing two or three
 * species is both plausible to build and the most honest picture of what
 * "fabricate this locally" actually produces.
 *
 * `tint` multiplies the shared plywood colour map, so species read as shifts in
 * hue and value rather than as flat paint. `roughness` separates open-grained
 * timbers from close, waxy ones.
 */

export const WOODS = [
  { key: 'birch', name: 'Birch ply', tint: '#f1d6ba', roughness: 0.82, note: 'The original render tint' },
  { key: 'ash', name: 'Ash', tint: '#e8d7b8', roughness: 0.80, note: 'Pale, open grain' },
  { key: 'oak', name: 'Oak', tint: '#d9b98c', roughness: 0.78, note: 'Warm mid tone' },
  { key: 'douglas', name: 'Douglas fir', tint: '#e3b383', roughness: 0.80, note: 'Pinkish, strong figure' },
  { key: 'larch', name: 'Larch', tint: '#ce9159', roughness: 0.76, note: 'Resinous, weathers grey' },
  { key: 'chestnut', name: 'Sweet chestnut', tint: '#c9a277', roughness: 0.80, note: 'Durable outdoors' },
  { key: 'walnut', name: 'Walnut', tint: '#6b4a32', roughness: 0.70, note: 'Dark, fine grain' },
  { key: 'thermo', name: 'Thermo-ash', tint: '#4a3626', roughness: 0.72, note: 'Heat-treated, rot resistant' },
  { key: 'charred', name: 'Charred', tint: '#2b2724', roughness: 0.55, note: 'Yakisugi — burnt surface' },
];

export const DEFAULT_WOOD = 'birch';

export const woodByKey = (key) => WOODS.find((w) => w.key === key) ?? WOODS[0];

/** A compact finish spec, e.g. `birch×2,walnut,oak`, bottom-to-top. */
export function finishSpec(woods) {
  const runs = [];
  for (const key of woods) {
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.count += 1;
    else runs.push({ key, count: 1 });
  }
  return runs.map((r) => (r.count > 1 ? `${r.key}×${r.count}` : r.key)).join(',');
}
