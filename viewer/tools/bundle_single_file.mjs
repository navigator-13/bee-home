/**
 * Fold the built viewer into one self-contained HTML file.
 *
 * The landing page embeds the builder rather than linking to it, and the
 * places it gets reviewed (a published artifact, a file:// preview, an email
 * attachment) forbid or cannot resolve sibling requests. So every asset the
 * builder fetches at runtime -- the module, the stylesheet, the fonts, the
 * textures and all thirty-odd storey meshes -- is inlined here and served
 * back through a fetch shim keyed on the same relative paths the source
 * already asks for. Nothing in viewer/src has to know.
 *
 *   node tools/bundle_single_file.mjs   ->  dist/builder.inline.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const MIME = {
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

/** Every file under dist/, keyed by the path the app asks for. */
function collect(dir, prefix = '') {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, collect(abs, rel + '/'));
    else out[rel] = abs;
  }
  return out;
}

const files = collect(dist);
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

// Assets the shim has to answer for: everything except the entry document and
// the two bundles, which get spliced into the markup directly.
const entry = /<script[^>]+src="\/?([^"]+\.js)"[^>]*><\/script>/.exec(html);
const sheet = /<link[^>]+href="\/?([^"]+\.css)"[^>]*>/.exec(html);
if (!entry || !sheet) throw new Error('unexpected dist/index.html shape');

const js = fs.readFileSync(path.join(dist, entry[1]), 'utf8');

// Only carry what is actually reachable. Textures and fonts are named as
// literals in the bundle; meshes are named by the model index it fetches. A
// leftover map nobody samples would otherwise cost a megabyte.
const referenced = js
  + fs.readFileSync(path.join(dist, sheet[1]), 'utf8')
  + fs.readFileSync(path.join(dist, 'models/index.json'), 'utf8');

const inline = {};
for (const [rel, abs] of Object.entries(files)) {
  if (rel === 'index.html' || rel === entry[1] || rel === sheet[1]) continue;
  if (!referenced.includes(path.basename(rel))) continue;
  const mime = MIME[path.extname(rel)] || 'application/octet-stream';
  inline[rel] = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
}
inline['models/index.json'] = `data:application/json;base64,`
  + fs.readFileSync(path.join(dist, 'models/index.json')).toString('base64');
const css = fs.readFileSync(path.join(dist, sheet[1]), 'utf8')
  // The stylesheet's own url() references resolve through CSS, not fetch.
  .replace(/url\(\/?([^)'"]+)\)/g, (m, p) => (inline[p] ? `url(${inline[p]})` : m));

// A closing tag inside an inlined script would end the block early.
const guard = (s) => s.replace(/<\/script/gi, '<\\/script');

// Two doors into the asset map. Three's loaders go through the loading
// manager (see useInlineAssets in src/main.js); the app's own index and rules
// are plain fetches, so those are shimmed here.
//
// The shim never fetches a data: URI -- it decodes the payload itself and
// synthesizes the Response. Fetching would work from disk but dies under any
// CSP whose connect-src omits data:, which is exactly the situation on a
// published artifact page. A Response built from bytes already in memory is
// outside CSP's jurisdiction.
const shim = `
(function () {
  var ASSETS = ${guard(JSON.stringify(inline))};
  window.__BEEHOME_ASSETS__ = ASSETS;
  var keys = Object.keys(ASSETS);
  var real = window.fetch.bind(window);
  function synth(uri) {
    var comma = uri.indexOf(',');
    var mime = uri.slice(5, comma).split(';')[0];
    var bin = atob(uri.slice(comma + 1));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return Promise.resolve(new Response(bytes.buffer, {
      status: 200,
      headers: { 'Content-Type': mime },
    }));
  }
  window.fetch = function (input, init) {
    var url = String(typeof input === 'string' ? input : (input && input.url) || '');
    // Anything already rewritten to a data: URI by the loading manager.
    if (url.slice(0, 5) === 'data:') return synth(url);
    var clean = url.split('?')[0];
    var hit = keys.find(function (key) { return clean.endsWith(key); });
    return hit ? synth(ASSETS[hit]) : real(input, init);
  };
})();
`;

// Function replacements, never strings: the minified bundle is full of `$&`
// and `$'` from regex code, and a string replacement expands those against
// the match -- which injects the matched <script> tag, closing tag and all,
// into the middle of the module. That is how the builder shipped as a page
// of raw source once.
html = html
  .replace(entry[0], () => `<script type="module">${guard(shim + '\n' + js)}</script>`)
  .replace(sheet[0], () => `<style>${css}</style>`);

const out = path.join(dist, 'builder.inline.html');
fs.writeFileSync(out, html);
console.log(out, (fs.statSync(out).size / 1024 / 1024).toFixed(2), 'MB');
