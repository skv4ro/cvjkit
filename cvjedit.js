// Real part-level editor over a decoded .cvj: expose every leaf part's dimensions,
// position, material, edge banding and drilling parameters for editing, and write
// the edited job back to a byte-exact-structured .cvj. The decoder already gives
// the full construction — this surfaces it for editing (ProdBoard/CV-level depth).
import { openContainer, getStream, setStream, writeContainer } from './cvj.js';
import { decodeStream, writeGraphMulti } from '../src/writer.mjs';

const IN = 25.4;
export const toMm = (inch) => inch * IN;
export const toIn = (mm) => mm / IN;

const findP = (o, n) => (o.params || []).find((p) => p.__class === 'CVParameter' && p.name === n);
export function getParam(o, n) { const p = findP(o, n); if (!p) return undefined; const v = p.value; return v && typeof v === 'object' && 'value' in v ? v.value : v; }
export function setParam(o, n, val) { const p = findP(o, n); if (!p || !p.value || typeof p.value !== 'object') return false; p.value.value = val; return true; }
export function hasParam(o, n) { return !!findP(o, n); }

// decode a .cvj buffer into an editable job model
export function decodeJob(buf) {
  const container = openContainer(buf);
  const { roots, ctx } = decodeStream(getStream(container, 'Contents'));
  const objs = ctx.map.filter((e) => e && e.obj).map((e) => e.obj);
  return { container, roots, ctx, objs };
}

// hardware objects (hinges, guides, legs, connectors…) placed in the job
export const HW_CLASSES = ['CVHardware', 'CVHinge', 'CVGuide', 'CVLegLeveler', 'CVPull', 'CVHingePlate', 'CVDrawerGuide', 'CVAccessory'];
export function hardwareObjs(objs) { return objs.filter((o) => HW_CLASSES.includes(o.__class)); }
export function hwDesc(hw) { return getParam(hw, '!UCSDESC') || getParam(hw, 'UCSDESC') || hw.name || hw.__class; }
export function hwFields(hw) {
  return [
    { label: 'X (mm)', param: 'X', kind: 'mm' }, { label: 'Y (mm)', param: 'Y', kind: 'mm' }, { label: 'Z (mm)', param: 'Z', kind: 'mm' },
    { label: 'Rotácia X°', param: 'AX', kind: 'int' }, { label: 'Rotácia Y°', param: 'AY', kind: 'int' }, { label: 'Rotácia Z°', param: 'AZ', kind: 'int' },
  ].filter((f) => hasParam(hw, f.param));
}

// leaf parts = CVAssembly with a DX param and no part-children
export function leafParts(objs) {
  return objs.filter((o) => o.__class === 'CVAssembly' && hasParam(o, 'DX')
    && !(o.children || []).some((c) => c && c.__class === 'CVAssembly' && hasParam(c, 'DX')));
}

// deep clone a part subtree with fresh object identities (preserving internal
// shared refs). CVParameter values are variants (numbers/strings), not refs to
// other job objects, so a leaf part is self-contained and safe to clone.
function deepClone(obj, map) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (map.has(obj)) return map.get(obj);
  if (Array.isArray(obj)) { const a = []; map.set(obj, a); for (const x of obj) a.push(deepClone(x, map)); return a; }
  const c = {}; map.set(obj, c);
  for (const k in obj) c[k] = deepClone(obj[k], map);
  return c;
}
// find the object whose children include `part`
export function parentOf(job, part) {
  for (const o of job.objs) if ((o.children || []).includes(part)) return o;
  return null;
}
// duplicate a part: clone it, insert after the original under the same parent.
// Returns the clone (null if no parent). writeGraphMulti re-emits the whole graph,
// so the new object gets a fresh MFC index — adding parts is valid (unlike in-place).
export function duplicatePart(job, part, newName) {
  const parent = parentOf(job, part); if (!parent) return null;
  const clone = deepClone(part, new Map());
  if (newName) clone.name = newName;
  const i = parent.children.indexOf(part);
  parent.children.splice(i + 1, 0, clone);
  job.objs.push(clone);               // list the new part for the editor
  return clone;
}
export function deletePart(job, part) {
  const parent = parentOf(job, part); if (!parent) return false;
  const i = parent.children.indexOf(part); if (i < 0) return false;
  parent.children.splice(i, 1);
  const j = job.objs.indexOf(part); if (j >= 0) job.objs.splice(j, 1);
  return true;
}

// write the (edited) job back to a .cvj byte array
export function encodeJob(job) {
  const { buf } = writeGraphMulti(job.roots, job.ctx.classSchemas);
  setStream(job.container, 'Contents', buf);
  return writeContainer(job.container);
}

// EVERY CVParameter of an object (name, value, kind, formula) — the full set of
// options CV stores for it. Each is directly editable (setParamObj).
export function allParams(obj) {
  return (obj.params || []).filter((p) => p.__class === 'CVParameter').map((p) => {
    const v = p.value; const val = v && typeof v === 'object' && 'value' in v ? v.value : v;
    const eq = (p.equations || []).find((e) => e.formula);
    return { name: p.name, value: val, kind: typeof val === 'number' ? 'num' : 'text', formula: eq ? eq.formula : null, p };
  });
}
export function setParamObj(p, val) { if (p && p.value && typeof p.value === 'object') { p.value.value = val; return true; } return false; }

// editable field groups for one part (label, param, kind, unit)
export function partFields(part) {
  const edge = (i) => [
    { label: `Vŕtať hranu ${i}`, param: `Vrtat_hrana_${i}`, kind: 'bool' },
    { label: `  rozteč ${i} (mm)`, param: `EDGE${i}DIS`, kind: 'mm' },
    { label: `  odsadenie predné ${i} (mm)`, param: `EDGE${i}FR_OFFSET`, kind: 'mm' },
    { label: `  odsadenie zadné ${i} (mm)`, param: `EDGE${i}RR_OFFSET`, kind: 'mm' },
  ];
  const groups = [
    { title: 'Rozmery (mm)', fields: [
      { label: 'DX', param: 'DX', kind: 'mm' }, { label: 'DY', param: 'DY', kind: 'mm' }, { label: 'DZ (hrúbka)', param: 'DZ', kind: 'mm' }] },
    { title: 'Pozícia (mm)', fields: [
      { label: 'X', param: 'X', kind: 'mm' }, { label: 'Y', param: 'Y', kind: 'mm' }, { label: 'Z', param: 'Z', kind: 'mm' }] },
    { title: 'Materiál / hrany', fields: [
      { label: 'Materiál (FACE index)', param: 'FACE', kind: 'int' },
      { label: 'Olepenie hrán (napr. HHHH)', param: 'BAND', kind: 'text' },
      { label: 'Vŕtať spojovačky', param: 'Vrtat_spojovacky', kind: 'bool' }] },
    { title: 'Vŕtanie hrán 1', fields: edge(1) },
    { title: 'Vŕtanie hrán 2', fields: edge(2) },
    { title: 'Vŕtanie hrán 3', fields: edge(3) },
    { title: 'Vŕtanie hrán 4', fields: edge(4) },
    { title: 'Poznámka', fields: [{ label: 'Komentár', param: 'komentar_NAB', kind: 'text' }] },
  ];
  // keep only fields the part actually has
  return groups.map((g) => ({ ...g, fields: g.fields.filter((f) => hasParam(part, f.param)) })).filter((g) => g.fields.length);
}
