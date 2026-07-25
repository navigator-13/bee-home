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

// The builder is handed over as inert text and mounted with srcdoc, because a
// 1 MB document does not survive being written into an HTML attribute by
// hand. Its own closing tags have to be hidden from the parser on the way in.
if (!fs.existsSync(builder)) {
  throw new Error('build the viewer first: cd viewer && npx vite build && node tools/bundle_single_file.mjs');
}
const SENTINEL = '@@BEEHOME_SCRIPT_END@@';
const source = fs.readFileSync(builder, 'utf8');
if (source.includes(SENTINEL)) throw new Error('sentinel collides with the builder source');
const payload = source.split('</script').join(SENTINEL);

html = html.replace(
  /<iframe src="\.\.\/\.\.\/viewer\/"([^>]*)><\/iframe>/,
  `<iframe id="builderFrame"$1></iframe>
      <script type="text/plain" id="builderSrc">${payload}</script>
      <script>
        // Mount on approach: booting a WebGL scene the moment the page loads
        // would stall the opening animation for something still four screens
        // below the fold.
        (function () {
          var frame = document.getElementById('builderFrame');
          var src = document.getElementById('builderSrc');
          var mount = function () {
            frame.srcdoc = src.textContent.split('${SENTINEL}').join('</scr' + 'ipt');
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

fs.writeFileSync(out, html);
console.log(out, (fs.statSync(out).size / 1024 / 1024).toFixed(2), 'MB');
