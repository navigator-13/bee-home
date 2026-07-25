"""Re-fetch the archived beehome.design front-end from the Wayback Machine
into docs/reference/.

The original site went offline with SPACE10; these captures are the only
surviving copy of the configurator's code, fonts, textures and imagery. Files
are fetched with Wayback's `id_` modifier so they come back byte-identical to
what the site served, rather than rewritten for archive playback.

Needs `web.archive.org` reachable — in a cloud session that means the
environment's network access must include it.

    python tools/fetch_archive.py
"""

import os
import subprocess
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

CDX = (
    "https://web.archive.org/cdx/search/cdx"
    "?url=beehome.design&matchType=domain&output=text"
    "&fl=timestamp,original,mimetype,statuscode&limit=5000"
)
ROOT = "docs/reference"


def manifest():
    """Earliest successful capture of each distinct URL."""
    out = subprocess.run(["curl", "-sS", CDX], capture_output=True, text=True).stdout
    best = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        ts, url, mime, status = parts[:4]
        if status != "200":
            continue
        if url not in best or ts < best[url][0]:
            best[url] = (ts, mime)
    return [(ts, url, mime) for url, (ts, mime) in sorted(best.items())]


def destination(url, mime):
    path = urllib.parse.urlparse(url).path
    name = urllib.parse.unquote(os.path.basename(path) or "index.html").split("?")[0]
    if "/fonts/" in path:
        return f"{ROOT}/fonts/{name}"
    if "/textures/" in path:
        return f"{ROOT}/textures/{name}"
    if "/images/" in path or "/icons/" in path:
        return f"{ROOT}/images/{name}"
    if name.endswith(".js"):
        return f"{ROOT}/js/{name}"
    if "page-data" in path:
        return f"{ROOT}/pages/" + path.strip("/").replace("/", "_")
    if mime == "text/html":
        # Skip tracking-parameter duplicates of pages already captured.
        if urllib.parse.urlparse(url).query:
            return None
        return f"{ROOT}/pages/" + (path.strip("/").replace("/", "_") or "index") + ".html"
    return f"{ROOT}/assets/{name}"


def fetch(entry):
    ts, url, mime = entry
    dest = destination(url, mime)
    if dest is None or os.path.exists(dest):
        return "skip"
    snapshot = f"https://web.archive.org/web/{ts}id_/{url}"
    result = subprocess.run(
        ["curl", "-sSL", "--max-time", "45", "-o", dest, snapshot], capture_output=True
    )
    if result.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 0:
        return "ok"
    if os.path.exists(dest):
        os.remove(dest)
    return "fail"


def main():
    for sub in ("pages", "assets", "js", "fonts", "textures", "images"):
        os.makedirs(f"{ROOT}/{sub}", exist_ok=True)
    entries = manifest()
    print(f"{len(entries)} archived URLs")
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(fetch, entries))
    for state in ("ok", "skip", "fail"):
        print(f"  {state}: {results.count(state)}")


if __name__ == "__main__":
    main()
