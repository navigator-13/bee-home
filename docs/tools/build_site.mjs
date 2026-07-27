/**
 * Build the landing page and the builder into a static site a host can serve.
 *
 * This is the sibling of build_landing.mjs, which folds everything into one
 * file for places that cannot resolve sibling requests. That file is right for
 * an artifact and wrong for a website: every visitor downloads all 46 pressed
 * plates, all 15 bee portraits and the whole WebGL builder before the first
 * paint, none of it cacheable, none of it skippable. Here the same source
 * becomes an ordinary document with ordinary files next to it, so a browser
 * fetches the four plates a region actually uses and caches them.
 *
 * The authored page has no <head> -- the artifact host supplies one. A real
 * host does not, so the document is assembled here. The viewport meta is the
 * load-bearing part: without it a phone lays the page out at desktop width and
 * every media query in the stylesheet sits idle.
 *
 *   node docs/tools/build_site.mjs [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(repo, 'docs/directions/landing-opus.html');
const viewerDist = path.join(repo, 'viewer/dist-site');
const out = path.resolve(process.argv[2] || path.join(repo, 'site'));

/* Absolute URLs for the social card, when the host is known. Open Graph
   consumers do not all resolve relative image paths, so a bare path silently
   yields a link with no picture on some of them. */
const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');

const COPY = [
  ['docs/plates', 'plates'],
  ['docs/assets/final-scenes/web', 'assets/final-scenes/web'],
  ['docs/assets/banner/web', 'assets/banner/web'],
  ['docs/assets/pressed/web', 'assets/pressed/web'],
  ['docs/assets/bees/web', 'assets/bees/web'],
];

const DESCRIPTION =
  'Design a Bee Home, download the cut files and have it made locally. '
  + "A revival of SPACE10's open-source parametric bee hotel, CC BY 4.0.";

if (!fs.existsSync(path.join(viewerDist, 'index.html'))) {
  throw new Error(
    'build the viewer for the site first:\n'
    + '  cd viewer && npx vite build --base=./ --outDir=dist-site',
  );
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let html = fs.readFileSync(src, 'utf8');

/* The page is authored in docs/directions and reaches up a level for its
   assets. In the built site it sits at the root with them alongside, so the
   climb comes off both the markup and the script's own default. */
let rewritten = 0;
html = html.replace(/src="\.\.\/((?:plates|assets)\/[^"]+)"/g, (whole, rel) => {
  const abs = path.join(repo, 'docs', rel);
  if (!fs.existsSync(abs)) throw new Error(`missing asset: ${rel}`);
  rewritten++;
  return `src="${rel}"`;
});

/* Named to the file, not the directory. A host that normalises trailing
   slashes would redirect /builder/ to /builder, and the viewer's own asset
   URLs are relative -- resolved against /builder they climb one level too far
   and 404. Pointing at the document itself takes the host's opinion about
   directory indexes out of it entirely. */
html = html.replace(
  /<iframe([^>]*)\ssrc="\.\.\/\.\.\/viewer\/"([^>]*)><\/iframe>/,
  (whole, before, attrs) => `<iframe${before} src="builder/index.html"${attrs}></iframe>`,
);

/* The bee globe travels as its own document, same as the builder. It is one
   file with everything in it, so it only has to land beside the page. */
const globeSrc = path.join(repo, 'viewer/public/bee-globe.html');
if (!fs.existsSync(globeSrc)) {
  throw new Error('build the globe first: python3 viewer/tools/build_globe.py');
}
fs.copyFileSync(globeSrc, path.join(out, 'bee-globe.html'));
html = html.replace('src="../../viewer/public/bee-globe.html"', 'src="bee-globe.html"');
if (html.includes('viewer/public/bee-globe.html')) {
  throw new Error('globe iframe was not rewritten');
}
if (html.includes('src="../../viewer/"')) throw new Error('builder iframe was not rewritten');

/* Lift the title out of the body. Browsers hoist a stray <title> into the head
   anyway, but only after parsing it as body content, and a duplicate in both
   places is worse than either. */
const titleMatch = /<title>([^<]*)<\/title>\s*/.exec(html);
const title = titleMatch ? titleMatch[1] : 'Bee Home';
if (titleMatch) html = html.replace(titleMatch[0], '');

const ogImage = siteUrl
  ? `${siteUrl}/assets/banner/web/banner.jpg`
  : 'assets/banner/web/banner.jpg';

/* Drawn rather than fetched: a favicon is one request that blocks nothing and
   matters at 16px, where a photograph is mud. Three stacked storeys on legs. */
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" fill="#e9e9e1"/>
<g fill="none" stroke="#2a2920" stroke-width="2">
<rect x="8" y="5" width="16" height="6"/>
<rect x="8" y="12" width="16" height="6"/>
<rect x="6" y="19" width="20" height="3"/>
<path d="M10 22v5M22 22v5"/>
</g></svg>`;
fs.writeFileSync(path.join(out, 'favicon.svg'), favicon);

const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${DESCRIPTION}" />
<meta name="theme-color" content="#e9e9e1" />
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${DESCRIPTION}" />
<meta property="og:image" content="${ogImage}" />
${siteUrl ? `<meta property="og:url" content="${siteUrl}/" />\n` : ''}<meta name="twitter:card" content="summary_large_image" />
<script>window.__ASSETS__ = '';</script>
</head>
<body>
`;

fs.writeFileSync(path.join(out, 'index.html'), head + html + '\n</body>\n</html>\n');

/** Copy a directory tree, counting what lands and how big it is. */
function copyTree(from, to) {
  let files = 0;
  let bytes = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) {
      const sub = copyTree(a, b);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      fs.copyFileSync(a, b);
      files++;
      bytes += fs.statSync(a).size;
    }
  }
  return { files, bytes };
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

let total = 0;
for (const [from, to] of COPY) {
  const abs = path.join(repo, from);
  if (!fs.existsSync(abs)) throw new Error(`missing asset directory: ${from}`);
  const { files, bytes } = copyTree(abs, path.join(out, to));
  total += bytes;
  console.log(`  ${to.padEnd(26)} ${String(files).padStart(3)} files  ${mb(bytes)}`);
}

/* The builder goes in whole, as its own little app. The single-file bundle
   that build_landing.mjs embeds is not wanted here -- it would be a second
   copy of everything, sitting unreferenced. */
const builder = copyTree(viewerDist, path.join(out, 'builder'));
total += builder.bytes;
console.log(`  ${'builder'.padEnd(26)} ${String(builder.files).padStart(3)} files  ${mb(builder.bytes)}`);

const indexBytes = fs.statSync(path.join(out, 'index.html')).size;
console.log(`\nrewrote ${rewritten} asset paths`);
console.log(`${out}`);
console.log(`  index.html ${(indexBytes / 1024).toFixed(0)} KB, ${mb(total)} of assets beside it`);
