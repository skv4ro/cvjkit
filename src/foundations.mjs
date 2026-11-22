// cvjkit — foundation readers (CXBase, CVBase, CXObject) wired into the codecs.
// CVBase::Save = CXBase::Save + schema(E901) + u16@0x40 + u32@0x48  (decompiled).
// CXBase::Save and CXObject::Serialize are filled once decompiled.
import { setCVBaseReader, setCXObjectReader, schema } from './codecs.mjs';

// CXBase::Save (verified by byte trace): CF01 + u32 id + CString name + CString label + u32
function readCXBase(r, ctx, obj) {
  obj._cxSchema = schema(r);   // CF01
  obj._id = r.u32();           // CXObjectID @0xc
  obj.name = r.cstring();      // object name
  obj.label = r.cstring();     // object label/description
  obj._v28 = r.u32();          // @0x28
}

// CVBase::Save (verified from decompilation)
setCVBaseReader((r, ctx, obj) => {
  readCXBase(r, ctx, obj);
  obj._baseSchema = schema(r);   // E901
  obj._v40 = r.u16();            // @0x40
  obj._v48 = r.u32();            // @0x48
});

// CXObject::Serialize dispatches to the concrete member's serialize. For a
// parameter value (@0x58) that concrete type writes a CXValue variant
// (02 CF type payload). Verified by byte trace. Other CXObject members
// (Cabinet @0x150/@0x188/...) may differ — handled per site when reached.
setCXObjectReader((r, ctx, obj, key) => {
  obj[key] = r.variant();
});
