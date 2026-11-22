// Cenotvorba (quoting): from a decoded .cvj, build a bill of materials and price.
// Board parts → face area (m²), hardware → counts, banding → edge length (m).
// Pure (Node + browser). Rates are configurable (€, shop-specific).

const IN = 25.4;
const getP = (o, n) => (o.params || []).find((p) => p.__class === 'CVParameter' && p.name === n);
const val = (p) => (p && p.value && typeof p.value === 'object' ? p.value.value : undefined);

export const DEFAULT_RATES = {
  boardPerM2: 25,          // €/m² dosky (18mm DTD, placeholder)
  bandPerM: 1.2,           // €/bm hrany (ABS)
  hinge: 2.5,              // €/ks pánt
  guide: 8,                // €/pár vedenie
  leg: 1.5,                // €/ks nožička
  hardware: 0.3,           // €/ks ostatné kovanie (spojky…)
  laborPerPart: 1.5,       // €/diel (rezanie/olepenie/vŕtanie, placeholder)
};

const HW = { CVHinge: 'hinge', CVGuide: 'guide', CVLegLeveler: 'leg', CVPull: 'hardware', CVHardware: 'hardware', CVHingePlate: 'hinge' };

// resolve the job's primary board + edge material to REAL CVData costs. Needs the
// job's "Materials" OLE stream bytes + the price snapshot (app/prices.json materials).
// Uses decor-code matching (src/matprices.mjs). Returns { board, edge } or null parts.
export function resolveMaterials(materialsBuf, pricesMap, M) {
  if (!materialsBuf || !pricesMap || !M) return { board: null, edge: null };
  const names = [...new Set(M.extractNames(materialsBuf))];
  const idx = M.priceIndex(pricesMap);
  const isBoardName = (n) => /\d{2}([.,]\d)?mm/i.test(n) && /^[0-9A-Z]/.test(n) && !/ABS|S_|_FACE|hrana|skrutk|hmozd|excenter|krytka|koliky|podper|Blum|Antaro|Legrabox|CreoBox|Box/i.test(n);
  const isEdgeName = (n) => /ABS/i.test(n) && /mm/i.test(n) && !/^S_/.test(n);
  let board = null, edge = null;
  for (const n of names) { if (!board && isBoardName(n)) { const m = M.matchPrice(n, idx); if (m && m.kind === 'board') board = { job: n, name: m.name, cost: m.cost }; } }
  for (const n of names) { if (!edge && isEdgeName(n)) { const m = M.matchPrice(n, idx); if (m) edge = { job: n, name: m.name, cost: m.cost }; } }
  return { board, edge };
}

// a leaf board part: CVAssembly with DX and a real board thickness (smallest dim 3..50mm)
export function boardParts(objs) {
  const out = [];
  for (const o of objs) {
    if (o.__class !== 'CVAssembly') continue;
    const dx = val(getP(o, 'DX')), dy = val(getP(o, 'DY')), dz = val(getP(o, 'DZ'));
    if (typeof dx !== 'number') continue;
    if ((o.children || []).some((c) => c && c.__class === 'CVAssembly' && typeof val(getP(c, 'DX')) === 'number')) continue; // not leaf
    const dims = [dx, dy, dz].map((d) => (typeof d === 'number' ? Math.abs(d) * IN : 0)).sort((a, b) => a - b);
    const [thk, w1, w2] = dims;         // thickness = smallest, face = two largest (mm)
    if (thk < 3 || thk > 50 || w1 < 20) continue;    // skip reference planes / degenerate
    out.push({ name: o.name, thk, areaM2: (w1 * w2) / 1e6, perimM: 2 * (w1 + w2) / 1000 });
  }
  return out;
}

export function priceJob(objs, rates = DEFAULT_RATES, resolved = null) {
  const boards = boardParts(objs);
  const totalAreaM2 = boards.reduce((s, b) => s + b.areaM2, 0);
  const bandM = boards.reduce((s, b) => s + b.perimM, 0);     // approx: full perimeter banded
  const hw = { hinge: 0, guide: 0, leg: 0, hardware: 0 };
  for (const o of objs) { const k = HW[o.__class]; if (k) hw[k]++; }

  // real material costs when resolved from CVData, else configurable placeholder rates
  const boardRate = resolved && resolved.board ? resolved.board.cost : rates.boardPerM2;
  const bandRate = resolved && resolved.edge ? resolved.edge.cost : rates.bandPerM;
  const boardLbl = resolved && resolved.board ? `Dosky — ${resolved.board.name.slice(0, 26)}` : 'Dosky (plocha)';
  const bandLbl = resolved && resolved.edge ? `Hrany — ${resolved.edge.name.slice(0, 26)}` : 'Olepenie hrán (odhad)';

  const lines = [
    { label: boardLbl, qty: totalAreaM2, unit: 'm²', rate: boardRate, cost: totalAreaM2 * boardRate },
    { label: bandLbl, qty: bandM, unit: 'bm', rate: bandRate, cost: bandM * bandRate },
    { label: 'Pánty', qty: hw.hinge, unit: 'ks', rate: rates.hinge, cost: hw.hinge * rates.hinge },
    { label: 'Vedenia', qty: hw.guide, unit: 'pár', rate: rates.guide, cost: hw.guide * rates.guide },
    { label: 'Nožičky', qty: hw.leg, unit: 'ks', rate: rates.leg, cost: hw.leg * rates.leg },
    { label: 'Ostatné kovanie', qty: hw.hardware, unit: 'ks', rate: rates.hardware, cost: hw.hardware * rates.hardware },
    { label: 'Práca (diely)', qty: boards.length, unit: 'diel', rate: rates.laborPerPart, cost: boards.length * rates.laborPerPart },
  ];
  const total = lines.reduce((s, l) => s + l.cost, 0);
  return { boards: boards.length, totalAreaM2, bandM, hw, lines, total, resolved, real: !!(resolved && resolved.board) };
}

export { IN };
