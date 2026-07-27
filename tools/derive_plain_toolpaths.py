"""Derive production cutting geometry for the plain ('b') storeys from the
display meshes — and refuse to emit it unless the derivation first reproduces
the known-good ('a') geometry.

    python tools/derive_plain_toolpaths.py --report     # validation table only
    python tools/derive_plain_toolpaths.py              # validate, then emit

WHY THE GATE EXISTS
-------------------
viewer/public/toolpaths.json holds real, extracted production geometry for the
51 patterned parts. The plain variant has no cutting lines anywhere in the .3dm,
so the only thing left to work from is the display mesh in
viewer/public/models/<L>_b.glb. Deriving geometry from a display mesh is only
legitimate if the same derivation, run on the patterned meshes, lands back on
the geometry we already know is correct. That check is the gate below, and as of
this writing IT FAILS — see FINDINGS. The tool is written so the emit path is
unreachable until someone supplies meshes that pass, rather than leaving a
plausible-looking file that nobody can vouch for.

WHAT THE DERIVATION DOES
------------------------
The storey meshes are 2.5D solids: a 120 x 160 x 30 mm block, cut face at the
mesh's z-min, stock face at z-max, no undercuts. So every machined feature shows
up as a horizontal, downward-facing facet, and its depth is just the z-height of
that facet above the cut face. Nothing is fitted; the whole derivation is:

  1. Collect triangles whose three vertices share a z, keep the ones whose
     normal points -Z. Union them per z-level. That level's polygon is a pocket
     footprint and its z is the pocket depth. (z == 0 is the leftover stock
     face, not a pocket; z == thickness would be no cut at all.)
  2. Holes in the +Z facet at z == thickness are through-pockets, depth
     == thickness.
  3. The outer profile is the union of every horizontal region, exterior rings
     only.
  4. Mesh coordinates are centred on the footprint; production is corner-origin,
     so shift by (+width/2, +height/2). Established by matching groove X
     positions, which agree to 0.00 mm.
  5. Corner relief is applied by rule, not measured: R3.2 where the cutter
     cannot reach an internal corner, R1.0 as an edge break on outside corners.
     Both radii are the convention observed throughout toolpaths.json.

FINDINGS (2026-07-27) — the gate fails, and not marginally
----------------------------------------------------------
Control: run the derivation on meshes that are known to encode the toolpaths
(tools/mesh_from_toolpaths.py output, via --allow-circular). On 15 of 16 letters
it recovers the outer profile to 0.076-0.243 mm, every pocket boundary to
0.17-0.24 mm, region IoU 0.900-0.991, and every depth exactly, with nothing
missing and nothing invented. The 16th, N, is not a derivation failure: that
mesh carries a 7 mm groove that toolpaths.json only lists under N1, while the
mesh index labels it N0, so the two inputs disagree about which variant it is.
The derivation itself is therefore sound to about a quarter of a millimetre.

Test: run the same derivation on the .3dm 'WEBSITE - Model' display meshes,
which are the only source variant 'b' has. It does not reproduce toolpaths.json:

  * The 30 mm through-cut present in all 51 production parts is absent from all
    32 display meshes. Not approximated — there is not one mesh vertex anywhere
    in its footprint.
  * Pattern-groove X positions match to 0.00 mm in 14 of 16 letters, but the Y
    extents are short by 9-61 mm in every letter, at every variant digit. The
    display grooves stop ~4 mm short at the far end and 5-45 mm short at the
    near end. Same feature, different revision of it.
  * Every mesh carries a stepped 17 mm-deep mounting socket that no production
    part has, and most lack the 20 mm edge break-out pockets entirely.
  * Totals: worst pocket boundary deviation 157 mm, worst region IoU 0.448,
    24 real depth classes not reproduced, 18 invented.

The expected noise from display meshes lacking fillets is 1.325 mm (the R3.2
sagitta) and 0.414 mm (R1.0). The deviations above are 7-100x that. They are a
different revision of the design, not a coarser rendering of the same one.

Requires: numpy, shapely.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
from collections import defaultdict

import numpy as np
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLPATHS = os.path.join(ROOT, "viewer", "public", "toolpaths.json")
MODELS = os.path.join(ROOT, "viewer", "public", "models")
OUT = os.path.join(ROOT, "viewer", "public", "toolpaths-plain.json")
LETTERS = "ABCDEFGHIJKLMNOP"

# Corner relief, as observed throughout toolpaths.json.
R_INSIDE = 3.2   # cutter cannot reach an internal corner; relieve it
R_OUTSIDE = 1.0  # edge break on an outside corner

# --- validation gate --------------------------------------------------------
# The display meshes are polyhedral: they have no fillets. Replacing an R3.2
# relief with a sharp corner moves the boundary by r*(sqrt(2)-1) = 1.325 mm, and
# an R1.0 break by 0.414 mm. Anything at or under ~1.4 mm is therefore the mesh
# being unfilleted, which the derivation puts back by rule. Real disagreement
# starts above that, so the gate sits just clear of it.
GATE_OUTER_MM = 2.0      # max boundary deviation of the derived outer profile
GATE_POCKET_MM = 2.0     # max boundary deviation of any matched pocket
GATE_MIN_IOU = 0.90      # worst per-depth region overlap
GATE_ALLOW_MISSING = 0   # real depth classes the derivation failed to produce
GATE_ALLOW_SPURIOUS = 0  # depth classes the derivation invented


# ---------------------------------------------------------------------------
# GLB reading
# ---------------------------------------------------------------------------

_CTYPE = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
          5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _read_glb(path):
    raw = open(path, "rb").read()
    if raw[:4] != b"glTF":
        raise ValueError(f"{path} is not a GLB")
    off, js, binbuf = 12, None, None
    while off < len(raw):
        length, kind = struct.unpack("<II", raw[off:off + 8])
        chunk = raw[off + 8:off + 8 + length]
        if kind == 0x4E4F534A:
            js = json.loads(chunk.decode("utf8"))
        elif kind == 0x004E4942:
            binbuf = chunk
        off += 8 + length
    return js, binbuf


def _accessor(js, binbuf, idx):
    acc = js["accessors"][idx]
    view = js["bufferViews"][acc["bufferView"]]
    fmt, size = _CTYPE[acc["componentType"]]
    ncomp = _NCOMP[acc["type"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or size * ncomp
    out = np.empty((acc["count"], ncomp), dtype=np.dtype(fmt))
    for i in range(acc["count"]):
        out[i] = struct.unpack_from("<" + fmt * ncomp, binbuf, base + i * stride)
    return out


def _node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4).T
    m = np.eye(4)
    if "scale" in node:
        s = np.eye(4)
        s[0, 0], s[1, 1], s[2, 2] = node["scale"]
        m = m @ s
    if "rotation" in node:
        x, y, z, w = node["rotation"]
        m = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
            [0, 0, 0, 1]]) @ m
    if "translation" in node:
        t = np.eye(4)
        t[:3, 3] = node["translation"]
        m = t @ m
    return m


def mesh_triangles(path):
    """Every triangle in the file, in world space. Returns (verts, faces)."""
    js, binbuf = _read_glb(path)
    verts, faces, base = [], [], 0
    stack = [(i, np.eye(4)) for i in js["scenes"][js.get("scene", 0)]["nodes"]]
    while stack:
        idx, parent = stack.pop()
        node = js["nodes"][idx]
        world = parent @ _node_matrix(node)
        if "mesh" in node:
            for prim in js["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                pts = _accessor(js, binbuf, prim["attributes"]["POSITION"]).astype(float)
                pts = (world[:3, :3] @ pts.T).T + world[:3, 3]
                if "indices" in prim:
                    tri = _accessor(js, binbuf, prim["indices"]).astype(int).reshape(-1, 3)
                else:
                    tri = np.arange(len(pts)).reshape(-1, 3)
                verts.append(pts)
                faces.append(tri + base)
                base += len(pts)
        for child in node.get("children", []):
            stack.append((child, world))
    return np.vstack(verts), np.vstack(faces)


# ---------------------------------------------------------------------------
# STEP 1 — mesh to candidate production geometry
# ---------------------------------------------------------------------------

def horizontal_regions(verts, faces, tol=1e-4):
    """{(z, facing): polygon} for every flat horizontal facet in the mesh."""
    buckets = defaultdict(list)
    for tri in verts[faces]:
        z = tri[:, 2]
        if z.max() - z.min() > tol:
            continue
        normal = np.cross(tri[1] - tri[0], tri[2] - tri[0])
        if abs(normal[2]) < 1e-9:
            continue
        poly = Polygon(tri[:, :2])
        if poly.area < 1e-9:
            continue
        buckets[(round(float(z[0]), 3), 1 if normal[2] > 0 else -1)].append(poly)
    return {k: unary_union(v).buffer(0) for k, v in buckets.items()}


def derive(mesh_path):
    """Candidate production geometry for one display mesh.

    Returns {outer, thickness, pockets: [(polygon, depth_mm)]} in production
    coordinates: millimetres, corner origin, Z up.
    """
    verts, faces = mesh_triangles(mesh_path)
    verts = verts.copy()
    lo, hi = verts.min(axis=0), verts.max(axis=0)
    # Centred display coordinates -> corner-origin production coordinates.
    verts[:, 0] -= lo[0]
    verts[:, 1] -= lo[1]
    verts[:, 2] -= lo[2]
    thickness = float(hi[2] - lo[2])

    regions = horizontal_regions(verts, faces)
    outer = unary_union(list(regions.values())).buffer(0)

    pockets = []
    for (z, facing), poly in sorted(regions.items()):
        if facing != -1:
            continue
        if z <= 1e-6 or z >= thickness - 1e-6:
            continue  # z == 0 is leftover stock, not a pocket floor
        pockets.append((poly, z))

    top = regions.get((round(thickness, 3), 1))
    if top is not None:
        for part in (top.geoms if isinstance(top, MultiPolygon) else [top]):
            for ring in part.interiors:
                pockets.append((Polygon(ring), thickness))

    return {"outer": outer, "thickness": thickness, "pockets": pockets}


def apply_corner_relief(poly, inside_r=R_INSIDE, outside_r=R_OUTSIDE):
    """Round the corners of a ring by rule.

    A sharp corner is replaced by a tangent arc: `inside_r` where the cutter
    could not reach (a corner convex into the material) and `outside_r` as an
    edge break elsewhere. Corners too tight for the radius are left alone rather
    than producing a self-intersecting ring.
    """
    ring = list(poly.exterior.coords)[:-1]
    if len(ring) < 3:
        return poly
    ccw = _signed_area(ring) > 0
    out = []
    for i, cur in enumerate(ring):
        prv, nxt = ring[i - 1], ring[(i + 1) % len(ring)]
        a = (prv[0] - cur[0], prv[1] - cur[1])
        b = (nxt[0] - cur[0], nxt[1] - cur[1])
        la, lb = math.hypot(*a), math.hypot(*b)
        if la < 1e-9 or lb < 1e-9:
            continue
        a, b = (a[0] / la, a[1] / la), (b[0] / lb, b[1] / lb)
        cross = a[0] * b[1] - a[1] * b[0]
        if abs(cross) < 1e-9:
            out.append(cur)  # straight through
            continue
        convex = (cross < 0) if ccw else (cross > 0)
        radius = inside_r if convex else outside_r
        half = math.acos(max(-1.0, min(1.0, a[0] * b[0] + a[1] * b[1]))) / 2
        if half < 1e-6 or abs(math.tan(half)) < 1e-9:
            out.append(cur)
            continue
        setback = radius / math.tan(half)
        if setback > min(la, lb) * 0.5:
            out.append(cur)  # corner too tight for this radius
            continue
        p0 = (cur[0] + a[0] * setback, cur[1] + a[1] * setback)
        p1 = (cur[0] + b[0] * setback, cur[1] + b[1] * setback)
        sweep = math.pi - 2 * half
        steps = max(2, int(math.ceil(sweep / math.radians(6))))
        cx = cur[0] + (a[0] + b[0]) / math.hypot(a[0] + b[0], a[1] + b[1]) * (radius / math.sin(half))
        cy = cur[1] + (a[1] + b[1]) / math.hypot(a[0] + b[0], a[1] + b[1]) * (radius / math.sin(half))
        a0 = math.atan2(p0[1] - cy, p0[0] - cx)
        a1 = math.atan2(p1[1] - cy, p1[0] - cx)
        delta = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        out += [(cx + radius * math.cos(a0 + delta * t / steps),
                 cy + radius * math.sin(a0 + delta * t / steps)) for t in range(steps + 1)]
    result = Polygon(out, [list(r.coords) for r in poly.interiors])
    return result if result.is_valid else result.buffer(0)


def _signed_area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts))) / 2.0


def polygon_to_segs(poly, chord_deg=6.0):
    """Ring -> the ['L', x1, y1, x2, y2] segment list toolpaths.json uses.

    Relieved corners come back as short chords rather than ['A', ...] arcs: the
    arc form needs a centre and a sweep, and re-fitting one to a polyline is a
    fit, not a derivation. Straight runs stay single segments.
    """
    segs = []
    coords = list(poly.exterior.coords)
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        if math.hypot(x2 - x1, y2 - y1) < 1e-7:
            continue
        segs.append(["L", round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)])
    return segs


# ---------------------------------------------------------------------------
# STEP 2 — validation against the known-good geometry
# ---------------------------------------------------------------------------

def _arc_points(cx, cy, r, a0, a1, step_deg=1.0):
    sweep = (a1 - a0) % 360.0 or 360.0
    n = max(2, int(math.ceil(sweep / step_deg)))
    return [(cx + r * math.cos(math.radians(a0 + sweep * i / n)),
             cy + r * math.sin(math.radians(a0 + sweep * i / n))) for i in range(n + 1)]


def _seg_points(seg):
    if seg[0] == "L":
        return [(seg[1], seg[2]), (seg[3], seg[4])]
    return _arc_points(seg[1], seg[2], seg[3], seg[4], seg[5])


def op_polygon(op):
    """One toolpaths.json op -> a closed polygon, chaining segments by endpoint."""
    chains = [_seg_points(s) for s in op["segs"]]
    path, used = list(chains[0]), [False] * len(chains)
    used[0] = True
    for _ in range(len(chains) - 1):
        end, best = path[-1], None
        for i, chain in enumerate(chains):
            if used[i]:
                continue
            for candidate in (chain, chain[::-1]):
                d = math.dist(end, candidate[0])
                if best is None or d < best[0]:
                    best = (d, i, candidate)
        _, i, candidate = best
        used[i] = True
        path += candidate[1:]
    poly = Polygon(path)
    return poly if poly.is_valid else poly.buffer(0)


def real_geometry(part):
    outer, pockets = None, []
    for op in part["ops"]:
        poly = op_polygon(op)
        if op["op"] == "CUT-OUTSIDE":
            outer = poly if outer is None else unary_union([outer, poly])
        else:
            pockets.append((poly, float(op["depth_mm"])))
    return outer, pockets


def _exteriors(geom):
    return unary_union([Polygon(p.exterior)
                        for p in (geom.geoms if isinstance(geom, MultiPolygon) else [geom])])


def _by_depth(pockets, clip, exclusive=True):
    """Pocket regions grouped by depth, clipped to the part.

    With `exclusive`, each depth keeps only the area no deeper pocket removes.
    That is what a mesh can show: a 6 mm groove running into a 20 mm pocket
    leaves a 6 mm floor only up to where the deeper pocket starts, even though
    the authored 6 mm toolpath runs the full length. Comparing authored extents
    against mesh floors otherwise reports a 4-6 mm error for two descriptions of
    the identical machined part.
    """
    grouped = defaultdict(list)
    for poly, depth in pockets:
        poly = poly.intersection(clip).buffer(0)
        if poly.area < 0.5:
            continue
        grouped[round(float(depth), 3)].append(poly)
    merged = {d: unary_union(v).buffer(0) for d, v in grouped.items()}
    if not exclusive:
        return merged
    out = {}
    for d, poly in merged.items():
        deeper = [g for dd, g in merged.items() if dd > d]
        if deeper:
            poly = poly.difference(unary_union(deeper)).buffer(0)
        if poly.area >= 0.5:
            out[d] = poly
    return out


def _hausdorff(a, b):
    return max(a.boundary.hausdorff_distance(b.boundary),
               b.boundary.hausdorff_distance(a.boundary))


def validate(parts, mesh_dir, suffix="a"):
    """Compare the derivation against the real geometry, letter by letter."""
    rows = []
    for letter in LETTERS:
        path = os.path.join(mesh_dir, f"{letter}_{suffix}.glb")
        if not os.path.exists(path):
            continue
        got = derive(path)
        # Clip to the *filled* footprint: got["outer"] has a hole wherever a
        # through-pocket is, and clipping a through-pocket to that erases it.
        clip = _exteriors(got["outer"])
        width = clip.bounds[2] - clip.bounds[0]
        height = clip.bounds[3] - clip.bounds[1]
        derived_depths = _by_depth(got["pockets"], clip)

        # Pick the variant digit this mesh is meant to be: stock size first
        # (it is exact and unambiguous), then region overlap.
        best = None
        for digit in "012":
            key = letter + digit
            if key not in parts:
                continue
            size = parts[key]["size_mm"]
            outer, pockets = real_geometry(parts[key])
            real_depths = _by_depth(pockets, outer)
            shared = set(derived_depths) & set(real_depths)
            overlap = sum(
                derived_depths[d].intersection(real_depths[d]).area
                / max(1e-9, derived_depths[d].union(real_depths[d]).area) for d in shared)
            # Stock size first (exact and unambiguous), then how much of the
            # feature set lines up, then region overlap.
            mismatch = len(set(real_depths) ^ set(derived_depths))
            score = (-10 * (abs(size[0] - width) + abs(size[1] - height))
                     - 0.5 * mismatch + overlap)
            if best is None or score > best[0]:
                best = (score, key, outer, real_depths)
        _, key, real_outer, real_depths = best

        outer_dev = _hausdorff(_exteriors(clip), _exteriors(real_outer))
        shared = sorted(set(derived_depths) & set(real_depths))
        ious = [derived_depths[d].intersection(real_depths[d]).area
                / max(1e-9, derived_depths[d].union(real_depths[d]).area) for d in shared]
        devs = [_hausdorff(derived_depths[d], real_depths[d]) for d in shared]
        rows.append({
            "letter": letter, "part": key, "outer_dev": outer_dev,
            "derived_pockets": len(derived_depths), "real_pockets": len(real_depths),
            "matched": len(shared),
            "min_iou": min(ious, default=0.0),
            "pocket_dev": max(devs, default=0.0),
            "depths_exact": len(shared),  # depth is the match key, so matched == exact
            "missing": sorted(set(real_depths) - set(derived_depths)),
            "spurious": sorted(set(derived_depths) - set(real_depths)),
        })
    return rows


def print_table(rows, title):
    print(f"\n=== {title} ===")
    head = (f"{'L':2} {'part':5} {'outerDev':>8} {'pk der/real':>11} {'matched':>7} "
            f"{'minIoU':>6} {'pocketDev':>9} {'depths?':>7}  missing / spurious")
    print(head)
    print("-" * len(head))
    for r in rows:
        print(f"{r['letter']:2} {r['part']:5} {r['outer_dev']:8.3f} "
              f"{r['derived_pockets']:5d}/{r['real_pockets']:<5d} {r['matched']:7d} "
              f"{r['min_iou']:6.3f} {r['pocket_dev']:9.2f} "
              f"{r['depths_exact']}/{r['matched']:<5} "
              f"{r['missing']} / {r['spurious']}")
    print("-" * len(head))


def gate(rows):
    """True if the derivation reproduces the known-good geometry. Prints why not."""
    worst_outer = max(r["outer_dev"] for r in rows)
    worst_pocket = max(r["pocket_dev"] for r in rows)
    worst_iou = min(r["min_iou"] for r in rows)
    missing = sum(len(r["missing"]) for r in rows)
    spurious = sum(len(r["spurious"]) for r in rows)
    print(f"worst outer deviation  {worst_outer:8.3f} mm   (limit {GATE_OUTER_MM})")
    print(f"worst pocket deviation {worst_pocket:8.3f} mm   (limit {GATE_POCKET_MM})")
    print(f"worst region IoU       {worst_iou:8.3f}      (limit {GATE_MIN_IOU})")
    print(f"missing depth classes  {missing:8d}      (limit {GATE_ALLOW_MISSING})")
    print(f"spurious depth classes {spurious:8d}      (limit {GATE_ALLOW_SPURIOUS})")
    failures = []
    if worst_outer > GATE_OUTER_MM:
        failures.append(f"outer profile off by {worst_outer:.2f} mm")
    if worst_pocket > GATE_POCKET_MM:
        failures.append(f"pocket boundary off by {worst_pocket:.2f} mm")
    if worst_iou < GATE_MIN_IOU:
        failures.append(f"pocket region IoU down to {worst_iou:.3f}")
    if missing > GATE_ALLOW_MISSING:
        failures.append(f"{missing} real depth classes not reproduced")
    if spurious > GATE_ALLOW_SPURIOUS:
        failures.append(f"{spurious} invented depth classes")
    if failures:
        print("\nGATE FAILED: " + "; ".join(failures))
        return False, dict(outer=worst_outer, pocket=worst_pocket, iou=worst_iou,
                           missing=missing, spurious=spurious)
    print("\nGATE PASSED")
    return True, dict(outer=worst_outer, pocket=worst_pocket, iou=worst_iou,
                      missing=missing, spurious=spurious)


# ---------------------------------------------------------------------------
# STEP 3 — emit, only behind the gate
# ---------------------------------------------------------------------------

def emit(parts, mesh_dir, tolerance):
    out = {
        "units": "mm",
        "source": "viewer/public/models/<LETTER>_b.glb",
        "library": "DERIVED — not extracted",
        "note": ("Derived from the plain display meshes by "
                 "tools/derive_plain_toolpaths.py, not read from the .3dm. "
                 "Corner relief is applied by rule (R%.1f inside, R%.1f outside), "
                 "not measured." % (R_INSIDE, R_OUTSIDE)),
        "derivation": {
            "tool": "tools/derive_plain_toolpaths.py",
            "validated_against": "viewer/public/toolpaths.json, variant 'a' meshes",
            "validation": tolerance,
        },
        "variants": {"0": "DEFAULT", "1": "FIXED", "2": "ROOF"},
        "parts": {},
    }
    for letter in LETTERS:
        path = os.path.join(mesh_dir, f"{letter}_b.glb")
        if not os.path.exists(path):
            continue
        got = derive(path)
        ops = [{
            "layer": f"CUT-OUTSIDE_T6MM_{got['thickness']:.2f}MM",
            "op": "CUT-OUTSIDE", "tool_mm": 6.0, "depth_mm": got["thickness"],
            "closed": True,
            "segs": polygon_to_segs(apply_corner_relief(_exteriors(got["outer"]))),
        }]
        for poly, depth in sorted(got["pockets"], key=lambda p: -p[1]):
            for piece in (poly.geoms if isinstance(poly, MultiPolygon) else [poly]):
                ops.append({
                    "layer": f"POCKET-INSIDE_T6MM_{depth:.2f}MM",
                    "op": "POCKET-INSIDE", "tool_mm": 6.0, "depth_mm": depth,
                    "closed": True,
                    "segs": polygon_to_segs(apply_corner_relief(piece)),
                })
        bounds = got["outer"].bounds
        out["parts"][letter + "0"] = {
            "size_mm": [round(bounds[2] - bounds[0], 2),
                        round(bounds[3] - bounds[1], 2),
                        round(got["thickness"], 2)],
            "ops": ops,
        }
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
    print(f"wrote {OUT} ({len(out['parts'])} parts)")


def check_not_circular(mesh_dir):
    """Refuse to validate against meshes that were built from toolpaths.json.

    tools/mesh_from_toolpaths.py can regenerate the variant-'a' GLBs from the
    very file the gate checks against. Validating on those proves only that the
    round trip is lossless — it says nothing about whether a display mesh
    carries production geometry, which is the question the gate exists to
    answer, and it is the question that matters for variant 'b' (whose meshes
    come from the .3dm and nowhere else). So bail out rather than pass falsely.
    """
    index = os.path.join(mesh_dir, "index.json")
    if not os.path.exists(index):
        return True
    blob = json.load(open(index))
    tainted = [f"{letter}_a" for letter, v in blob.get("storeys", {}).items()
               if "toolpath" in str(v.get("a", {}).get("source", "")).lower()]
    if tainted:
        print(f"REFUSING: {len(tainted)} variant-'a' meshes in {mesh_dir} declare "
              f"toolpaths.json as their source ({', '.join(tainted[:4])}...). "
              f"Validating the derivation against them would be circular.\n"
              f"Point --models at meshes built from the .3dm "
              f"(tools/mesh_storeys.py), or pass --allow-circular to measure "
              f"round-trip loss only.")
        return False
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--models", default=MODELS, help="directory of storey GLBs")
    ap.add_argument("--report", action="store_true", help="validate only, never emit")
    ap.add_argument("--allow-circular", action="store_true",
                    help="permit meshes generated from toolpaths.json "
                         "(round-trip measurement only, never a valid gate)")
    args = ap.parse_args()

    if not args.allow_circular and not check_not_circular(args.models):
        return 2

    parts = json.load(open(TOOLPATHS))["parts"]
    rows = validate(parts, args.models, suffix="a")
    print_table(rows, f"variant 'a' derivation vs toolpaths.json  ({args.models})")
    ok, tolerance = gate(rows)

    if args.report:
        return 0
    if not ok:
        print("\nRefusing to emit toolpaths-plain.json. The derivation does not "
              "reproduce geometry we already know to be correct, so nothing it "
              "produces for the plain variant can be trusted. See FINDINGS in "
              "this file's docstring.")
        return 1
    emit(parts, args.models, tolerance)
    return 0


if __name__ == "__main__":
    sys.exit(main())
