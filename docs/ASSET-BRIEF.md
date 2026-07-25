# Asset brief — images for beehome.design revival

Art direction for generated imagery. The page consumes these files by exact
name; drop them in the paths below and the site picks them up with no code
change. Anything missing falls back to the drawn placeholder, so partial
delivery is fine.

The page's world: bone paper `#e9e9e1`, ink `#2a2920`, one accent — the bee
periwinkle `#7d94d8`, reserved for bees and for what bees see. Quiet,
Scandinavian, editorial. Nothing glossy, nothing stocky.

---

## 1. Pressed flowers (the herbarium)

**Dump into:** `docs/assets/pressed/`
**Two files per species:** `<slug>-rgb.png` and `<slug>-uv.png`
**Size:** 1000 × 1500 px (2:3 portrait). PNG.

### `-rgb` — as you see it

A real pressed-flower plate: one specimen per image, flattened as if dried
under glass for a herbarium sheet. Full stem with leaves and flower head(s),
composed tall in the frame, roots optional. Colours natural but slightly
faded the way pressed petals actually fade — this is the page's one pop of
colour, so let the species' own hue carry it (cornflower blue, poppy red,
yarrow cream). Background: flat `#e9e9e1`, or transparent. Soft single
shadow at most. No vase, no hand, no table, no text.

### `-uv` — as she sees it

Same species, same general silhouette and scale, but the bee's version:
a dark field (near-ink, deep violet-charcoal) with the flower rendered the
way UV photography of flowers reads — petals pale and luminous where they
reflect UV, and **nectar guides** glowing toward the centre: the bullseye,
the runway streaks at the petal bases. Guides and glow lean to periwinkle
`#7d94d8` / blue-white. Still botanical, still one specimen, not sci-fi.
Background: flat near-ink `#22211a`, or transparent.

### Species list (24 plates, 48 files)

| Common | Latin | Files |
| --- | --- | --- |
| Viper's bugloss | Echium vulgare | `echium-vulgare-rgb.png` / `-uv.png` |
| Common knapweed | Centaurea nigra | `centaurea-nigra-…` |
| Bird's-foot trefoil | Lotus corniculatus | `lotus-corniculatus-…` |
| Wild marjoram | Origanum vulgare | `origanum-vulgare-…` |
| Yarrow / Common yarrow | Achillea millefolium | `achillea-millefolium-…` (shared) |
| Field scabious | Knautia arvensis | `knautia-arvensis-…` |
| Selfheal | Prunella vulgaris | `prunella-vulgaris-…` |
| Meadow clary | Salvia pratensis | `salvia-pratensis-…` |
| Common poppy | Papaver rhoeas | `papaver-rhoeas-…` |
| Cornflower | Centaurea cyanus | `centaurea-cyanus-…` |
| Sainfoin | Onobrychis viciifolia | `onobrychis-viciifolia-…` |
| Wild carrot | Daucus carota | `daucus-carota-…` |
| Lavender | Lavandula stoechas | `lavandula-stoechas-…` |
| Rosemary | Salvia rosmarinus | `salvia-rosmarinus-…` |
| Wild thyme | Thymus vulgaris | `thymus-vulgaris-…` |
| Crown daisy | Glebionis coronaria | `glebionis-coronaria-…` |
| Wild bergamot | Monarda fistulosa | `monarda-fistulosa-…` |
| Purple coneflower | Echinacea purpurea | `echinacea-purpurea-…` |
| New England aster | Symphyotrichum novae-angliae | `symphyotrichum-novae-angliae-…` |
| Golden alexanders | Zizia aurea | `zizia-aurea-…` |
| California poppy | Eschscholzia californica | `eschscholzia-californica-…` |
| Phacelia | Phacelia tanacetifolia | `phacelia-tanacetifolia-…` |
| Gumweed | Grindelia camporum | `grindelia-camporum-…` |

UV accuracy note: real UV patterns are species-specific (poppies are
UV-dark, many composites have a UV bullseye, bugloss flowers shift). Aim
for plausible-per-species, not invented uniformity; where unknown, a modest
central darkening plus pale petal tips is the safe read.

---

## 2. Bees (portraits for "Who comes")

**Dump into:** `docs/assets/bees/`
**One file per species:** `<slug>.png` — e.g. `osmia-bicornis.png`
**Size:** 800 × 800 px. Same plate language as the flowers: specimen on bone,
pinned-collection style, side profile, fine detail in the wings and scopa.
Not cute, not cartoon. Slugs: `osmia-bicornis`, `megachile-centuncularis`,
`osmia-caerulescens`, `megachile-willughbiella`, `osmia-leaiana`,
`osmia-cornuta`, `megachile-ericetorum`, `chelostoma-florisomne`,
`heriades-truncorum`, `megachile-pilidens`, `osmia-lignaria`, `osmia-taurus`,
`megachile-pugnata`, `megachile-fidelis`, `osmia-aztecana`.
(The page does not consume these yet — deliver the flowers first.)

---

## 3. Product imagery experiment (vs. our Blender pipeline)

Blender renders are slow here (~5 min/frame CPU). Worth testing whether
image generation over our real geometry reads better and faster. References
to feed alongside the prompt:

- `docs/plates/bh-4.png` — hidden-line drawing of the real four-storey model
  (ground truth for proportions; the object must match this)
- `docs/renders/web/studio-front.jpg` — our current best render (material and
  lighting reference)
- `viewer/public/models/*.glb` — actual geometry, for tools that take 3D input

**Dump into:** `docs/assets/scenes/`, 1600 × 1200 px:

- `sited-garden.png` — the Bee Home on legs among real planting, morning
  light, deep focus, shot at its true scale (it is ~50 cm tall — waist-high
  on a person, not a building)
- `sited-balcony.png` — wall-fixed variant on a balcony rail or wall,
  city-quiet background
- `workshop.png` — parts and one assembled unit on a workbench, honest
  makerspace clutter, window light

Hard constraints for all three: the object's geometry must match the plate
drawing (four storeys + plain roof slab, bore face visible), pale northern
timber (birch/ash, not orange), no text in image, no people's faces.

---

## Licence

Everything generated for this project ships under the project's CC BY 4.0.
Do not composite in third-party photography with unclear terms.
