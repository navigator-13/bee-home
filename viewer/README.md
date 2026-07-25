# Bee Home — builder

A rebuild of the 3D configurator that used to run at `beehome.design`.

```
npm install
npm run dev
```

## Where the geometry comes from

`public/models/*.glb` is generated from the `WEBSITE - Model` layer of
`BEEHOME GEOMETRIES.3dm` at the repo root — the same layer the original site
exported as `.obj`. Those OBJ files were never archived, so they are rebuilt
from source:

```
pip install rhino3dm mapbox_earcut numpy
python ../tools/mesh_storeys.py
```

The solids are polyhedral, so `tools/mesh_storeys.py` triangulates them exactly
without needing Rhino — see the module docstring for how.

## What is faithful to the original, and what isn't

Faithful:

- The **Bee Home ID** grammar (`src/design.js`), so a design made here can still
  be fabricated by the Grasshopper definition in this repo.
- The **stacking rules**, loaded from `public/storey-rules.json` — lifted
  verbatim from the original site's bundle.
- The **Grasshopper export string**, including the `0`/`1`/`2` roof-variant
  suffixes.
- The **palette**, the **wood textures**, and the display typeface, all
  recovered from the archived site.

Not faithful, deliberately:

- No ShapeDiver. The original round-tripped every change to a hosted parametric
  service; the meshes are static here and the stacking is done client-side.
- Body type is a system grotesque, not Neue Haas Unica — that font is licensed
  and cannot be redistributed.

Known gaps: no AR yet (`<model-viewer>` is the obvious route), and no DXF
export — take the Bee Home ID to `BEEHOME.gh` for cutting files.

## Storey variants

Each letter has two meshes, `_a` and `_b`, from the two stacks in the source
file. The original manifest called its pair `_default` and `_holes`; which of
ours is which is still unconfirmed, so they are named neutrally. `_a` carries
the cavity detail and is the default here.
