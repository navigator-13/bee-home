"""Turn the Bee/World prototype into the asset the region section embeds.

The prototype (viewer/bee-globe-standalone.html) is the handoff artefact and
stays exactly as it arrived — it is the visual reference to regress against.
This makes the production copy from it:

  · Textures go from PNG to WebP. Sixteen 800x800 PNGs are 875KB, which is
    1.19MB once base64 has had its way with them, for a bee that draws a few
    hundred pixels tall. Same dimensions, same alpha, a quarter of the bytes.
  · The prototype's own chrome comes off: the specimen title, the art-direction
    sliders, and the hover note. The page around it does its own talking.
  · The backdrop becomes the page's paper, so the frame has no visible edge.

    python3 viewer/tools/build_globe.py
"""
import base64
import io
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "viewer/bee-globe-standalone.html"
OUT = ROOT / "viewer/public/bee-globe.html"
PAPER = "#e9e9e1"

html = SRC.read_text(encoding="utf-8")
before = len(html)

# The rig reads its layers off one map of name -> data URI. Re-encode each.
pattern = re.compile(r'"([\w-]+\.png)":"data:image/png;base64,([A-Za-z0-9+/=]+)"')
saved = 0
count = 0


def to_webp(match):
    global saved, count
    name, payload = match.group(1), match.group(2)
    raw = base64.b64decode(payload)
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    buf = io.BytesIO()
    # Lossy with alpha. These are soft photographic cut-outs; at 82 the edges
    # hold and the flat interiors are where all the saving is.
    img.save(buf, "WEBP", quality=82, method=6)
    packed = base64.b64encode(buf.getvalue()).decode()
    saved += len(payload) - len(packed)
    count += 1
    return f'"{name}":"data:image/webp;base64,{packed}"'


html = pattern.sub(to_webp, html)
if count == 0:
    raise SystemExit("no bee textures found — has the prototype's asset map changed?")

# Prototype chrome goes away with CSS, not with scissors. The handoff is
# explicit that the sliders stay in the source and may be hidden: setLayout()
# reads their values and writes back to the <output> elements, so cutting them
# out threw "Cannot set properties of null" and the bee never drew.
hide = (
    "<style>header,.scale-controls,.hover-note{display:none!important}"
    "body,main.viewer{background:%s}</style>" % PAPER
)
html = html.replace("</head>", hide + "</head>", 1)
if hide not in html:
    raise SystemExit("could not find </head> to hide the prototype chrome")

# Sit on the same paper as the section that frames it.
html = html.replace("#f5f4f0", PAPER).replace("rgba(245,244,240,.82)", "rgba(233,233,225,.82)")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"  {count} textures to webp, {saved // 1024}KB of base64 saved")
print(f"{OUT.relative_to(ROOT)}  {before // 1024}KB -> {len(html) // 1024}KB")
