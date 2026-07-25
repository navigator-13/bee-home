"""Extract the 2D CNC cutting curves from BEEHOME GEOMETRIES.3dm as SVG.

The `CUT-*` and `POCKET-*` layers hold the nested toolpaths the Grasshopper
definition produces, in layer colours that already encode their meaning: red
for outside cuts, magenta for pockets, layer names carrying stock thickness and
pocket depth. That vocabulary is the basis of the "Stock & Toolpath" direction,
so this pulls it out verbatim rather than drawing an imitation.

    pip install rhino3dm && python tools/extract_cutlines.py
"""

import rhino3dm

SRC = "BEEHOME GEOMETRIES.3dm"
OUT = "docs/directions/toolpaths.svg"
SAMPLES = 200


def simplify(points, tol=0.6):
    """Drop points lying on the segment between their neighbours."""
    kept = [points[0]]
    for i in range(1, len(points) - 1):
        (ax, ay), (bx, by), (cx, cy) = kept[-1], points[i], points[i + 1]
        cross = abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
        length = max(1e-6, ((cx - ax) ** 2 + (cy - ay) ** 2) ** 0.5)
        if cross / length > tol:
            kept.append(points[i])
    kept.append(points[-1])
    return kept


def main():
    model = rhino3dm.File3dm.Read(SRC)
    layers = {l.Index: l.FullPath for l in model.Layers}

    curves = []
    for obj in model.Objects:
        name = layers.get(obj.Attributes.LayerIndex, "")
        if not (name.startswith("CUT-") or name.startswith("POCKET-")):
            continue
        geo = obj.Geometry
        domain = geo.Domain
        try:
            pts = [
                geo.PointAt(domain.T0 + (domain.T1 - domain.T0) * i / SAMPLES)
                for i in range(SAMPLES + 1)
            ]
        except AttributeError:
            continue
        curves.append((name.startswith("CUT-"), simplify([(p.X, p.Y) for p in pts])))

    xs = [p[0] for _, c in curves for p in c]
    ys = [p[1] for _, c in curves for p in c]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    pad = (max_x - min_x) * 0.012
    width = (max_x - min_x) + 2 * pad
    height = (max_y - min_y) + 2 * pad

    def path(points):
        # Flip Y: Rhino is Y-up, SVG is Y-down.
        return "M" + "L".join(
            f"{x - min_x + pad:.0f} {(max_y - y) + pad:.0f}" for x, y in points
        ) + "Z"

    parts = [
        f'<svg class="toolpaths" xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {width:.0f} {height:.0f}" fill="none" role="img" '
        f'aria-label="Bee Home cutting paths nested on a sheet of stock">'
    ]
    parts += [f'<path class="tp cut" d="{path(c)}"/>' for cut, c in curves if cut]
    parts += [f'<path class="tp pocket" d="{path(c)}"/>' for cut, c in curves if not cut]
    parts.append("</svg>")

    with open(OUT, "w") as fh:
        fh.write("".join(parts))
    print(f"wrote {OUT}: {len(curves)} curves")


if __name__ == "__main__":
    main()
