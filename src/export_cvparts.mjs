// Export CV-EXACT parts for catalog cabinets → app/cvparts.json. For each
// cabinet we load its real AssemblyPart template from CVData, evaluate every
// part's size/position/rotation with the equation engine (full cross-reference
// resolution), map to world W/H/D via the rotation, keep only real board parts,
// and record which world axis is the thickness so the browser can reparametrize
// (scale the two face dims with the cabinet, keep thickness). Node-only.
// Run: node src/export_cvparts.mjs [limit] [nameFilter]
import { writeFileSync, readFileSync } from 'node:fs';
import { findSource, loadAssembly } from './cvdata.mjs';
import { buildModel, makeEngine } from './engine.mjs';
import { axisMap } from './resize.mjs';

const IN = 25.4;
const LIMIT = Number(process.argv[2]) || 300;
const FILTER = process.argv[3] || '';
const clean = (s) => String(s == null ? '' : s).replace(/^\{[a-z]\}/i, '').trim();

// map a CV part name to our part code (LF/RF/BO/TO/SH/DOR/DF/UB/TK) for downstream tools
function codeOf(name) {
  const n = (name || '').toUpperCase();
  if (/\bLF\b|LEFT/.test(n)) return 'LF'; if (/\bRF\b|RIGHT/.test(n)) return 'RF';
  if (/BOTTOM|\bBO\b|\bDNO\b/.test(n)) return 'BO'; if (/\bTOP\b|\bTO\b|VRCH/.test(n)) return 'TO';
  if (/SHELF|POLIC|\bSH\b/.test(n)) return 'SH'; if (/DOOR|DVER|\bDOR\b|CELO|ČELO|FRONT/.test(n)) return 'DOR';
  if (/DRAWER|ZASUV|ZÁSUV|\bDF\b/.test(n)) return 'DF'; if (/BACK|CHRBAT|CHRBÁT|\bUB\b/.test(n)) return 'UB';
  if (/TOE|SOKEL|\bTK\b/.test(n)) return 'TK'; return 'PART';
}

const P = (name, param) => ({ __class: 'CVParameter', name, type: param.type, equations: param.equations || [], value: param.value || { value: 0 } });
function assemblyToObjs(assembly, parts, W, H, D) {
  const byId = new Map();
  for (const p of parts) byId.set(p.id, {
    __class: 'CVAssembly', name: p.name, children: [], _leaf: !p.subAssembly,
    params: [P('DX', p.dims.W), P('DY', p.dims.L), P('DZ', p.dims.D), P('X', p.dims.X), P('Y', p.dims.Y), P('Z', p.dims.Z), P('AX', p.dims.AX), P('AY', p.dims.AY), P('AZ', p.dims.AZ), ...(p.params || [])],
  });
  const roots = [];
  for (const p of parts) { const n = byId.get(p.id); const par = p.parentId && byId.get(p.parentId); if (par) par.children.push(n); else roots.push(n); }
  const cab = { __class: 'CVCabinet', name: assembly.name, children: roots,
    params: [{ __class: 'CVParameter', name: 'DX', type: 1, equations: [], value: { value: W / IN } }, { __class: 'CVParameter', name: 'DY', type: 1, equations: [], value: { value: H / IN } }, { __class: 'CVParameter', name: 'DZ', type: 1, equations: [], value: { value: D / IN } }] };
  return { objs: [cab, ...byId.values()], leaves: [...byId.values()].filter((n) => n._leaf) };
}
function cabParts(id, W, H, D) {
  const { assembly, parts } = loadAssembly(src, id);
  const { objs, leaves } = assemblyToObjs(assembly, parts, W, H, D);
  const eng = makeEngine(buildModel(objs));
  const val = (o, n) => { const p = (o.params || []).find((x) => x.name === n); return p ? eng.valueOf({ owner: o, p }) : undefined; };
  const out = [];
  for (const o of leaves) {
    const m = axisMap(val(o, 'AX') || 0, val(o, 'AY') || 0, val(o, 'AZ') || 0);
    const w = { W: 0, H: 0, D: 0 };
    for (const dn of ['DX', 'DY', 'DZ']) { const d = val(o, dn); if (typeof d === 'number') w[m[dn]] = Math.abs(d); }
    const size = [w.W * IN, w.H * IN, w.D * IN];
    const sorted = [...size].sort((a, b) => a - b);
    if (sorted[2] < 80 || sorted[0] < 3 || sorted[0] > 50 || !(size[0] && size[1] && size[2])) continue; // real board only
    const tAxis = size.indexOf(sorted[0]);                         // thinnest world dim = thickness
    const pos = [(val(o, 'X') || 0) * IN, (val(o, 'Y') || 0) * IN, (val(o, 'Z') || 0) * IN];
    out.push({ n: clean(o.name).slice(0, 24), c: codeOf(o.name), p: pos.map((x) => +x.toFixed(1)), s: size.map((x) => +x.toFixed(1)), t: tAxis });
  }
  return out;
}

const src = findSource();
if (!src.server) { console.error('CVData nedostupná:', src.errors?.join('; ')); process.exit(1); }
let catalog;
try { catalog = JSON.parse(readFileSync('app/cvcatalog.json', 'utf8')).cabinets; }
catch { console.error('Najprv spusti node src/export_catalog.mjs'); process.exit(1); }

let pool = catalog.filter((c) => c.id && (!FILTER || c.name.toLowerCase().includes(FILTER.toLowerCase())));
pool = pool.slice(0, LIMIT);
console.log(`CVData: ${src.server}/${src.database} · spracúvam ${pool.length} skriniek${FILTER ? ` (filter "${FILTER}")` : ''}…`);
const out = {}; let ok = 0, empty = 0;
for (let i = 0; i < pool.length; i++) {
  const c = pool[i];
  try {
    const parts = cabParts(c.id, c.W, c.H, c.D);
    if (parts.length >= 4) { out[c.id] = { W: c.W, H: c.H, D: c.D, parts }; ok++; } else empty++;
  } catch (e) { empty++; }
  if ((i + 1) % 25 === 0) process.stdout.write(`\r  ${i + 1}/${pool.length} (ok ${ok})`);
}
const payload = { source: `${src.server}/${src.database}`, created: new Date().toISOString(), count: ok, parts: out };
writeFileSync('app/cvparts.json', JSON.stringify(payload));
console.log(`\n→ app/cvparts.json · ${ok} CV-presných skriniek (${empty} preskočených) · ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`);
