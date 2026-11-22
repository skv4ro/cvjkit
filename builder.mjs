// cvjkit — .cvj builder (write path, WORK IN PROGRESS).
// Assembles an OLE container with Version / Header / Contents streams.
// The CVJob E907 header block is fully implemented (reverse of decodeJobHeader,
// from CVJob::Save analysis). The node header + child lists are stubbed and
// marked TODO until the serializer decompilation + a reference .cvj confirm them.
import * as CFB from 'cfb';
import { Writer } from '../src/archive.mjs';

// ---------- CArchive object-graph helpers ----------
// First instance of a class: FF FF schema:u16 len:u16 ascii-name  (registers class, object = counter++)
export function writeNewClass(w, name, schema) {
  w.u16(0xffff).u16(schema).u16(name.length);
  for (let i = 0; i < name.length; i++) w.u8(name.charCodeAt(i));
  return w;
}
// Reference to an already-registered class: 0x8000 | idx
export function writeClassRef(w, idx) { w.u16(0x8000 | idx); return w; }
// Reference to an existing object: idx (<0x7FFF); 0 = NULL
export function writeObjRef(w, idx) { w.u16(idx); return w; }

// ---------- CVJob E907 header block (fully known) ----------
// opts: { unitSymbol='"', unitName='mm', dbTypes=[1,1,1,1], texts10=[], texts16=[], bids=[] }
export function writeJobHeaderBlock(w, opts = {}) {
  const o = Object.assign({
    unitSymbol: '"', unitName: 'mm',
    flags: [0, 0x10001, 1, 6, 2],       // @470,@474,@478,@47c,@488 (observed sample)
    sysDef: [6, 0, 0],                   // @498,@4a0,@49c
    v4bc: 1, v4a4: 0, v3a8: 1, v4b4: 1,
    u32s7: [0, 0, 0, 0, 0, 0, 0],        // @3ac
    f64s7: [0, 0, 0, 0, 0, 0, 0],        // @3c8
    texts10: Array(10).fill(''),
    bids: [],
    v400: 0,
    texts16: Array(16).fill(''),
    text390: '',
    dbTypes: [1, 1, 1, 1],               // material, construction, door, catalog DatabaseTypeID
  }, opts);

  w.u16(0xe907);
  w.u16(o.flags[0]).u32(o.flags[1]).u32(o.flags[2]).u32(o.flags[3]).u32(o.flags[4]);
  w.cstring(o.unitSymbol).cstring(o.unitName);
  w.u32(o.sysDef[0]).u32(o.sysDef[1]).u32(o.sysDef[2]);
  w.u16(o.v4bc).u32(o.v4a4).u16(o.v3a8).u32(o.v4b4);
  for (const v of o.u32s7) w.u32(v);
  for (const v of o.f64s7) w.f64(v);
  for (const t of o.texts10) w.cstring(t);
  w.u16(o.bids.length);
  for (const b of o.bids) { w.u32(b.id ?? 0).cstring(b.name ?? '').u32(b.flag ?? 0).f64(b.a ?? 0).f64(b.b ?? 0).f64(b.c ?? 0); }
  w.u32(o.v400);
  for (const t of o.texts16) w.cstring(t);
  w.u32(0xffffffff);
  w.cstring(o.text390);
  for (const v of o.dbTypes) w.u32(v);
  return w;
}

// ---------- node header (CVAsmBase::Save) — TODO: confirm from decompilation ----------
// Observed shape of a tree node: CF01 type:u32 | CString name | CString label | u32 | E901 block | params...
// Kept minimal and flagged until CVAsmBase::Save bytes are verified.
export function writeNodeHeaderStub(w, { type = 0, name = '', label = '' } = {}) {
  w.u16(0xcf01).u32(type).cstring(name).cstring(label);
  // TODO: exact tail (E901 u32 u16 | E901 nParams:u16 | params) — fill from CVAsmBase::Save
  return w;
}

// ---------- Contents (CVJob) — scaffold ----------
export function buildContents(model = {}) {
  const w = new Writer();
  // CVSchema::Serialize writes a schema word first in CVJob::Save; placeholder:
  // TODO: prepend the exact CXSchema stream header once confirmed.
  writeJobHeaderBlock(w, model.jobHeader || {});
  // CVAsmBaseEx::SaveDataAndChildren -> 02E9 nBand:u16 [bands] nChildren:u16 u32 [children]
  w.u16(0xe902);        // 02E9 container marker (little-endian 0x02E9)
  w.u16(0);             // nBand = 0
  w.u16(0);             // nChildren = 0 (empty job)
  w.u32(0);
  // TODO: trailing job lists (CVCatalogDataList, CVMatDataListX, CVConstDataListX,
  //       CVDoorDataList, CVTemplateList, CVDrawManager) — required for CV to open.
  return w.buffer();
}

// ---------- Version stream ----------
export function buildVersion(ver = [2025, 4, 2551]) {
  const w = new Writer();
  for (const v of ver) w.u32(v);
  return w.buffer();
}

// ---------- container assembly ----------
export function buildContainer(streams) {
  const cfb = CFB.utils.cfb_new();
  for (const [name, bytes] of Object.entries(streams)) CFB.utils.cfb_add(cfb, name, bytes);
  return new Uint8Array(CFB.write(cfb, { type: 'array' }));
}

// ---------- full .cvj (scaffold) ----------
export function buildCvj(model = {}) {
  return buildContainer({
    Version: buildVersion(model.version),
    Header: new Uint8Array(0),   // TODO: theLicense::WriteData payload
    Contents: buildContents(model),
    // TODO: Materials stream (CV recomputes, but may need a skeleton)
  });
}
