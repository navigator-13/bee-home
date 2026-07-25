"""Cut the Cycles stills down to web assets.

The renders are shot loose so the framing can be decided here rather than in
Blender: the assembly steps are cropped tight and, crucially, to one shared
box, because they share a camera and the object must not jump between steps.
The hero keeps its full frame -- the sweep and the foliage shadow are the
point of that one.

    python3 tools/web_renders.py
"""
import os
import pathlib

import numpy as np
from PIL import Image

SRC = pathlib.Path('docs/renders')
OUT = SRC / 'web'
WIDTH = {'hero': 1600, 'detail': 1400}


def wood_box(path):
    """Wood is far warmer than the sweep it stands on: R-B separates them."""
    pixels = np.asarray(Image.open(path).convert('RGB')).astype(int)
    ys, xs = np.where((pixels[:, :, 0] - pixels[:, :, 2]) > 45)
    return xs.min(), ys.min(), xs.max(), ys.max()


def main():
    OUT.mkdir(exist_ok=True)
    steps = sorted(SRC.glob('assembly-*.png'))
    boxes = [wood_box(p) for p in steps]
    shared = (min(b[0] for b in boxes), min(b[1] for b in boxes),
              max(b[2] for b in boxes), max(b[3] for b in boxes))

    for path in sorted(SRC.glob('*.png')):
        image = Image.open(path).convert('RGB')
        if path.stem.startswith('assembly'):
            box, margin = shared, 0.14
        elif path.stem == 'hero':
            box, margin = None, 0
        else:
            box, margin = wood_box(path), 0.05
        if box:
            pad = int(max(box[2] - box[0], box[3] - box[1]) * margin)
            image = image.crop((max(0, box[0] - pad), max(0, box[1] - pad),
                                min(image.width, box[2] + pad),
                                min(image.height, box[3] + pad)))
        width = WIDTH.get(path.stem, 1000)
        if image.width > width:
            image = image.resize((width, round(image.height * width / image.width)),
                                 Image.LANCZOS)
        out = OUT / (path.stem + '.jpg')
        image.save(out, quality=80, optimize=True, progressive=True)
        print(out.name, image.size, os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    main()
