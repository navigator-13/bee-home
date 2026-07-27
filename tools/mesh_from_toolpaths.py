"""Build the storey display meshes from the production toolpaths.

The builder's 3D preview used to be meshed from the `WEBSITE - Model` layer of
BEEHOME GEOMETRIES.3dm (see tools/mesh_storeys.py). That layer is a display
derivative, and it does not agree with the geometry the DXF in the build pack
is cut from: measured against the cutting library, every letter's mesh is the
FIXED storey, while almost every storey in a stack is cut as DEFAULT. On K, L
and M the two differ by 29.5 mm; on B, C, I, J, P by 10-15 mm. Someone could
preview one shape and be sent files for another.

So this builds the meshes from viewer/public/toolpaths.json instead, which is
the cutting geometry itself. Nothing here reads the .3dm, so a checkout can
regenerate the previews without Rhino:

    pip install shapely mapbox_earcut numpy && python tools/mesh_from_toolpaths.py

--- which variant a mesh shows -------------------------------------------

The cutting library holds three storeys per letter -- DEFAULT, FIXED, ROOF --
and for ten of the sixteen letters their outside profiles genuinely differ:
FIXED and ROOF have a flat back edge (it beds against the wall bracket, and
carries the counterbored fixings) where DEFAULT has the same recessed relief as
the front. The viewer has one mesh slot per letter, keyed `storeys[L].a`, and
main.js has no hook to vary it down the stack.

One shape has to stand for three, so it is the one almost every storey is:
design.js's exportString appends `2` to the topmost storey and `1` to the
second from top only under a fixed mounting. Everything else is `0`, which is
also the digit main.js falls back to when the export string runs short. So
DEFAULT it is, and the topmost storey is the one whose preview is approximate.
Point VARIANT at "1" or "2" to see the others.

--- how the solid is built -------------------------------------------------

The curves in toolpaths.json are finished wall geometry, not tool centrelines:
the CUT-OUTSIDE bounding box is exactly the part footprint, a 6.00 mm deep
pocket cut with a 6 mm cutter is exactly 6.000 mm wide, and pockets that break
out through an edge are drawn overrunning it. So no tool radius is offset;
CUT-OUTSIDE is extruded through the stock and each POCKET-INSIDE is subtracted
to its own depth.

Depth is measured from the underside, z = 0. The 2D file cannot say which face
that is, but two things point the same way. The ROOF variant replaces the
storey's 30 mm through-bore with a 24 mm blind pocket, which only means
anything if the 6 mm it leaves is the face you can see -- the top. And the
display meshes this replaces put every pocket floor at exactly z = depth,
measured up from z = 0, so keeping that face keeps the previews the way round
people have already seen them.

The solid comes out as a stack of horizontal bands, one per distinct pocket
depth. Band k spans [z(k-1), z(k)] and its cross-section is the outside profile
less every pocket at least as deep as z(k), so the bands grow monotonically
upward and each interface contributes one downward-facing pocket ceiling. That
gives a closed, watertight shell with no interior faces, all-planar except
where the source has arcs.
"""

import json
import math
import os
import struct

import mapbox_earcut
import numpy as np
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

SRC = "viewer/public/toolpaths.json"
OUT_DIR = "viewer/public/models"
INDEX = os.path.join(OUT_DIR, "index.json")
LETTERS = "ABCDEFGHIJKLMNOP"

# Which production variant the one-mesh-per-letter slot stands for. See above.
VARIANT = "0"

# Arcs are the only thing tessellated. A quarter-millimetre of sagitta turns
# the R3.2 corner fillets into two chords each: a fifth of the 1.35 mm the old
# meshes were out by for having no fillets at all, and under a pixel at the
# size these render.
# 0.25 chorded each R3.2 fillet finely enough that the chord dihedral came in
# under EdgesGeometry's 20-degree threshold, so every rounded corner drew as
# three hairlines instead of one. 0.7 puts a fillet at two segments, which is
# all it is worth at the size these render, and halves the triangle count.
ARC_SAGITTA_MM = 0.7

# Clipping a pocket that breaks out through an edge against the outside profile
# leaves slivers where the two curves run together. Anything under this is
# tessellation noise, not a feature -- the smallest real one is a 5 mm groove.
MIN_AREA_MM2 = 0.05


# --- curves ----------------------------------------------------------------

def arc_points(cx, cy, r, a0, a1):
    """A counter-clockwise arc as points, chorded to ARC_SAGITTA_MM."""
    sweep = (a1 - a0) % 360.0 or 360.0
    if r <= ARC_SAGITTA_MM:
        step = 90.0
    else:
        step = 2 * math.degrees(math.acos(1 - ARC_SAGITTA_MM / r))
    n = max(1, int(math.ceil(sweep / step)))
    return [(cx + r * math.cos(math.radians(a0 + sweep * i / n)),
             cy + r * math.sin(math.radians(a0 + sweep * i / n)))
            for i in range(n + 1)]


def op_ring(op, dx, dy):
    """One operation's closed curve as a ring of points, part-centred.

    Segments are stored in file order, which is not necessarily head to tail,
    so each one is attached to whichever end of the chain it meets.
    """
    runs = []
    for s in op["segs"]:
        if s[0] == "L":
            runs.append([(s[1], s[2]), (s[3], s[4])])
        else:
            runs.append(arc_points(*s[1:]))

    ring = runs.pop(0)
    while runs:
        i, flip, gap = min(
            ((i, flip, math.dist(ring[-1], run[-1 if flip else 0]))
             for i, run in enumerate(runs) for flip in (False, True)),
            key=lambda t: t[2],
        )
        run = runs.pop(i)
        if gap > 1e-3:
            raise SystemExit(f"{op['layer']}: curve breaks by {gap:.4f} mm")
        ring.extend((run[::-1] if flip else run)[1:])
    if math.dist(ring[0], ring[-1]) > 1e-3:
        raise SystemExit(f"{op['layer']}: curve does not close")
    return [(x - dx, y - dy) for x, y in ring[:-1]]


def clean(geom):
    """A list of valid polygons, with the tessellation slivers dropped."""
    if geom.is_empty:
        return []
    geom = geom.buffer(0)
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    out = []
    for p in polys:
        if p.is_empty or p.area < MIN_AREA_MM2:
            continue
        holes = [r for r in p.interiors if Polygon(r).area >= MIN_AREA_MM2]
        out.append(orient(Polygon(p.exterior, holes), 1.0))
    return out


# --- solid -----------------------------------------------------------------

def bands(part):
    """(z0, z1, region) for each horizontal band of the solid, bottom up."""
    width, depth, thickness = part["size_mm"]
    dx, dy = width / 2, depth / 2

    profile, curves = None, {}
    for op in part["ops"]:
        ring = Polygon(op_ring(op, dx, dy)).buffer(0)
        if op["op"] == "CUT-OUTSIDE":
            if profile is not None:
                raise SystemExit("more than one outside profile")
            profile = ring
        else:
            curves.setdefault(op["depth_mm"], []).append(ring)

    # Curves at one depth are one pocket, read even-odd. N's 20 mm pocket is
    # two nested rectangles, one 124 x 164 and one 100 x 140, and it is the
    # 12 mm frame between them -- unioning them instead mills the whole storey
    # down to a 10 mm sheet. Nesting across *different* depths is a
    # counterbore, not a ring, so those stay separate and the deeper one wins.
    pockets = []
    for depth, rings in curves.items():
        region = rings[0]
        for ring in rings[1:]:
            region = region.symmetric_difference(ring)
        pockets.append((depth, region.intersection(profile)))

    levels = sorted({d for d, _ in pockets if 0 < d < thickness}) + [thickness]
    out, z0 = [], 0.0
    for z1 in levels:
        cut = unary_union([p for d, p in pockets if d >= z1 - 1e-9])
        region = clean(profile.difference(cut)) if not cut.is_empty else clean(profile)
        out.append((z0, z1, region))
        z0 = z1
    return out


def snap(poly, grid=1e-4):
    """Quantise coordinates so faces that meet actually share vertices."""
    def q(ring):
        return [(round(x / grid) * grid, round(y / grid) * grid) for x, y in ring.coords]
    return Polygon(q(poly.exterior), [q(h) for h in poly.interiors])


def split_t_junctions(polys, points, tol=1e-6):
    """Cut every ring at any vertex of the model that lands mid-edge.

    A pocket ceiling meets the wall of the band below it along a line that the
    band above may cross at a corner the band below does not have. The shell is
    then watertight in shape but not in topology -- an edge on one side, two on
    the other -- and a renderer that welds by index leaves a hairline crack down
    the part. Splitting first makes the two sides agree vertex for vertex.
    """
    P = np.array(sorted(points)) if points else np.zeros((0, 2))

    def cut(ring):
        out = []
        pts = list(ring.coords)
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            out.append((ax, ay))
            dx, dy = bx - ax, by - ay
            length = math.hypot(dx, dy)
            if length < tol or not len(P):
                continue
            t = ((P[:, 0] - ax) * dx + (P[:, 1] - ay) * dy) / (length * length)
            off = np.abs((P[:, 0] - ax) * dy - (P[:, 1] - ay) * dx) / length
            hit = (t > tol) & (t < 1 - tol) & (off <= tol)
            out.extend(tuple(p) for p in P[hit][np.argsort(t[hit])])
        return out + [pts[-1]]

    return [Polygon(cut(p.exterior), [cut(h) for h in p.interiors]) for p in polys]


def triangulate(poly):
    """Ear-clip one polygon, holes and all. Comes out counter-clockwise."""
    verts = list(poly.exterior.coords)[:-1]
    rings = [len(verts)]
    for hole in poly.interiors:
        verts.extend(list(hole.coords)[:-1])
        rings.append(len(verts))

    def clip(points):
        idx = mapbox_earcut.triangulate_float64(
            np.array(points, dtype=np.float64), np.array(rings, dtype=np.uint32))
        return [[verts[idx[i + j]] for j in range(3)] for i in range(0, len(idx), 3)]

    # Bridging to a hole costs two vertices, and a polygon of n vertices
    # triangulates into n - 2, so a correct run returns exactly this many. A
    # short count means earcut dropped degenerate ears and the shell has a slit.
    want = len(verts) + 2 * len(poly.interiors) - 2
    tris = clip(verts)
    if len(tris) == want:
        return tris

    # Earcut reaches a hole by bridging to it from the ring outside. Where two
    # holes have edges on one straight line -- D's pair of semicircular notches
    # share their chord -- the bridge runs down that line, and it comes back a
    # triangulation with both chords missing and a hole where they were.
    #
    # Bending the plane very slightly takes the two off that line. It is a
    # homeomorphism, so it cannot change which side of anything a point is on,
    # and only the indices are kept: the triangles are built from the vertices
    # as they were, so nothing moves by so much as a float.
    tris = clip([(x, y + 1e-6 * x * x) for x, y in verts])
    if len(tris) != want:
        raise SystemExit(f"triangulation returned {len(tris)} triangles, wanted {want}")
    return tris


def build(part):
    """Positions and flat normals for one part, as flat lists."""
    def tidy(polys):
        return [q for p in polys for q in clean(snap(p))]

    layers = [(z0, z1, tidy(region)) for z0, z1, region in bands(part)]
    steps = []
    for (z0, z1, below), (_, _, above) in zip(layers, layers[1:]):
        gap = unary_union(above).difference(unary_union(below))
        steps.append((z1, tidy(clean(gap))))

    corners = set()
    for polys in [region for _, _, region in layers] + [p for _, p in steps]:
        for poly in polys:
            for ring in [poly.exterior, *poly.interiors]:
                corners.update(ring.coords)
    layers = [(z0, z1, split_t_junctions(region, corners)) for z0, z1, region in layers]
    steps = [(z, split_t_junctions(polys, corners)) for z, polys in steps]

    positions, normals = [], []

    def face(polys, z, up):
        for poly in polys:
            for tri in triangulate(poly):
                for x, y in (tri if up else tri[::-1]):
                    positions.extend((x, y, z))
                    normals.extend((0.0, 0.0, 1.0 if up else -1.0))

    # A wall segment shared by several bands is one quad, not one per band:
    # the outside profile is usually unbroken from the underside to the top,
    # and stacking a strip per band there tripled the triangle count for
    # nothing. Collect every band's boundary edges first and merge the ones
    # that run into each other.
    spans = {}
    for z0, z1, region in layers:
        for poly in region:
            for ring in [poly.exterior, *poly.interiors]:
                pts = list(ring.coords)
                for a, b in zip(pts, pts[1:]):
                    if a != b:
                        spans.setdefault((a, b), []).append((z0, z1))

    walls, breaks = {}, {}
    for (a, b), heights in sorted(spans.items()):
        merged = []
        for z0, z1 in sorted(heights):
            if merged and abs(merged[-1][1] - z0) < 1e-9:
                merged[-1][1] = z1
            else:
                merged.append([z0, z1])
        walls[(a, b)] = merged
        for z0, z1 in merged:
            breaks.setdefault(a, set()).update((z0, z1))
            breaks.setdefault(b, set()).update((z0, z1))

    # A merged wall still has to break where its neighbours break, or the seam
    # between them is one edge on one side and two on the other -- watertight
    # to look at, but a T-junction, and those crack open a pixel at a time as
    # the model turns. A break travels along a wall to the far end and on into
    # whatever is next, so this runs to a fixed point.
    moving = True
    while moving:
        moving = False
        for (a, b), merged in walls.items():
            spread = {z for z in breaks[a] | breaks[b]
                      if any(z0 < z < z1 for z0, z1 in merged)}
            for point in (a, b):
                if not spread <= breaks[point]:
                    breaks[point] |= spread
                    moving = True

    for (a, b), merged in walls.items():
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        # Exterior rings run counter-clockwise and holes clockwise, so timber
        # is on the left of both and out is to the right.
        n = ((b[1] - a[1]) / length, -(b[0] - a[0]) / length, 0.0)
        for z0, z1 in merged:
            at = sorted({z0, z1} | {z for z in breaks[a] | breaks[b] if z0 < z < z1})
            for c0, c1 in zip(at, at[1:]):
                quad = [(*a, c0), (*b, c0), (*b, c1), (*a, c1)]
                for i, j, k in ((0, 1, 2), (0, 2, 3)):
                    for p in (quad[i], quad[j], quad[k]):
                        positions.extend(p)
                        normals.extend(n)

    # Underside, then one pocket ceiling per interface, then the top. The bands
    # grow upward, so an interface is exactly the region the band above has and
    # the band below does not, and it faces down.
    face(layers[0][2], 0.0, up=False)
    for z, polys in steps:
        face(polys, z, up=False)
    face(layers[-1][2], layers[-1][1], up=True)
    return positions, normals


# --- glTF ------------------------------------------------------------------

def write_glb(path, positions, normals):
    """A minimal single-primitive GLB, indexed.

    Deliberately not an import from tools/mesh_storeys.py, which writes the
    same format: that module pulls in rhino3dm at import time, and the point
    here is a mesh step that runs without Rhino.

    Indexed because these solids are mostly large flat faces, and every
    triangle in one face carries the same normal as well as shared corners, so
    welding on (position, normal) drops about half the file without touching a
    single facet -- and welding on the pair, rather than position alone, keeps
    the faceting: two faces meeting at an edge still get a vertex each.
    """
    verts = np.array(positions, dtype=np.float32).reshape(-1, 3)
    norms = np.array(normals, dtype=np.float32).reshape(-1, 3)
    seen, indices, unique = {}, [], []
    for vertex, normal in zip(verts, norms):
        key = (tuple(vertex.tolist()), tuple(normal.tolist()))
        if key not in seen:
            seen[key] = len(unique)
            unique.append(key)
        indices.append(seen[key])

    pos = np.array([k[0] for k in unique], dtype=np.float32)
    nor = np.array([k[1] for k in unique], dtype=np.float32)
    dtype, component = ((np.uint16, 5123) if len(unique) < 65536
                        else (np.uint32, 5125))
    idx = np.array(indices, dtype=dtype)

    chunks, views, offset = [], [], 0
    for array, target in ((pos, 34962), (nor, 34962), (idx, 34963)):
        blob = array.tobytes()
        while len(blob) % 4:
            blob += b"\0"
        views.append({"buffer": 0, "byteOffset": offset,
                      "byteLength": array.nbytes, "target": target})
        chunks.append(blob)
        offset += len(blob)
    blob = b"".join(chunks)

    gltf = {
        "asset": {"version": "2.0", "generator": "bee-home tools/mesh_from_toolpaths.py"},
        "scenes": [{"nodes": [0]}],
        "scene": 0,
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [
            {"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2}]}],
        "accessors": [
            {
                "bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3",
                "min": pos.min(axis=0).tolist(), "max": pos.max(axis=0).tolist(),
            },
            {"bufferView": 1, "componentType": 5126, "count": len(nor), "type": "VEC3"},
            {"bufferView": 2, "componentType": component, "count": len(idx),
             "type": "SCALAR"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    while len(json_bytes) % 4:
        json_bytes += b" "
    total = 12 + 8 + len(json_bytes) + 8 + len(blob)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        fh.write(json_bytes)
        fh.write(struct.pack("<II", len(blob), 0x004E4942))
        fh.write(blob)


# --- main ------------------------------------------------------------------

def verify(part, positions):
    """Refuse to write a shell that is not closed, or not the right size.

    A mesh that fails either of these looks fine head-on and wrong the moment
    it is turned, which is exactly the failure this tool exists to remove, so
    it is worth catching here rather than in a screenshot.
    """
    tris = np.array(positions, dtype=float).reshape(-1, 3, 3)
    edges = {}
    for tri in tris:
        keys = [tuple(np.round(p, 4)) for p in tri]
        for u, v in zip(keys, keys[1:] + keys[:1]):
            edges[(u, v)] = edges.get((u, v), 0) + 1
    open_edges = [e for e, n in edges.items() if edges.get((e[1], e[0]), 0) != n]
    if open_edges:
        raise SystemExit(f"{len(open_edges)} unpaired edges: shell is not closed")

    lo, hi = tris.reshape(-1, 3).min(axis=0), tris.reshape(-1, 3).max(axis=0)
    want = [part["size_mm"][0] / 2, part["size_mm"][1] / 2, part["size_mm"][2]]
    got = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
    for i, target in enumerate([want[0] * 2, want[1] * 2, want[2]]):
        if abs(got[i] - target) > 0.01:
            raise SystemExit(f"axis {i}: {got[i]:.3f} mm, expected {target:.3f}")
    if abs(lo[0] + hi[0]) > 0.01 or abs(lo[1] + hi[1]) > 0.01 or abs(lo[2]) > 0.01:
        raise SystemExit(f"not centred on the footprint at z=0: {lo}, {hi}")


def main():
    library = json.load(open(SRC))
    index = json.load(open(INDEX))
    total = 0
    extra = 0

    for letter in LETTERS:
        # Variant 0 keeps the original filename and the `a` slot, so anything
        # that only knows about one mesh per letter still works.
        shapes = {}
        for variant in ("0", "1", "2"):
            key = letter + variant
            if key not in library["parts"]:
                continue
            part = library["parts"][key]
            positions, normals = build(part)
            verify(part, positions)
            shapes[variant] = (part, positions, normals)

        base = shapes["0"]
        write_glb(os.path.join(OUT_DIR, f"{letter}_a.glb"), base[1], base[2])
        entry = index["storeys"][letter]["a"]
        entry["size_mm"] = [float(v) for v in base[0]["size_mm"]]
        entry["triangles"] = len(base[1]) // 9
        entry["source"] = f"toolpaths {letter}0 ({library['variants']['0']})"
        total += entry["triangles"]
        note = ""

        # A storey is cut differently depending on where it lands in the stack:
        # topmost is ROOF, second from top is FIXED under a fixed mounting.
        # Only emit those where the geometry actually differs -- most letters
        # are the same part in more than one position, and a duplicate mesh per
        # letter per variant would put a megabyte into the single-file build
        # for nothing.
        for variant in ("1", "2"):
            if variant not in shapes:
                index["storeys"][letter].pop("a" + variant, None)
                continue
            part, positions, normals = shapes[variant]
            if positions == base[1]:
                index["storeys"][letter].pop("a" + variant, None)
                continue
            name = f"{letter}_a{variant}.glb"
            write_glb(os.path.join(OUT_DIR, name), positions, normals)
            index["storeys"][letter]["a" + variant] = {
                "file": f"models/{name}",
                "size_mm": [float(v) for v in part["size_mm"]],
                "triangles": len(positions) // 9,
                "source": f"toolpaths {letter}{variant} "
                          f"({library['variants'][variant]})",
            }
            total += len(positions) // 9
            extra += 1
            note += f" +{variant}"

        print(f"{letter}_a: {entry['triangles']:4d} tris, "
              f"{'x'.join(f'{v:g}' for v in base[0]['size_mm'])} mm{note}")

    with open(INDEX, "w") as fh:
        json.dump(index, fh, indent=1)
    print(f"\nwrote 16 default meshes plus {extra} positional variants, "
          f"{total} triangles")


if __name__ == "__main__":
    main()
