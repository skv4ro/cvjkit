// Phase-3 proof: evaluate the WHOLE parameter graph from inputs (computed refs,
// not stored values) and compare to CV's stored values. High match = the engine
// reproduces CV's construction. Then demo: change a base dimension → recompute.
import { readFile } from 'node:fs/promises';
import { openContainer, getStream } from '../app/cvj.js';
import { decodeStream } from './writer.mjs';
import { buildModel, makeEngine, storedVal } from './engine.mjs';

const files = process.argv.slice(2);
for (const f of files) {
  const { ctx } = decodeStream(getStream(openContainer(new Uint8Array(await readFile(f))), 'Contents'));
  const objs = ctx.map.filter((e) => e && e.obj).map((e) => e.obj);
  const model = buildModel(objs);
  const eng = makeEngine(model);
  const res = eng.run();

  // Honest metric: only count params we ACTUALLY computed (formula evaluated, no
  // fallback to stored). Split by stored=0 (S2M layer, not design-time).
  let inputs = 0, nonNum = 0, couldNot = 0;
  let cMatch = 0, cMismatch = 0;              // computed, all
  let cMatchNZ = 0, cMismNZ = 0;              // computed, stored!=0 (design-time)
  const samples = [];
  for (const r of res) {
    if (eng.isInput(r.p)) { inputs++; continue; }
    if (typeof r.stored !== 'number') { nonNum++; continue; }
    if (r.fellBack) { couldNot++; continue; } // couldn't evaluate → don't claim it
    const d = Math.abs(r.value - r.stored);
    const isZero = Math.abs(r.stored) < 1e-9;
    if (d < 1e-6) { cMatch++; if (!isZero) cMatchNZ++; }
    else {
      cMismatch++; if (!isZero) cMismNZ++;
      if (!isZero && samples.length < 10) samples.push(`${r.name}: got ${r.value.toFixed(4)} vs ${r.stored.toFixed(4)}`);
    }
  }
  const computed = cMatch + cMismatch;
  console.log(`\n### ${f.split(/[\\/]/).pop()}`);
  console.log(`  params: ${res.length}  inputs: ${inputs}  derived-numeric computed: ${computed}  couldNotEval: ${couldNot}`);
  console.log(`  ✓ engine correct (all computed): ${cMatch}/${computed} = ${((cMatch / computed) * 100).toFixed(1)}%`);
  console.log(`  ✓ engine correct (design-time, excl. stored=0): ${cMatchNZ}/${cMatchNZ + cMismNZ} = ${((cMatchNZ / (cMatchNZ + cMismNZ)) * 100).toFixed(1)}%`);
  console.log(`  ✗ mismatch computed: ${cMismatch}  (design-time: ${cMismNZ})`);
  console.log(`  cycles hit: ${eng.stats.cycles}  evalFail: ${eng.stats.evalFail}`);
  const topU = Object.entries(eng.stats.unresolved).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topU.length) console.log('  top unresolved refs:', topU.map(([k, v]) => `${k}(${v})`).join(' '));
  if (samples.length) { console.log('  sample mismatches:'); samples.forEach((s) => console.log('    ' + s)); }

  // --- demo: change the cabinet width (Cab.DX) and recompute ---
  const cab = objs.find((o) => o.__class === 'CVCabinet');
  const dxNode = model.resolveNode(cab, ':DX');
  if (dxNode) {
    const base = eng.run();
    const baseMap = new Map(base.map((r) => [r.p, r.value]));
    const oldDX = storedVal(dxNode.p);
    const newDX = oldDX + 200 / 25.4;                 // +200 mm
    const after = eng.run([{ p: dxNode.p, value: newDX }]);
    let changed = 0; const chSamples = [];
    for (const r of after) {
      const before = baseMap.get(r.p);
      if (before !== undefined && Math.abs(r.value - before) > 1e-6) {
        changed++;
        if (chSamples.length < 8 && !eng.isInput(r.p)) chSamples.push(`${r.name}: ${before.toFixed(3)} → ${r.value.toFixed(3)}`);
      }
    }
    console.log(`  ⟳ change Cab.DX ${(oldDX * 25.4).toFixed(0)}mm → ${(newDX * 25.4).toFixed(0)}mm: ${changed} derived values recomputed`);
    chSamples.forEach((s) => console.log('      ' + s));
  }
}
