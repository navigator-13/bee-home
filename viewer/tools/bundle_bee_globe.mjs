/** Build a single-file Bee / World artifact that runs directly over file://. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const beeDir=path.join(root,'public/assets/bee');
const parts=['antenna-far','wing-lower','wing-upper','leg-front-far-upper','leg-front-far-lower','abdomen','leg-rear-near-upper','leg-rear-near-lower','thorax','leg-mid-near-upper','leg-mid-near-lower','head','mouthparts','leg-front-near-upper','leg-front-near-lower','antenna-near'];
const assets={};
for(const name of parts){const file=`${name}.png`;assets[file]=`data:image/png;base64,${fs.readFileSync(path.join(beeDir,file)).toString('base64')}`}

const result=await build({entryPoints:[path.join(root,'src/bee-globe/main.js')],bundle:true,write:false,format:'iife',target:['es2020'],minify:true});
const js=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const css=fs.readFileSync(path.join(root,'src/bee-globe.css'),'utf8');
let html=fs.readFileSync(path.join(root,'bee-globe/index.html'),'utf8');
html=html
  .replace(/<script id="file-redirect">[\s\S]*?<\/script>/,'')
  .replace(/<link rel="stylesheet" href="\/src\/bee-globe\.css">/,()=>`<style>${css}</style>`)
  // A function replacement is required: minified Three.js contains `$&` and
  // `$'`, which String.replace would expand back into the matched module tag.
  .replace(/<script type="module" src="\/src\/bee-globe\/main\.js"><\/script>/,()=>`<script>window.__BEE_GLOBE_ASSETS__=${JSON.stringify(assets)};<\/script><script>${js}<\/script>`);
const outputs=[path.join(root,'bee-globe-standalone.html'),path.join(root,'dist/bee-globe-standalone.html')];
for(const out of outputs){fs.writeFileSync(out,html);console.log(`${out} ${(fs.statSync(out).size/1024/1024).toFixed(2)} MB`)}
