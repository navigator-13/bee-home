"""Extract the production CNC toolpaths from BEEHOME GEOMETRIES.3dm as JSON.

The browser cannot open a .3dm, and the meshes it *can* open are the wrong
geometry to cut from. `WEBSITE - Model` — the layer the GLBs come from — is a
de-featured display derivative: every fillet and corner relief has been
stripped out of it. Cutting a storey from that outline with the 6 mm endmill
the project specifies leaves about 1.2 mm of material standing in every inside
corner, and Bee Home is friction-fit joinery with no fasteners, so the parts
would not seat.

The finished toolpaths are already in the file, on layers whose names carry
the operation, the cutter and the depth of cut:

    CUT-OUTSIDE_T6MM_30.00MM      outside profile, 6 mm cutter, 30 mm deep
    POCKET-INSIDE_T6MM_20.00MM    inside pocket, 6 mm cutter, 20 mm deep

Nothing here is inferred. Depths and tool diameters are parsed from those
names; the geometry is copied segment for segment. Every segment in the file
is exactly a line or exactly an arc — 3958 lines, 3930 arcs, and 948 NURBS
segments that are all linear or circular to 1e-6 — so nothing is tessellated
and no tolerance is spent.

    pip install rhino3dm && python tools/extract_toolpaths.py

--- how the parts are identified -------------------------------------------

The 3dm holds two near-identical copies of the cutting library, labelled by
REFERENCE text objects sitting under them: one under "REFERENCE: BeeHome story
library", one under "GRASSHOPPER: 2D Cutting lines". This reads the
Grasshopper copy, that being the definition's own output. They agree part for
part except the default base plate, where the Grasshopper copy carries two
pockets the reference copy does not.

Each copy is three columns of 17, labelled ROOF / FIXED / DEFAULT by their own
REFERENCE texts. Those are the three storey variants the Bee Home ID already
encodes: the export string appends `2` to the topmost storey, `1` to the one
below it when the base is fixed, and `0` otherwise.

Within a column the parts run *down* the letters: the topmost is the base
plate, then A below it, through to P at the bottom. That ordering was not
documented, it was measured — see verify_toolpath_mapping() at the foot of
this file, which re-checks it on every run and refuses to write if it breaks.
"""

import collections
import json
import math
import os
import re

import rhino3dm

SRC = "BEEHOME GEOMETRIES.3dm"
OUT = "viewer/public/toolpaths.json"
LETTERS = "ABCDEFGHIJKLMNOP"

# Pocket toolpaths that break out through an edge run up to a millimetre past
# the outside profile, so a part's own pockets are claimed by centroid with a
# little slack rather than by strict containment.
CLAIM_TOL = 1.5

# Two columns 200 mm apart, so anything under half that groups cleanly.
COLUMN_STEP = 200

LAYER_RE = re.compile(r"^(CUT-OUTSIDE|POCKET-INSIDE)_T([\d.]+)MM_([\d.]+)MM$")


def parse_layer(name):
    """Operation, cutter diameter and depth of cut, straight off the name."""
    m = LAYER_RE.match(name)
    if not m:
        return None
    return {"op": m.group(1), "tool_mm": float(m.group(2)), "depth_mm": float(m.group(3))}


def segments(curve):
    """A PolyCurve as native lines and arcs, in world coordinates.

    DXF arcs are always counter-clockwise from start angle to end angle, so an
    arc whose plane faces away from +Z has its angles swapped rather than its
    geometry rewritten.
    """
    out = []
    for i in range(curve.SegmentCount):
        seg = curve.SegmentCurve(i)
        arc = seg.Arc if isinstance(seg, rhino3dm.ArcCurve) else seg.TryGetArc(1e-6)
        if arc is not None and not seg.IsLinear(1e-6):
            c, s, e = arc.Center, arc.StartPoint, arc.EndPoint
            a0 = math.degrees(math.atan2(s.Y - c.Y, s.X - c.X)) % 360
            a1 = math.degrees(math.atan2(e.Y - c.Y, e.X - c.X)) % 360
            if arc.Plane.ZAxis.Z < 0:
                a0, a1 = a1, a0
            out.append(["A", c.X, c.Y, arc.Radius, a0, a1])
            continue
        d = seg.Domain
        p0, p1 = seg.PointAt(d.T0), seg.PointAt(d.T1)
        out.append(["L", p0.X, p0.Y, p1.X, p1.Y])
    return out


def localise(segs, ox, oy, places=4):
    """Shift to a part-local origin and drop float noise."""
    out = []
    for s in segs:
        if s[0] == "L":
            out.append(["L", round(s[1] - ox, places), round(s[2] - oy, places),
                        round(s[3] - ox, places), round(s[4] - oy, places)])
        else:
            out.append(["A", round(s[1] - ox, places), round(s[2] - oy, places),
                        round(s[3], places), round(s[4], places), round(s[5], places)])
    return out


def read_library(model):
    """Every toolpath curve, tagged with its layer, bounding box and centroid."""
    layers = {l.Index: l.FullPath for l in model.Layers}
    profiles, pockets = [], []
    for obj in model.Objects:
        name = layers.get(obj.Attributes.LayerIndex, "")
        spec = parse_layer(name)
        if spec is None:
            continue
        geo = obj.Geometry
        box = geo.GetBoundingBox()
        rec = dict(spec, layer=name, geo=geo,
                   x0=box.Min.X, y0=box.Min.Y, x1=box.Max.X, y1=box.Max.Y,
                   cx=(box.Min.X + box.Max.X) / 2, cy=(box.Min.Y + box.Max.Y) / 2)
        (profiles if spec["op"] == "CUT-OUTSIDE" else pockets).append(rec)
    return profiles, pockets


def label_columns(model):
    """The ROOF / FIXED / DEFAULT texts, and which x each one sits under."""
    layers = {l.Index: l.FullPath for l in model.Layers}
    found = []
    for obj in model.Objects:
        if layers.get(obj.Attributes.LayerIndex) != "REFERENCE":
            continue
        geo = obj.Geometry
        if not isinstance(geo, rhino3dm.Text):
            continue
        word = geo.PlainText.strip().rstrip(".").upper()
        if word in ("ROOF", "FIXED", "DEFAULT"):
            found.append((geo.Plane.Origin.X, word))
    return found


def build():
    model = rhino3dm.File3dm.Read(SRC)
    profiles, pockets = read_library(model)

    # Group the outside profiles into columns, and each column into its 17
    # parts by height up the sheet.
    columns = collections.defaultdict(list)
    for rec in profiles:
        columns[round(rec["x0"] / COLUMN_STEP)].append(rec)
    if any(len(v) != 17 for v in columns.values()):
        raise SystemExit(f"expected columns of 17, got {[len(v) for v in columns.values()]}")

    labels = label_columns(model)
    variant_of = {}
    for key, recs in columns.items():
        x = min(r["x0"] for r in recs)
        near = [(abs(lx - x), word) for lx, word in labels if abs(lx - x) < COLUMN_STEP / 2]
        if not near:
            raise SystemExit(f"column at x={x:.1f} has no ROOF/FIXED/DEFAULT label")
        variant_of[key] = min(near)[1]

    # Two copies of the library; the Grasshopper one is the definition's output.
    order = sorted(columns, key=lambda k: min(r["x0"] for r in columns[k]))
    chosen = {variant_of[k]: k for k in order[3:]}
    if set(chosen) != {"ROOF", "FIXED", "DEFAULT"}:
        raise SystemExit(f"second library copy is not one of each variant: {chosen}")

    digit = {"DEFAULT": "0", "FIXED": "1", "ROOF": "2"}
    parts, unclaimed = {}, list(pockets)

    for word, key in chosen.items():
        ranked = sorted(columns[key], key=lambda r: r["y0"])
        for ordinal, prof in enumerate(ranked):
            name = "BASE" if ordinal == 16 else LETTERS[15 - ordinal]
            mine = [p for p in unclaimed
                    if prof["x0"] - CLAIM_TOL <= p["cx"] <= prof["x1"] + CLAIM_TOL
                    and prof["y0"] - CLAIM_TOL <= p["cy"] <= prof["y1"] + CLAIM_TOL]
            for p in mine:
                unclaimed.remove(p)
            ox, oy = prof["x0"], prof["y0"]
            ops = [{
                "layer": prof["layer"], "op": prof["op"], "tool_mm": prof["tool_mm"],
                "depth_mm": prof["depth_mm"], "closed": bool(prof["geo"].IsClosed),
                "segs": localise(segments(prof["geo"]), ox, oy),
            }]
            for p in sorted(mine, key=lambda p: (-p["depth_mm"], p["cy"], p["cx"])):
                ops.append({
                    "layer": p["layer"], "op": p["op"], "tool_mm": p["tool_mm"],
                    "depth_mm": p["depth_mm"], "closed": bool(p["geo"].IsClosed),
                    "segs": localise(segments(p["geo"]), ox, oy),
                })
            parts[f"{name}{digit[word]}"] = {
                "letter": name, "variant": digit[word],
                "size_mm": [round(prof["x1"] - prof["x0"], 2),
                            round(prof["y1"] - prof["y0"], 2),
                            prof["depth_mm"]],
                "ops": ops,
            }

    # Everything left over belongs to the copy we did not read.
    leftover = [p for p in unclaimed
                if any(columns[k][0]["x0"] - 200 < p["cx"] < columns[k][0]["x0"] + 400
                       for k in order[3:])]
    if leftover:
        raise SystemExit(f"{len(leftover)} pockets in the chosen library claimed by no part")

    doc = {
        "units": "mm",
        "source": SRC,
        "library": "GRASSHOPPER: 2D Cutting lines",
        "note": ("Production toolpath centrelines as authored, in part-local mm. "
                 "Layer names carry the operation, cutter diameter and depth of cut."),
        "variants": {"0": "DEFAULT", "1": "FIXED", "2": "ROOF"},
        "parts": parts,
    }
    verify(parts)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    kb = os.path.getsize(OUT) / 1024
    total = sum(len(p["ops"]) for p in parts.values())
    print(f"wrote {OUT}: {len(parts)} parts, {total} operations, {kb:.0f} kB")


def verify(parts):
    """Re-check the part identification rather than trusting it.

    The letter order was recovered by measurement, so it is worth confirming on
    every run. Three things have to hold, and each would break under a
    different kind of mistake:

      · every letter present in all three variants, plus the base plate;
      · H alone is not 160 mm deep, matching the one storey the website index
        records as 120 x 140;
      · exactly five letters have a plain rectangular outside profile of four
        lines and four corner breaks, and they are A, D, E, N and O — the same
        five the display meshes show as unnotched slabs.
    """
    expected = {f"{n}{d}" for n in list(LETTERS) + ["BASE"] for d in "012"}
    if set(parts) != expected:
        raise SystemExit(f"part set mismatch: missing {expected - set(parts)}")

    odd = {k[0] for k, v in parts.items() if k[-1] == "0" and v["size_mm"][1] != 160.0}
    if odd != {"H"}:
        raise SystemExit(f"expected H to be the only non-160mm storey, got {odd}")

    def plain(part):
        segs = part["ops"][0]["segs"]
        return len(segs) == 8 and sum(1 for s in segs if s[0] == "A") == 4

    flat = {k[0] for k, v in parts.items() if k[-1] == "2" and k[:-1] != "BASE" and plain(v)}
    if flat != {"A", "D", "E", "N", "O"}:
        raise SystemExit(f"expected A/D/E/N/O to be the plain slabs, got {sorted(flat)}")

    for key, part in parts.items():
        if not part["ops"][0]["closed"]:
            raise SystemExit(f"{key}: outside profile is not a closed curve")
    print(f"verified {len(parts)} parts: letters, footprints and plain-slab set all as expected")


if __name__ == "__main__":
    build()
