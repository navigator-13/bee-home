# Visual directions

Source for the direction concepts published as an artifact. Each block in
`directions.tpl.html` is built in its own aesthetic rather than described —
the palette, type and motion are the proposal.

Two of the three visuals are made from real project material rather than stock
imagery, which is the point:

| File | How it was made |
| --- | --- |
| `toolpaths.svg` | All 792 cutting curves from the `CUT-*` and `POCKET-*` layers of `BEEHOME GEOMETRIES.3dm`, in the Rhino file's own layer colours. Regenerate with `tools/extract_cutlines.py`. |
| `beevision.jpg` | The original launch photograph with the red channel dropped and short wavelengths lifted — an approximation of red-blind, UV-shifted bee vision. |
| `humanvision.jpg` | The same photograph untouched, for the drag-to-compare. |
| `tunnel.jpg` | A darkened, vignetted crop of Irina Boersma's process photograph. |

`directions.tpl.html` uses `$FONT`, `$IMG_*` and `$TOOLPATHS` placeholders,
substituted with base64 data URIs at publish time so the page is self-contained
(the Artifact CSP blocks every external host).

Direction C — Field Guide — was dropped after review.
