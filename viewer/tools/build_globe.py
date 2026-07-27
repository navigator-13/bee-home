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

# Filling the frame rather than floating in it. Mobile keeps the prototype's
# 80% relationship to desktop.
DESK_GLOBE, DESK_BEE = ".84", "1.06"
MOBILE_GLOBE, MOBILE_BEE = ".80", "0.86"

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
# Transparent, not paper. The renderer is already created with alpha, so
# clearing the CSS backdrop lets the section behind the frame show through —
# which means the globe keeps working if the page's paper ever changes, and
# there is no near-miss between two off-whites to notice.
hide = (
    "<style>header,.scale-controls,.hover-note{display:none!important}"
    "html,body,main.viewer{background:transparent!important}</style>"
)
html = html.replace("</head>", hide + "</head>", 1)
if hide not in html:
    raise SystemExit("could not find </head> to hide the prototype chrome")

# The prototype's own backdrop colour goes with it.
html = html.replace("background:#f5f4f0", "background:transparent")

# Scale. The prototype framed its globe against a whole viewport, where 31% of
# the canvas was right; dropped into a column beside a heading it left the
# frame mostly empty. setLayout() derives everything from these two values —
# including the bee's foot contact, l.position.y = globe + 0.1 * bee — so
# raising them here is the one change that cannot break the rig. Both stay
# inside the ranges the sliders declare: globe .15-1.00, bee .20-1.45.
# The frame is ~242px wide on a phone and ~368px on a desktop, so the
# prototype's 700px breakpoint -- written for a full-window canvas -- matched
# both and gave every desktop the phone's numbers. 300 is what actually
# separates the two frames this page builds.
html = html.replace('matchMedia("(max-width: 700px)")',
                    'matchMedia("(max-width: 300px)")')

old_scale = "u.value=v?.25:.31,f.value=v?.32:.4"
new_scale = f"u.value=v?{MOBILE_GLOBE}:{DESK_GLOBE},f.value=v?{MOBILE_BEE}:{DESK_BEE}"
if old_scale not in html:
    raise SystemExit("scale initialiser not found — has the prototype changed?")
html = html.replace(old_scale, new_scale)

# The globe is a bee on a world, next to a question about which bees live near
# you — so pressing it should do what pressing any other bee on this page does.
# It cannot reach the page itself from inside a frame, so it says so upstairs.
click = (
    "<script>addEventListener('click',function(){"
    "try{parent.postMessage({type:'beehome:globe-click'},'*')}catch(e){}"
    "});document.documentElement.style.cursor='pointer';</script>"
)
html = html.replace("</body>", click + "</body>", 1)

# A brisker walk on a small screen. The gait is one number -- seconds per
# cycle -- so dividing it is exactly a speed-up, and nothing else about the rig
# moves. 1.25 / 1.2 / 1.15 is 20% then a further 15%. Read from matchMedia
# directly rather than reusing the layout flag, so this survives the prototype
# reordering its own boot.
old_gait = "cycleDuration:1.25"
new_gait = 'cycleDuration:matchMedia("(max-width: 300px)").matches?0.9058:1.25'
if old_gait not in html:
    raise SystemExit("gait constant not found -- has the prototype changed?")
html = html.replace(old_gait, new_gait, 1)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"  {count} textures to webp, {saved // 1024}KB of base64 saved")
print(f"{OUT.relative_to(ROOT)}  {before // 1024}KB -> {len(html) // 1024}KB")
