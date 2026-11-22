import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { openContainer, getStream } from '../app/cvj.js';
import { reserializeCheck } from './writer.mjs';
const files = readFileSync('corpus.txt','utf8').split('\n').map(s=>s.trim()).filter(Boolean);
let pass=0, part=0, fail=0;
for (const f of files) {
  const data = new Uint8Array(await readFile(f));
  const contents = getStream(openContainer(data),'Contents');
  let r; try { r = reserializeCheck(contents); } catch(e){ console.log('ER',e.message.slice(0,50),f.split(/[\/]/).pop()); fail++; continue; }
  const pct=((r.consumed/r.total)*100).toFixed(0);
  const nm=f.split(/[\/]/).pop();
  if(r.ok && pct==='100'){ console.log(`OK 100%  ${nm}`); pass++; }
  else if(r.ok){ console.log(`~~ ${pct}% stop:${r.frontier||'?'} @${r.consumed}  ${nm}`); part++; }
  else { console.log(`XX diff@${r.firstDiff}  ${nm}`); fail++; }
}
console.log(`\n${pass} full-100%, ${part} partial(byte-exact-but-undecoded-tail), ${fail} broken, of ${files.length}`);
