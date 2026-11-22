// cvjkit — .cvj (OLE + MFC CArchive) bridge. Node + browser (cfb via importmap).
import * as CFB from 'cfb';
import { Reader, Writer } from '../src/archive.mjs';

const toU8 = (x) => x instanceof Uint8Array ? x : new Uint8Array(x);

// ---- container ----
export function openContainer(data) {
  const cfb = CFB.read(toU8(data), { type: 'array' });
  const streams = [];
  for (const e of cfb.FullPaths.map((p, i) => ({ p, c: cfb.FileIndex[i] }))) {
    if (e.c && e.c.type === 2) streams.push({ name: e.p.replace(/^Root Entry[\/]/, ''), size: e.c.content.length, _content: toU8(e.c.content) });
  }
  return { cfb, streams };
}

export function getStream(container, name) {
  const s = container.streams.find((s) => s.name === name || s.name.endsWith('/' + name));
  return s ? s._content : null;
}

// Re-serialize the container unchanged (stream-level round-trip of the OLE wrapper).
export function writeContainer(container) {
  return toU8(CFB.write(container.cfb, { type: 'array' }));
}

// ---- CVJob header block (decoded from CVJob::Save analysis) ----
// Located in the Contents stream: first 0xE907 marker, then the fixed layout.
export function decodeJobHeader(contents) {
  const u = toU8(contents);
  let at = -1;
  for (let i = 0; i + 1 < u.length; i++) { if (u[i] === 0x07 && u[i + 1] === 0xe9) { at = i; break; } }
  if (at < 0) return { found: false };
  const r = new Reader(u); r.p = at + 2;
  const h = { found: true, offset: at };
  h.flags = [r.u16(), r.u32(), r.u32(), r.u32(), r.u32()];
  h.unitSymbol = r.atCString() ? r.cstring() : null;
  h.unitName = r.atCString() ? r.cstring() : null;
  try {
    h.sysDef = { v109: r.u32(), v3a2: r.u32(), v3a3: r.u32() };
    h.v4bc = r.u16(); h.v4a4 = r.u32(); h.v3a8 = r.u16(); h.v4b4 = r.u32();
    h.u32s = Array.from({ length: 7 }, () => r.u32());
    h.f64s = Array.from({ length: 7 }, () => r.f64());
    h.texts = Array.from({ length: 10 }, () => (r.atCString() ? r.cstring() : null));
  } catch { /* partial — layout can vary by schema version; keep what we have */ }
  return h;
}

// ---- high-level import ----
export function importCvj(data) {
  const container = openContainer(data);
  const contents = getStream(container, 'Contents');
  const header = contents ? decodeJobHeader(contents) : { found: false };
  return {
    container,
    streams: container.streams.map((s) => ({ name: s.name, size: s.size })),
    header,
  };
}

// ---- write-back ----
// Replace a stream's content in the container (prepares for writeContainer).
export function setStream(container, name, bytes) {
  const u = toU8(bytes);
  const idx = container.cfb.FullPaths.findIndex((p) => p === name || p.endsWith('/' + name));
  if (idx < 0) throw new Error(`stream not found: ${name}`);
  const entry = container.cfb.FileIndex[idx];
  entry.content = u; entry.size = u.length;
  const s = container.streams.find((s) => s.name === name || s.name.endsWith('/' + name));
  if (s) { s._content = u; s.size = u.length; }
  return container;
}

// In-place same-length value patch inside a stream buffer.
// kind: 'u16'|'u32'|'i32'|'f64'|'variant' ; for variant pass {type,value}.
// Returns a NEW Uint8Array (same length) — safe for byte-exact write-back.
export function patchValue(contents, offset, kind, value) {
  const u = toU8(contents).slice();
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  switch (kind) {
    case 'u16': dv.setUint16(offset, value & 0xffff, true); break;
    case 'u32': dv.setUint32(offset, value >>> 0, true); break;
    case 'i32': dv.setInt32(offset, value | 0, true); break;
    case 'f64': dv.setFloat64(offset, value, true); break;
    case 'variant': { // 02 CF type payload — patch payload only, type unchanged
      const type = dv.getUint32(offset + 2, true);
      if ([1, 2, 3, 6, 9].includes(type)) dv.setFloat64(offset + 6, value.value ?? value, true);
      else if ([4, 5, 7, 10].includes(type)) dv.setInt32(offset + 6, value.value ?? value, true);
      else throw new Error(`variant type ${type} not patchable in place`);
      break;
    }
    default: throw new Error(`unknown kind ${kind}`);
  }
  return u;
}

// Patch a CString in place only if the new string has the SAME length (chars),
// so no bytes shift. Returns new buffer or throws on length mismatch.
export function patchCStringSameLen(contents, markerOffset, newText) {
  const r = new Reader(contents); r.p = markerOffset;
  const old = r.cstring();
  if (newText.length !== old.length) throw new Error(`length differs (${old.length} -> ${newText.length}); in-place edit needs equal length`);
  const u = toU8(contents).slice();
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  // skip FF FE FF + length field to reach char data
  let p = markerOffset + 3; let n = u[p++];
  if (n === 0xff) { n = dv.getUint16(p, true); p += 2; if (n === 0xffff) { p += 4; } }
  for (let i = 0; i < newText.length; i++) dv.setUint16(p + i * 2, newText.charCodeAt(i), true);
  return u;
}

// Produce the final .cvj bytes from a container whose streams may have been edited.
export function exportCvj(container) { return writeContainer(container); }

// Stream-level byte-exact round-trip check (OLE wrapper + raw streams).
export function roundTripCheck(data) {
  const src = toU8(data);
  const container = openContainer(src);
  const out = writeContainer(container);
  // Compare by stream content (container layout may legitimately differ).
  const reparsed = openContainer(out);
  const byName = new Map(reparsed.streams.map((s) => [s.name, s._content]));
  const diffs = [];
  for (const s of container.streams) {
    const b = byName.get(s.name);
    if (!b || b.length !== s._content.length || !eq(b, s._content)) diffs.push(s.name);
  }
  return { streams: container.streams.length, mismatched: diffs };
}

function eq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
