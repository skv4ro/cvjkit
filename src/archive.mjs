// MFC CArchive primitives for Cabinet Vision .cvj streams.
// Independent re-implementation from format analysis (interoperability only).
// Buffer-free: works in Node and the browser (DataView + Uint8Array).
//
// Encodings (little-endian):
//   int:     u8 / u16 / u32 / u64 / f64
//   CString: FF FE FF <len> <utf16le>   len = u8; if 0xFF -> u16; if 0xFFFF -> u32
//   count:   u16; if 0xFFFF -> u32
//   tag:     CArchive object-graph tags (see tag())
//   variant: 02 CF type:u32 payload (ORDX type codes 1..12)

const U16 = new TextDecoder('utf-16le');

function toU8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (Array.isArray(buf)) return Uint8Array.from(buf);
  throw new TypeError('expected Uint8Array/ArrayBuffer');
}

export class Reader {
  constructor(buf) { this.u = toU8(buf); this.dv = new DataView(this.u.buffer, this.u.byteOffset, this.u.byteLength); this.p = 0; }
  get rem() { return this.u.length - this.p; }
  eof() { return this.p >= this.u.length; }
  need(n) { if (this.p + n > this.u.length) throw new RangeError(`read past end @${this.p} (+${n}/${this.u.length})`); }

  u8()  { this.need(1); return this.u[this.p++]; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.p, true);  this.p += 4; return v; }
  u64() { this.need(8); const v = this.dv.getBigUint64(this.p, true); this.p += 8; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
  bytes(n) { this.need(n); const v = this.u.subarray(this.p, this.p + n); this.p += n; return v; }

  count() { const n = this.u16(); return n === 0xffff ? this.u32() : n; }
  peek16() { this.need(2); return this.dv.getUint16(this.p, true); }

  cstring() {
    const m0 = this.u8(), m1 = this.u8(), m2 = this.u8();
    if (m0 !== 0xff || m1 !== 0xfe || m2 !== 0xff)
      throw new Error(`not a CString @${this.p - 3}: ${m0.toString(16)} ${m1.toString(16)} ${m2.toString(16)}`);
    let n = this.u8();
    if (n === 0xff) { n = this.u16(); if (n === 0xffff) n = this.u32(); }
    const s = U16.decode(this.u.subarray(this.p, this.p + 2 * n));
    this.p += 2 * n;
    return s;
  }
  atCString() { return this.rem >= 3 && this.u[this.p] === 0xff && this.u[this.p + 1] === 0xfe && this.u[this.p + 2] === 0xff; }

  tag() {
    const w = this.u16();
    if (w === 0x0000) return { kind: 'null' };
    if (w === 0xffff) { const schema = this.u16(), len = this.u16();
      const name = String.fromCharCode(...this.u.subarray(this.p, this.p + len)); this.p += len;
      return { kind: 'newclass', schema, name }; }
    if (w === 0x7fff) { const big = this.u32();
      return (big & 0x80000000) ? { kind: 'classref', idx: big & 0x7fffffff } : { kind: 'objref', idx: big }; }
    if (w & 0x8000) return { kind: 'classref', idx: w & 0x7fff };
    return { kind: 'objref', idx: w };
  }

  variant() {
    const m = this.u16();
    if (m !== 0xcf02) throw new Error(`not a variant @${this.p - 2}: ${m.toString(16)}`);
    const type = this.u32();
    if ([1, 2, 3, 6, 9].includes(type)) return { type, value: this.f64() };
    if ([4, 5, 7, 10].includes(type)) return { type, value: this.i32() };
    if (type === 8) return { type, value: this.cstring() };
    return { type, raw: this.u32() };
  }
}

export class Writer {
  constructor() { this.parts = []; this.len = 0; }
  _push(u8) { this.parts.push(u8); this.len += u8.length; }
  _num(n, fn) { const b = new Uint8Array(n); new DataView(b.buffer)[fn](0, arguments[2], true); this._push(b); return this; }
  u8(v)  { this._push(Uint8Array.of(v & 0xff)); return this; }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 0xffff, true); this._push(b); return this; }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this._push(b); return this; }
  i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v | 0, true); this._push(b); return this; }
  u64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); this._push(b); return this; }
  f64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this._push(b); return this; }
  bytes(u8) { this._push(toU8(u8)); return this; }

  count(n) { if (n >= 0xffff) { this.u16(0xffff); this.u32(n); } else this.u16(n); return this; }

  cstring(s) {
    this.u8(0xff).u8(0xfe).u8(0xff);
    const n = s.length;
    if (n < 0xff) this.u8(n);
    else if (n < 0xffff) { this.u8(0xff); this.u16(n); }
    else { this.u8(0xff); this.u16(0xffff); this.u32(n); }
    const b = new Uint8Array(n * 2); const dv = new DataView(b.buffer);
    for (let i = 0; i < n; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
    this._push(b); return this;
  }

  variant(type, value) {
    this.u16(0xcf02).u32(type);
    if ([1, 2, 3, 6, 9].includes(type)) this.f64(value);
    else if ([4, 5, 7, 10].includes(type)) this.i32(value);
    else if (type === 8) this.cstring(value);
    else this.u32(value);
    return this;
  }

  buffer() {
    const out = new Uint8Array(this.len); let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}
