"""Pull the original site's copy out of the recovered bundle.

The launch site's own words are in `docs/reference/js/component---src-pages-index-tsx-*.js`.
Any rewrite should adapt from this rather than invent a new voice — it is the
one part of the project that cannot be reconstructed by reasoning about it.

    python tools/extract_copy.py
"""

import glob
import re

BUNDLE = "docs/reference/js/component---src-pages-index-tsx-397b098707f266e1a972.js"
OUT = "docs/reference/extracted/original-copy.md"

# Library warnings that share the bundle with the real copy.
NOISE = (
    "THREE.", "Cesium", "Firebase", "Vertex texture", "Entity geometry",
    "The batch table", "Required property", "Sentinel-2", "The Earth at night",
    "All GeometryInstances", "The useServiceWorker", "The usePublicVapidKey",
    "WebGL", "Texture is not", "This browser", "Unable to",
)

# The bundle is UTF-8 read as latin-1 somewhere upstream, so punctuation arrives
# mojibaked. These are the sequences that actually occur.
MOJIBAKE = {
    "â€”": "—",   # em dash
    "â€™": "’",   # right single quote
    "â€œ": "“",   # left double quote
    "â€": "”",   # right double quote
    "â€–": "–",   # en dash
    "Â ": " ",
}


def clean(text):
    for bad, good in MOJIBAKE.items():
        text = text.replace(bad, good)
    return re.sub(r"\s+", " ", text).strip()


def main():
    path = BUNDLE if glob.glob(BUNDLE) else sorted(
        glob.glob("docs/reference/js/component---src-pages-index-tsx-*.js"), key=len
    )[-1]
    source = open(path, encoding="utf8", errors="replace").read()

    found = set()
    for match in re.finditer(r'"((?:[^"\\]|\\.){20,400})"', source):
        text = match.group(1)
        try:
            text = text.encode().decode("unicode_escape")
        except Exception:
            pass
        if not re.search(r"[a-z]", text):
            continue
        if re.search(r"[{}<>\\/@#$^*|~`\[\]]|function|return|=>|0x|webpack|http", text):
            continue
        if text.count(" ") < 4 or not re.match(r"^[A-Z]", text):
            continue
        if not re.search(r"[.!?]$", text):
            continue
        cleaned = clean(text)
        if cleaned.startswith(NOISE) or len(cleaned) < 30:
            continue
        found.add(cleaned)

    lines = [
        "# Original Bee Home copy",
        "",
        f"Extracted verbatim from `{path.split('/')[-1]}`.",
        "",
        "This is the site's own voice — plain, warm, second person, specific about",
        "numbers. Adapt from it. Do not write a new one.",
        "",
    ]
    lines += [f"- {t}" for t in sorted(found, key=len, reverse=True)]
    open(OUT, "w").write("\n".join(lines) + "\n")
    print(f"wrote {OUT}: {len(found)} lines")


if __name__ == "__main__":
    main()
