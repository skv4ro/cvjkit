// cvjkit — Contents (MFC CArchive object graph) WRITER.
// Exact mirror of the readers in src/codecs.mjs + src/foundations.mjs: every
// field is emitted in the same order/width it was read, and the MFC shared
// index space (newclass / classref / objref) is reproduced byte-for-byte.
//
// Two uses:
//   1. Re-serialize a decoded object graph  -> byte-exact round-trip (proof).
//   2. Serialize a hand-built graph          -> from-scratch .cvj generation.
import { Reader, Writer } from './archive.mjs';
import { ReadCtx, readObject } from './contents.mjs';
import './codecs.mjs';
import './foundations.mjs';

// ---- write context: mirrors ReadCtx's index assignment exactly ----
// On READ, index 0 is reserved; a newclass registers the class (next index)
// THEN the object (next index); a classref registers only the object; an
// objref registers nothing. We reproduce that assignment order here so every
// ref index matches.
export class WriteCtx {
  constructor(classSchemas) {
    this.classIdx = new Map();      // class name -> its index in the shared space
    this.objIdx = new Map();        // object (by identity) -> its index
    this.next = 1;                  // next index to hand out (1-based like MFC)
    this.classSchemas = classSchemas || new Map(); // class name -> newclass schema u16
  }
}

function writeRefTag(w, idx, isClass) {
  if (idx < 0x7fff) w.u16(isClass ? (0x8000 | idx) : idx);
  else { w.u16(0x7fff); w.u32((isClass ? (0x80000000 | idx) : idx) >>> 0); }
}

// Mirror of readObject: resolve the tag, dispatch to the class writer.
export function writeObject(w, ctx, obj) {
  if (obj === null || obj === undefined) { w.u16(0x0000); return; }   // null tag
  const seen = ctx.objIdx.get(obj);
  if (seen !== undefined) { writeRefTag(w, seen, false); return; }    // objref
  const name = obj.__class;
  if (!name) throw new Error('object has no __class: ' + JSON.stringify(obj).slice(0, 80));
  if (!ctx.classIdx.has(name)) {                                      // newclass
    const sch = ctx.classSchemas.get(name);
    if (sch === undefined) throw new Error(`no newclass schema recorded for class "${name}"`);
    w.u16(0xffff).u16(sch).u16(name.length);
    for (let i = 0; i < name.length; i++) w.u8(name.charCodeAt(i));
    ctx.classIdx.set(name, ctx.next++);
  } else {                                                            // classref
    writeRefTag(w, ctx.classIdx.get(name), true);
  }
  ctx.objIdx.set(obj, ctx.next++);                                    // register before body
  const codec = WRITE_CODECS.get(name);
  if (!codec) throw new Error(`no writer registered for class "${name}"`);
  codec(w, ctx, obj);
}

// ---- schema + inline helpers (mirror codecs.mjs) ----
const sch = (w, v) => w.u16(v & 0xffff);
function writeMtPoint3d(w, p) { w.f64(p.x).f64(p.y).f64(p.z); }
function writeVariant(w, v) { w.variant(v.type, 'value' in v ? v.value : v.raw); }

function writeCVCatOptions(w, ctx, o) {
  sch(w, o._schema);
  w.u32(o.options.length); for (const x of o.options) writeObject(w, ctx, x);
  w.u32(o.effects.length); for (const x of o.effects) writeObject(w, ctx, x);
}

// ---- foundations (mirror src/foundations.mjs) ----
function writeCXBase(w, ctx, o) {
  sch(w, o._cxSchema); w.u32(o._id); w.cstring(o.name); w.cstring(o.label); w.u32(o._v28);
}
function writeCVBase(w, ctx, o) {
  writeCXBase(w, ctx, o); sch(w, o._baseSchema); w.u16(o._v40); w.u32(o._v48);
}
function writeCXObject(w, ctx, o, key) { writeVariant(w, o[key]); }

// ---- CVParBase / CVAsmBase / CVAsmBaseEx children ----
function writeCVParBase(w, ctx, o) {
  writeCVBase(w, ctx, o); sch(w, o._parSchema);
  w.u16(o.params.length); for (const p of o.params) writeObject(w, ctx, p);
}
function writeCVAsmBase(w, ctx, o) {
  writeCVParBase(w, ctx, o);
  sch(w, o._asmSchema);
  w.u16(o._v74).u16(o._v76).u32(o._v78).i32(o._v80).u16(o._v7c).u32(o._v84).u32(o._v88);
  const v = o._asmSchema & 0xff;
  if (v > 2) w.u32(o._v70);
  if (v > 1) writeObject(w, ctx, o._shape);
}
function writeCVAsmBaseExChildren(w, ctx, o) {
  sch(w, o._exSchema);
  w.u16(o.data.length); for (const d of o.data) writeObject(w, ctx, d);
  w.u16(o.children.length); w.u32(o._v44);
  for (const c of o.children) writeObject(w, ctx, c);
}

// ---- per-class writers (mirror each registerClass in codecs.mjs) ----
const WRITE_CODECS = new Map();
const wc = (name, fn) => WRITE_CODECS.set(name, fn);

wc('CVEquation', (w, ctx, o) => {
  sch(w, o._schema); w.cstring(o.condition); w.cstring(o.formula); w.u8(o.flag);
});

wc('CVParameter', (w, ctx, o) => {
  writeCVBase(w, ctx, o);
  sch(w, o._schema); w.u32(o.flags); w.u32(o._v78);
  writeCXObject(w, ctx, o, 'value');
  for (const e of o.equations) writeObject(w, ctx, e);   // count = flags & 0xffff
  w.cstring(o.options); w.u16(o._v96);
});

wc('CVCabinet', (w, ctx, o) => {
  writeCVAsmBase(w, ctx, o);
  sch(w, o._schema);
  w.u16(o._v100).u32(o._v170).u32(o._v104);
  writeMtPoint3d(w, o.size);
  writeCVCatOptions(w, ctx, o.catOptions);
  w.u32(o._v260).u32(o._v264).u16(o._v10c);
  writeMtPoint3d(w, o.pt110); writeMtPoint3d(w, o.pt130);
  w.u32(o._v26c);
  writeCVAsmBaseExChildren(w, ctx, o);
});

function writeCVDataPacket(w, o) { sch(w, o._dpSchema); w.u32(o._dp10); }
wc('CVShapePacket', (w, ctx, o) => writeCVDataPacket(w, o));
wc('CVHingePlate', (w, ctx, o) => { writeCVAsmBase(w, ctx, o); sch(w, o._schema); });
// library lists: empty body in Contents (data lives in separate OLE streams)
for (const name of ['CVLightSchedList', 'CVTemplateList', 'CVDoorDataList',
                    'CVCatalogDataList', 'CVCatalogDataListX', 'CVMatDataListX',
                    'CVConstDataListX', 'CVDrawManager']) {
  wc(name, () => { /* empty */ });
}
wc('CVBandPacket', (w, ctx, o) => {
  writeCVDataPacket(w, o);
  sch(w, o._schema); w.u16(o._v18);
  w.f64(o.b20).f64(o.b28).f64(o.b30).f64(o.b38);
  if (o._v18 & 1) writeObject(w, ctx, o.template);
});

function writeCVTemplate(w, ctx, o) {
  writeCVBase(w, ctx, o);
  sch(w, o._tSchema); w.u32(o._t50).u32(o._t9c);
  writeMtPoint3d(w, o.pt58); writeMtPoint3d(w, o.pt78);
}
wc('CVTemplate2d', (w, ctx, o) => {
  writeCVTemplate(w, ctx, o);
  sch(w, o._schema); w.f64(o._c0);
  writeObject(w, ctx, o.profile);
  if (o.profile === null) {
    w.u32(o.nodes.length); for (const n of o.nodes) writeObject(w, ctx, n);
  }
});
wc('CVVertexNode', (w, ctx, o) => { w.f64(o.x).f64(o.y).f64(o.z).u32(o._v30); });
wc('CVTemplateNode', (w, ctx, o) => {
  w.f64(o.x).f64(o.y).f64(o.z).u32(o._v30);
  sch(w, o._schema); w.f64(o._n38).f64(o._n40);
});

// ---- 2D geometry kernel writers (mirror the CXVTemplate chain in codecs.mjs) ----
const writeMtPoint2d = (w, p) => w.f64(p.x).f64(p.y);
wc('CXParameter', (w, ctx, o) => {
  sch(w, o._schema); w.cstring(o.name); w.u32(o._v10); writeVariant(w, o.value);
});
wc('CXIdLst', (w, ctx, o) => {
  sch(w, o._schema); w.u32(o._v08); w.count(o.ids.length); for (const id of o.ids) w.u64(id);
});
function writeCXGeometry2d(w, ctx, o) {
  sch(w, o._geomSchema); w.i32(o._g08);
  writeObject(w, ctx, o.refList);
  w.i32(o.cxParams.length); for (const p of o.cxParams) writeObject(w, ctx, p);
}
function writeCXCurve2d(w, ctx, o) {
  writeCXGeometry2d(w, ctx, o);
  sch(w, o._curveSchema); writeMtPoint2d(w, o.start); writeMtPoint2d(w, o.end);
}
wc('CXLine2d', (w, ctx, o) => { writeCXCurve2d(w, ctx, o); sch(w, o._lineSchema); });
wc('CXArc2d', (w, ctx, o) => { writeCXCurve2d(w, ctx, o); sch(w, o._arcSchema); writeMtPoint2d(w, o.mid); });
function writeCXProfileLoadData(w, ctx, o) {
  sch(w, o._profSchema); w.u32(o._profD4);
  w.i32(o.entities.length); for (const e of o.entities) writeObject(w, ctx, e);
  if ((o._profSchema & 0xff) > 1) { w.i32(o.entities2.length); for (const e of o.entities2) writeObject(w, ctx, e); }
}
function writeCXTemplateLoadData(w, ctx, o) {
  writeCXProfileLoadData(w, ctx, o); sch(w, o._tmplSchema); w.u32(o._t160); w.u32(o._t168);
}
wc('CXVTemplate', (w, ctx, o) => {
  writeCXTemplateLoadData(w, ctx, o);
  w.u32(o._v218).u32(o._v214a);
  writeMtPoint3d(w, o.pt1c8); writeMtPoint3d(w, o.pt1e8);
  w.f64(o._v208).u32(o._v214);
});

// Sketch constraints (CXRel2d family) — mirror readCXRel2d.
function writeCXRelHelpData(w, h) {
  sch(w, h._schema); w.i32(h.type); const t = h.type;
  if (t === 1) { w.f64(h.p[0]).f64(h.p[1]).f64(h.p[2]); }
  else if (t === 2) { w.f64(h.p[0]); }
  else if (t === 3 || t === 6 || t === 8) { w.i32(h.i); }
  else if (t === 7) { w.f64(h.p[0]).f64(h.p[1]); }
  else if (t === 9) { w.u32(h.u).f64(h.f); }
  w.f64(h.trail);                       // ALWAYS
}
function writeCXGRef(w, g) {
  sch(w, g._schema); w.i32(g.entityId).i32(g._v10).i32(g._v48);
  writeCXRelHelpData(w, g.help);
}
function writeCXGRefLst(w, lst) {
  sch(w, lst._schema); w.i32(lst.refs.length); for (const g of lst.refs) writeCXGRef(w, g);
}
function writeCXRel2d(w, ctx, o) {
  writeCXGeometry2d(w, ctx, o);
  sch(w, o._relSchema); const v = o._relSchema & 0xff;
  w.u8(o._rel40);
  writeCXGRefLst(w, o.grefs);
  if (v > 1) { w.i32(o._e0).i32(o._e4).i32(o._e8).i32(o._ec).f64(o._f0).i32(o._f8); }
  if (v >= 3) for (const p of o.relPts) writeMtPoint2d(w, p);
  if (v >= 4) { w.f64(o._a8).f64(o._b0); }
}
// Concrete constraints = writeCXRel2d + per-class tail (see codecs.mjs).
wc('CXCoincidentRel2d', writeCXRel2d);
wc('CXConcentricRel2d', writeCXRel2d);
function writeCXFixedLikeRel2d(w, ctx, o) { writeCXRel2d(w, ctx, o); sch(w, o._ctSchema); w.u8(o._ctBool); }
wc('CXHorzVertRel2d', writeCXFixedLikeRel2d);
wc('CXFixedRel2d', writeCXFixedLikeRel2d);

function writeCVPathBase(w, o) { sch(w, o._pathSchema); w.u32(o._p08); w.u32(o._p0c); }
wc('CVRouteOp', (w, ctx, o) => {
  writeCVAsmBase(w, ctx, o);
  sch(w, o._schema);
  if ((o._schema & 0xff) < 2) { w.u32(o._v100); w.u32(o._v104); }
  else writeCVPathBase(w, o);
});

wc('CVDoor', (w, ctx, o) => {
  writeCVAsmBase(w, ctx, o);
  sch(w, o._schema); w.i32(o._currency); w.u64(o._currencyCur);
  writeCVAsmBaseExChildren(w, ctx, o);
});

wc('CVAssembly', (w, ctx, o) => {
  writeCVAsmBase(w, ctx, o); sch(w, o._schema); writeCVAsmBaseExChildren(w, ctx, o);
});

const writeAsmHardware = (w, ctx, o) => { writeCVAsmBase(w, ctx, o); sch(w, o._schema); };
for (const name of ['CVHardware', 'CVLegLeveler', 'CVSmartFace', 'CVHinge', 'CVGuide',
                    'CVPull', 'CVDrawerGuide', 'CVDoorHardware', 'CVAccessory',
                    'CVHoleOp', 'CVHoleMasterOp', 'CVDadoExOp', 'CVDadoExMasterOp',
                    'CVDadoMasterOp', 'CVLineboreOp', 'CVLineBoreMasterOp', 'CVLeg']) {
  wc(name, writeAsmHardware);
}
// CVLineOp mirrors CVAssembly (CVAsmBase + schema + E902 data/children block).
wc('CVLineOp', (w, ctx, o) => {
  writeCVAsmBase(w, ctx, o); sch(w, o._schema); writeCVAsmBaseExChildren(w, ctx, o);
});

wc('CVWall', (w, ctx, o) => {
  writeCVAsmBase(w, ctx, o); sch(w, o._schema);
  w.u16(o._d0).u16(o._d4).u16(o._d2).u16(o._da).u16(o._dc).u16(o._d6).u16(o._d8);
  w.u32(o._e0).u32(o._e8).u16(o._de);
  writeCVAsmBaseExChildren(w, ctx, o);
});

wc('CVWallFace', (w, ctx, o) => {
  writeCVAsmBase(w, ctx, o); sch(w, o._schema);
  w.u32(o._d0).u32(o._d4).u32(o._d8);
  writeCVAsmBaseExChildren(w, ctx, o);
});

wc('CVFloorLevel', (w, ctx, o) => {
  writeCVAsmBase(w, ctx, o); sch(w, o._schema);
  w.u16(o.rooms.length); for (const rm of o.rooms) writeObject(w, ctx, rm);
  w.u32(o.polygons.length);
  for (const pg of o.polygons) {
    w.u32(pg.verts.length); for (const vt of pg.verts) w.f64(vt.x).f64(vt.y).f64(vt.z);
    w.u32(pg.loops.length); for (const lp of pg.loops) { w.u32(lp.length); for (const k of lp) w.u32(k); }
  }
  writeCVAsmBaseExChildren(w, ctx, o);
});

function writeJobBlock(w, o) {
  sch(w, o._jobSchema);
  w.u16(o.flags[0]).u32(o.flags[1]).u32(o.flags[2]).u32(o.flags[3]).u32(o.flags[4]);
  w.cstring(o.unitSymbol); w.cstring(o.unitName);
  w.u32(o.sysDef[0]).u32(o.sysDef[1]).u32(o.sysDef[2]);
  w.u16(o._v4bc).u32(o._v4a4).u16(o._v3a8).u32(o._v4b4);
  for (const x of o._u32s7) w.u32(x);
  for (const x of o._f64s7) w.f64(x);
  for (const s of o.texts10) w.cstring(s);
  w.u16(o.bids.length);
  for (const b of o.bids) { w.u32(b.id).cstring(b.name).u32(b.flag).f64(b.a).f64(b.b).f64(b.c); }
  w.u32(o._v400);
  for (const s of o.texts16) w.cstring(s);
  w.u32(o._marker);
  w.cstring(o.text390);
  w.u32(o.dbTypes[0]).u32(o.dbTypes[1]).u32(o.dbTypes[2]).u32(o.dbTypes[3]);
}
wc('CVJob', (w, ctx, o) => {
  writeCVAsmBase(w, ctx, o); writeJobBlock(w, o); writeCVAsmBaseExChildren(w, ctx, o);
});

// ---- top-level: serialize one graph (single root) to a Contents buffer ----
export function writeGraph(root, classSchemas) {
  return writeGraphMulti([root], classSchemas).buf;
}

// The Contents stream is a SEQUENCE of top-level objects sharing ONE MFC index
// space. Serialize a list of roots into one buffer with a single WriteCtx so
// every cross-object ref index matches the original.
export function writeGraphMulti(roots, classSchemas) {
  const w = new Writer();
  const ctx = new WriteCtx(classSchemas);
  for (const root of roots) writeObject(w, ctx, root);
  return { buf: w.buffer(), ctx };
}

// Decode the whole Contents as a sequence of top-level objects (one shared ctx)
// until EOF or the first unmapped class. Returns the roots + the decodable prefix.
export function decodeStream(contents) {
  const r = new Reader(contents);
  const ctx = new ReadCtx(r);
  const roots = [];
  let consumed = 0, stop = null;
  try {
    while (!r.eof()) { const o = readObject(ctx); roots.push(o); consumed = r.p; }
  } catch (e) { stop = e; }
  return { roots, ctx, consumed, total: contents.length, stop };
}

// ---- verification: decode the decodable prefix, re-emit, compare byte-for-byte ----
export function reserializeCheck(contents) {
  const { roots, ctx, consumed, total, stop } = decodeStream(contents);
  const { buf: out } = writeGraphMulti(roots, ctx.classSchemas);
  const n = Math.min(out.length, consumed);
  let firstDiff = -1;
  for (let i = 0; i < n; i++) if (out[i] !== contents[i]) { firstDiff = i; break; }
  const ok = firstDiff === -1 && out.length === consumed;
  return { ok, consumed, total, outLen: out.length, firstDiff,
           lenMatch: out.length === consumed, roots: roots.length,
           frontier: stop && stop.className ? stop.className : (stop ? stop.message : null) };
}

// ---- structural edit: decode the decodable prefix, let a callback mutate the
// object graph, re-emit the prefix and append the still-undecoded tail verbatim.
// Safe for value / string-length changes that DON'T add, remove or reorder
// objects or introduce new classes (the shared MFC index space — and thus the
// untouched tail's refs — stay valid). This is the capability in-place param
// patching cannot give: changing counts, string lengths, adding equations, etc.
export function editStream(contents, mutate) {
  const { roots, ctx, consumed, total } = decodeStream(contents);
  const beforeObjs = ctx.map.filter((e) => e && e.obj).length;
  const beforeClasses = new Set(ctx.map.filter((e) => e && e.cls).map((e) => e.cls));
  mutate({ roots, ctx });
  // guard: object/class count must be unchanged so the appended tail stays valid
  const afterObjs = ctx.map.filter((e) => e && e.obj).length;
  if (afterObjs !== beforeObjs)
    throw new Error(`editStream: object count changed (${beforeObjs}->${afterObjs}); tail refs would break. Add/remove objects only when the whole stream decodes.`);
  // A changed __class that needs a brand-new newclass would shift the tail's
  // index space; the writer throws "no newclass schema recorded" if that happens
  // (classSchemas only holds classes the original stream already declared).
  void beforeClasses;
  const { buf: head } = writeGraphMulti(roots, ctx.classSchemas);
  const tail = contents.subarray(consumed, total);
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0); out.set(tail, head.length);
  return out;
}

export { WRITE_CODECS };
