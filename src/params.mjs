// cvjkit — targeted parameter scanner/editor for a .cvj Contents stream.
// Finds every CVParameter (name + value variant) by forward-parsing from each
// CF01 object header, without needing a full geometry-aware tree decode.
// Lets you change numeric/text values IN PLACE (same byte length) so the rest
// of the file is untouched and CV/S2M re-reads it. Interoperability only.
import { Reader } from './archive.mjs';

const FLOAT_TYPES = new Set([1, 2, 3, 6, 9]);   // variant payload = double
const INT_TYPES = new Set([4, 5, 7, 10]);       // variant payload = i32

// Try to parse a parameter starting at a CF01 marker. Returns descriptor or null.
function tryParam(u, pos) {
  const r = new Reader(u); r.p = pos;
  try {
    if (r.u16() !== 0xcf01) return null;         // CXBase schema
    r.u32();                                     // id
    if (!r.atCString()) return null;
    const name = r.cstring();
    if (!/^[\x20-\x7e]{1,64}$/.test(name)) return null;
    if (!r.atCString()) return null;
    r.cstring();                                 // label
    r.u32();                                      // CXBase @0x28
    if (r.u16() !== 0xe901) return null;         // CVBase schema
    r.u16(); r.u32();                            // @0x40, @0x48
    if (r.u16() !== 0xe904) return null;         // CVParameter schema
    const flags = r.u32();                       // @0x90
    r.u32();                                     // @0x78
    if (r.u16() !== 0xcf02) return null;         // value variant marker
    const typeOff = r.p;
    const type = r.u32();
    const payloadOff = r.p;
    let value;
    if (FLOAT_TYPES.has(type)) value = r.f64();
    else if (INT_TYPES.has(type)) value = r.i32();
    else return null;
    return { name, type, value, payloadOff, flags, start: pos };
  } catch { return null; }
}

// Scan the whole Contents for parameters.
export function scanParams(contents) {
  const u = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
  const out = [];
  for (let i = 0; i + 1 < u.length; i++) {
    if (u[i] === 0x01 && u[i + 1] === 0xcf) {    // 0xCF01 little-endian
      const p = tryParam(u, i);
      if (p) { out.push(p); i = p.payloadOff; }
    }
  }
  return out;
}

// Patch a parameter's numeric value in place (same byte length — no shift).
export function patchParam(contents, param, newValue) {
  const u = (contents instanceof Uint8Array ? contents : new Uint8Array(contents)).slice();
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (FLOAT_TYPES.has(param.type)) dv.setFloat64(param.payloadOff, newValue, true);
  else if (INT_TYPES.has(param.type)) dv.setInt32(param.payloadOff, newValue | 0, true);
  else throw new Error(`type ${param.type} not numerically patchable`);
  return u;
}
