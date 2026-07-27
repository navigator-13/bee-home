# Bee / World — 2.5D rig prototype

For a direct, no-server preview, open `viewer/bee-globe-standalone.html`. It embeds the application bundle, World Atlas data, CSS, and all bee textures. Opening `viewer/bee-globe/index.html` over `file://` now redirects to that standalone artifact automatically.

For development, run from `viewer/` with `npm run dev`, then open `http://localhost:5173/bee-globe/`. The original Bee Home builder at `/` is unchanged. `npm run build` regenerates standalone copies in both `viewer/` and `viewer/dist/`.

## Architecture

The globe implementation is adapted directly from the supplied `live_globe_viewer.html`: its 96×64 sphere, 15° latitude/longitude grid, TopoJSON `world-atlas` coastline conversion, anti-meridian splitting, and visual materials are preserved. The globe is scaled to 82% and oriented with Europe/Africa forward.

The camera and bee anchor are fixed. User orbit/drag is deliberately disabled. A screen-space Z-axis group rolls the globe clockwise like a wheel, making its crown travel to the right under the stationary left-facing bee. Raycasting pauses both gait and rotation only while the pointer is over either subject. Bee materials ignore globe depth and render afterward, so no leg can be clipped by the sphere. `rigConfig.js` remains the single tuning surface for pivots, depth, parenting, and gait membership.

Continuous sliders expose globe scale from 0.20–1.00 and bee scale from 0.40–1.45. A shared layout equation pins the readable foot silhouette to the globe crown for every combination; defaults remain 0.82 and 1.04.

## Asset processing workflow

`python3 tools/cut_bee_layers.py` reads the 800×800 transparent `docs/assets/bees/megachile-ericetorum.png`, applies editable overlapping polygon masks, and writes full-canvas PNGs to `public/assets/bee/`. It also produces `contact-sheet.png` and `annotated-preview.png`. Full-sized canvases retain the common source datum, so pivots stay normalized and replacement art drops in without code changes.

These are provisional masks. The source is already transparent and preserves natural fur/wing alpha, but a human retouch pass is recommended around the thorax/abdomen overlap, wing roots, and the occluded front-far leg. No single flat sprite is rendered.

## Layer-cutting checklist

- Keep the original canvas or record crop bounds; export RGBA PNGs.
- Leave 8–20 px overlap under joints and adjacent body pieces.
- The provisional cutter currently dilates every mask by 12 px to enforce that overlap.
- Preserve wispy fur beyond the solid mask and semi-transparent wing pixels.
- Remove dark/background halos with color decontamination, not hard erosion.
- Reconstruct only the visible portion of the front far leg; keep mid/rear far legs as helper bones.
- Keep pivots in `rigConfig.js`, never baked into image geometry.
- Review every layer over both light and dark backgrounds, then regenerate the contact sheet.

## Rig and animation parameters

Each part has `id`, `texturePath`, `parentId`, normalized `pivot`, `depth`, visibility, and initial rotation. Each leg declares side, anatomical position, upper/lower part IDs, tripod phase, and visibility.

- Gait cycle: 1.25 s
- Upper-leg amplitude: 9°
- Lower-leg fold: 16° during swing
- Root bob, fore/aft motion, and root pitch: disabled
- Body, face, abdomen, wings, mouthparts, and antennae: static
- Globe roll: −0.13 rad/s around the screen Z axis

Press **D** to inspect pivots and foot targets.
