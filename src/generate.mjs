// CLI: resize a real cabinet (width/height/depth) and write a valid .cvj for S2M.
// Core rule lives in src/resize.mjs (rotation-aware, shared with the web app).
// Usage: node src/generate.mjs <in.cvj> W=<mm> H=<mm> D=<mm> [out=<path>]
import { readFile, writeFile } from 'node:fs/promises';
import { openContainer, getStream, setStream, writeContainer } from '../app/cvj.js';
import { decodeStream, writeGraphMulti, reserializeCheck } from './writer.mjs';
import { resizeGraph } from './resize.mjs';

const args = process.argv.slice(2);
const inFile = args[0];
const kv = Object.fromEntries(args.slice(1).map((a) => a.split('=')));
if (!inFile || (!kv.W && !kv.H && !kv.D)) { console.error('usage: node src/generate.mjs <in.cvj> W=<mm> H=<mm> D=<mm> [out=<path>]'); process.exit(1); }

const container = openContainer(new Uint8Array(await readFile(inFile)));
const { roots, ctx } = decodeStream(getStream(container, 'Contents'));
const objs = ctx.map.filter((e) => e && e.obj).map((e) => e.obj);

const target = { W: kv.W ? +kv.W : undefined, H: kv.H ? +kv.H : undefined, D: kv.D ? +kv.D : undefined };
const { from, to, rows } = resizeGraph(objs, target);
const cab = objs.find((o) => o.__class === 'CVCabinet');
const r0 = (n) => n.toFixed(0);
console.log(`Skrinka: ${cab.name}  ${r0(from.W)}×${r0(from.H)}×${r0(from.D)} → ${r0(to.W)}×${r0(to.H)}×${r0(to.D)}mm\n`);
console.log('DIEL        DX(mm) os          DY(mm) os          DZ(mm) os');
console.log('------------------------------------------------------------------');
const seen = new Set();
for (const r of rows) {
  if (seen.has(r.name)) continue; seen.add(r.name);
  const c = (d) => d ? `${d.from.toFixed(0)}${d.scales ? '→' + d.to.toFixed(0) : ''}[${d.axis}${d.scales ? '↑' : '·'}]`.padEnd(16) : ''.padEnd(16);
  console.log(`${(r.name || '?').slice(0, 10).padEnd(10)} ${c(r.dims.DX)} ${c(r.dims.DY)} ${c(r.dims.DZ)}`);
}

const out = kv.out || inFile.replace(/\.cvj$/i, '') + `-${kv.W || ''}x${kv.H || ''}x${kv.D || ''}.cvj`;
const { buf } = writeGraphMulti(roots, ctx.classSchemas);
setStream(container, 'Contents', buf);
await writeFile(out, Buffer.from(writeContainer(container)));
const chk = reserializeCheck(getStream(openContainer(new Uint8Array(await readFile(out))), 'Contents'));
console.log(`\n→ zapísané: ${out}`);
console.log(`→ round-trip: ${chk.ok ? 'OK byte-exact' : 'CHYBA diff@' + chk.firstDiff}, ${((chk.consumed / chk.total) * 100).toFixed(0)}% streamu`);
