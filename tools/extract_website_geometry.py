"""Extract the 'WEBSITE - Model' / 'WEBSITE - Guides' layers from
BEEHOME GEOMETRIES.3dm — the same geometry the original beehome.design
viewer was fed as .obj — into a machine-readable inventory.

    pip install rhino3dm && python tools/extract_website_geometry.py
"""
import json
import sys

import rhino3dm

SRC = "BEEHOME GEOMETRIES.3dm"
OUT = "docs/website-geometry.json"


def main():
    model = rhino3dm.File3dm.Read(SRC)
    if model is None:
        sys.exit(f"could not read {SRC}")
    layers = {l.Index: l.FullPath for l in model.Layers}

    items = []
    for obj in model.Objects:
        layer = layers.get(obj.Attributes.LayerIndex)
        if layer not in ("WEBSITE - Model", "WEBSITE - Guides"):
            continue
        geo = obj.Geometry
        box = geo.GetBoundingBox()
        items.append(
            {
                "layer": layer,
                "type": type(geo).__name__,
                "origin": [round(box.Min.X, 2), round(box.Min.Y, 2), round(box.Min.Z, 2)],
                "size_mm": [
                    round(box.Max.X - box.Min.X, 2),
                    round(box.Max.Y - box.Min.Y, 2),
                    round(box.Max.Z - box.Min.Z, 2),
                ],
            }
        )

    # The library is laid out as two vertical stacks of 16 storeys; sort so the
    # stacks stay grouped and each reads top-down the way it does in Rhino.
    items.sort(key=lambda i: (round(i["origin"][0] / 500), -i["origin"][1]))

    with open(OUT, "w") as fh:
        json.dump({"source": SRC, "units": "mm", "objects": items}, fh, indent=2)
    print(f"wrote {OUT} ({len(items)} objects)")


if __name__ == "__main__":
    main()
