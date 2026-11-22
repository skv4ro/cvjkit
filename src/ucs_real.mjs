// UCS proof on a REAL shop cabinet: load its template from CVData, then for a
// chosen cabinet W/H/D compute (1) each part's size from the cabinet dims and
// (2) each machining operation's position from its part's computed size. Change
// the width and watch BOTH parts and drilling recompute — the full parametric
// rebuild the saved .cvj cannot do.
import { findSource, loadAssembly } from './cvdata.mjs';
import { compile, evalAst } from './equations.mjs';

const IN = 25.4;
const mm = (x) => (typeof x === 'number' ? (x * IN).toFixed(1) : '—');
const pv = (p) => (p && p.value && typeof p.value === 'object' ? p.value.value : undefined);

// evaluate a formula-parameter in a numeric context {DX,DY,DZ,...}; bare/self names
// resolve against the context, then extra().
function evalIn(param, ctx, extra = () => undefined) {
  const eq = (param.equations || []).find((e) => !e.condition || e.condition === '1') || (param.equations || [])[0];
  if (!eq || !eq.formula) return pv(param);
  const resolve = (name) => {
    const bare = name.startsWith(':') ? name.slice(1) : name;
    if (bare in ctx) return ctx[bare];
    const e = extra(bare); return e;
  };
  try { const v = evalAst(compile(eq.formula), resolve); return typeof v === 'number' && !Number.isNaN(v) ? v : undefined; }
  catch { return undefined; }
}

const src = findSource();
if (!src.server) { console.error('CVData nedostupná:', src.errors.join('; ')); process.exit(1); }
const asmId = Number(process.argv[2]) || 583;    // 1KS_HRL-PR-4P (reálna skrinka dielne)
const { assembly, parts } = loadAssembly(src, asmId);
const leaves = parts.filter((p) => !p.subAssembly);
const nOps = leaves.reduce((a, p) => a + p.ops.length, 0);
console.log(`CVData: ${src.server}/${src.database}${src.copy ? ' (kópia ' + (src.created || '').slice(0, 10) + ')' : ''}`);
console.log(`Skrinka [${assembly.id}] ${assembly.name}  (${leaves.length} dielov, ${nOps} operácií)\n`);

function build(wMm, hMm, dMm) {
  const cab = { DX: wMm / IN, DY: hMm / IN, DZ: dMm / IN };
  return leaves.map((p) => {
    // part params (for use by ops) evaluated in the cabinet context
    const pp = (name) => { const q = p.params.find((x) => x.name === name); return q ? evalIn(q, cab) : undefined; };
    const dims = { DX: evalIn(p.dims.W, cab), DY: evalIn(p.dims.L, cab), DZ: evalIn(p.dims.D, cab) };
    const ops = p.ops.map((o) => ({
      name: o.name,
      X: evalIn(o.X, dims, pp), Y: evalIn(o.Y, dims, pp), Z: evalIn(o.Z, dims, pp),
      rep: evalIn(o.REPT, dims, pp), sp: evalIn(o.SPCNG, dims, pp),
    }));
    return { name: p.name, dims, ops };
  });
}

const base = build(600, 720, 560);
const wide = build(800, 720, 560);               // +200 mm width

console.log('DIEL                      | šírka 600 → 800mm (DX×DY×DZ)');
console.log('--------------------------+-----------------------------------');
for (let i = 0; i < leaves.length; i++) {
  const b = base[i].dims, w = wide[i].dims;
  const ch = typeof b.DX === 'number' && Math.abs(b.DX - w.DX) > 1e-9;
  console.log(`${(base[i].name || '').slice(0, 25).padEnd(25)} | ${mm(b.DX)}×${mm(b.DY)}×${mm(b.DZ)} → ${mm(w.DX)}×${mm(w.DY)}×${mm(w.DZ)}${ch ? '  ⟵' : ''}`);
}

// show operations that move with the width change
console.log('\nVŔTANIA/OPERÁCIE ktoré sa posunuli (X pozícia) pri zmene šírky:');
let opChanged = 0, opTotal = 0, shown = 0;
for (let i = 0; i < leaves.length; i++) {
  for (let k = 0; k < base[i].ops.length; k++) {
    const ob = base[i].ops[k], ow = wide[i].ops[k]; opTotal++;
    if (typeof ob.X === 'number' && typeof ow.X === 'number' && Math.abs(ob.X - ow.X) > 1e-9) {
      opChanged++;
      if (shown++ < 8) console.log(`  ${(base[i].name + '/' + (ob.name || '')).slice(0, 30).padEnd(30)} X ${mm(ob.X)} → ${mm(ow.X)}mm${ob.rep ? ` (×${ob.rep})` : ''}`);
    }
  }
}
const partChanged = base.filter((b, i) => typeof b.dims.DX === 'number' && Math.abs(b.dims.DX - wide[i].dims.DX) > 1e-9).length;
console.log(`\n⟳ zmena šírky 600→800mm: prepočítaných ${partChanged}/${leaves.length} dielov a ${opChanged}/${opTotal} operácií sa posunulo — parametrický rebuild reálnej skrinky z CVData.`);
