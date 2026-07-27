# Bee / World — implementation handoff

This folder contains a working Three.js prototype of a photographic, articulated side-profile bee walking on a rotating world-atlas globe.

## Recommended repo workflow

This implementation is intended to be committed in the repository alongside the real site. Give the implementing agent the branch/PR containing these files and this instruction:

> Integrate the supplied Bee / World prototype into the production site. Preserve the existing globe generation, photographic layer assets, leg hierarchy, clockwise screen-space globe roll, hover-to-pause behavior, and responsive scale defaults. On desktop initialize globe scale to 0.31 and bee scale to 0.40. Below 700 px initialize to 0.25 and 0.32. Keep the bee foot contact pinned to the globe crown when either value changes. Only leg transforms may animate: body, eye, head, thorax, abdomen, wings, antennae, and mouthparts must remain static. Do not restore OrbitControls rotation or rewrite the masks. Adapt mounting and cleanup to the site framework and preserve the visual output.

## Integration options

### Preferred: integrate the committed modules

The implementation is already organized as normal repository source. Move or adapt these paths into the production site's component structure:

- `src/bee-globe/`
- `src/bee-globe.css`
- `public/assets/bee/`

Install:

```bash
npm install three topojson-client world-atlas
```

Use `bee-globe/index.html` as the DOM reference. In React/Next.js, mount the renderer client-side only and translate `boot()` into an effect/component lifecycle. Dispose the renderer, geometries, materials, textures, ResizeObserver, animation frame, and event listeners on unmount.

The slider controls should remain in the source as an art-direction tool but may be hidden in production. The current prototype supports `?controls=0`; native integrations can conditionally omit or hide `.scale-controls` while retaining the values and `setLayout()` logic.

### Reference-only: standalone artifact

Host `bee-globe-standalone.html` as a public asset and place it in a responsive iframe. It has Three.js, TopoJSON world data, CSS, and all 16 bee textures embedded, with no runtime dependencies.

```html
<iframe
  src="/bee-globe-standalone.html"
  title="Bee walking on a globe"
  loading="lazy"
  style="width:100%;height:100%;border:0"
></iframe>
```

Use this as a visual regression reference, not the primary production architecture.

## Responsive defaults

| Viewport | Globe | Bee |
| --- | ---: | ---: |
| Desktop, above 700 px | 0.31 | 0.40 |
| Mobile, 700 px or below | 0.25 | 0.32 |

The mobile values are 80% of the desktop values. The live sliders remain wider for art direction: globe `0.15–1.00`, bee `0.20–1.45`.

`setLayout()` is the source of truth. It scales both groups and sets:

```js
beeAnchor.position.y = globeScale + 0.10 * beeScale;
```

Do not position the bee with CSS; the contact relationship belongs in scene coordinates.

## Fragile invariants — do not regress

1. Only the leg hierarchy animates.
2. Every upper leg stores `userData.baseY`; swing lift is added to it. Never replace the base Y with the lift value.
3. Lower leg nodes remain parented to their corresponding upper leg nodes.
4. Bee materials use `depthTest: false`, `depthWrite: false`, and high `renderOrder`, keeping every leg in front of the globe.
5. The camera and bee anchor remain fixed. Users cannot orbit or drag the globe.
6. `globeSpin.rotation.z -= …` gives the intuitive wheel motion beneath a left-facing bee. Do not change this back to Y-axis yaw.
7. Hover raycasting pauses both gait and globe roll.
8. Preserve `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` for mobile performance.

## File map

- `src/bee-globe/main.js` — scene, responsive defaults, scale pinning, hover, animation loop
- `src/bee-globe/createGlobe.js` — source viewer's sphere/grid/world-atlas coastline generation
- `src/bee-globe/BeeRig.js` — layered plane hierarchy and stable base transforms
- `src/bee-globe/rigConfig.js` — pivots, parent relationships, depth order, gait groups
- `src/bee-globe/animation.js` — leg-only alternating tripod animation
- `public/assets/bee/*.png` — production runtime layers
- `tools/cut_bee_layers.py` — reproducible provisional crop generation
- `tools/bundle_bee_globe.mjs` — standalone-file generator
- `bee-globe-standalone.html` — self-contained reference implementation

## Production checks

- Compare desktop at 1440×900 and mobile at 390×844.
- Confirm no horizontal overflow and no overlap between title and controls.
- Confirm the bee remains side-on and fixed while the globe rolls.
- Test hover pause with a mouse; do not require hover on touch devices.
- Honor `prefers-reduced-motion` in production by starting paused or reducing roll/gait speed.
- Verify public asset paths if the site deploys under a base path.
- Keep DPR capped and test mid-range mobile hardware.
