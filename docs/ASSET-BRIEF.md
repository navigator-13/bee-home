# Asset brief — images for the beehome.design revival

For an image-generation agent. The site consumes these files by exact name;
drop them at the paths below and they appear with no code change. Anything
missing falls back to a placeholder, so partial delivery is fine.

**Read section 0 before generating anything.** The first deliverable is
research, not pictures.

Everything referenced under `docs/assets/` is something **you create**, not
something to go looking for. The directories are empty on purpose:

```
docs/assets/RESEARCH.md      <- you write this first (section 0)
docs/assets/pressed/         <- flower plates (section 1)
docs/assets/bees/            <- bee portraits (section 2)
docs/assets/scenes/          <- sited product shots (section 3)
```

Files that already exist and are inputs to you are called out by path in
each section — the plate drawing, the reference renders, the geometry.

The page's world: bone paper `#e9e9e1`, ink `#2a2920`, one accent — the bee
periwinkle `#7d94d8`. Quiet, Scandinavian, editorial. Nothing glossy,
nothing stocky, no lens flare, no bokeh sparkle.

---

## 0. Research first — do not invent the science

The bee-vision plates are the one place where making it up will be obvious
to anyone who knows the subject, and the brief you are replacing got it
wrong. Before generating a single image, research the following and
**write your findings to a new file at `docs/assets/RESEARCH.md`.** It does
not exist yet; creating it is the first task. Cite a source per claim.

**0.1 The trap: three different things get called "UV flower photography".**
Establish the difference and state in writing which one we are making.

- **Reflected-UV photography.** A UV-pass filter, visible light blocked.
  Records which parts of a flower reflect or absorb UV. Results are
  greyscale. This is the closest thing to physical evidence of the pattern.
- **UV-induced visible fluorescence (UVIVF).** UV light in, *visible* light
  out; the flower glows in the dark. Neon, magical, widely shared online.
  **This is not what a bee sees.** If our plates come back glowing electric
  blue on black, this is the mistake that was made.
- **Bee-vision simulation / false colour.** Takes reflectance across the
  bee's three receptors and maps them into an image a human can look at.
  This is what we want — but the colour mapping is a *convention*, so state
  the one you used.

**0.2 What a bee's eye actually does.** Verify and record: the three
photoreceptor types and their approximate peak sensitivities; the fact
that bees see into the ultraviolet and do **not** have a red receptor;
what that implies for a pure red flower; what "bee purple" means and why a
human display cannot show it truthfully. Note the standard false-colour
convention used in the literature for displaying bee vision, and say
whether you followed it.

**0.3 Per-species patterns.** For each species in the table below, find
whether a UV pattern is actually documented, and what it is — bullseye,
petal-tip reflectance, nectar guide lines, or none. Where you cannot find
a source for a species, **say so in RESEARCH.md and mark that plate
"pattern not documented"** rather than inventing a bullseye. A few honest
gaps are worth more than a uniform invention.

**0.4 Sources worth starting from** (verify them, they are leads, not
gospel): Bjørn Rørslett's reflected-UV flower archive; Klaus Schmitt's
reflected-UV and bee-vision simulation work; the Floral Reflectance
Database (FReD) for measured spectra; Chittka's work on bee colour space.
Note which are reflected-UV and which are fluorescence, since that is the
distinction that matters here.

**0.5 Licensing.** Do not trace, composite, or copy any photograph you
find. Research informs what you generate; it never gets pasted in. Say in
RESEARCH.md that you did not use source imagery directly.

Send `RESEARCH.md` back **before** the first plates, not alongside them —
it is a checkpoint, and its conclusions decide what the `-uv` plates
actually look like. If your research contradicts anything in this brief,
the research wins; flag the contradiction rather than quietly following
either one.

---

## 1. Pressed flowers (the herbarium)

**Into:** `docs/assets/pressed/`
**Two files per species:** `<slug>-rgb.png` and `<slug>-uv.png`
**Size:** 1000 × 1500 px, 2:3 portrait, PNG, transparent background preferred.

The section they live in is being redesigned as a loose, drifting
composition rather than a grid, so each specimen must read on its own with
no crop and no border.

### `-rgb` — as you see it

One pressed specimen per plate, flattened as if dried under glass for a
herbarium sheet: stem, leaves, flower head, composed tall. Colour natural
but slightly faded the way pressed petals fade — this is the page's one
pop of colour, so let the species' own hue carry it. Transparent
background, or flat `#e9e9e1`. Soft single shadow at most. No vase, no
hand, no table, no text, no pins, no tape.

### `-uv` — as she sees it

Same specimen, same silhouette and scale, so the two can cross-fade in
register. Not a glowing neon version of the first plate. What it should
be is set by your research in 0.1–0.3; as a starting hypothesis to test
rather than a spec:

- The image is a **bee-vision simulation**, so its palette follows the
  false-colour convention you recorded — which is not a dark field with
  blue glow.
- The pattern must match documented behaviour for that species: where the
  centre absorbs UV and the tips reflect it, that reads as a distinct
  bullseye; where nothing is documented, present the flower plainly and
  note it.
- Same botanical register as the `-rgb` plate. A specimen, not an effect.

If your research shows a species where human and bee views are nearly
identical, deliver that. The honest near-match is more interesting than a
fabricated pattern.

### Species (24 plates, 48 files)

| Common | Latin | Slug |
| --- | --- | --- |
| Viper's bugloss | Echium vulgare | `echium-vulgare` |
| Common knapweed | Centaurea nigra | `centaurea-nigra` |
| Bird's-foot trefoil | Lotus corniculatus | `lotus-corniculatus` |
| Wild marjoram | Origanum vulgare | `origanum-vulgare` |
| Yarrow | Achillea millefolium | `achillea-millefolium` |
| Field scabious | Knautia arvensis | `knautia-arvensis` |
| Selfheal | Prunella vulgaris | `prunella-vulgaris` |
| Meadow clary | Salvia pratensis | `salvia-pratensis` |
| Common poppy | Papaver rhoeas | `papaver-rhoeas` |
| Cornflower | Centaurea cyanus | `centaurea-cyanus` |
| Sainfoin | Onobrychis viciifolia | `onobrychis-viciifolia` |
| Wild carrot | Daucus carota | `daucus-carota` |
| Lavender | Lavandula stoechas | `lavandula-stoechas` |
| Rosemary | Salvia rosmarinus | `salvia-rosmarinus` |
| Wild thyme | Thymus vulgaris | `thymus-vulgaris` |
| Crown daisy | Glebionis coronaria | `glebionis-coronaria` |
| Wild bergamot | Monarda fistulosa | `monarda-fistulosa` |
| Purple coneflower | Echinacea purpurea | `echinacea-purpurea` |
| New England aster | Symphyotrichum novae-angliae | `symphyotrichum-novae-angliae` |
| Golden alexanders | Zizia aurea | `zizia-aurea` |
| California poppy | Eschscholzia californica | `eschscholzia-californica` |
| Phacelia | Phacelia tanacetifolia | `phacelia-tanacetifolia` |
| Gumweed | Grindelia camporum | `grindelia-camporum` |
| Common poppy (red-vision case) | Papaver rhoeas | see 0.2 |

Poppy is listed twice deliberately: it is the species where "bees cannot
see red" gets interesting. Work out what is actually true for it and let
that plate carry the point.

---

## 2. Bees (portraits)

**Into:** `docs/assets/bees/` — `<slug>.png`, 800 × 800 px.

Same plate language: specimen on bone, entomological side profile, real
detail in wing venation and scopa. Not cute, not cartoon, no smiling.
These are solitary bees — most are smaller and less fuzzy-yellow than the
honeybee everyone pictures. Get the body plan right per genus; *Osmia* and
*Megachile* do not look alike.

Slugs: `osmia-bicornis`, `megachile-centuncularis`, `osmia-caerulescens`,
`megachile-willughbiella`, `osmia-leaiana`, `osmia-cornuta`,
`megachile-ericetorum`, `chelostoma-florisomne`, `heriades-truncorum`,
`megachile-pilidens`, `osmia-lignaria`, `osmia-taurus`, `megachile-pugnata`,
`megachile-fidelis`, `osmia-aztecana`.

Lower priority than the flowers.

---

## 3. Sited product imagery — a race against our Blender pipeline

We render in Blender at roughly five minutes a frame. Worth testing
whether generation over our real geometry gets there faster and better.
Feed these as references:

- `docs/plates/bh-4.png` — hidden-line drawing of the real four-storey
  model. **Ground truth for proportions; the object must match it.**
- `docs/renders/web/studio-wall.jpg`, `workshop-bench.jpg` — our current
  best, for material and light.
- `viewer/public/models/*.glb` — the actual geometry, if your tool takes 3D.

**Into:** `docs/assets/scenes/`, 1600 × 1200 px:

- `sited-garden.png` — on legs among real planting, morning light, deep
  focus. True scale: about 50 cm tall, waist-high, not a building.
- `sited-wall.png` — the wall-fixed variant on something real: the side of
  a house, a shed, a tree trunk. Our render has it on featureless plaster
  and that is the note we got back.
- `sited-balcony.png` — city-quiet, wall or rail mounted.

Hard constraints on all three: geometry matches the plate drawing (four
storeys plus a plain roof slab, bore face visible), pale northern timber —
birch or ash, not orange or terracotta — no text anywhere in the image, no
identifiable faces.

---

## Delivery

Commit to a branch and open a PR, or hand back a zip. Include
`RESEARCH.md`. Flag anything you could not verify rather than filling the
gap. Everything generated here ships under the project's CC BY 4.0; do not
composite in third-party photography.
