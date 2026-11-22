// cvjkit — from-scratch Contents builder ("generovanie od nuly").
// Constructs a CVJob object graph in code (no template file) and serializes it
// with the proven writer. Field markers and opaque defaults are the values CV
// 2025 itself writes (captured from real jobs), so the output is structurally a
// CV object graph. S2M/CV acceptance of a synthesized job is the user's to
// validate — this module guarantees the bytes are a well-formed CVJob graph
// that our own byte-exact-verified reader decodes back identically.
import { writeGraph, decodeStream, writeGraphMulti } from './writer.mjs';

// newclass tag schema CV 2025 stamps on every class in Contents.
export const CLASS_SCHEMA = 2012;
export function classSchemasFor(names) {
  const m = new Map(); for (const n of names) m.set(n, CLASS_SCHEMA); return m;
}

// inline schema markers (CXSchema::Serialize u16), as CV writes them.
const M = { CX: 0xcf01, BASE: 0xe901, PAR: 0xe901, ASM: 0xe903, EX: 0xe902,
            JOB: 0xe907, PARAM: 0xe904, EQ: 0xe904, CAT: 0xe901, CAB: 0xe901 };

const MM_PER_IN = 25.4;
const inch = (mm) => mm / MM_PER_IN;

// ---- field mixins (match the readers' field sets exactly) ----
function cxBase(name = '', label = '', id = 0) {
  return { _cxSchema: M.CX, _id: id, name, label, _v28: 0 };
}
function cvBase(name, label, id, v40 = 0) {
  return { ...cxBase(name, label, id), _baseSchema: M.BASE, _v40: v40, _v48: 0 };
}
function parBase(name, label, id, params = [], v40 = 0) {
  return { ...cvBase(name, label, id, v40), _parSchema: M.PAR, params };
}
// CVAsmBase with schema version 3 (low byte 3 => writes _v70 + _shape).
function asmBase(name, label, id, params = [], opts = {}) {
  return {
    ...parBase(name, label, id, params, opts.v40 ?? 0),
    _asmSchema: M.ASM,            // 0xe903, low byte 3
    _v74: opts._v74 ?? 0, _v76: opts._v76 ?? 0, _v78: opts._v78 ?? 0,
    _v80: opts._v80 ?? 0, _v7c: opts._v7c ?? 0, _v84: opts._v84 ?? 0,
    _v88: opts._v88 ?? 0,
    _v70: opts._v70 ?? 0,        // written because low byte 3 > 2
    _shape: null,                // written because low byte 3 > 1
  };
}
function asmChildren(children = [], data = [], v44 = 0) {
  return { _exSchema: M.EX, data, _v44: v44, children };
}

// ---- public constructors ----
// CVParameter with a variant value. kind: 'f64' (type 2) or 'i32' (type 4).
export function newParameter(name, value, { kind = 'f64', label = '', options = '' } = {}) {
  const type = kind === 'i32' ? 4 : 2;
  const v = kind === 'i32' ? { type, value: value | 0 } : { type, value: +value };
  return {
    __class: 'CVParameter',
    ...cvBase(name, label, 0),
    _schema: M.PARAM, flags: 0 /* low16 = equation count = 0 */, _v78: 0,
    value: v, equations: [], options, _v96: 0,
  };
}

// CVCabinet. size in mm; stored as inches (CV internal unit).
export function newCabinet({ name = 'CAB', label = '', w = 600, h = 720, d = 560,
                             params = [], id = 1 } = {}) {
  return {
    __class: 'CVCabinet',
    ...asmBase(name, label, id, params, { _v74: 1, _v76: 1, _v7c: 4 }),
    ...asmChildren([]),
    _schema: M.CAB,
    _v100: 0, _v170: 0, _v104: 0,
    size: { x: inch(w), y: inch(h), z: inch(d) },
    catOptions: { _schema: M.CAT, options: [], effects: [] },
    _v260: 0x10, _v264: 0, _v10c: 4,
    pt110: { x: 0, y: 0, z: 0 }, pt130: { x: 0, y: 0, z: 0 },
    _v26c: 0,
  };
}

// CVJob. children = top-level assemblies/cabinets/floor-levels.
export function newJob({ unitSymbol = '"', unitName = 'mm', params = [], children = [] } = {}) {
  return {
    __class: 'CVJob',
    ...asmBase('Job', 'Default', 0, params),
    ...asmChildren(children),
    _jobSchema: M.JOB,
    flags: [0, 0, 0, 0, 0],
    unitSymbol, unitName,
    sysDef: [0, 0, 0],
    _v4bc: 1, _v4a4: 0, _v3a8: 1, _v4b4: 1,
    _u32s7: [0, 0, 0, 0, 0, 0, 0],
    _f64s7: [0, 0, 0, 0, 0, 0, 0],
    texts10: Array(10).fill(''),
    bids: [],
    _v400: 0,
    texts16: Array(16).fill(''),
    _marker: 0xffffffff,
    text390: '',
    dbTypes: [0, 0, 0, 0],
  };
}

// ---- deep clone an object graph with FRESH identities ----
// Shared references within the subtree stay shared (one clone per source via the
// identity map). Primitives (incl. bigint for COleCurrency) copy by value. This
// lets us lift a decoded subtree into a graph we fully own, where add/remove of
// objects is safe (no foreign index space to disturb).
export function deepClone(src, map = new Map()) {
  if (src === null || typeof src !== 'object') return src;        // primitive / bigint
  if (map.has(src)) return map.get(src);
  if (Array.isArray(src)) {
    const out = []; map.set(src, out);
    for (const x of src) out.push(deepClone(x, map));
    return out;
  }
  const out = {}; map.set(src, out);
  for (const k of Object.keys(src)) out[k] = deepClone(src[k], map);
  return out;
}

// Collect the distinct class->schema pairs actually used by a graph (so a cloned
// graph carries the real newclass schemas, not a guessed table).
export function classSchemasOfGraph(root) {
  const names = new Set(); collectClasses(root, names);
  return classSchemasFor([...names]);   // all CV 2025 classes share schema 2012
}

// ---- graph walk / query / edit helpers (composition layer) ----
export function* walk(o, seen = new Set()) {
  if (!o || typeof o !== 'object' || !o.__class || seen.has(o)) return;
  seen.add(o); yield o;
  for (const key of ['children', 'rooms', 'data', 'params', 'equations'])
    if (Array.isArray(o[key])) for (const c of o[key]) yield* walk(c, seen);
  for (const key of ['_shape', 'profile', 'template', 'catOptions', 'value'])
    if (o[key] && typeof o[key] === 'object' && o[key].__class) yield* walk(o[key], seen);
}
export const findAll = (root, cls) => [...walk(root)].filter((o) => o.__class === cls);
export const findFirst = (root, cls, pred) =>
  [...walk(root)].find((o) => o.__class === cls && (!pred || pred(o)));

// A "part" (diel) is a LEAF CVAssembly (no sub-assembly children) carrying DX/DY/DZ.
export function isLeafPart(o) {
  return o.__class === 'CVAssembly' && o.params.some((p) => p.name === 'DX') &&
    !(o.children || []).some((c) => c && c.__class === 'CVAssembly');
}
export const findParts = (root) => [...walk(root)].filter(isLeafPart);

export function getParam(o, name) {
  const p = (o.params || []).find((p) => p.name === name);
  return p && p.value ? p.value.value : undefined;
}
export function setParam(o, name, value) {
  const p = (o.params || []).find((p) => p.name === name);
  if (!p || !p.value) return false;
  const t = p.value.type;
  p.value.value = (t === 4 || t === 5 || t === 7 || t === 10) ? (value | 0) : +value;
  return true;
}
// part dimensions in mm (DX=length, DY=width, DZ=thickness)
export const partDimsMm = (part) => ({
  dx: Math.round(getParam(part, 'DX') * MM_PER_IN * 10) / 10,
  dy: Math.round(getParam(part, 'DY') * MM_PER_IN * 10) / 10,
  dz: Math.round(getParam(part, 'DZ') * MM_PER_IN * 10) / 10,
});
export function setPartDimsMm(part, { dx, dy, dz } = {}) {
  if (dx != null) setParam(part, 'DX', inch(dx));
  if (dy != null) setParam(part, 'DY', inch(dy));
  if (dz != null) setParam(part, 'DZ', inch(dz));
}

// Duplicate a part/cabinet subtree (fresh identities) and append it to a parent.
// overrides: { name, label, dims:{dx,dy,dz}, params:{NAME:value,...} }
export function duplicateInto(parent, subtree, overrides = {}) {
  const copy = deepClone(subtree);
  if (overrides.name != null) copy.name = overrides.name;
  if (overrides.label != null) copy.label = overrides.label;
  if (overrides.dims) setPartDimsMm(copy, overrides.dims);
  if (overrides.params) for (const [k, v] of Object.entries(overrides.params)) setParam(copy, k, v);
  parent.children.push(copy);
  return copy;
}

// ---- serialize a built job graph to a Contents buffer ----
// Collect every class the graph uses so the newclass schema table is complete.
function collectClasses(obj, set) {
  if (obj == null || typeof obj !== 'object') return;
  if (obj.__class) set.add(obj.__class);
  for (const k in obj) { const v = obj[k];
    if (Array.isArray(v)) v.forEach((x) => collectClasses(x, set));
    else if (v && typeof v === 'object') collectClasses(v, set); }
}
export function serializeContents(job) {
  const classes = new Set(); collectClasses(job, classes);
  return writeGraph(job, classSchemasFor([...classes]));
}

// Self-verification: serialize, decode, re-serialize; the two byte streams must
// be identical (proves the built graph is a fixed point of our codec pair).
export function verifyRoundTrip(job) {
  const a = serializeContents(job);
  const { roots, ctx, consumed, stop } = decodeStream(a);
  const { buf: b } = writeGraphMulti(roots, ctx.classSchemas);
  let diff = -1; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) { diff = i; break; }
  return { ok: diff === -1 && a.length === b.length && consumed === a.length,
           bytes: a.length, consumed, firstDiff: diff,
           stop: stop ? (stop.className || stop.message) : null, roots: roots.length };
}
