// Nesting (cutting optimization): pack rectangular board parts onto standard
// sheets per material and report layout + waste. Shelf/guillotine FFDH with 90°
// rotation. Pure (Node + browser). A real CV/S2M-level manufacturing function.

export const DEFAULT_SHEET = { W: 2800, L: 2070, kerf: 4, trim: 10 }; // mm

// parts: [{ w, l, name, material, qty? }]  (w,l in mm)
// returns { sheets:[{material, index, W, L, used, placements:[{x,y,w,l,name,rot}]}],
//           byMaterial:{ [mat]:{ sheets, areaParts, areaSheets, wastePct } }, totalSheets }
export function nest(parts, sheet = DEFAULT_SHEET) {
  const S = { ...DEFAULT_SHEET, ...sheet };
  const usableW = S.W - 2 * S.trim, usableL = S.L - 2 * S.trim;
  // expand quantities, group by material, biggest-first
  const byMat = new Map();
  for (const p of parts) {
    const n = Math.max(1, p.qty || 1);
    for (let i = 0; i < n; i++) {
      const w = Math.min(p.w, p.l), l = Math.max(p.w, p.l);       // normalise: l = longer
      if (l > usableL && l > usableW) continue;                    // too big for any sheet — skip
      const m = p.material || 'materiál';
      if (!byMat.has(m)) byMat.set(m, []);
      byMat.get(m).push({ w, l, name: p.name || '?' });
    }
  }
  const sheets = []; const byMaterial = {};
  for (const [mat, items] of byMat) {
    items.sort((a, b) => b.l - a.l || b.w - a.w);                  // tallest first (FFDH)
    const matSheets = [];
    let areaParts = 0;
    for (const it of items) areaParts += it.w * it.l;
    // place each item; part "height" runs along sheet L, "width" along sheet W
    let sh = null, shelfY = 0, shelfX = 0, shelfH = 0;
    const newSheet = () => { sh = { material: mat, index: matSheets.length + 1, W: S.W, L: S.L, placements: [] }; matSheets.push(sh); shelfY = 0; shelfX = 0; shelfH = 0; };
    for (const it of items) {
      // orient so it fits the shelf width; prefer tall-on-shelf
      let w = it.w, l = it.l, rot = false;
      if (!sh) newSheet();
      // try current shelf (width = usableW), item needs w<=usableW; new shelf if x overflow
      const place = (W, L) => { // W across sheet, L down sheet
        if (shelfX + W + S.kerf > usableW + 0.001) { shelfY += shelfH + S.kerf; shelfX = 0; shelfH = 0; }   // next shelf
        if (shelfY + L > usableL + 0.001) { newSheet(); }
        sh.placements.push({ x: S.trim + shelfX, y: S.trim + shelfY, w: W, l: L, name: it.name, rot: W !== it.w });
        shelfX += W + S.kerf; shelfH = Math.max(shelfH, L);
      };
      // choose orientation: if the item is wider than usableW, rotate
      if (w > usableW && l <= usableW) { place(l, w); }            // rotate
      else { place(w, l); }
    }
    const areaSheets = matSheets.length * S.W * S.L;
    byMaterial[mat] = { sheets: matSheets.length, areaParts: +(areaParts / 1e6).toFixed(2), areaSheets: +(areaSheets / 1e6).toFixed(2), wastePct: areaSheets ? +(100 * (1 - areaParts / areaSheets)).toFixed(1) : 0 };
    for (const s of matSheets) { s.used = +(100 * s.placements.reduce((a, p) => a + p.w * p.l, 0) / (S.W * S.L)).toFixed(1); sheets.push(s); }
  }
  return { sheets, byMaterial, totalSheets: sheets.length, sheet: S };
}
