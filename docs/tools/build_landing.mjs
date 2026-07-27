/**
 * Fold the landing page into one file that can be opened or published
 * anywhere -- no sibling requests, no CDN, no local server.
 *
 * The page as authored (docs/directions/landing-opus.html) points at real
 * files on disk so it stays editable and diffable. This turns those pointers
 * into data URIs and swaps the builder's <iframe src> for the self-contained
 * build of the viewer, so the builder is genuinely embedded rather than
 * pictured.
 *
 *   node docs/tools/build_landing.mjs [out.html]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(repo, 'docs/directions/landing-opus.html');
const builder = path.join(repo, 'viewer/dist/builder.inline.html');
const out = process.argv[2] || path.join(repo, 'docs/directions/landing-opus.build.html');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

let html = fs.readFileSync(src, 'utf8');

html = html.replace(/src="((?:\.\.\/)[^"]+\.(?:png|jpg|webp))"/g, (whole, rel) => {
  const abs = path.resolve(path.dirname(src), rel);
  if (!fs.existsSync(abs)) throw new Error(`missing asset: ${rel}`);
  const mime = MIME[path.extname(abs)];
  return `src="data:${mime};base64,${fs.readFileSync(abs).toString('base64')}"`;
});

// Plates the page requests at runtime rather than naming in its markup: the
// herbarium picks a species per region and builds the src in script, so the
// regex above never sees them. They go in as a map the page reads instead.
const pressed = path.join(repo, 'docs/assets/pressed/web');
if (fs.existsSync(pressed)) {
  const plates = {};
  for (const file of fs.readdirSync(pressed)) {
    if (!file.endsWith('.webp')) continue;
    plates[file.replace(/\.webp$/, '')] =
      `data:image/webp;base64,${fs.readFileSync(path.join(pressed, file)).toString('base64')}`;
  }
  html = html.replace('</style>', () =>
    `</style>\n<script>window.__PRESSED__ = ${JSON.stringify(plates)};</script>`);
  console.log(`inlined ${Object.keys(plates).length} pressed plates`);
}

// The loose head crops that used to scatter around the region question are no
// longer drawn -- the band they belonged to came out. They stay on disk, since
// the plates they were cut from are still the source of the drift, but there
// is nothing left to read the map, and inlining it cost 356KB of base64 in
// every build. If the heads come back, so does this block.

// Bee portraits, same story -- the region list builds their src in script.
const bees = path.join(repo, 'docs/assets/bees/web');
if (fs.existsSync(bees)) {
  const pics = {};
  for (const file of fs.readdirSync(bees)) {
    if (!file.endsWith('.webp')) continue;
    pics[file.replace(/\.webp$/, '')] =
      `data:image/webp;base64,${fs.readFileSync(path.join(bees, file)).toString('base64')}`;
  }
  html = html.replace('</style>', () =>
    `</style>\n<script>window.__BEEPIC__ = ${JSON.stringify(pics)};</script>`);
  console.log(`inlined ${Object.keys(pics).length} bee portraits`);
}

// The builder travels as base64. Raw source in a text/plain script looked
// fine from disk but did not survive the artifact host re-serialising the
// page: the payload spilled out as visible text where the builder should
// have been. Base64 has no '<' in its alphabet, so no HTML parser anywhere
// can break it open, and any entity re-encoding a sanitiser applies leaves
// it untouched.
if (!fs.existsSync(builder)) {
  throw new Error('build the viewer first: cd viewer && npx vite build && node tools/bundle_single_file.mjs');
}
const payload = fs.readFileSync(builder).toString('base64');

// Replaced through a function, not a template: the bundle is full of `$1`
// and `$&` from minified regex replacements, and a string replacement would
// expand them against this match and quietly corrupt the module.
html = html.replace(
  /<iframe([^>]*)\ssrc="\.\.\/\.\.\/viewer\/"([^>]*)><\/iframe>/,
  (whole, before, attrs) => `<iframe${before}${attrs}></iframe>
      <script type="text/plain" id="builderSrc">${payload}</script>
      <script>
        // Mount on approach: booting a WebGL scene the moment the page loads
        // would stall the opening animation for something still four screens
        // below the fold.
        (function () {
          var frame = document.getElementById('builderFrame');
          var src = document.getElementById('builderSrc');
          var mount = function () {
            var bin = atob(src.textContent.replace(/\\s+/g, ''));
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            frame.srcdoc = new TextDecoder('utf-8').decode(bytes);
            src.remove();
          };
          if (!window.IntersectionObserver) return mount();
          var io = new IntersectionObserver(function (entries) {
            if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); mount(); }
          }, { rootMargin: '600px' });
          io.observe(frame);
        })();
      </script>`,
);
if (html.includes('src="../../viewer/"')) throw new Error('builder iframe was not replaced');

/* The globe, inlined the same way and for the same reason as the builder: one
   file has no siblings to fetch. Mounted on approach rather than at load, so a
   second WebGL context is not created four screens above where it is needed. */
const globeFile = path.join(repo, 'viewer/public/bee-globe.html');
if (fs.existsSync(globeFile)) {
  const globe = fs.readFileSync(globeFile).toString('base64');
  html = html.replace(
    /<iframe id="globeFrame"[^>]*src="\.\.\/\.\.\/viewer\/public\/bee-globe\.html"([^>]*)><\/iframe>/,
    (whole, attrs) => `<iframe id="globeFrame"${attrs}></iframe>
      <script type="text/plain" id="globeSrc">${globe}</script>
      <script>
        (function () {
          var frame = document.getElementById('globeFrame');
          var src = document.getElementById('globeSrc');
          var mount = function () {
            var bin = atob(src.textContent.replace(/\\s+/g, ''));
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            frame.srcdoc = new TextDecoder('utf-8').decode(bytes);
            src.remove();
          };
          if (!window.IntersectionObserver) return mount();
          var io = new IntersectionObserver(function (entries) {
            if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); mount(); }
          }, { rootMargin: '500px' });
          io.observe(frame);
        })();
      </script>`,
  );
  if (html.includes('viewer/public/bee-globe.html')) throw new Error('globe iframe was not replaced');
  console.log('inlined the bee globe');
}

fs.writeFileSync(out, html);
console.log(out, (fs.statSync(out).size / 1024 / 1024).toFixed(2), 'MB');
