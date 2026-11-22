// cvjkit — original parametric cabinet model + part generator.
// All dimensions in millimetres. Coordinate frame: X = width (right),
// Y = height (up), Z = depth (into the room, away from the front).

let _id = 1;
const nextId = () => _id++;

export class Part {
  // box part: size {dx,dy,dz}, position = min corner {x,y,z}
  constructor(code, name, pos, size, material = 'Board 18') {
    this.id = nextId();
    this.code = code; this.name = name;
    this.pos = pos; this.size = size;
    this.material = material;
  }
  get volume() { return this.size.dx * this.size.dy * this.size.dz / 1e9; } // m³
  get area() { // largest face area m² (for sheet material)
    const { dx, dy, dz } = this.size;
    return Math.max(dx * dy, dy * dz, dx * dz) / 1e6;
  }
}

// Cabinet type catalogue. Every type is an original branch of the generator.
//   base   — standard floor cabinet with toe kick + doors (the original).
//   wall   — upper/wall cabinet: no toe, shallower, mounted high on the wall.
//   tall   — full-height pantry/larder: toe + many shelves + tall doors.
//   drawer — floor cabinet whose front is N stacked drawers (no doors).
export const CABINET_TYPES = ['base', 'wall', 'tall', 'drawer', 'sink', 'corner', 'open'];

export const TYPE_LABEL = {
  base: 'Spodná skrinka', wall: 'Horná skrinka',
  tall: 'Vysoká skrinka', drawer: 'Zásuvková skrinka',
  sink: 'Drezová skrinka', corner: 'Rohová skrinka', open: 'Otvorená polica',
};

// Per-type default placement height off the floor (mm). Wall cabinets hang high.
export const TYPE_Y = { base: 0, wall: 1450, tall: 0, drawer: 0, sink: 0, corner: 0, open: 1450 };

// Per-type parameter overrides on top of the shared base defaults.
const TYPE_DEFAULTS = {
  base:   { toe: 100, shelves: 1, doors: 2 },
  wall:   { D: 320, toe: 0, shelves: 2, doors: 2, topType: 'full' },
  tall:   { H: 2000, toe: 100, shelves: 4, doors: 2 },
  drawer: { toe: 100, shelves: 0, doors: 0, drawers: 3 },
  sink:   { W: 800, toe: 100, shelves: 0, doors: 2 },          // drez nad, bez police
  corner: { W: 900, D: 900, toe: 100, shelves: 1, doors: 1 },  // rohová (štvorec)
  open:   { D: 300, toe: 0, shelves: 3, doors: 0, topType: 'full' }, // otvorená polica
};

// Construction method (konštrukcia): the configurable rule-set that drives how
// every cabinet is generated. A profile is applied globally (room.construction)
// and inherited by each cabinet's params; per-cabinet overrides still win. These
// keys are the ones generate() actually reads, so changing the profile changes
// the parts, dimensions, joints, back and banding — the CV "construction" layer.
export const CONSTRUCTION_KEYS = ['T', 'BT', 'backInset', 'backJoint', 'toe', 'toeSetback', 'doorGap', 'doorOverlay', 'stretcherW', 'shelfSetback'];
export const DEFAULT_CONSTRUCTION = {
  name: 'Štandard 18', T: 18, BT: 6, backInset: 12, backJoint: 'applied',
  toe: 100, toeSetback: 50, doorGap: 3, doorOverlay: 'overlay', stretcherW: 80, shelfSetback: 20,
  joint: 'minifix', bandDoor: 'ABS 2mm', bandCarcass: 'ABS 0.8mm',
};
export function constructionFrom(profile) {   // pick only the keys generate() reads
  const out = {}; for (const k of CONSTRUCTION_KEYS) if (profile[k] != null) out[k] = profile[k]; return out;
}

export class Cabinet {
  constructor(opts = {}) {
    this.id = nextId();
    this.type = CABINET_TYPES.includes(opts.type) ? opts.type : 'base';
    this.name = opts.name || TYPE_LABEL[this.type] || 'Cabinet';
    // position of the cabinet's front-bottom-left corner in the room (mm)
    this.x = opts.x ?? 0;
    this.y = opts.y ?? TYPE_Y[this.type] ?? 0;
    this.z = opts.z ?? 0;
    this.params = Object.assign({
      W: 600, H: 720, D: 560,      // carcass width / height / depth
      T: 18,                        // board thickness
      BT: 6,                        // back thickness
      backInset: 12,                // back set in from rear edge
      toe: 100,                     // toe kick height (0 = no toe)
      toeSetback: 50,               // toe recess from front
      shelves: 1,                   // number of adjustable shelves
      shelfSetback: 20,             // shelf set back from front
      topType: 'stretchers',        // 'full' | 'stretchers'
      stretcherW: 80,               // stretcher width (front/back)
      doors: 1,                     // 0,1,2 door leaves
      doorGap: 3,                   // gap/reveal around doors
      doorOverlay: 'overlay',       // 'overlay' (front cover) | 'inset' (fronty v korpuse)
      backJoint: 'applied',         // 'applied' (nabitý) | 'groove' (do drážky) | 'rebate' (falc)
      drawers: 3,                   // drawer count (drawer type, 1–5)
      doorStyle: 'slab',            // 'slab' | 'shaker' | 'raised' | 'glass' (vzhľad frontu)
      handle: 'bar',                // 'bar' | 'knob' | 'gola' | 'none' (typ úchytky)
      material: 'Board 18',
    }, TYPE_DEFAULTS[this.type] || {}, opts.params || {});
    this.partCad = opts.partCad || {};       // per-part drilling/cutouts, keyed by code+index (survives regen)
    this.customParts = opts.customParts || []; // user-added rectangular panels {code,name,pos,size,material}
    this.sys32 = opts.sys32 || false;        // 32 mm system holes on side panels
    this.rot = ((opts.rot || 0) % 360 + 360) % 360; // 0/90/180/270 — for L/U layouts
    this.cvParts = opts.cvParts || null;             // CV-exact parts (from CVData template), reparametrized
    this.cvDef = opts.cvDef || null;                 // their default W/H/D
    this.joinery = opts.joinery || false;            // show carcass connectors
    this.joineryType = opts.joineryType || 'minifix'; // 'minifix' | 'dowel' | 'confirmat'
    this.hwDrill = opts.hwDrill || false;            // auto hinge/runner drilling
    this.parts = [];
    this.generate();
  }

  setRot(deg) { this.rot = ((deg % 360) + 360) % 360; return this; }

  // Carcass connectors (spojovacia technika): where each horizontal panel
  // (bottom/top/stretcher) meets a side, 2 connectors along the depth. Returns
  // cabinet-local points {x,y,z,type} rendered inside the cabinet group.
  connectors() {
    if (!this.joinery) return [];
    const p = this.params, T = p.T, W = p.W;
    const out = [];
    for (const pt of this.parts) {
      if (!['BO', 'TO', 'ST'].includes(pt.code)) continue;
      const y = pt.pos.y + pt.size.dy / 2;
      const inset = Math.min(60, pt.size.dz / 3);
      const zs = [...new Set([Math.round(pt.pos.z + inset), Math.round(pt.pos.z + pt.size.dz - inset)])];
      for (const x of [T / 2, W - T / 2]) for (const z of zs) out.push({ x, y, z, type: this.joineryType });
    }
    return out;
  }

  // Auto hardware drilling: ⌀35 hinge cup bores on doors (2–3 by height, 22 mm
  // from the hinge edge) + ⌀5 hinge-plate holes on the matching side. Tagged
  // hw:true so toggling off leaves manual/system holes. Flows to DXF/G-code/CSV.
  applyHardwareDrilling(on = this.hwDrill) {
    this.hwDrill = !!on;
    for (const pt of this.parts) { if (pt.cad) pt.cad.drilling = (pt.cad.drilling || []).filter((h) => !h.hw); }
    if (!this.hwDrill) return this;
    for (const pt of this.parts) {
      if (pt.code !== 'DOR') continue;
      const F = partFace(pt.size);                              // u = height usually, v = width
      // door face: width = min(dx,dy) side? use dx as width, dy as height for a front panel
      const W = pt.size.dx, H = pt.size.dy;
      const left = !/R\b|R$/.test(pt.name);                     // 'Door R' hinges right, else left
      const ex = 22;                                            // cup centre from hinge edge
      const ys = H > 1200 ? [100, H / 2, H - 100] : [100, H - 100];
      // NOTE: drilling coords are in partFace (u,v); for a door uAxis=height, vAxis=width
      const toUV = (xWidth, yHeight) => (F.uLen === H ? { x: yHeight, y: xWidth } : { x: xWidth, y: yHeight });
      for (const y of ys) { const p = toUV(left ? ex : W - ex, y); pt.cad.drilling.push({ x: Math.round(p.x), y: Math.round(p.y), d: 35, hw: true }); }
    }
    // drawer runner screw holes on the sides (⌀4 at each drawer height, front+back)
    if (this.type === 'drawer') {
      const fronts = this.parts.filter((p) => p.code === 'DF');
      for (const side of this.parts.filter((p) => p.code === 'LF' || p.code === 'RF')) {
        const F = partFace(side.size);                         // u = height, v = depth
        for (const df of fronts) {
          const yc = Math.round(df.pos.y + df.size.dy / 2);
          for (const v of [37, Math.round(F.vLen - 37)]) side.cad.drilling.push({ x: yc, y: v, d: 4, hw: true });
        }
      }
    }
    return this;
  }

  // 32 mm system: two vertical rows of ⌀5 holes at 32 mm pitch on each side
  // panel (front + back row). Tagged sys:true so toggling off leaves manual
  // holes untouched. Reapplied after every regen so it tracks dimensions.
  applySystem32(on = this.sys32) {
    this.sys32 = !!on;
    for (const pt of this.parts) {
      if (!pt.cad) continue;
      pt.cad.drilling = (pt.cad.drilling || []).filter((h) => !h.sys);
      if (this.sys32 && (pt.code === 'LF' || pt.code === 'RF')) {
        const F = partFace(pt.size);                 // u = height, v = depth (for a side panel)
        const front = 37, back = 37, dia = 5, pitch = 32;
        for (const v of [front, Math.round(F.vLen - back)])
          for (let u = 96; u <= F.uLen - 64; u += pitch) pt.cad.drilling.push({ x: Math.round(u), y: v, d: dia, sys: true });
      }
    }
    return this;
  }

  // switch cabinet type, re-applying that type's sensible defaults where the
  // user has not overridden them, then regenerate parts.
  setType(type) {
    if (!CABINET_TYPES.includes(type) || type === this.type) return this;
    this.type = type;
    Object.assign(this.params, TYPE_DEFAULTS[type] || {});
    if (TYPE_Y[type] != null) this.y = TYPE_Y[type];
    this.generate();
    return this;
  }

  setParam(k, v) { this.params[k] = v; this.generate(); return this; }

  // --- generator: carcass -> parts (original, rule-based) ---
  // Build parts from CV-exact template parts, reparametrized to current W/H/D
  // (scale the two face dims + position per axis; keep the thickness dim fixed).
  _buildFromCv() {
    const { W, H, D } = this.params, d = this.cvDef;
    const R = [W / d.W, H / d.H, D / d.D];
    return this.cvParts.map((cp) => {
      const s = cp.s.slice(), pos = cp.p.slice();
      for (let i = 0; i < 3; i++) { if (i !== cp.t) s[i] = s[i] * R[i]; pos[i] = pos[i] * R[i]; }
      return new Part(cp.c || 'PART', cp.n || 'Diel', { x: pos[0], y: pos[1], z: pos[2] }, { dx: s[0], dy: s[1], dz: s[2] }, this.params.material);
    });
  }
  // CV parts are reliable only when positions are distinct and not stacked at origin
  _cvUsable() {
    if (!this.cvParts || this.cvParts.length < 3 || !this.cvDef) return false;
    const seen = new Set(); let origin = 0;
    for (const cp of this.cvParts) { const k = cp.p.map((x) => Math.round(x)).join(','); if (seen.has(k)) return false; seen.add(k); if (k === '0,0,0') origin++; }
    return origin <= 1;
  }

  generate() {
    const p = this.params;
    const mat = p.material;
    // CV-exact template parts (from CVData) take precedence when reliable
    if (this.cvParts && this._cvUsable()) {
      const cvp = this._buildFromCv();
      const idx = {};
      for (const pt of cvp) { const i = idx[pt.code] || 0; idx[pt.code] = i + 1; pt.key = pt.code + i; pt.cad = this.partCad[pt.key] || (this.partCad[pt.key] = { drilling: [], cutouts: [] }); if (!pt.cad.drilling) pt.cad.drilling = []; if (!pt.cad.cutouts) pt.cad.cutouts = []; }
      this.parts = cvp;
      if (this.sys32) this.applySystem32(true);
      if (this.hwDrill) this.applyHardwareDrilling(true);
      return cvp;
    }
    const parts = [];
    const toe = (this.type === 'wall') ? 0 : Math.max(0, p.toe | 0);
    const carcassH = p.H - toe;             // carcass sits on toe
    const y0 = toe;                          // carcass bottom
    const innerW = p.W - 2 * p.T;
    const carcassD = p.D;
    const ctx = { toe, carcassH, y0, innerW, carcassD };

    // Sides (LF / RF): full depth, carcass height
    parts.push(new Part('LF', 'Left side',  { x: 0,        y: y0, z: 0 }, { dx: p.T, dy: carcassH, dz: carcassD }, mat));
    parts.push(new Part('RF', 'Right side', { x: p.W - p.T, y: y0, z: 0 }, { dx: p.T, dy: carcassH, dz: carcassD }, mat));

    // Bottom (BO)
    parts.push(new Part('BO', 'Bottom', { x: p.T, y: y0, z: 0 }, { dx: innerW, dy: p.T, dz: carcassD }, mat));

    // Top: full panel or two stretchers
    const topY = y0 + carcassH - p.T;
    if (p.topType === 'full') {
      parts.push(new Part('TO', 'Top', { x: p.T, y: topY, z: 0 }, { dx: innerW, dy: p.T, dz: carcassD }, mat));
    } else {
      parts.push(new Part('ST', 'Stretcher front', { x: p.T, y: topY, z: 0 },
        { dx: innerW, dy: p.T, dz: p.stretcherW }, mat));
      parts.push(new Part('ST', 'Stretcher back', { x: p.T, y: topY, z: carcassD - p.stretcherW },
        { dx: innerW, dy: p.T, dz: p.stretcherW }, mat));
    }

    // Back (UB): inset from rear
    // Back (UB) — attachment per construction backJoint
    const bj = p.backJoint || 'applied';
    let backZ, backX = p.T, backW = innerW;
    if (bj === 'groove') { backZ = carcassD - 13 - p.BT; backX = p.T - 6; backW = innerW + 12; }   // let into 6 mm grooves
    else if (bj === 'rebate') { backZ = carcassD - p.BT; }                                         // in a rear rebate
    else { backZ = carcassD - p.backInset - p.BT; }                                                // applied, inset
    const back = new Part('UB', 'Back', { x: backX, y: y0 + p.T, z: backZ }, { dx: backW, dy: carcassH - 2 * p.T, dz: p.BT }, mat);
    back.joint = bj;
    parts.push(back);

    // Toe kick (TK) — base / tall / drawer only
    if (toe > 0) {
      parts.push(new Part('TK', 'Toe kick', { x: p.T, y: 0, z: p.toeSetback },
        { dx: innerW, dy: toe, dz: p.T }, mat));
    }

    if (this.type === 'drawer') {
      this._genDrawers(parts, ctx);
    } else {
      this._genShelves(parts, ctx);
      this._genDoors(parts, ctx);
    }

    // user-added custom panels (optionally a non-rectangular outline)
    for (const cp of this.customParts || []) {
      const part = new Part(cp.code || 'CUST', cp.name || 'Vlastný diel', { ...cp.pos }, { ...cp.size }, cp.material || mat);
      part.shape = cp.shape || 'rect'; part.notch = cp.notch; part.clip = cp.clip;
      parts.push(part);
    }

    // stable per-part key (code + ordinal) + attach persistent CAD (drilling/cutouts)
    const idx = {};
    for (const pt of parts) {
      const i = idx[pt.code] || 0; idx[pt.code] = i + 1;
      pt.key = pt.code + i;
      pt.cad = this.partCad[pt.key] || (this.partCad[pt.key] = { drilling: [], cutouts: [] });
      if (!pt.cad.drilling) pt.cad.drilling = [];
      if (!pt.cad.cutouts) pt.cad.cutouts = [];
    }
    this.parts = parts;
    if (this.sys32) this.applySystem32(true);        // keep system holes in sync with dimensions
    if (this.hwDrill) this.applyHardwareDrilling(true);
    return parts;
  }

  // add a custom rectangular panel to this cabinet (persists across regen)
  addCustomPart(spec = {}) {
    const cp = { code: 'CUST', name: spec.name || 'Vlastný diel',
      pos: spec.pos || { x: 0, y: 0, z: -60 }, size: spec.size || { dx: 300, dy: 300, dz: 18 }, material: spec.material,
      shape: spec.shape || 'rect', notch: spec.notch, clip: spec.clip };
    this.customParts.push(cp); this.generate(); return cp;
  }

  // Adjustable shelves (SH)
  _genShelves(parts, { y0, carcassH, innerW, carcassD }) {
    const p = this.params, mat = p.material;
    const n = Math.max(0, p.shelves | 0);
    const freeH = carcassH - 2 * p.T;
    for (let i = 0; i < n; i++) {
      const sy = y0 + p.T + freeH * (i + 1) / (n + 1);
      parts.push(new Part('SH', `Shelf ${i + 1}`, { x: p.T, y: sy, z: 0 },
        { dx: innerW, dy: p.T, dz: carcassD - p.shelfSetback }, mat));
    }
  }

  // Doors (DOR): overlay (cover the carcass front) or inset (flush inside the
  // carcass opening) — driven by the construction profile's doorOverlay.
  _genDoors(parts, { y0, carcassH }) {
    const p = this.params;
    const d = Math.max(0, Math.min(2, p.doors | 0));
    if (d <= 0) return;
    const g = p.doorGap, T = p.T, doorMat = p.material + ' door';
    const inset = (p.doorOverlay === 'inset');
    // inset: doors fit the opening between sides/top/bottom, flush at z 0..T.
    // overlay: doors cover the whole front, proud at z −T..0.
    const x0 = inset ? T + g : g;
    const spanW = inset ? (p.W - 2 * T - 2 * g) : (p.W - 2 * g);          // total door width
    const doorY = inset ? y0 + T + g : y0 + g;
    const doorH = inset ? carcassH - 2 * T - 2 * g : carcassH - 2 * g;
    const doorZ = inset ? 0 : -T;
    if (d === 1) {
      parts.push(new Part('DOR', 'Door', { x: x0, y: doorY, z: doorZ }, { dx: spanW, dy: doorH, dz: T }, doorMat));
    } else {
      const leafW = (spanW - g) / 2;
      parts.push(new Part('DOR', 'Door L', { x: x0, y: doorY, z: doorZ }, { dx: leafW, dy: doorH, dz: T }, doorMat));
      parts.push(new Part('DOR', 'Door R', { x: x0 + leafW + g, y: doorY, z: doorZ }, { dx: leafW, dy: doorH, dz: T }, doorMat));
    }
  }

  // Drawer stack: N equal fronts (DF) + a box of 4 sides (DB) and a bottom (DBO)
  _genDrawers(parts, { y0, carcassH, innerW, carcassD }) {
    const p = this.params;
    const dmat = p.material + ' drawer';
    const N = Math.max(1, Math.min(5, p.drawers | 0 || 1));
    const g = p.doorGap;
    const fh = (carcassH - (N + 1) * g) / N;      // one drawer-front height
    const side = 13;                               // runner clearance per side
    const boxW = innerW - 2 * side;                // outer box width
    const boxD = Math.max(100, carcassD - p.backInset - p.BT - 30);
    const boxH = Math.max(60, fh - 60);            // box lower than the front
    const bx = p.T + side;                         // box left (room-local via cabinet)
    const bz = 15;                                 // box set back from front face

    for (let i = 0; i < N; i++) {
      const fy = y0 + g + i * (fh + g);            // front bottom
      const by = fy + 20;                          // box bottom

      // Drawer front (DF) — on the front face like a door
      parts.push(new Part('DF', `Drawer front ${i + 1}`, { x: g, y: fy, z: -p.T },
        { dx: p.W - 2 * g, dy: fh, dz: p.T }, dmat));

      // Drawer box: left + right sides, front + back, all code DB
      parts.push(new Part('DB', `Drawer ${i + 1} side L`, { x: bx, y: by, z: bz },
        { dx: p.T, dy: boxH, dz: boxD }, dmat));
      parts.push(new Part('DB', `Drawer ${i + 1} side R`, { x: bx + boxW - p.T, y: by, z: bz },
        { dx: p.T, dy: boxH, dz: boxD }, dmat));
      parts.push(new Part('DB', `Drawer ${i + 1} front`, { x: bx + p.T, y: by, z: bz },
        { dx: boxW - 2 * p.T, dy: boxH, dz: p.T }, dmat));
      parts.push(new Part('DB', `Drawer ${i + 1} back`, { x: bx + p.T, y: by, z: bz + boxD - p.T },
        { dx: boxW - 2 * p.T, dy: boxH, dz: p.T }, dmat));

      // Drawer box bottom (DBO)
      parts.push(new Part('DBO', `Drawer ${i + 1} bottom`, { x: bx, y: by, z: bz },
        { dx: boxW, dy: p.BT, dz: boxD }, dmat));
    }
  }

  partCount() { return this.parts.length; }
}

// Edge banding (olepovanie hrán): which edges of a sheet part get banded, by
// part code. Visible fronts (doors/drawer fronts) are banded on all 4 edges;
// shelves/sides/tops/bottoms on the front edge only; structural/hidden parts
// (back, stretchers, toe, drawer box) none. Returns banded edge count, total
// banded length (mm) and the banding material — consumed by cut-list/labels/report.
const BAND_RULES = { DOR: 4, DF: 4, SH: 1, LF: 1, RF: 1, BO: 1, TO: 1 };
export function partBanding(part) {
  const edges = BAND_RULES[part.code] || 0;
  if (!edges) return { edges: 0, mm: 0, desc: '—', material: '' };
  const [a, b] = [part.size.dx, part.size.dy, part.size.dz].sort((x, y) => y - x);
  const mm = edges === 4 ? 2 * (a + b) : a;                 // perimeter of face, or one front edge
  return { edges, mm: Math.round(mm), desc: edges === 4 ? '4 hrany' : 'čelo', material: 'ABS 2mm' };
}

// Largest face of a panel for the part CAD editor: thinnest dim = thickness
// (normal/n), the two remaining are u (longer, horizontal) and v (vertical).
// Axis letters map dx→x, dy→y, dz→z so the 3D view can place holes/cutouts.
export function partFace(size) {
  const dims = [['dx', size.dx], ['dy', size.dy], ['dz', size.dz]].sort((a, b) => a[1] - b[1]);
  const n = dims[0];                                 // thinnest = thickness/normal
  const rest = [dims[1], dims[2]].sort((a, b) => b[1] - a[1]);
  const L = { dx: 'x', dy: 'y', dz: 'z' };
  return { u: rest[0][0], v: rest[1][0], n: n[0], uAxis: L[rest[0][0]], vAxis: L[rest[1][0]], nAxis: L[n[0]],
    uLen: rest[0][1], vLen: rest[1][1], nLen: n[1] };
}

// Outline polygon of a shaped front panel's face (local x,y mm; width=dx,
// height=dy, thickness=dz) for atypical shapes: 'rect' (default), 'lcut'
// (L-notch at top-right) or 'angle' (clipped top-right corner). Consumed by the
// 3D view, the CAD drawing and the DXF export.
export function partOutline(part) {
  const u = part.size.dx, v = part.size.dy;
  const sh = part.shape || 'rect';
  if (sh === 'lcut') { const nw = (part.notch && part.notch.w) || Math.round(u * 0.4), nh = (part.notch && part.notch.h) || Math.round(v * 0.4);
    return [[0, 0], [u, 0], [u, v - nh], [u - nw, v - nh], [u - nw, v], [0, v]]; }
  if (sh === 'angle') { const c = part.clip || Math.round(Math.min(u, v) * 0.4);
    return [[0, 0], [u, 0], [u, v - c], [u - c, v], [0, v]]; }
  if (sh === 'round') {                                     // rounded-corner rectangle (arc-sampled polygon)
    const r = part.radius || Math.round(Math.min(u, v) * 0.2), seg = 6, pts = [];
    const arc = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (Math.PI / 2) * (i / seg); pts.push([+(cx + r * Math.cos(a)).toFixed(1), +(cy + r * Math.sin(a)).toFixed(1)]); } };
    arc(r, r, Math.PI); arc(u - r, r, -Math.PI / 2); arc(u - r, v - r, 0); arc(r, v - r, Math.PI / 2);
    return pts;
  }
  return [[0, 0], [u, 0], [u, v], [0, v]];
}

// Axis-aligned world footprint of a cabinet (rot = 0/90/180/270). Width/depth
// swap for 90/270. Used by the worktop builder and the 2D plan.
export function cabFootprint(c) {
  const W = c.params.W, D = c.params.D, rot = ((c.rot || 0) % 360 + 360) % 360;
  if (rot === 90 || rot === 270) return { x0: c.x, z0: c.z, x1: c.x + D, z1: c.z + W, rot };
  return { x0: c.x, z0: c.z, x1: c.x + W, z1: c.z + D, rot };
}

// 3D transform for a cabinet: group rotation (rad about Y) + position so the
// rotated local box [0..W]×[0..D] lands on the footprint corner at (x,z).
export function cabTransform(c) {
  const W = c.params.W, D = c.params.D, rot = ((c.rot || 0) % 360 + 360) % 360;
  if (rot === 90) return { ry: -Math.PI / 2, px: c.x + D, py: c.y, pz: c.z };
  if (rot === 180) return { ry: Math.PI, px: c.x + W, py: c.y, pz: c.z + D };
  if (rot === 270) return { ry: Math.PI / 2, px: c.x, py: c.y, pz: c.z + W };
  return { ry: 0, px: c.x, py: c.y, pz: c.z };
}

// Worktop (pracovná doska): slabs over runs of adjacent floor cabinets, now
// orientation-aware so L/U layouts get a worktop on every wall. Groups by
// rotation + top height + lane, merges along the run axis, adds a front
// overhang on the correct side, and punches sink/hob cutouts.
const WORKTOP_FLOOR = new Set(['base', 'sink', 'drawer', 'corner']);
export function computeWorktops(room, opts = {}) {
  const thick = opts.thickness ?? 38;
  const over = opts.overhang ?? 20;
  const mat = opts.material || 'Pracovná doska';
  const cabs = room.cabinets.filter((c) => WORKTOP_FLOOR.has(c.type));
  const groups = new Map();
  for (const c of cabs) {
    const rot = ((c.rot || 0) % 360 + 360) % 360;
    const fp = cabFootprint(c);
    const topY = Math.round(c.y + c.params.H);
    const horiz = (rot === 0 || rot === 180);               // run along X (else along Z)
    const lane = horiz ? `${Math.round(fp.z0)}/${Math.round(fp.z1)}` : `${Math.round(fp.x0)}/${Math.round(fp.x1)}`;
    const key = `${rot}|${topY}|${lane}`;
    (groups.get(key) || groups.set(key, []).get(key)).push({ fp, rot, topY, horiz });
  }
  const runs = [];
  for (const [, list] of groups) {
    const { rot, topY, horiz } = list[0];
    list.sort((a, b) => (horiz ? a.fp.x0 - b.fp.x0 : a.fp.z0 - b.fp.z0));
    let run = null; const flush = () => { if (run) runs.push(run); run = null; };
    for (const it of list) {
      const a0 = horiz ? it.fp.x0 : it.fp.z0, a1 = horiz ? it.fp.x1 : it.fp.z1;
      const b0 = horiz ? it.fp.z0 : it.fp.x0, b1 = horiz ? it.fp.z1 : it.fp.x1;
      if (run && a0 <= run.a1 + 2) { run.a1 = Math.max(run.a1, a1); run.b0 = Math.min(run.b0, b0); run.b1 = Math.max(run.b1, b1); }
      else { flush(); run = { a0, a1, b0, b1, rot, topY, horiz }; }
    }
    flush();
  }
  const CUT_RIM = { drez: 40, doska: 30 };
  return runs.map((r) => {
    let x0, z0, x1, z1;
    if (r.horiz) { x0 = r.a0; x1 = r.a1; z0 = r.b0; z1 = r.b1; } else { z0 = r.a0; z1 = r.a1; x0 = r.b0; x1 = r.b1; }
    if (r.rot === 0) z0 -= over; else if (r.rot === 180) z1 += over; else if (r.rot === 90) x1 += over; else if (r.rot === 270) x0 -= over;
    const pos = { x: x0, y: r.topY, z: z0 }, size = { dx: x1 - x0, dy: thick, dz: z1 - z0 };
    const cutouts = [];
    for (const ap of room.appliances || []) {
      const rim = CUT_RIM[ap.type]; if (rim == null) continue;
      const ax0 = ap.x, ax1 = ap.x + ap.size.dx, az0 = ap.z, az1 = ap.z + ap.size.dz;
      if (ax1 <= pos.x || ax0 >= pos.x + size.dx || az1 <= pos.z || az0 >= pos.z + size.dz) continue;
      const cx = Math.max(0, ax0 + rim - pos.x), cz = Math.max(0, az0 + rim - pos.z);
      const cw = Math.min(pos.x + size.dx, ax1 - rim) - (pos.x + cx);
      const cd = Math.min(pos.z + size.dz, az1 - rim) - (pos.z + cz);
      if (cw > 20 && cd > 20) cutouts.push({ x: Math.round(cx), z: Math.round(cz), w: Math.round(cw), d: Math.round(cd), kind: ap.type, name: ap.name });
    }
    const length = Math.round(r.horiz ? size.dx : size.dz), depth = Math.round(r.horiz ? size.dz : size.dx);
    return { pos, size, material: mat, length, depth, thickness: thick, cutouts };
  });
}

export class Wall {
  constructor(x1, z1, x2, z2, height = 2440, thickness = 100) {
    this.id = nextId();
    this.a = { x: x1, z: z1 }; this.b = { x: x2, z: z2 };
    this.height = height; this.thickness = thickness;
  }
  get length() { return Math.hypot(this.b.x - this.a.x, this.b.z - this.a.z); }
  get angle() { return Math.atan2(this.b.z - this.a.z, this.b.x - this.a.x); }
}

// Appliances (spotrebiče) — standalone objects placed in the kitchen, not
// cabinets. Standard EU sizes (mm). y = height off floor (hob/sink sit on the
// worktop ~758, built-ins mid-height, fridge/dishwasher on the floor).
export const APPLIANCE_TYPES = ['drez', 'doska', 'rura', 'chladnicka', 'umyvacka', 'digestor'];
export const APPLIANCE_LABEL = {
  drez: 'Drez', doska: 'Varná doska', rura: 'Rúra',
  chladnicka: 'Chladnička', umyvacka: 'Umývačka', digestor: 'Digestor',
};
const APPLIANCE_DEF = {
  drez:       { dx: 800, dy: 180, dz: 500, y: 740 },
  doska:      { dx: 600, dy: 60,  dz: 520, y: 758 },
  rura:       { dx: 595, dy: 595, dz: 560, y: 850 },
  chladnicka: { dx: 600, dy: 1800, dz: 600, y: 0 },
  umyvacka:   { dx: 600, dy: 820, dz: 570, y: 0 },
  digestor:   { dx: 600, dy: 380, dz: 300, y: 1500 },
};
export class Appliance {
  constructor(opts = {}) {
    this.id = nextId();
    this.type = APPLIANCE_TYPES.includes(opts.type) ? opts.type : 'drez';
    this.name = opts.name || APPLIANCE_LABEL[this.type];
    const d = APPLIANCE_DEF[this.type];
    this.size = opts.size ? { ...opts.size } : { dx: d.dx, dy: d.dy, dz: d.dz };
    this.x = opts.x ?? 0;
    this.y = opts.y ?? d.y;
    this.z = opts.z ?? 40;
  }
}

// Accessories (doplnky) — carpentry trim in the cabinet decor: end panels,
// filler strips, cornices and plinths. Like appliances but sheet material, so
// they count in the cut-list and material area and can be edge-banded.
export const ACCESSORY_TYPES = ['panel', 'filler', 'cornice', 'plinth'];
export const ACCESSORY_LABEL = { panel: 'Bočný panel', filler: 'Výplň', cornice: 'Rímsa', plinth: 'Sokel' };
const ACCESSORY_DEF = {
  panel:   { dx: 18, dy: 720, dz: 560, y: 0 },
  filler:  { dx: 50, dy: 720, dz: 560, y: 0 },
  cornice: { dx: 600, dy: 60, dz: 40, y: 2000 },
  plinth:  { dx: 600, dy: 100, dz: 18, y: 0 },
};
export class Accessory {
  constructor(opts = {}) {
    this.id = nextId();
    this.type = ACCESSORY_TYPES.includes(opts.type) ? opts.type : 'panel';
    this.name = opts.name || ACCESSORY_LABEL[this.type];
    const d = ACCESSORY_DEF[this.type];
    this.size = opts.size ? { ...opts.size } : { dx: d.dx, dy: d.dy, dz: d.dz };
    this.x = opts.x ?? 0;
    this.y = opts.y ?? d.y;
    this.z = opts.z ?? 40;
    this.material = opts.material || 'Board 18';
  }
}

export class Room {
  constructor(name = 'Room 1') {
    this.id = nextId();
    this.name = name;
    this.walls = [];
    this.cabinets = [];
    this.appliances = [];
    this.accessories = [];
  }
  // rectangular room helper (W×D in mm), walls clockwise
  static rectangle(w = 4000, d = 3000, height = 2440) {
    const r = new Room();
    r.walls = [
      new Wall(0, 0, w, 0, height),
      new Wall(w, 0, w, d, height),
      new Wall(w, d, 0, d, height),
      new Wall(0, d, 0, 0, height),
    ];
    return r;
  }
  addCabinet(cab) { this.cabinets.push(cab); return cab; }
  addAppliance(ap) { this.appliances.push(ap); return ap; }
  addAccessory(ac) { this.accessories.push(ac); return ac; }

  // Auto-row: line up base cabinets side by side along the front wall
  // (walls[0], from a..b). Returns the cabinets that were added.
  fillFrontWall(opts = {}) {
    const wall = this.walls[0];
    if (!wall) return [];
    const W = opts.W || 600;
    const z = opts.z ?? 40;
    const length = wall.length;
    const count = Math.max(0, Math.floor(length / W));
    const added = [];
    for (let i = 0; i < count; i++) {
      const cab = new Cabinet({ type: 'base', name: `Spodná ${i + 1}`, x: i * W, y: 0, z, params: { W } });
      this.addCabinet(cab); added.push(cab);
    }
    return added;
  }

  stats() {
    let parts = 0, area = 0, vol = 0;
    for (const c of this.cabinets) for (const p of c.parts) { parts++; area += p.area; vol += p.volume; }
    return { cabinets: this.cabinets.length, parts, area: +area.toFixed(3), volume: +vol.toFixed(4) };
  }
}
