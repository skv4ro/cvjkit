// UCS-layer proof: load a cabinet TEMPLATE from CVData, evaluate its parts'
// dimension formulas for a chosen cabinet W/H/D, then change the width and show
// the parts recompute. This is the parametric rebuild a saved .cvj cannot give.
import { findSource, loadAssembly } from './cvdata.mjs';
import { query } from './cvdata.mjs';
import { compile, evalAst } from './equations.mjs';

const IN = 25.4;
const mm = (inch) => inch * IN;
const pv = (p) => (p && p.value && typeof p.value === 'object' ? p.value.value : undefined);

// evaluate a template formula-parameter in the context of a cabinet W/H/D.
// `:DX/:DY/:DZ` = the cabinet (sizing context); bare names fall back to cabinet.
function evalDim(param, cab) {
  const eq = (param.equations || []).find((e) => !e.condition || e.condition === '1') || (param.equations || [])[0];
  if (!eq || !eq.formula) return pv(param);           // plain stored value
  const resolve = (name) => {
    const bare = name.startsWith(':') ? name.slice(1) : name;
    if (bare === 'DX') return cab.DX;
    if (bare === 'DY') return cab.DY;
    if (bare === 'DZ') return cab.DZ;
    return cab[bare];                                   // other cabinet params if any
  };
  try { return evalAst(compile(eq.formula), resolve); } catch { return undefined; }
}

const src = findSource();
if (!src.server) { console.error('CVData nedostupná:', src.errors.join('; ')); process.exit(1); }
console.log(`CVData zdroj: ${src.server}/${src.database}${src.copy ? ' (kópia)' : ''} ${src.created ? '· ' + src.created.slice(0, 10) : ''}`);

// pick a demo assembly: arg, else an assembly whose leaf parts' Width references :DX
let asmId = Number(process.argv[2]);
if (!asmId) {
  const [pick] = query(src, `SELECT TOP 1 a.ID id, a.Name name, COUNT(p.ID) n
    FROM Assembly a JOIN AssemblyPart p ON p.AssemblyID = a.ID
    WHERE p.SubAssembly = 0 AND p.Width LIKE '%:DX%'
    GROUP BY a.ID, a.Name HAVING COUNT(p.ID) BETWEEN 4 AND 40 ORDER BY COUNT(p.ID) DESC`);
  asmId = pick && pick.id;
}
const { assembly, parts } = loadAssembly(src, asmId);
const leaves = parts.filter((p) => !p.subAssembly);
console.log(`\nŠablóna skrinky: [${assembly.id}] ${assembly.name}`);
console.log(`template rozmery: W=${assembly.width} H=${assembly.height} D=${assembly.depth} (${parts.length} dielov, ${leaves.length} listových)\n`);

function rebuild(wMm, hMm, dMm) {
  const cab = { DX: wMm / IN, DY: hMm / IN, DZ: dMm / IN };
  return leaves.map((p) => ({
    name: p.name,
    W: evalDim(p.dims.W, cab), L: evalDim(p.dims.L, cab), D: evalDim(p.dims.D, cab),
  }));
}

const base = rebuild(600, 720, 560);
const wide = rebuild(800, 720, 560);          // +200 mm width
console.log('diel                     | šírka 600mm → 800mm (W×L×D v mm)');
console.log('-------------------------+--------------------------------------');
let changed = 0;
for (let i = 0; i < Math.min(leaves.length, 16); i++) {
  const b = base[i], w = wide[i];
  const f = (x) => (typeof x === 'number' ? mm(x).toFixed(1) : '—');
  const dW = typeof b.W === 'number' && typeof w.W === 'number' && Math.abs(b.W - w.W) > 1e-9;
  if (dW) changed++;
  console.log(`${(b.name || '').slice(0, 24).padEnd(24)} | ${f(b.W)}×${f(b.L)}×${f(b.D)}  →  ${f(w.W)}×${f(w.L)}×${f(w.D)}${dW ? '  ⟵ zmena' : ''}`);
}
const allChanged = base.filter((b, i) => typeof b.W === 'number' && Math.abs(b.W - wide[i].W) > 1e-9).length;
console.log(`\n⟳ zmena šírky 600→800mm prepočítala šírku u ${allChanged}/${leaves.length} dielov (parametrický rebuild z CVData šablóny).`);
