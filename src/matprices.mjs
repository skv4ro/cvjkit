// Match a job's materials (names from the Materials OLE stream) to real CVData
// prices (app/prices.json) by decor code. Pure (Node+browser).

// extract CV CStrings (FF FE FF + len + UTF-16LE) from a byte buffer
export function extractNames(buf) {
  const out = []; let i = 0;
  while (i < buf.length - 4) {
    if (buf[i] === 0xff && buf[i + 1] === 0xfe && buf[i + 2] === 0xff) {
      const len = buf[i + 3];
      if (len > 1 && len < 80 && i + 4 + len * 2 <= buf.length) {
        let s = '', ok = true;
        for (let j = 0; j < len; j++) { const c = buf[i + 4 + j * 2] | (buf[i + 4 + j * 2 + 1] << 8); if (c < 32 && c !== 9) { ok = false; break; } s += String.fromCharCode(c); }
        if (ok && /[A-Za-z0-9]/.test(s)) { out.push(s); i += 4 + len * 2; continue; }
      }
    }
    i++;
  }
  return out;
}
// decor code = leading tokens that look like a manufacturer code (contain a digit,
// or a short ≤3-char supplier suffix like SU/ST), stopping at the first word.
// "0197-SU-chinchilla-grey-36mm" → "0197-SU"; "H3309-ST28-dub…" → "H3309-ST28".
export const decorCode = (name) => {
  const toks = name.trim().split(/[-/ ]+/);
  const code = [];
  for (const t of toks) {
    if (/\d/.test(t) || (code.length && /^[A-Z]{1,3}$/.test(t))) code.push(t);
    else break;
  }
  return code.join('-').toUpperCase();
};

// build code → cheapest/representative price from the price map
export function priceIndex(pricesMap) {
  const byCode = new Map();
  for (const [name, cost] of Object.entries(pricesMap)) {
    const code = decorCode(name);
    if (!code) continue;
    const isBoard = /DTD|LTD|MDF|lamino|board/i.test(name);
    const isEdge = /ABS|hrana|edge|laser/i.test(name);
    const kind = isBoard ? 'board' : isEdge ? 'edge' : 'other';
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({ name, cost, kind });
  }
  return byCode;
}
// resolve a job material name → {name, cost, kind} best match (by decor code)
export function matchPrice(jobName, idx) {
  const code = decorCode(jobName);
  const cands = idx.get(code);
  if (!cands || !cands.length) return null;
  // prefer a board match for board-like job names
  const wantBoard = /DTD|LTD|mm|lamino/i.test(jobName);
  const board = cands.find((c) => c.kind === 'board');
  return (wantBoard && board) ? board : cands[0];
}
