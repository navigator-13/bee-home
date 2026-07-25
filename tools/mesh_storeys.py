"""Mesh the 'WEBSITE - Model' layer of BEEHOME GEOMETRIES.3dm to glTF.

These solids are the source the original beehome.design viewer was fed as .obj
(the OBJ exports themselves were never archived). Meshing them normally means
Rhino, but the solids are polyhedral — every face is planar and every edge is a
straight line — so they can be triangulated exactly without it:

  1. Group faces by their supporting plane.
  2. Collect the edges lying in each plane and walk them into closed loops.
  3. Project each loop to 2D, classify outer boundaries vs. holes by nesting,
     and ear-clip with mapbox_earcut.
  4. Lift the triangles back to 3D and orient them by the face normal.

    pip install rhino3dm mapbox_earcut numpy && python tools/mesh_storeys.py
"""

import json
import math
import os
import struct
from collections import defaultdict

import mapbox_earcut
import numpy as np
import rhino3dm

SRC = "BEEHOME GEOMETRIES.3dm"
OUT_DIR = "viewer/public/models"
# Units are mm and the smallest real feature is ~5 mm, so 0.01 mm is a safe
# tolerance — and it must stay looser than the rounding in plane_key(), or
# edges get rejected from the very plane they define.
TOL = 1e-2


# --- geometry helpers -------------------------------------------------------

def plane_key(normal, origin):
    """Quantised (normal, offset) so coincident faces land in one group."""
    n = normal / np.linalg.norm(normal)
    if (n[0], n[1], n[2]) < (-n[0], -n[1], -n[2]):  # canonical direction
        n = -n
    return (*np.round(n, 4), round(float(np.dot(n, origin)), 3))


def basis_for(normal):
    """An orthonormal 2D basis for a plane with the given normal."""
    n = normal / np.linalg.norm(normal)
    seed = np.array([1.0, 0.0, 0.0]) if abs(n[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(n, seed)
    u /= np.linalg.norm(u)
    return u, np.cross(n, u)


def walk_loops(segments):
    """Walk undirected segments into closed loops of point indices."""
    adjacency = defaultdict(list)
    for a, b in segments:
        adjacency[a].append(b)
        adjacency[b].append(a)

    unused = {frozenset(s) for s in segments if s[0] != s[1]}
    loops = []
    while unused:
        edge = next(iter(unused))
        start, current = tuple(edge)
        unused.discard(edge)
        loop = [start, current]
        while True:
            nxt = None
            for candidate in adjacency[current]:
                if frozenset((current, candidate)) in unused:
                    nxt = candidate
                    break
            if nxt is None:
                break
            unused.discard(frozenset((current, nxt)))
            if nxt == start:
                break
            loop.append(nxt)
            current = nxt
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def signed_area(points):
    total = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def contains(outer, point):
    """Even-odd point-in-polygon."""
    inside = False
    x, y = point
    for i in range(len(outer)):
        x1, y1 = outer[i]
        x2, y2 = outer[(i - 1) % len(outer)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-30) + x1:
            inside = not inside
    return inside


def triangulate_plane(loops2d):
    """Ear-clip a set of coplanar loops, nesting holes inside their outer ring."""
    ordered = sorted(loops2d, key=lambda lp: abs(signed_area(lp)), reverse=True)
    groups = []  # (outer, [holes])
    for loop in ordered:
        placed = False
        for outer, holes in groups:
            if contains(outer, loop[0]):
                holes.append(loop)
                placed = True
                break
        if not placed:
            groups.append((loop, []))

    triangles = []
    for outer, holes in groups:
        verts, rings = list(outer), [len(outer)]
        for hole in holes:
            verts.extend(hole)
            rings.append(len(verts))
        indices = mapbox_earcut.triangulate_float64(
            np.array(verts, dtype=np.float64), np.array(rings, dtype=np.uint32)
        )
        for i in range(0, len(indices), 3):
            triangles.append([verts[indices[i + j]] for j in range(3)])
    return triangles


def mesh_brep(brep):
    """Triangulate a polyhedral Brep. Returns (positions, normals) as flat lists."""
    # Bucket faces and edges by supporting plane.
    face_normals = {}
    for face in brep.Faces:
        domain_u, domain_v = face.Domain(0), face.Domain(1)
        mid_u = (domain_u.T0 + domain_u.T1) / 2
        mid_v = (domain_v.T0 + domain_v.T1) / 2
        point = face.PointAt(mid_u, mid_v)
        normal = face.NormalAt(mid_u, mid_v)
        n = np.array([normal.X, normal.Y, normal.Z])
        if face.OrientationIsReversed:
            n = -n
        origin = np.array([point.X, point.Y, point.Z])
        face_normals.setdefault(plane_key(n, origin), []).append((n, origin))

    edges = []
    for edge in brep.Edges:
        a, b = edge.PointAtStart, edge.PointAtEnd
        edges.append((np.array([a.X, a.Y, a.Z]), np.array([b.X, b.Y, b.Z])))

    positions, normals = [], []
    for key, faces in face_normals.items():
        n_canon = np.array(key[:3])
        offset = key[3]
        outward = faces[0][0]  # representative outward normal for this plane
        u, v = basis_for(n_canon)
        origin = faces[0][1]

        # Deduplicate points so loop-walking sees shared vertices as identical.
        index_of, points2d, segments = {}, [], []
        def register(p):
            key2 = (round(p[0], 4), round(p[1], 4), round(p[2], 4))
            if key2 not in index_of:
                index_of[key2] = len(points2d)
                rel = p - origin
                points2d.append((float(np.dot(rel, u)), float(np.dot(rel, v))))
            return index_of[key2]

        for a, b in edges:
            if abs(np.dot(n_canon, a) - offset) > TOL:
                continue
            if abs(np.dot(n_canon, b) - offset) > TOL:
                continue
            ia, ib = register(a), register(b)
            if ia != ib:
                segments.append((ia, ib))
        if not segments:
            continue

        loops = [[points2d[i] for i in loop] for loop in walk_loops(segments)]
        loops = [lp for lp in loops if abs(signed_area(lp)) > 1e-6]
        if not loops:
            continue

        flip = np.dot(outward, n_canon) < 0
        for tri in triangulate_plane(loops):
            pts3 = [origin + u * x + v * y for x, y in tri]
            # Wind counter-clockwise about the outward normal.
            edge1, edge2 = pts3[1] - pts3[0], pts3[2] - pts3[0]
            if np.dot(np.cross(edge1, edge2), outward) < 0:
                pts3 = [pts3[0], pts3[2], pts3[1]]
            for p in pts3:
                positions.extend([float(p[0]), float(p[1]), float(p[2])])
                normals.extend([float(outward[0]), float(outward[1]), float(outward[2])])
    return positions, normals


# --- glTF writing -----------------------------------------------------------

def write_glb(path, positions, normals):
    pos = np.array(positions, dtype=np.float32)
    nor = np.array(normals, dtype=np.float32)
    blob = pos.tobytes() + nor.tobytes()
    while len(blob) % 4:
        blob += b"\0"

    count = len(positions) // 3
    pts = pos.reshape(-1, 3)
    gltf = {
        "asset": {"version": "2.0", "generator": "bee-home tools/mesh_storeys.py"},
        "scenes": [{"nodes": [0]}],
        "scene": 0,
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}}]}],
        "accessors": [
            {
                "bufferView": 0, "componentType": 5126, "count": count, "type": "VEC3",
                "min": pts.min(axis=0).tolist(), "max": pts.max(axis=0).tolist(),
            },
            {"bufferView": 1, "componentType": 5126, "count": count, "type": "VEC3"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": pos.nbytes, "target": 34962},
            {"buffer": 0, "byteOffset": pos.nbytes, "byteLength": nor.nbytes, "target": 34962},
        ],
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


# --- main -------------------------------------------------------------------

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    model = rhino3dm.File3dm.Read(SRC)
    layers = {l.Index: l.FullPath for l in model.Layers}

    solids = []
    for obj in model.Objects:
        if layers.get(obj.Attributes.LayerIndex) != "WEBSITE - Model":
            continue
        geo = obj.Geometry
        if isinstance(geo, rhino3dm.Extrusion):
            geo = geo.ToBrep(False)
        box = geo.GetBoundingBox()
        solids.append((box, geo))

    # Two stacks of 16 storeys (sorted top-down) plus the mounting guides.
    stacks = defaultdict(list)
    for box, geo in solids:
        stacks[round(box.Min.X / 500)].append((box, geo))
    stack_keys = sorted(k for k in stacks if len(stacks[k]) == 16)

    index = {"units": "mm", "storeys": {}, "guides": []}
    letters = "ABCDEFGHIJKLMNOP"

    for variant, key in zip(("a", "b"), stack_keys):
        column = sorted(stacks[key], key=lambda item: item[0].Min.Y)
        for letter, (box, geo) in zip(letters, column):
            positions, normals = mesh_brep(geo)
            # Re-origin each storey to its own footprint centre at z=0.
            pts = np.array(positions).reshape(-1, 3)
            shift = np.array([
                (box.Min.X + box.Max.X) / 2, (box.Min.Y + box.Max.Y) / 2, box.Min.Z
            ])
            pts -= shift
            name = f"{letter}_{variant}"
            write_glb(f"{OUT_DIR}/{name}.glb", pts.flatten().tolist(), normals)
            index["storeys"].setdefault(letter, {})[variant] = {
                "file": f"models/{name}.glb",
                "size_mm": [
                    round(box.Max.X - box.Min.X, 2),
                    round(box.Max.Y - box.Min.Y, 2),
                    round(box.Max.Z - box.Min.Z, 2),
                ],
                "triangles": len(positions) // 9,
            }
            print(f"{name}: {len(positions)//9} tris, h={box.Max.Z - box.Min.Z:.1f}mm")

    # The guides are the three mounting options, identifiable by size: a tall
    # spike, four short legs, and the base plates. `WEBSITE - Guides` labels
    # them Base / Spike / Legs in the source file.
    guides = [s for k, v in stacks.items() if len(v) != 16 for s in v]
    seen = set()
    for box, geo in guides:
        w = round(box.Max.X - box.Min.X, 1)
        d = round(box.Max.Y - box.Min.Y, 1)
        h = round(box.Max.Z - box.Min.Z, 1)
        if h >= 150:
            name = "spike"
        elif w <= 20:
            name = "leg"
        else:
            name = "base"
        if name in seen:  # legs and plates are repeated in the source file
            continue
        seen.add(name)
        positions, normals = mesh_brep(geo)
        pts = np.array(positions).reshape(-1, 3)
        pts -= np.array([
            (box.Min.X + box.Max.X) / 2, (box.Min.Y + box.Max.Y) / 2, box.Min.Z
        ])
        write_glb(f"{OUT_DIR}/{name}.glb", pts.flatten().tolist(), normals)
        index["guides"].append({
            "name": name, "file": f"models/{name}.glb", "size_mm": [w, d, h],
        })
        print(f"guide {name}: {w} x {d} x {h} mm")

    with open(f"{OUT_DIR}/index.json", "w") as fh:
        json.dump(index, fh, indent=2)
    print(f"\nwrote {len(index['storeys'])*2} storey meshes + {len(index['guides'])} guides")


if __name__ == "__main__":
    main()
