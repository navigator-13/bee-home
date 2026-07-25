"""Cut the Cycles stills down to web assets.

Framing is decided in Blender now — every shot is composed in-camera — so this
does not crop. It only resizes and encodes: 1600 px for the heroes and details,
900 px for the assembly frames, which are only ever shown as a small strip.

    python3 tools/web_renders.py
"""
import os
import pathlib

from PIL import Image

SRC = pathlib.Path('docs/renders')
OUT = SRC / 'web'
ASSEMBLY_WIDTH = 900
DEFAULT_WIDTH = 1600


def main():
    OUT.mkdir(exist_ok=True)
    stills = sorted(SRC.glob('*.png'))
    if not stills:
        raise SystemExit('no renders in docs/renders — run tools/render_stills.py first')

    # Anything left in web/ from a previous set would outlive the PNG it came
    # from and quietly keep publishing a render that no longer exists.
    for stale in OUT.glob('*.jpg'):
        if not (SRC / (stale.stem + '.png')).exists():
            stale.unlink()
            print('removed stale', stale.name)

    for path in stills:
        image = Image.open(path).convert('RGB')
        width = ASSEMBLY_WIDTH if path.stem.startswith('assembly') else DEFAULT_WIDTH
        if image.width > width:
            image = image.resize((width, round(image.height * width / image.width)),
                                 Image.LANCZOS)
        out = OUT / (path.stem + '.jpg')
        image.save(out, quality=80, optimize=True, progressive=True)
        print(out.name, image.size, os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    main()
