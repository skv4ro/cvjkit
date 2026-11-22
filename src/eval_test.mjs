// Phase-2 proof: how much of CV's construction engine can we reproduce from the
// formulas in a .cvj? For every CVParameter that has a formula, evaluate it using
// the STORED values of referenced params as inputs, and compare the result to the
// param's own stored value. Match rate = fraction of derived values we can recompute.
import { readFile } from 'node:fs/promises';
import { openContainer, getStream } from '../app/cvj.js';
import { decodeStream } from './writer.mjs';
import { compile, evalAst } from './equations.mjs';

const files = process.argv.slice(2);

function paramVal(obj, name) {
  if (!obj || !obj.params) return undefined;
  for (const p of obj.params) if (p.__class === 'CVParameter' && p.name === name) {
    const v = p.value; return v && typeof v === 'object' && 'value' in v ? v.value : v;
  }
  return undefined;
}
const childNamed = (obj, name) => (obj && obj.children || []).find((c) => c && c.name === name);

for (const f of files) {
  const { ctx } = decodeStream(getStream(openContainer(new Uint8Array(await readFile(f))), 'Contents'));
  const objs = ctx.map.filter((e) => e && e.obj).map((e) => e.obj);
  // parent map + cabinet lookup
  const parent = new Map();
  for (const o of objs) for (const c of (o.children || [])) if (c) parent.set(c, o);
  const cabinetOf = (o) => { let x = o; while (x) { if (x.__class === 'CVCabinet') return x; x = parent.get(x); } return objs.find((z) => z.__class === 'CVCabinet'); };

  const stats = { total: 0, parseFail: 0, unresolved: 0, evalFail: 0, match: 0, mismatch: 0 };
  const unresolvedNames = {}; const mismatches = [];
  // resolve a bare name by walking obj → ancestors → cabinet (CV param scoping)
  const scoped = (obj, name) => {
    let x = obj;
    while (x) { const v = paramVal(x, name); if (v !== undefined) return v; x = parent.get(x); }
    return undefined;
  };
  const resolveFor = (obj) => (name) => {
    if (name.startsWith(':')) return paramVal(obj, name.slice(1));
    if (name.indexOf('.') >= 0) {
      const segs = name.split('.');
      let cur = segs[0] === 'This' ? obj : segs[0] === 'Cab' ? cabinetOf(obj) : (childNamed(obj, segs[0]) || childNamed(cabinetOf(obj), segs[0]));
      for (let k = 1; k < segs.length - 1 && cur; k++) cur = childNamed(cur, segs[k]);
      return cur ? paramVal(cur, segs[segs.length - 1]) : undefined;
    }
    return scoped(obj, name);
  };

  for (const obj of objs) {
    if (!obj.params) continue;
    for (const p of obj.params) {
      if (p.__class !== 'CVParameter' || !p.equations || !p.equations.length) continue;
      const stored = paramVal(obj, p.name);
      if (typeof stored !== 'number') continue;
      for (const e of p.equations) {
        if (!e.formula) continue;
        if (e.condition && e.condition !== '1') continue;   // only unconditional for this proof
        stats.total++;
        let ast; try { ast = compile(e.formula); } catch { stats.parseFail++; continue; }
        let val; try { val = evalAst(ast, resolveFor(obj)); }
        catch (err) {
          const m = /unresolved (\S+)/.exec(err.message);
          if (m) { stats.unresolved++; unresolvedNames[m[1]] = (unresolvedNames[m[1]] || 0) + 1; }
          else stats.evalFail++;
          continue;
        }
        if (Math.abs(val - stored) < 1e-6) stats.match++;
        else {
          stats.mismatch++;
          if (Math.abs(stored) < 1e-9) stats.mismatchStored0 = (stats.mismatchStored0 || 0) + 1;
          if (mismatches.length < 8) mismatches.push(`${p.name}="${e.formula}" → ${val.toFixed(4)} vs ${stored.toFixed(4)}`);
        }
      }
    }
  }
  const pct = (n) => ((n / stats.total) * 100).toFixed(1);
  console.log(`\n### ${f.split(/[\\/]/).pop()}`);
  console.log(`formulas (unconditional, numeric): ${stats.total}`);
  console.log(`  ✓ match:      ${stats.match} (${pct(stats.match)}%)`);
  console.log(`  ✗ mismatch:   ${stats.mismatch} (${pct(stats.mismatch)}%)  — of which stored=0: ${stats.mismatchStored0 || 0} (likely computed in S2M, not design-time)`);
  const designMatchable = stats.match + (stats.mismatch - (stats.mismatchStored0 || 0)) + stats.unresolved;
  console.log(`  ⇒ design-time match rate (excl. stored=0): ${stats.match}/${designMatchable} = ${((stats.match / designMatchable) * 100).toFixed(1)}%`);
  console.log(`  ? unresolved: ${stats.unresolved} (${pct(stats.unresolved)}%)`);
  console.log(`  ! parseFail:  ${stats.parseFail}   evalFail: ${stats.evalFail}`);
  const topU = Object.entries(unresolvedNames).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topU.length) console.log('  top unresolved:', topU.map(([k, v]) => `${k}(${v})`).join(' '));
  if (mismatches.length) { console.log('  sample mismatches:'); mismatches.forEach((m) => console.log('    ' + m)); }
}
