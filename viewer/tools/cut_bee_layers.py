"""Create provisional full-canvas rig layers from the transparent source bee.

The polygon masks intentionally overlap. They are editable starting points, not a
claim of production-grade hair/occlusion reconstruction.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT.parent / "docs/assets/bees/megachile-ericetorum.png"
OUT = ROOT / "public/assets/bee"
OUT.mkdir(parents=True, exist_ok=True)

# Polygons are in source pixels. Full 800px canvases preserve a shared datum.
P = {
 "antenna-near": [(38,319),(95,278),(165,292),(174,311),(118,302),(45,337)],
 "antenna-far": [(84,271),(151,273),(177,302),(160,315),(132,291),(91,286)],
 "head": [(143,300),(189,257),(272,268),(303,355),(272,432),(177,429),(146,386)],
 "mouthparts": [(145,377),(207,374),(217,435),(183,477),(148,443)],
 "thorax": [(246,249),(439,238),(508,350),(452,452),(277,445),(241,355)],
 "abdomen": [(425,309),(650,321),(715,401),(710,528),(647,560),(511,520),(449,428)],
 "wing-upper": [(353,271),(536,207),(676,184),(729,198),(714,232),(625,273),(430,318)],
 "wing-lower": [(346,307),(560,287),(733,292),(755,320),(724,342),(535,354),(389,335)],
 "leg-front-near-upper": [(194,374),(267,370),(270,402),(245,435),(220,466),(190,462),(187,430),(205,398)],
 "leg-front-near-lower": [(176,410),(246,414),(247,498),(239,554),(214,568),(188,536),(180,474)],
 "leg-mid-near-upper": [(361,391),(423,385),(438,410),(417,446),(403,475),(372,492),(348,464),(356,430)],
 "leg-mid-near-lower": [(344,435),(422,438),(406,512),(382,568),(337,610),(299,601),(327,555)],
 "leg-rear-near-upper": [(482,379),(540,382),(561,410),(557,451),(543,493),(526,520),(499,496),(485,450)],
 "leg-rear-near-lower": [(518,455),(568,458),(575,505),(578,555),(607,605),(596,641),(565,640),(546,590),(529,532),(515,490)],
 "leg-front-far-upper": [(153,365),(215,352),(232,380),(216,418),(199,447),(165,445),(151,418)],
 "leg-front-far-lower": [(145,393),(217,397),(209,492),(190,538),(159,546),(145,515)],
}

src = Image.open(SRC).convert("RGBA")
for name, polygon in P.items():
    mask = Image.new("L", src.size, 0)
    ImageDraw.Draw(mask).polygon(polygon, fill=255)
    # Twelve pixels of concealed overlap keeps fur and thin legs from being
    # sliced at joints as adjacent planes rotate independently.
    mask = mask.filter(ImageFilter.MaxFilter(25))
    # Clear RGB as well as alpha outside the mask. Keeping the source's hidden
    # colour data made each mostly-transparent layer hundreds of kilobytes.
    layer = Image.composite(src, Image.new("RGBA", src.size), mask)
    layer.save(OUT / f"{name}.png", optimize=True)

src.save(OUT / "source.png", optimize=True)

thumb = 220
sheet = Image.new("RGBA", (thumb * 4, thumb * 4), "#f3f2ed")
draw = ImageDraw.Draw(sheet)
for i, name in enumerate(P):
    im = Image.open(OUT / f"{name}.png"); im.thumbnail((thumb, thumb))
    x=(i%4)*thumb; y=(i//4)*thumb
    sheet.alpha_composite(im, (x,y)); draw.text((x+8,y+8), name, fill="#111")
sheet.save(OUT / "contact-sheet.png")

preview = src.copy(); d = ImageDraw.Draw(preview)
for name, polygon in P.items():
    x=sum(p[0] for p in polygon)//len(polygon); y=sum(p[1] for p in polygon)//len(polygon)
    d.ellipse((x-4,y-4,x+4,y+4), fill="#ff3b30", outline="white"); d.text((x+6,y-7), name, fill="white", stroke_width=2, stroke_fill="black")
preview.save(OUT / "annotated-preview.png")
print(f"wrote {len(P)} layers to {OUT}")
