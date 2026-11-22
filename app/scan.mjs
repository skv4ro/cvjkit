// cvjkit — structural scan of the Contents (CArchive) stream.
// Enumerates class registrations (FF FF schema len ascii-name) to reveal the
// object inventory of a real job without a full per-class body parser.
const toU8 = (x) => x instanceof Uint8Array ? x : new Uint8Array(x);

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{2,40}$/;

// Scan for new-class registrations: FF FF <schema:u16> <len:u16> <len ascii>
export function scanClasses(contents) {
  const u = toU8(contents);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const hits = [];
  for (let i = 0; i + 6 < u.length; i++) {
    if (u[i] !== 0xff || u[i + 1] !== 0xff) continue;
    const schema = dv.getUint16(i + 2, true);
    const len = dv.getUint16(i + 4, true);
    if (len < 3 || len > 40 || i + 6 + len > u.length) continue;
    let name = '';
    let ok = true;
    for (let k = 0; k < len; k++) { const c = u[i + 6 + k]; if (c < 0x20 || c > 0x7e) { ok = false; break; } name += String.fromCharCode(c); }
    if (!ok || !NAME_RE.test(name)) continue;
    // schema plausibility: CV classes use high byte 0xE9 / 0xCF, or small numbers
    hits.push({ offset: i, schema, schemaHex: '0x' + schema.toString(16), name });
    i += 6 + len - 1;
  }
  return hits;
}

// Summary: unique class names with counts + first offset.
export function classInventory(contents) {
  const hits = scanClasses(contents);
  const map = new Map();
  for (const h of hits) {
    if (!map.has(h.name)) map.set(h.name, { name: h.name, schemaHex: h.schemaHex, count: 0, firstOffset: h.offset });
    map.get(h.name).count++;
  }
  return { total: hits.length, classes: [...map.values()].sort((a, b) => a.firstOffset - b.firstOffset) };
}
