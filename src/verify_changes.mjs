import { readFile } from 'node:fs/promises';
import { openContainer, getStream } from '../app/cvj.js';
import { decodeStream, writeGraphMulti } from './writer.mjs';
import { buildModel, makeEngine, storedVal } from './engine.mjs';

// 1) STRICT full-stream byte equality for the 2 CVLineOp files
const lineopFiles = [
  "../nabytkar/samples/PLN-Pochybova-S-skrina-pod-schody-PLN-260821-06/PLN-Pochybova-S-skrina-pod-schody-PLN-260821-06.cvj",
  "../nabytkar/samples/PLN-Pochybova-detska-izba-PLN-260410-10/PLN-Pochybova-detska-izba-PLN-260410-10.cvj",
];
console.log('=== 1) STRICT full-stream byte equality (CVLineOp files) ===');
for (const f of lineopFiles) {
  const contents = getStream(openContainer(new Uint8Array(await readFile(f))), 'Contents');
  const { roots, ctx, consumed, total } = decodeStream(contents);
  const { buf: out } = writeGraphMulti(roots, ctx.classSchemas);
  let firstDiff = -1; const n = Math.min(out.length, contents.length);
  for (let i = 0; i < n; i++) if (out[i] !== contents[i]) { firstDiff = i; break; }
  const exact = firstDiff === -1 && out.length === contents.length && consumed === total;
  // count CVLineOp objects decoded
  const nLineOp = ctx.map.filter(e => e && e.obj && e.obj.__class === 'CVLineOp').length;
  console.log(`  ${exact ? 'PASS' : 'FAIL'}  ${f.split(/[\/]/).pop()}`);
  console.log(`       in=${contents.length}B out=${out.length}B consumed=${consumed}/${total} firstDiff=${firstDiff} CVLineOp-decoded=${nLineOp}`);
}

// 2) Independent engine spot-check: hand-compute a known formula
console.log('\n=== 2) Engine spot-check: u00_TOEH := Cab.DY - Cab.Case.DY ===');
const P = "../nabytkar/sample_projekty/TEST-skrinka/TEST-skrinka.cvj";
const { ctx } = decodeStream(getStream(openContainer(new Uint8Array(await readFile(P))), 'Contents'));
const objs = ctx.map.filter(e => e && e.obj).map(e => e.obj);
const model = buildModel(objs); const eng = makeEngine(model);
const cab = objs.find(o => o.__class === 'CVCabinet');
const DY = storedVal(model.resolveNode(cab, 'Cab.DY').p);
const CaseDY = storedVal(model.resolveNode(cab, 'Cab.Case.DY').p);
const expected = DY - CaseDY;
// find the engine's computed value for u00_TOEH
const res = eng.run();
const toeh = res.find(r => r.name === 'u00_TOEH');
console.log(`  Cab.DY=${DY.toFixed(5)}  Cab.Case.DY=${CaseDY.toFixed(5)}  hand = ${expected.toFixed(5)}`);
console.log(`  engine u00_TOEH = ${toeh ? toeh.value.toFixed(5) : 'n/a'}  (stored=${toeh ? toeh.stored.toFixed(5) : 'n/a'})`);
console.log(`  ${toeh && Math.abs(toeh.value - expected) < 1e-9 ? 'PASS (engine computed, not echoed stored)' : 'CHECK'}`);
