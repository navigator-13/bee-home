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
  /<iframe src="\.\.\/\.\.\/viewer\/"([^>]*)><\/iframe>/,
  (whole, attrs) => `<iframe id="builderFrame"${attrs}></iframe>
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

fs.writeFileSync(out, html);
console.log(out, (fs.statSync(out).size / 1024 / 1024).toFixed(2), 'MB');
