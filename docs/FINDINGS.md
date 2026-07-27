# What the original left, and what this rebuild had to work out

Bee Home was released by SPACE10 in May 2020 under CC BY 4.0, and went off the
air when the lab closed in 2023. The geometry survived. The site did not, and
neither did the answers to a number of questions the files raise but do not
settle.

This is a record of what was recovered, what turned out to be wrong or
ambiguous, how each was settled, and what is still open. It is here so that the
next person does not repeat the measuring, and so that anyone reading the build
pack can see how much of it is sourced and how much is inferred.

## Recovered rather than reinvented

| Thing | Where it came from |
| --- | --- |
| Site copy | The Wayback Machine, extracted to `docs/reference/extracted/original-copy.md` |
| Bee Home ID grammar | `ReadMe.pdf` |
| Grasshopper export string | The original site bundle's `floorsExportString` |
| Stacking rules | The original site bundle, **not** `ReadMe.pdf` — see below |
| Timber material recipe | The original site's AR export code: `#F1D6BA` over the plywood map at `repeat(2, 2)` |
| Cutting geometry | `BEEHOME GEOMETRIES.3dm`, via `tools/extract_toolpaths.py` |

## Settled

**The stacking rules contradict themselves.** `ReadMe.pdf` states them twice and
the two statements disagree. The recovered site bundle carries one version, and
that is the one in `viewer/public/storey-rules.json`, because it is the version
the original builder actually enforced.

**The letter mapping runs down each column, not up.** The library sheet has no
part names on it. Reading the ordinals the other way round produced a set that
looked plausible and was wrong throughout. Confirmed by the sagitta of the R3.2
corner fillets, 3.2 × (√2 − 1) = 1.326 mm, which only lands on the right parts
under one direction.

**The display meshes were the wrong cut.** All 32 shipped meshes were the FIXED
variant. The same letter is cut three ways depending on where it sits — the
topmost storey is the ROOF cut, the one below it the FIXED cut under a wall
mounting, everything else DEFAULT — so 12 of the 16 letters previewed as a part
the cutting files would not produce. In a four-storey standing build, three of
the four storeys were wrong. The meshes are now regenerated from the production
toolpaths by `tools/mesh_from_toolpaths.py`; agreement with the cutting geometry
went from 15 mm to 1.25 mm.

**The cut list was sending people for the wrong stock.** H is 140 mm deep cut as
a storey and 150 mm as a roof. Read off the display meshes, the list named a
board the DXF then cut past. Footprints now come from the cutting library.

**Curves sharing a depth are one region, read even-odd.** Treated as a union,
N's 20 mm pocket becomes a solid rectangle; read even-odd it is the frame
between two nested rectangles, which is what the part is.

**The pocket curves are finished walls, not tool centrelines.** A 6.00 mm wide
pocket cut with a 6 mm cutter is a single pass, and the outside profiles match
the cut-list footprints to the millimetre. This was assumed unresolvable for a
while. It is not.

**Nothing in the geometry is too tight for the cutter named on its layer.**
Every part contains 1 mm arcs, and a 6 mm cutter has a 3 mm radius, so 236 of
them sit inside pockets. Classifying each by whether its centre falls in the
void the cutter enters or in the material it travels around: zero corners are
tighter than the cutter that has to reach them. Every 1 mm arc is convex.

**Which pockets are the nesting cavities.** Recorded nowhere. `BEEHOME.gh` is a
binary archive, and the only names in the Rhino files are layer names, which
carry the cutter and the depth and nothing about intent. Measured across all 16
letters:

- The 30 mm through-pocket is 22.6 × 32.6 mm in every one of them, identical in
  size and position, open at both ends. It is the shared opening.
- The cavities are the shallow slots — 6 to 12 mm across, 99 to 149 mm long,
  cut 6 to 20 mm into a 30 mm board and closed by the underside of the storey
  above. That is a horizontal tunnel of the bore solitary bees use, at a length
  that favours female offspring.
- The 20 mm pockets are broad, 52 × 22 up to 124 × 164. Front pattern and
  recesses.

So the letters whose deepest cut is 6 or 7 mm are the ones full of nesting
channels, not the ones without any. **Every letter has them except D**, and a
design made only of chamber storeys is a bee hotel with nowhere to nest. The
build pack now says so.

**The job needs two cutters, not one.** Every part is a 6 mm job except D, whose
two small pockets are on a `T5MM` layer. A stack with a D in it is a tool
change. The spec row now reads the cutters off the design.

**Plain fronts cannot be made from these files.** The cutting library holds one
set of storey profiles, the patterned ones. Deriving the plain geometry was
tried properly — the method validates on a control at 0.076–0.243 mm on the
outer profile, IoU 0.900 to 0.991, depths exact — and then fails on the real
input by 7 to 100× that, because the input meshes are an earlier design
revision: the 30 mm through-cut is absent from all 32 of them and every groove
is short in Y by 9 to 61 mm. `tools/derive_plain_toolpaths.py` refuses to emit
rather than ship geometry it cannot vouch for.

**The build pack was four A4 pages while claiming two.** The three drawing
plates took their height from the render buffer rather than the frame they print
in, putting 360 mm of content in a 273 mm page, and a multi-column block with no
definite height fragments across printed pages instead of balancing inside one.

**The legs and the spike are stock, not sheet parts.** A 200 mm spike and a
50 mm leg do not come off a 30 mm sheet, so no DXF would carry them. Their
sections are corroborated rather than guessed: the base plates hold a
32.2 × 32.2 mm socket, and 32.2 against a 30 mm member is 1.1 mm of clearance a
side — the same clearance the 32.2 mm wide leg recesses give a 30 mm leg. Length
comes from the mounting height, which the cut list already computes.

**Duplicate coincident curves on the base plate.** `BASE0` carries its two
122 × 32 leg recesses twice over: one pair identical to within rounding, the
other differing by 2% of area. Read even-odd — which is how every other pocket
in the library has to be read — a curve drawn twice cancels itself and the
recess disappears. It is the only part of the 51 with this problem, and the base
plate is not in the DXF, so nothing downstream is affected. Worth knowing before
anyone promotes the base plate to a cut part.

**The variant labels are the originals'.** DEFAULT, FIXED and ROOF are read from
text sitting beside each column in the Rhino file, not inferred from position.

## Still open

**Which face the pocket depths are measured from.** A 2D file cannot say. In
practice this matters less than it sounds: every depth is within the board
thickness and no layer names a second side, so the whole library reads as one
setup with every pocket cut from the same face. Cut the parts from one sheet in
one setup and the stack is self-consistent — the worst case is a mirror-image
Bee Home, which works identically. The real risk is flipping some parts and not
others, which is an instruction, not an unknown. `tools/mesh_from_toolpaths.py`
documents the assumption it makes.

**Which base plate goes with which mounting.** The library holds three, one per
cut variant, all 140 × 160 × 30 and sharing the same through-pocket and 32.2 mm
socket. They differ only in what else they carry: the DEFAULT one adds two
122 × 32 frames front and back, the ROOF one adds a 24 mm socket further
forward, the FIXED one adds nothing. Those differences do not map onto standing,
grounded and wall-fixed in any way the geometry supports. The likely answer is
that the base plate is simply the DEFAULT one, on the same positional rule the
storeys already use — it sits at the bottom of the stack, so it is neither the
topmost part nor the one below it — and that the other two are what the
definition emits for a row that has no meaning in those columns. Worth one test
cut before it goes in the DXF.

**The roof slab has no production geometry, and is now derived.** Nothing in the
toolpath library is thinner than 30 mm. The display mesh is no help either: it
is a plain box, 36 vertices and twelve triangles, and so is the base plate's,
while the production base plate has a through-pocket and two sockets in it. A
plain display box is evidence of a simplified display model, not of a featureless
part. What is solid is the footprint — the roof and the base plate are both
140 × 160 while every storey is 120 wide — so the DXF now cuts the roof from the
base plate's own production outline, labelled on the drawing as derived with a
nominal thickness. If the real part has a register recess on its underside, this
one will sit flat instead of locating.

## Rebuilt rather than recovered

The 3D builder, the DXF writer, the two-sheet build pack, the site and its
artwork are new work. The original site's builder ran on ShapeDiver, a hosted
Grasshopper service that is not part of the release, so the parametric model
could not simply be restarted. What is here renders the original geometry
directly.

---

Original Bee Home CC BY 4.0 — SPACE10, Bakken & Bæck, Tanita Klein.
This revival and everything new in it, also CC BY 4.0 — Iván Langesfeld, 2026.
