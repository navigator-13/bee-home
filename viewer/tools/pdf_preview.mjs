import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport:{width:1000,height:1414}, deviceScaleFactor:2 });
await p.goto(pathToFileURL(process.argv[2]).href + `#toolbar=0&navpanes=0&view=Fit&page=${process.argv[4]||1}`);
await p.waitForTimeout(5000);
await p.screenshot({ path: process.argv[3] });
await b.close();
