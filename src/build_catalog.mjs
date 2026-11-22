import { readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { openContainer, getStream } from '../app/cvj.js';
import { decodeStream } from './writer.mjs';
const IN=25.4;
const files = readFileSync('corpus.txt','utf8').split('\n').map(s=>s.trim()).filter(Boolean);
const pv=(o,n)=>{ for(const p of (o&&o.params||[])) if(p.__class==='CVParameter'&&p.name===n){const v=p.value; return v&&typeof v==='object'&&'value'in v?v.value:v;} };
// collect cabinet code -> list of sizes
const byCode=new Map();
for(const f of files){ let ctx; try{({ctx}=decodeStream(getStream(openContainer(new Uint8Array(await readFile(f))),'Contents')));}catch{continue;}
  const objs=ctx.map.filter(e=>e&&e.obj).map(e=>e.obj);
  for(const o of objs){ if(o.__class!=='CVCabinet')continue; const W=pv(o,'DX'),H=pv(o,'DY'),D=pv(o,'DZ');
    if(typeof W!=='number')continue; const w=W*IN,h=H*IN,d=D*IN;
    if(w<150||w>2500||h<150||h>2800||d<150||d>900)continue; // real cabinets
    const code=(o.name||'?').trim(); if(!byCode.has(code))byCode.set(code,[]); byCode.get(code).push([Math.round(w),Math.round(h),Math.round(d)]);
  }
}
// representative (median) size per code; keep codes seen >=1
const med=a=>a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];
const cat=[];
for(const [code,sizes] of byCode){
  if(sizes.length<1)continue;
  cat.push({ code, count:sizes.length, W:med(sizes.map(s=>s[0])), H:med(sizes.map(s=>s[1])), D:med(sizes.map(s=>s[2])) });
}
cat.sort((a,b)=>b.count-a.count);
writeFileSync('app/catalog.json', JSON.stringify(cat.slice(0,40),null,1));
console.log(`katalóg: ${cat.length} typov, uložených top ${Math.min(40,cat.length)} do app/catalog.json`);
console.log('ukážka:', cat.slice(0,8).map(c=>`${c.code} ${c.W}×${c.H}×${c.D} (${c.count}×)`).join('\n  '));
