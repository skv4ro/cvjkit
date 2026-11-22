// cvjkit — per-class Contents codecs, derived from format/LAYOUT.md
// (our own decompilation of CV's ::Save methods). Interoperability only.
//
// Two foundations are filled from CVBase::Save and CXObject::Serialize once
// decompiled: readCVBase() and readCXObject(). Everything else is complete.
import { registerClass, readObject } from './contents.mjs';

// ---- schema marker (CXSchema::Serialize writes a u16) ----
function schema(r) { return r.u16(); }

// ---- MtPoint3d: embedded geometry point, serialized INLINE as 3 raw f64
// (no MFC tag, no index registration). Verified: CVCabinet@0x150 = (600,862,530)mm.
function readMtPoint3d(r) { return { x: r.f64(), y: r.f64(), z: r.f64() }; }

// ---- CVCatOptions: embedded (inline) catalog-options block.
// CVCatOptions::Load = schema(E901) + u32 nOptions + nOptions×WriteObject(CVOptOption)
//                      + u32 nEffects + nEffects×WriteObject(CVOptEffect).
function readCVCatOptions(r, ctx) {
  const out = { _schema: schema(r) };          // E901
  const nOpt = r.u32();
  out.options = [];
  for (let i = 0; i < nOpt; i++) out.options.push(readObject(ctx));
  const nEff = r.u32();
  out.effects = [];
  for (let i = 0; i < nEff; i++) out.effects.push(readObject(ctx));
  return out;
}

// ---- foundations (TO FILL from decompilation) ----
// CVBase::Save writes the common object header (name/id/flags) before CVParBase.
let CVBASE_READ = null;   // (r, ctx, obj) => void
let CXOBJECT_READ = null; // (r, ctx, obj, key) => void
export function setCVBaseReader(fn) { CVBASE_READ = fn; }
export function setCXObjectReader(fn) { CXOBJECT_READ = fn; }
function readCVBase(r, ctx, obj) {
  if (!CVBASE_READ) throw new Error('CVBase layout not loaded yet');
  CVBASE_READ(r, ctx, obj);
}
function readCXObject(r, ctx, obj, key) {
  if (!CXOBJECT_READ) throw new Error('CXObject layout not loaded yet');
  CXOBJECT_READ(r, ctx, obj, key);
}

// ---- NULL-terminated child list: read objects until a null tag ----
function readNullTermList(r, ctx) {
  const out = [];
  for (;;) { const o = readObject(ctx); if (o === null) break; out.push(o); }
  return out;
}

// ---- CVParBase (E901): CVBase + schema + u16 count + that many params ----
function readCVParBase(r, ctx, obj) {
  readCVBase(r, ctx, obj);
  obj._parSchema = schema(r);          // E901
  const n = r.u16();                   // @0x58 = parameter count
  obj.params = [];
  for (let i = 0; i < n; i++) obj.params.push(readObject(ctx));
}

// ---- CVAsmBase::Load: CVParBase + schema + fields; @0x70 only if schema>2,
// shape (CVTemplate2d @0x68 via operator>>) only if schema>1. (Verified vs ::Load.)
function readCVAsmBase(r, ctx, obj) {
  readCVParBase(r, ctx, obj);
  const sch = schema(r); obj._asmSchema = sch;   // E903 (low byte = version)
  obj._v74 = r.u16();                  // @0x74
  obj._v76 = r.u16();                  // @0x76
  obj._v78 = r.u32();                  // @0x78
  obj._v80 = r.i32();                  // @0x80
  obj._v7c = r.u16();                  // @0x7c
  obj._v84 = r.u32();                  // @0x84
  obj._v88 = r.u32();                  // @0x88
  const v = sch & 0xff;
  if (v > 2) obj._v70 = r.u32();       // @0x70 (schema>2)
  if (v > 1) obj._shape = readObject(ctx); // CVTemplate2d @0x68 (schema>1)
}

// ---- CVAsmBaseEx::SaveDataAndChildren (E902): data + children ----
function readCVAsmBaseExChildren(r, ctx, obj) {
  obj._exSchema = schema(r);           // E902
  const countA = r.u16();              // @0xc4
  obj.data = [];
  for (let i = 0; i < countA; i++) obj.data.push(readObject(ctx));
  const n = r.u16() & 0xffff;          // i16 child count (non-flagged)
  obj._v44 = r.u32();
  obj.children = [];
  for (let i = 0; i < n; i++) obj.children.push(readObject(ctx));
}

// ---- CVEquation (E904): standalone ----
registerClass('CVEquation', {
  read(r, ctx, obj) {
    obj._schema = schema(r);           // E904
    obj.condition = r.cstring();       // @0x28
    obj.formula = r.cstring();         // @0x20
    obj.flag = r.u8();                 // @0x30
  },
});

// ---- CVParameter (E904): CVBase + fields + nested + equations + text ----
registerClass('CVParameter', {
  read(r, ctx, obj) {
    readCVBase(r, ctx, obj);
    obj._schema = schema(r);           // E904
    obj.flags = r.u32();               // @0x90 (written first)
    obj._v78 = r.u32();                // @0x78
    readCXObject(r, ctx, obj, 'value'); // CXObject @0x58 (the variant value)
    const nEq = obj.flags & 0xffff;    // (short)@0x90 = equation count
    obj.equations = [];
    for (let i = 0; i < nEq; i++) obj.equations.push(readObject(ctx));
    obj.options = r.cstring();         // @0x88
    obj._v96 = r.u16();                // @0x96
  },
});

// ---- CVCabinet (E901) ----
registerClass('CVCabinet', {
  read(r, ctx, obj) {
    readCVAsmBase(r, ctx, obj);
    obj._schema = schema(r);           // E901
    obj._v100 = r.u16();               // @0x100
    obj._v170 = r.u32();               // @0x170
    obj._v104 = r.u32();               // @0x104
    obj.size = readMtPoint3d(r);       // @0x150 MtPoint3d (W,H,D)
    obj.catOptions = readCVCatOptions(r, ctx); // @0x188 CVCatOptions (inline)
    obj._v260 = r.u32();               // @0x260
    obj._v264 = r.u32();               // @0x264
    obj._v10c = r.u16();               // @0x10c
    obj.pt110 = readMtPoint3d(r);      // @0x110 MtPoint3d
    obj.pt130 = readMtPoint3d(r);      // @0x130 MtPoint3d
    obj._v26c = r.u32();               // @0x26c
    readCVAsmBaseExChildren(r, ctx, obj);
  },
});

// ---- CVDataPacket (base of all *Packet): schema + u32 @0x10 ----
function readCVDataPacket(r, obj) {
  obj._dpSchema = schema(r);           // schema
  obj._dp10 = r.u32();                 // @0x10
}

// ---- CVShapePacket: base CXObject; Load folds onto CVDataPacket::Load =
// schema + u32@0x10 (the shape id; template ptr reconnected post-load). (Agent-verified.)
registerClass('CVShapePacket', { read(r, ctx, obj) { readCVDataPacket(r, obj); } });

// ---- CVHingePlate: derives from CVHardware → CVAsmBase::Load + trailing schema
// (same as the hardware family; no own body). (Agent-verified via ctor.)
registerClass('CVHingePlate', { read(r, ctx, obj) { readCVAsmBase(r, ctx, obj); obj._schema = schema(r); } });

// ---- Top-level library LISTS: their ::Load does NOT read from the Contents
// archive — it opens a SEPARATE OLE sub-stream ("Lights"/"Shapes"/"Doors"/
// "Catalogs"/"DrawManager"/…) and serializes from there. So in the Contents
// stream their body is EMPTY (only the class tag is present). (Agent-verified:
// CVLightSchedList/CVTemplateList/CVDoorDataList/CVCatalogDataListX/CVDrawManager
// all do …Load → OpenLoadArchive(doc,"<name>") → read elsewhere.)
for (const name of ['CVLightSchedList', 'CVTemplateList', 'CVDoorDataList',
                    'CVCatalogDataList', 'CVCatalogDataListX', 'CVMatDataListX',
                    'CVConstDataListX', 'CVDrawManager']) {
  registerClass(name, { read() { /* empty body in Contents — data is in its own OLE stream */ } });
}

// ---- CVBandPacket: CVDataPacket + schema + u16 + 4×f64 + optional CVTemplate2d
// CVBandPacket::Load: CVDataPacket::Load, schema, u16@0x18, f64@0x20/0x28/0x30/0x38,
//   if(@0x18 & 1) >> CVTemplate2d @0x40.
registerClass('CVBandPacket', {
  read(r, ctx, obj) {
    readCVDataPacket(r, obj);
    obj._schema = schema(r);
    obj._v18 = r.u16();                 // @0x18
    obj.b20 = r.f64(); obj.b28 = r.f64(); obj.b30 = r.f64(); obj.b38 = r.f64();
    if (obj._v18 & 1) obj.template = readObject(ctx);   // CVTemplate2d @0x40
  },
});

// ---- CVTemplate::Load: CVBase + schema + u32@0x50 + u32@0x9c + MtPoint3d@0x58 + @0x78 ----
function readCVTemplate(r, ctx, obj) {
  readCVBase(r, ctx, obj);
  obj._tSchema = schema(r);
  obj._t50 = r.u32();
  obj._t9c = r.u32();
  obj.pt58 = readMtPoint3d(r);
  obj.pt78 = readMtPoint3d(r);
}

// ---- CVTemplate2d::Load: CVTemplate + schema + f64@0xc0 + >>CXVTemplate(profile);
// if profile==null → u32 count + count×CVTemplateNode (node polygon). ----
registerClass('CVTemplate2d', {
  read(r, ctx, obj) {
    readCVTemplate(r, ctx, obj);
    obj._schema = schema(r);
    obj._c0 = r.f64();
    obj.profile = readObject(ctx);     // CXVTemplate or null
    if (obj.profile === null) {
      const n = r.u32();
      obj.nodes = [];
      for (let i = 0; i < n; i++) obj.nodes.push(readObject(ctx)); // CVTemplateNode
    }
  },
});

// ====================================================================
// 2D geometry kernel (CXVTemplate chain). Layouts from format/geom_findings.md
// (decompiled CV ::Load bodies). Reader conventions: u16 schema, 4-byte int,
// 8-byte double, tagged readObject for entities/CXIdLst/CXParameter, inline
// MtPoint2d/MtPoint3d. See that file for addresses & confidence.
// ====================================================================

// MtPoint2d: embedded 2D point, inline 2 raw f64 (x,y). (HIGH-CONFIDENCE infer;
// confirm vs XMATH MtPoint2d::Serialize.)
function readMtPoint2d(r) { return { x: r.f64(), y: r.f64() }; }

// CXProfile::LoadData (0x31010): schema + u32@0xd4 + i32 count1 + count1×entity;
// if (schema&0xff)>1 → i32 count2 + count2×entity. Entity = tagged readObject.
function readCXProfileLoadData(r, ctx, obj) {
  const s = schema(r); obj._profSchema = s;
  obj._profD4 = r.u32();
  const c1 = r.i32(); obj.entities = [];
  for (let i = 0; i < c1; i++) obj.entities.push(readObject(ctx));
  if ((s & 0xff) > 1) {
    const c2 = r.i32(); obj.entities2 = [];
    for (let i = 0; i < c2; i++) obj.entities2.push(readObject(ctx));
  }
}
// CXTemplate::LoadData (0x47b40): CXProfile::LoadData + schema + u32@0x160 + u32@0x168.
function readCXTemplateLoadData(r, ctx, obj) {
  readCXProfileLoadData(r, ctx, obj);
  obj._tmplSchema = schema(r);
  obj._t160 = r.u32();
  obj._t168 = r.u32();
}

// CXIdLst::Load (XBASE) — reference-id list. VERIFIED from bytes (satnik @231912):
//   u16 schema(0xcf01) + u32 field + u16 count + count×u64 id. (ids 2,9,10 observed.)
registerClass('CXIdLst', {
  read(r, ctx, obj) {
    obj._schema = schema(r);             // 0xcf01
    obj._v08 = r.u32();
    const n = r.count();                 // u16 count (MFC escape)
    obj.ids = [];
    for (let i = 0; i < n; i++) obj.ids.push(r.u64());
  },
});
// CXParameter::Load (XBASE) — VERIFIED from bytes (satnik @231003): a named value.
//   u16 schema(0xcf01) + CString name + u32 field + CXValue variant.
// (Read as a tagged object inside CXGeometry2d; byte-count checked for _SDEDGE
// [i32 68] and _PROFID [f64 0].)
registerClass('CXParameter', {
  read(r, ctx, obj) {
    obj._schema = schema(r);             // 0xcf01
    obj.name = r.cstring();
    obj._v10 = r.u32();                  // flags/kind (1 for _SDEDGE, 0 for _PROFID)
    obj.value = r.variant();             // CXValue (02 CF type payload)
  },
});

// CXGeometry2d::Load (0x16a10): schema + i32@0x08 + CXIdLst(tagged) + i32 pcount +
// pcount×CXParameter(tagged).
function readCXGeometry2d(r, ctx, obj) {
  obj._geomSchema = schema(r);
  obj._g08 = r.i32();
  obj.refList = readObject(ctx);         // CXIdLst (tagged)
  const pc = r.i32(); obj.cxParams = [];
  for (let i = 0; i < pc; i++) obj.cxParams.push(readObject(ctx)); // CXParameter (tagged)
}
// CXCurve2d::Load (0xa290): CXGeometry2d + schema + MtPoint2d start + MtPoint2d end.
function readCXCurve2d(r, ctx, obj) {
  readCXGeometry2d(r, ctx, obj);
  obj._curveSchema = schema(r);
  obj.start = readMtPoint2d(r);
  obj.end = readMtPoint2d(r);
}
// CXLine2d::Load (0x1bd30): CXCurve2d + trailing schema.
registerClass('CXLine2d', {
  read(r, ctx, obj) { readCXCurve2d(r, ctx, obj); obj._lineSchema = schema(r); },
});
// CXArc2d::Load (0x7ad0): CXCurve2d + schema + MtPoint2d mid.
registerClass('CXArc2d', {
  read(r, ctx, obj) { readCXCurve2d(r, ctx, obj); obj._arcSchema = schema(r); obj.mid = readMtPoint2d(r); },
});

// CXRelHelpData::Load (0x3ea70): a type-keyed union. schema + i32 type@0x08 +
// payload-by-type + ALWAYS a trailing f64@0x28. (Agent-decompiled, VERIFIED.)
function readCXRelHelpData(r) {
  const h = { _schema: schema(r), type: r.i32() };
  const t = h.type;
  if (t === 1) h.p = [r.f64(), r.f64(), r.f64()];
  else if (t === 2) h.p = [r.f64()];
  else if (t === 3 || t === 6 || t === 8) h.i = r.i32();
  else if (t === 7) h.p = [r.f64(), r.f64()];
  else if (t === 9) { h.u = r.u32(); h.f = r.f64(); }
  // default (0, 4, 5, >9): no payload
  h.trail = r.f64();                    // ALWAYS present (@0x28)
  return h;
}
// CXGRef::Load (0x19360): schema + i32 entityId@0x08 + i32@0x10 + i32@0x48 +
// CXRelHelpData@0x18 (inline). (Member type from CXGRef copy-ctor; VERIFIED.)
function readCXGRef(r) {
  return { _schema: schema(r), entityId: r.i32(), _v10: r.i32(), _v48: r.i32(),
           help: readCXRelHelpData(r) };
}
// CXGRefLst::Load (0x1a230): schema + i32 count + count×CXGRef (inline). VERIFIED.
function readCXGRefLst(r) {
  const lst = { _schema: schema(r) };
  const n = r.i32(); lst.refs = [];
  for (let i = 0; i < n; i++) lst.refs.push(readCXGRef(r));
  return lst;
}
// CXRel2d::Load (0x3beb0) — base for ALL sketch constraints. CXHorzVertRel2d and
// CXCoincidentRel2d have no own body = exactly this. (Agent-decompiled + byte-checked.)
function readCXRel2d(r, ctx, obj) {
  readCXGeometry2d(r, ctx, obj);
  const s = schema(r); obj._relSchema = s; const v = s & 0xff;
  obj._rel40 = r.u8();                 // bool @0x40
  obj.grefs = readCXGRefLst(r);        // CXGRefLst @0xb8 (inline)
  if (v > 1) { obj._e0 = r.i32(); obj._e4 = r.i32(); obj._e8 = r.i32(); obj._ec = r.i32(); obj._f0 = r.f64(); obj._f8 = r.i32(); }
  if (v >= 3) obj.relPts = [readMtPoint2d(r), readMtPoint2d(r), readMtPoint2d(r), readMtPoint2d(r)];
  if (v >= 4) { obj._a8 = r.f64(); obj._b0 = r.f64(); }
}
// Concrete constraint classes = CXRel2d::Load + a PER-CLASS trailing block
// (COMDAT-folded, so symbol search misses them). v-conditionals in readCXRel2d
// are cumulative supersets; the concrete tail is appended after. (Agent-verified.)
//   Coincident / Concentric: +0 (no override)
//   HorzVert (folded w/ Fixed): u16 schema + bool (1B)  → +3 bytes
registerClass('CXCoincidentRel2d', { read: readCXRel2d });
registerClass('CXConcentricRel2d', { read: readCXRel2d });
function readCXFixedLikeRel2d(r, ctx, obj) {
  readCXRel2d(r, ctx, obj);
  obj._ctSchema = schema(r);           // concrete-class u16 schema
  obj._ctBool = r.u8();                // bool@0x100
}
registerClass('CXHorzVertRel2d', { read: readCXFixedLikeRel2d });
registerClass('CXFixedRel2d', { read: readCXFixedLikeRel2d });
// Rarer constraint classes (ParaPerp/Angle/Radius/Ellipse*/Distance) have longer
// per-class tails documented in format/geom_findings.md; they don't appear in the
// current corpus, so register them only when a sample needs them.

// CXVTemplate::Load (CVGlue 0x17f240): CXProfile::Load(→CXTemplate::LoadData) +
// u32@0x218 + u32@0x214 + MtPoint3d@0x1c8 + MtPoint3d@0x1e8 + f64@0x208 + u32@0x214.
registerClass('CXVTemplate', {
  read(r, ctx, obj) {
    readCXTemplateLoadData(r, ctx, obj);
    obj._v218 = r.u32();
    obj._v214a = r.u32();
    obj.pt1c8 = readMtPoint3d(r);
    obj.pt1e8 = readMtPoint3d(r);
    obj._v208 = r.f64();
    obj._v214 = r.u32();
  },
});

// ---- CVVertexNode::Load: MtPoint3d(3 f64) + u32 @0x30 ----
registerClass('CVVertexNode', {
  read(r, ctx, obj) { Object.assign(obj, readMtPoint3d(r)); obj._v30 = r.u32(); },
});

// ---- CVTemplateNode::Load: CVVertexNode + schema + f64@0x38 + f64@0x40 ----
registerClass('CVTemplateNode', {
  read(r, ctx, obj) {
    Object.assign(obj, readMtPoint3d(r)); obj._v30 = r.u32(); // CVVertexNode
    obj._schema = schema(r);
    obj._n38 = r.f64();
    obj._n40 = r.f64();
  },
});

// ---- CVPathBase::Load: schema + u32 @0x08 + u32 @0x0c ----
function readCVPathBase(r, obj) {
  obj._pathSchema = schema(r);
  obj._p08 = r.u32();
  obj._p0c = r.u32();
}

// ---- CVRouteOp::Load: CVAsmBase + schema; v<2 → 2×u32, else CVPathBase::Load ----
function readRouteOp(r, ctx, obj) {
  readCVAsmBase(r, ctx, obj);
  const sch = schema(r); obj._schema = sch;
  if ((sch & 0xff) < 2) { obj._v100 = r.u32(); obj._v104 = r.u32(); }
  else readCVPathBase(r, obj);
}
registerClass('CVRouteOp', { read: readRouteOp });   // verified vs CVRouteOp::Load

// ---- CVDoor::Load: CVAsmBase + schema + COleCurrency(12B @0xe0) + children ----
registerClass('CVDoor', {
  read(r, ctx, obj) {
    readCVAsmBase(r, ctx, obj);
    obj._schema = schema(r);
    obj._currency = r.i32();            // COleCurrency m_status
    obj._currencyCur = r.u64();         // COleCurrency m_cur (CURRENCY int64)
    readCVAsmBaseExChildren(r, ctx, obj);
  },
});

// ---- CVAssembly / CVWidget (shared COMDAT): CVAsmBase + schema + children ----
registerClass('CVAssembly', {
  read(r, ctx, obj) {
    readCVAsmBase(r, ctx, obj);
    obj._schema = schema(r);
    readCVAsmBaseExChildren(r, ctx, obj);
  },
});

// ---- CVHardware: no own Load (COMDAT-folded) → inherits CVAsmBase::Load
// (derives from CVAsmBaseEx, which has no own Load). = CVAsmBase only, no children.
registerClass('CVHardware', {
  read(r, ctx, obj) { readCVAsmBase(r, ctx, obj); obj._schema = schema(r); },
});

// ---- CVAsmBaseEx-derived classes with no own Load (inherit CVAsmBase::Load
// + trailing schema). Verified for CVHardware; same shape for the hardware/face
// family. Each is validated by the probe decoding the whole corpus.
function readAsmHardware(r, ctx, obj) { readCVAsmBase(r, ctx, obj); obj._schema = schema(r); }
for (const name of ['CVLegLeveler', 'CVSmartFace', 'CVHinge', 'CVGuide', 'CVPull',
                    'CVDrawerGuide', 'CVDoorHardware', 'CVAccessory',
                    // CVOperation family: all derive from CVAsmBaseEx with no own ::Load
                    // → resolve to CVAsmBase::Load (same pattern as CVHardware). Verified
                    // by decompile (agent): machining data lives as CVParameters in the
                    // param list + optional CVTemplate2d shape. CVRouteOp is the exception.
                    'CVHoleOp', 'CVHoleMasterOp', 'CVDadoExOp', 'CVDadoExMasterOp',
                    'CVDadoMasterOp', 'CVLineboreOp', 'CVLineBoreMasterOp', 'CVLeg']) {
  registerClass(name, { read: readAsmHardware });
}

// ---- CVLineOp: derives from CVAsmBaseEx WITH data/children block (E902), unlike
// the other machining ops. Same layout as CVAssembly: CVAsmBase + schema +
// SaveDataAndChildren. (Verified: the other ops' trailing bytes are the parent's
// child list; CVLineOp owns a small, usually-empty E902 block.) ----
registerClass('CVLineOp', {
  read(r, ctx, obj) {
    readCVAsmBase(r, ctx, obj);
    obj._schema = schema(r);
    readCVAsmBaseExChildren(r, ctx, obj);
  },
});

// ---- CVWall (E901) ----
registerClass('CVWall', {
  read(r, ctx, obj) {
    readCVAsmBase(r, ctx, obj);
    obj._schema = schema(r);
    obj._d0 = r.u16(); obj._d4 = r.u16(); obj._d2 = r.u16(); obj._da = r.u16();
    obj._dc = r.u16(); obj._d6 = r.u16(); obj._d8 = r.u16();
    obj._e0 = r.u32(); obj._e8 = r.u32(); obj._de = r.u16();
    readCVAsmBaseExChildren(r, ctx, obj);
  },
});

// ---- CVWallFace (E901) ----
registerClass('CVWallFace', {
  read(r, ctx, obj) {
    readCVAsmBase(r, ctx, obj);
    obj._schema = schema(r);
    obj._d0 = r.u32(); obj._d4 = r.u32(); obj._d8 = r.u32();
    readCVAsmBaseExChildren(r, ctx, obj);
  },
});

// ---- CVFloorLevel (E903) ----
registerClass('CVFloorLevel', {
  read(r, ctx, obj) {
    readCVAsmBase(r, ctx, obj);
    obj._schema = schema(r);           // E903
    const countC = r.u16();            // @0xd8
    obj.rooms = [];
    for (let i = 0; i < countC; i++) obj.rooms.push(readObject(ctx));
    // geometry (polygons) — count D of polygon blocks
    const countD = r.u32();
    obj.polygons = [];
    for (let d = 0; d < countD; d++) {
      const nV = r.u32(); const verts = [];
      for (let v = 0; v < nV; v++) verts.push({ x: r.f64(), y: r.f64(), z: r.f64() });
      const nM = r.u32(); const loops = [];
      for (let m = 0; m < nM; m++) { const nK = r.u32(); const idx = []; for (let k = 0; k < nK; k++) idx.push(r.u32()); loops.push(idx); }
      obj.polygons.push({ verts, loops });
    }
    readCVAsmBaseExChildren(r, ctx, obj);
  },
});

// ---- CVJob (E907): CVAsmBase + job header block + DB types + children ----
// Job header block mirrors builder.writeJobHeaderBlock (from CVJob::Save analysis).
function readJobBlock(r, obj) {
  obj._jobSchema = schema(r);                 // E907
  obj.flags = [r.u16(), r.u32(), r.u32(), r.u32(), r.u32()];
  obj.unitSymbol = r.cstring();
  obj.unitName = r.cstring();
  obj.sysDef = [r.u32(), r.u32(), r.u32()];
  obj._v4bc = r.u16(); obj._v4a4 = r.u32(); obj._v3a8 = r.u16(); obj._v4b4 = r.u32();
  obj._u32s7 = Array.from({ length: 7 }, () => r.u32());
  obj._f64s7 = Array.from({ length: 7 }, () => r.f64());
  obj.texts10 = Array.from({ length: 10 }, () => r.cstring());
  const nBid = r.u16(); obj.bids = [];
  for (let i = 0; i < nBid; i++) obj.bids.push({ id: r.u32(), name: r.cstring(), flag: r.u32(), a: r.f64(), b: r.f64(), c: r.f64() });
  obj._v400 = r.u32();
  obj.texts16 = Array.from({ length: 16 }, () => r.cstring());
  obj._marker = r.u32();                       // 0xFFFFFFFF
  obj.text390 = r.cstring();
  obj.dbTypes = [r.u32(), r.u32(), r.u32(), r.u32()];
}

registerClass('CVJob', {
  read(r, ctx, obj) {
    readCVAsmBase(r, ctx, obj);
    readJobBlock(r, obj);
    readCVAsmBaseExChildren(r, ctx, obj);
  },
});

export { readCVAsmBase, readCVAsmBaseExChildren, readCVParBase, readJobBlock, schema };
