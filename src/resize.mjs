// Rotation-aware cabinet resize — the construction rule, as a pure function over
// the decoded object graph (no I/O, runs in Node and the browser).
//
// Each part carries a rotation (AX,AY,AZ, multiples of 90°) that maps its local
// DX/DY/DZ onto the cabinet axes W(=X) H(=Y) D(=Z). A face dimension (spans >40%
// of its mapped axis) scales with that axis; a thickness/rail stays. Positions are
// in cabinet coords (X↔W, Y↔H, Z↔D): far-anchored shifts by Δaxis, centred by Δ/2.

const IN = 25.4, D2R = Math.PI / 180;
const EPS = 0.5 / IN, SPAN = 0.4;
const AX = ['W', 'H', 'D'];
const getP = (o, n) => (o.params || []).find((p) => p.__class === 'CVParameter' && p.name === n);
const val = (p) => (p && p.value && typeof p.value === 'object' ? p.value.value : undefined);
const setVal = (p, v) => { if (p && p.value && typeof p.value === 'object') p.value.value = v; };

export function axisMap(ax, ay, az) {
  const col = (lx, ly, lz) => {
    const cx = Math.cos(ax * D2R), sx = Math.sin(ax * D2R);
    const cy = Math.cos(ay * D2R), sy = Math.sin(ay * D2R);
    const cz = Math.cos(az * D2R), sz = Math.sin(az * D2R);
    let x = lx, y = cx * ly - sx * lz, z = sx * ly + cx * lz;         // Rx
    [x, y, z] = [cy * x + sy * z, y, -sy * x + cy * z];                // Ry
    [x, y, z] = [cz * x - sz * y, sz * x + cz * y, z];                 // Rz
    const v = [x, y, z]; let b = 0; for (let i = 1; i < 3; i++) if (Math.abs(v[i]) > Math.abs(v[b])) b = i;
    return AX[b];
  };
  return { DX: col(1, 0, 0), DY: col(0, 1, 0), DZ: col(0, 0, 1) };
}

// list the leaf parts (CVAssembly with DX, no part-children) under a decoded job
export function leafParts(objs) {
  return objs.filter((o) => o.__class === 'CVAssembly' && typeof val(getP(o, 'DX')) === 'number'
    && !(o.children || []).some((c) => c && c.__class === 'CVAssembly' && typeof val(getP(c, 'DX')) === 'number'));
}

// read the first cabinet's current size (internal inch units + mm)
export function cabinetSize(objs) {
  const cab = objs.find((o) => o.__class === 'CVCabinet');
  if (!cab) return null;
  const W = val(getP(cab, 'DX')), H = val(getP(cab, 'DY')), D = val(getP(cab, 'DZ'));
  return { cab, W, H, D, mm: { W: W * IN, H: H * IN, D: D * IN } };
}

// resize the first cabinet to target {W,H,D} given in mm (any subset; omitted = keep).
// Mutates the object graph in place. Returns { from, to, rows }.
export function resizeGraph(objs, targetMm) {
  const s = cabinetSize(objs);
  if (!s) throw new Error('no CVCabinet in job');
  const axv = { W: s.W, H: s.H, D: s.D };
  const nxt = {
    W: targetMm.W ? targetMm.W / IN : s.W,
    H: targetMm.H ? targetMm.H / IN : s.H,
    D: targetMm.D ? targetMm.D / IN : s.D,
  };
  const dlt = { W: nxt.W - axv.W, H: nxt.H - axv.H, D: nxt.D - axv.D };
  setVal(getP(s.cab, 'DX'), nxt.W); setVal(getP(s.cab, 'DY'), nxt.H); setVal(getP(s.cab, 'DZ'), nxt.D);

  const rows = [];
  for (const o of leafParts(objs)) {
    const m = axisMap(val(getP(o, 'AX')) || 0, val(getP(o, 'AY')) || 0, val(getP(o, 'AZ')) || 0);
    const row = { name: o.name, dims: {} };
    for (const dn of ['DX', 'DY', 'DZ']) {
      const p = getP(o, dn); const v = val(p); if (typeof v !== 'number') continue;
      const a = m[dn];
      const scales = v > SPAN * axv[a] && dlt[a] !== 0;
      if (scales) setVal(p, v + dlt[a]);
      row.dims[dn] = { from: v * IN, to: (scales ? v + dlt[a] : v) * IN, axis: a, scales };
    }
    for (const [pn, a] of [['X', 'W'], ['Y', 'H'], ['Z', 'D']]) {
      const p = getP(o, pn); const v = val(p); if (typeof v !== 'number') continue;
      let sh = 0;
      if (v > axv[a] / 2 + EPS && v < axv[a] + EPS) sh = dlt[a];
      else if (Math.abs(v - axv[a] / 2) < EPS) sh = dlt[a] / 2;
      if (sh) setVal(p, v + sh);
    }
    rows.push(row);
  }
  return { from: { W: axv.W * IN, H: axv.H * IN, D: axv.D * IN }, to: { W: nxt.W * IN, H: nxt.H * IN, D: nxt.D * IN }, rows };
}

export { IN };
