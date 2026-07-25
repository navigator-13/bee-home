"""Fetch the CC0 environment, texture and prop assets the stills are built from.

Everything here comes from Poly Haven (https://polyhaven.com), which publishes
under CC0 — no attribution required, though `assets/third_party/SOURCES.md`
records what was taken and from where anyway.

    python3 tools/fetch_assets.py            # fetch anything missing
    python3 tools/fetch_assets.py --list     # show what is on disk

Downloads are cached, so a second run costs nothing. `render_stills.py` calls
`ensure()` itself, so there is no separate step to forget.
"""

import json
import os
import sys
import urllib.request

ROOT = "assets/third_party"
API = "https://api.polyhaven.com"
UA = {"User-Agent": "bee-home-revival/1.0 (render pipeline)"}

# HDRIs light the sets. 4k is plenty — these are never seen sharp behind the
# subject, they are doing the lighting.
HDRIS = {
    "artist_workshop": "4k",        # workshop key: soft midday daylight, low contrast
    "brown_photostudio_02": "4k",   # studio fill: a real softbox room
}

# Poly Haven models arrive as glTF with textures alongside.
MODELS = [
    "hand_plane_no4",
    "wooden_hammer_01",
    "handsaw_wood",
    "vintage_hand_drill",
    "flathead_screwdriver",
    "measuring_tape_01",
    "bench_vice_01",
    "small_oil_can_01",
    "cleaner_tin_01",
    "can_rusted",
    "wicker_basket_01",
    "wooden_stool_01",
    "planter_pot_clay",
    "cardboard_box_01",
    "steel_frame_shelves_01",
    "wooden_bookshelf_worn",
    "desk_lamp_arm_01",
    "ceramic_vase_02",
    "jug_01",
    "wooden_ladder",
]

# PBR sets for the surfaces the camera actually lands on.
TEXTURES = {
    "plywood": "2k",            # the bench top
    "raw_plank_wall": "2k",     # the shop's back wall
    "wood_planks_grey": "2k",   # bench frame and battens, weathered pale
    "concrete_floor_02": "2k",
    "beige_wall_001": "2k",     # plaster: window wall, and the studio wall
}


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r, open(path + ".part", "wb") as fh:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
    os.replace(path + ".part", path)
    print("  fetched", path, os.path.getsize(path) // 1024, "KB")
    return True


def api(path):
    req = urllib.request.Request(API + path, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def hdri(slug, res):
    out = f"{ROOT}/hdri/{slug}_{res}.hdr"
    if os.path.exists(out):
        return out
    files = api(f"/files/{slug}")
    url = files["hdri"][res]["hdr"]["url"]
    get(url, out)
    return out


def texture(slug, res):
    """Grab colour, roughness and normal — the three that actually change a look."""
    base = f"{ROOT}/textures/{slug}"
    want = {"Diffuse": "diff", "Rough": "rough", "nor_gl": "nor"}
    files = api(f"/files/{slug}")
    got = {}
    for key, short in want.items():
        entry = files.get(key, {}).get(res, {})
        # jpg where offered, png otherwise; exr is overkill for these.
        for fmt in ("jpg", "png"):
            if fmt in entry:
                out = f"{base}/{short}.{fmt}"
                get(entry[fmt]["url"], out)
                got[short] = out
                break
    return got


def model(slug):
    """glTF plus every texture it references, kept in the layout the file expects."""
    base = f"{ROOT}/models/{slug}"
    marker = f"{base}/.complete"
    if os.path.exists(marker):
        return base
    files = api(f"/files/{slug}")
    gltf = files.get("gltf", {})
    res = "2k" if "2k" in gltf else sorted(gltf)[0]
    entry = gltf[res]["gltf"]
    get(entry["url"], f"{base}/{os.path.basename(entry['url'])}")
    for rel, info in (entry.get("include") or {}).items():
        get(info["url"], f"{base}/{rel}")
    with open(marker, "w") as fh:
        fh.write("ok\n")
    return base


def sources_md():
    lines = [
        "# Third-party assets",
        "",
        "Everything below is from Poly Haven and published under CC0 1.0 "
        "(public domain dedication). No attribution is required; this file exists "
        "so the provenance of anything in a render is traceable.",
        "",
        "Fetched by `python3 tools/fetch_assets.py`. Not committed — the directory "
        "is ignored, and the script re-fetches on a clean checkout.",
        "",
        "| asset | kind | source | licence |",
        "| --- | --- | --- | --- |",
    ]
    for slug in HDRIS:
        lines.append(f"| `{slug}` | HDRI | https://polyhaven.com/a/{slug} | CC0 |")
    for slug in TEXTURES:
        lines.append(f"| `{slug}` | texture | https://polyhaven.com/a/{slug} | CC0 |")
    for slug in MODELS:
        lines.append(f"| `{slug}` | model | https://polyhaven.com/a/{slug} | CC0 |")
    os.makedirs(ROOT, exist_ok=True)
    with open(f"{ROOT}/SOURCES.md", "w") as fh:
        fh.write("\n".join(lines) + "\n")


def ensure(quiet=True):
    """Idempotent: returns the paths, fetching only what is missing."""
    paths = {"hdri": {}, "texture": {}, "model": {}}
    for slug, res in HDRIS.items():
        paths["hdri"][slug] = hdri(slug, res)
    for slug, res in TEXTURES.items():
        paths["texture"][slug] = texture(slug, res)
    for slug in MODELS:
        paths["model"][slug] = model(slug)
    sources_md()
    return paths


if __name__ == "__main__":
    if "--list" in sys.argv:
        for dirpath, _, names in os.walk(ROOT):
            for n in sorted(names):
                p = os.path.join(dirpath, n)
                print(f"{os.path.getsize(p)//1024:8d} KB  {p}")
        raise SystemExit
    print("fetching CC0 assets from Poly Haven into", ROOT)
    ensure()
    print("done")
