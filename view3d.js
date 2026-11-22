// cvjkit — 3D view (Three.js). Renders room walls + cabinet parts as boxes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { computeWorktops, partFace, cabTransform, partOutline } from './model.js';

const MM = 0.001; // mm -> metres for the 3D scene

export class View3D {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    // SolidWorks-style vertical gradient background (light blue-grey → near white)
    {
      const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256; const g = cv.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#9fb6d2'); grad.addColorStop(0.45, '#cdd9e8'); grad.addColorStop(1, '#f3f6fa');
      g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
      this.scene.background = new THREE.CanvasTexture(cv);
    }

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.position.set(3, 2.4, 4);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(2, 0.6, 1.5);
    this.controls.enableDamping = true;

    // bright, even CAD lighting
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2cc, 1.25));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85); dir.position.set(4, 8, 6); this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.45); dir2.position.set(-5, 4, -3); this.scene.add(dir2);
    const grid = new THREE.GridHelper(20, 40, 0x9aa7b4, 0xc4ccd4); grid.position.y = -0.001; this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(0.5));   // origin triad (X red, Y green, Z blue)

    this.root = new THREE.Group(); this.scene.add(this.root);

    // Material palette — carcass, doors, drawers and back are coloured apart.
    this.mat = {
      'Board 18': new THREE.MeshLambertMaterial({ color: 0xcaa472 }), // carcass
      'door': new THREE.MeshLambertMaterial({ color: 0x9fb4c9 }),     // doors
      'drawer': new THREE.MeshLambertMaterial({ color: 0x86c1a6 }),   // drawer fronts + boxes
      'back': new THREE.MeshLambertMaterial({ color: 0xb28b57 }),     // back panel
      'wall': new THREE.MeshLambertMaterial({ color: 0xd4dbe3, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      'floor': new THREE.MeshLambertMaterial({ color: 0xe6eaef }),
      'handle': new THREE.MeshLambertMaterial({ color: 0x4a4f55 }),
      'worktop': new THREE.MeshLambertMaterial({ color: 0x8c9196 }), // pracovná doska (kameň/laminát)
      'steel': new THREE.MeshLambertMaterial({ color: 0xc2c7cc }),   // spotrebič — nerez
      'steelDark': new THREE.MeshLambertMaterial({ color: 0x3a3e44 }), // panel/sklo/horák
      'hole': new THREE.MeshLambertMaterial({ color: 0x20242a }),    // vŕtanie/výrez (tmavé)
      'connector': new THREE.MeshLambertMaterial({ color: 0x9a7b2e }), // spoj (kov/mosadz)
    };
    this.edge = new THREE.LineBasicMaterial({ color: 0x33414e });   // crisp dark edges (CAD look)

    // Picking: click a cabinet in 3D to select it.
    this.raycaster = new THREE.Raycaster();
    this.pickables = [];       // meshes eligible for raycasting
    this._selHelper = null;    // highlight outline of the selected cabinet
    this.onPick = null;        // callback(cabinet|null, event)
    this.onDragMove = null;    // callback(cabinet, xMm, zMm) — live drag on the floor
    this.onDragEnd = null;     // callback(cabinet)
    this._downXY = null;
    this._drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      this._downXY = [e.clientX, e.clientY];
      const cab = e.button === 0 ? this._pick(e.clientX, e.clientY) : null; // start dragging a cabinet
      if (cab) {
        const f = this._floorPoint(e.clientX, e.clientY);
        if (f) { this._drag = { cab, fx: f.x, fz: f.z, x0: cab.x, z0: cab.z }; this.controls.enabled = false; e.stopImmediatePropagation(); this.onPick && this.onPick(cab, e); }
      }
    }, { capture: true });   // run before OrbitControls so a cabinet grab suppresses orbit
    canvas.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      const f = this._floorPoint(e.clientX, e.clientY); if (!f) return;
      const nx = Math.round(this._drag.x0 + (f.x - this._drag.fx) / MM);
      const nz = Math.round(this._drag.z0 + (f.z - this._drag.fz) / MM);
      this.onDragMove && this.onDragMove(this._drag.cab, nx, nz);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this._drag) { const cab = this._drag.cab; this._drag = null; this.controls.enabled = true; this._downXY = null; this.onDragEnd && this.onDragEnd(cab); return; }
      if (!this.onPick || !this._downXY) return;
      const moved = Math.hypot(e.clientX - this._downXY[0], e.clientY - this._downXY[1]);
      this._downXY = null;
      if (moved > 6) return; // treat as orbit drag, not a click
      this.onPick(this._pick(e.clientX, e.clientY), e);
    });

    addEventListener('resize', () => this.resize());
    this.resize();
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop); };
    loop();
  }

  // switch between 3D perspective and 2D top-down (plan) view
  setViewMode(mode) {
    this._viewMode = mode;
    const room = this._lastRoom;
    let maxX = 4, maxZ = 3; if (room) { maxX = 0; maxZ = 0; for (const w of room.walls) { maxX = Math.max(maxX, w.a.x, w.b.x); maxZ = Math.max(maxZ, w.a.z, w.b.z); } maxX *= MM; maxZ *= MM; }
    const cx = maxX / 2, cz = maxZ / 2;
    if (mode === 'top') {
      this.controls.minPolarAngle = this.controls.maxPolarAngle = 0;   // lock straight down
      this.controls.enableRotate = false;
      this.camera.up.set(0, 0, -1);
      this.camera.position.set(cx, Math.max(maxX, maxZ) * 1.25, cz);
      this.controls.target.set(cx, 0, cz);
    } else {
      this.controls.minPolarAngle = 0; this.controls.maxPolarAngle = Math.PI * 0.495;
      this.controls.enableRotate = true;
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(cx + Math.max(maxX, maxZ) * 0.7, Math.max(maxX, maxZ) * 0.6, cz + Math.max(maxX, maxZ) * 0.9);
      this.controls.target.set(cx, 0.4, cz);
    }
    this.camera.updateProjectionMatrix(); this.controls.update();
  }

  // Ray → floor plane (y=0) intersection, in scene metres (or null).
  _floorPoint(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const nx = ((cx - r.left) / r.width) * 2 - 1, ny = -((cy - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    this._floor = this._floor || new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this._floor, pt) ? pt : null;
  }

  // Raycast at screen pixel (cx,cy) -> cabinet whose mesh was hit, or null.
  _pick(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const nx = ((cx - r.left) / r.width) * 2 - 1;
    const ny = -((cy - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      let o = h.object;
      while (o && !(o.userData && o.userData.cabinet)) o = o.parent;
      if (o) return o.userData.cabinet;
    }
    return null;
  }

  resize() {
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  _box(size, pos, material) {
    const g = new THREE.BoxGeometry(size.dx * MM, size.dy * MM, size.dz * MM);
    const m = new THREE.Mesh(g, material);
    // BoxGeometry is centred; our pos is the min corner
    m.position.set((pos.x + size.dx / 2) * MM, (pos.y + size.dy / 2) * MM, (pos.z + size.dz / 2) * MM);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), this.edge);
    m.add(e);
    return m;
  }

  // Render parts decoded from a real .cvj (axis-aligned world boxes). Each box:
  // { pos:{x,y,z} mm (min corner), size:{dx,dy,dz} mm, code }.
  showCvjParts(boxes) {
    this.root.clear(); this.pickables = [];
    const grp = new THREE.Group();
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const b of boxes) {
      const code = (b.code || '').toUpperCase();
      const mat = /DOR|FO/.test(code) ? this.mat.door : /DO|DWR|BB/.test(code) ? this.mat.drawer
        : /UB/.test(code) ? this.mat.back : this.mat['Board 18'];
      grp.add(this._box(b.size, b.pos, mat));
      const p = [b.pos.x, b.pos.y, b.pos.z], s = [b.size.dx, b.size.dy, b.size.dz];
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i] + s[i]); }
    }
    this.root.add(grp);
    // frame the bounding box
    const c = lo.map((v, i) => (v + hi[i]) / 2 * MM);
    const span = Math.max(...hi.map((v, i) => (v - lo[i]))) * MM || 1;
    this.controls.target.set(c[0], c[1], c[2]);
    this.camera.position.set(c[0] + span, c[1] + span * 0.8, c[2] + span * 1.3);
    this.camera.near = span / 100; this.camera.far = span * 100; this.camera.updateProjectionMatrix();
    return boxes.length;
  }

  _matFor(part) {
    const m = part.material || '';
    if (part.code === 'UB') return this.mat.back;
    return this._decorMat(m);   // doors/drawers/carcass all in the chosen decor colour
  }

  // inset / raised / glass front panel for the chosen door style
  _addDoorStyle(group, part, cab) {
    const style = (cab && cab.params && cab.params.doorStyle) || 'slab';
    if (style === 'slab') return;                              // flat front: nothing to add
    const s = part.size, p = part.pos;
    const m = Math.max(40, Math.min(90, Math.min(s.dx, s.dy) * 0.14)); // frame width
    const iw = s.dx - 2 * m, ih = s.dy - 2 * m;
    if (iw < 30 || ih < 30) return;
    const base = this._decorMat(part.material).color.getHex();
    let col, zoff, mat, th = 5;
    if (style === 'shaker') { col = this._shade(base, -0.10); zoff = +2; }   // recessed inner panel
    else if (style === 'raised') { col = this._shade(base, +0.10); zoff = -3; th = 8; } // proud panel
    else { // glass
      mat = this.mat.glass || (this.mat.glass = new THREE.MeshLambertMaterial({ color: 0xaaccdd, transparent: true, opacity: 0.45 }));
      zoff = +1;
    }
    if (!mat) { this._panelCache = this._panelCache || {}; mat = this._panelCache[col] || (this._panelCache[col] = new THREE.MeshLambertMaterial({ color: col })); }
    const g = new THREE.BoxGeometry(iw * MM, ih * MM, th * MM);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set((p.x + s.dx / 2) * MM, (p.y + s.dy / 2) * MM, (p.z + zoff) * MM);
    group.add(mesh);
  }

  _shade(hex, f) { // lighten (f>0) / darken (f<0) a packed RGB
    let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    const k = f < 0 ? (1 + f) : 1, a = f > 0 ? f : 0;
    r = Math.round(r * k + 255 * a); g = Math.round(g * k + 255 * a); b = Math.round(b * k + 255 * a);
    return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
  }

  // handle on a door / drawer front — bar / knob / gola / none
  _addHandle(group, part, cab) {
    const kind = (cab && cab.params && cab.params.handle) || 'bar';
    if (kind === 'none') return;
    const s = part.size, p = part.pos; const T = 18;
    const hz = p.z - T * 0.5;                                  // just proud of the front
    const isDF = part.code === 'DF';
    if (kind === 'knob') {                                     // small round knob
      const g = new THREE.CylinderGeometry(9 * MM, 9 * MM, 14 * MM, 16);
      g.rotateX(Math.PI / 2);
      const kx = isDF ? p.x + s.dx / 2 : p.x + s.dx - 26;
      const ky = isDF ? p.y + s.dy - 24 : p.y + s.dy / 2;
      const mesh = new THREE.Mesh(g, this.mat.handle);
      mesh.position.set(kx * MM, ky * MM, hz * MM);
      group.add(mesh); return;
    }
    if (kind === 'gola') {                                     // J-pull: thin lip along the top edge
      const gw = s.dx - 20, gy = p.y + s.dy - 10;
      const g = new THREE.BoxGeometry(gw * MM, 10 * MM, 10 * MM);
      const mesh = new THREE.Mesh(g, this.mat.handle);
      mesh.position.set((p.x + s.dx / 2) * MM, gy * MM, (p.z - 4) * MM);
      group.add(mesh); return;
    }
    // bar handle (default)
    let hw, hh, hx, hy;
    if (isDF) { hw = Math.min(s.dx * 0.5, 180); hh = 16; hx = p.x + (s.dx - hw) / 2; hy = p.y + s.dy - 26; }
    else { hw = 16; hh = Math.min(s.dy * 0.5, 180); hx = p.x + s.dx - 26; hy = p.y + (s.dy - hh) / 2; }
    const g = new THREE.BoxGeometry(hw * MM, hh * MM, 14 * MM);
    const mesh = new THREE.Mesh(g, this.mat.handle);
    mesh.position.set((hx + hw / 2) * MM, (hy + hh / 2) * MM, hz * MM);
    group.add(mesh);
  }

  // part CAD: drilling (holes) + cutouts (pockets) placed on the part's main face
  _addPartCad(group, pt) {
    const cad = pt.cad; if (!cad || (!cad.drilling?.length && !cad.cutouts?.length)) return;
    const F = partFace(pt.size);
    const letter = { x: 'dx', y: 'dy', z: 'dz' };
    for (const hole of cad.drilling || []) {
      const d = hole.d || 8, depth = Math.min(F.nLen, 16);
      const g = new THREE.CylinderGeometry(d / 2 * MM, d / 2 * MM, depth * MM, 16);
      if (F.nAxis === 'x') g.rotateZ(Math.PI / 2); else if (F.nAxis === 'z') g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, this.mat.hole);
      const c = { x: pt.pos.x, y: pt.pos.y, z: pt.pos.z };
      c[F.uAxis] += hole.x; c[F.vAxis] += hole.y; c[F.nAxis] += F.nLen - depth / 2;
      m.position.set(c.x * MM, c.y * MM, c.z * MM); group.add(m);
    }
    for (const cut of cad.cutouts || []) {
      const s = {}; s[letter[F.uAxis]] = cut.w; s[letter[F.vAxis]] = cut.h; s[letter[F.nAxis]] = F.nLen + 2;
      const c = { x: pt.pos.x, y: pt.pos.y, z: pt.pos.z };
      c[F.uAxis] += cut.x + cut.w / 2; c[F.vAxis] += cut.y + cut.h / 2; c[F.nAxis] += F.nLen / 2;
      group.add(this._box(s, { x: c.x - s.dx / 2, y: c.y - s.dy / 2, z: c.z - s.dz / 2 }, this.mat.hole));
    }
  }

  // shaped front panel (atypical outline) extruded from its polygon, thickness dz
  _shapedMesh(part) {
    const pts = partOutline(part);
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: part.size.dz, bevelEnabled: false });
    geo.scale(MM, MM, MM);
    const mesh = new THREE.Mesh(geo, this._decorMat(part.material || 'Board 18'));
    mesh.position.set(part.pos.x * MM, part.pos.y * MM, part.pos.z * MM);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edge));
    return mesh;
  }

  // worktop slab, with sink/hob cutouts punched through (extruded shape + holes)
  _worktopMesh(wt) {
    const { pos, size, cutouts } = wt;
    if (!cutouts || !cutouts.length) return this._box(size, pos, this.mat.worktop);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(size.dx, 0); shape.lineTo(size.dx, size.dz); shape.lineTo(0, size.dz); shape.lineTo(0, 0);
    for (const c of cutouts) {
      const h = new THREE.Path();
      h.moveTo(c.x, c.z); h.lineTo(c.x + c.w, c.z); h.lineTo(c.x + c.w, c.z + c.d); h.lineTo(c.x, c.z + c.d); h.lineTo(c.x, c.z);
      shape.holes.push(h);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: size.dy, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); geo.scale(MM, MM, MM);           // shape(u=X, v=Z) → world; extrude(thickness) → +Y
    const mesh = new THREE.Mesh(geo, this.mat.worktop);
    mesh.position.set(pos.x * MM, pos.y * MM, (pos.z + size.dz) * MM);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edge));
    return mesh;
  }

  // appliance (spotrebič): steel body + per-type accents, placed at absolute pos
  _addAppliance(ap) {
    const s = ap.size, p = { x: ap.x, y: ap.y, z: ap.z };
    this.root.add(this._box(s, p, this.mat.steel));
    const add = (sz, po) => this.root.add(this._box(sz, po, this.mat.steelDark));
    const t = ap.type;
    if (t === 'drez') {                                            // basin recessed in the top
      add({ dx: s.dx - 120, dy: 14, dz: s.dz - 140 }, { x: p.x + 60, y: p.y + s.dy - 14, z: p.z + 70 });
    } else if (t === 'doska') {                                    // 4 burners on top
      const by = p.y + s.dy, r = 80;
      for (const x of [p.x + s.dx * 0.28, p.x + s.dx * 0.72]) for (const z of [p.z + s.dz * 0.3, p.z + s.dz * 0.7])
        add({ dx: r, dy: 6, dz: r }, { x: x - r / 2, y: by, z: z - r / 2 });
    } else if (t === 'rura') {                                     // oven: glass front + handle
      add({ dx: s.dx - 60, dy: s.dy - 170, dz: 10 }, { x: p.x + 30, y: p.y + 40, z: p.z - 8 });
      add({ dx: s.dx - 80, dy: 26, dz: 22 }, { x: p.x + 40, y: p.y + s.dy - 80, z: p.z - 16 });
    } else if (t === 'umyvacka' || t === 'chladnicka') {          // front handle (+ fridge door seam)
      add({ dx: 26, dy: s.dy - 140, dz: 18 }, { x: p.x + s.dx - 56, y: p.y + 70, z: p.z - 14 });
      if (t === 'chladnicka') add({ dx: s.dx - 20, dy: 14, dz: 3 }, { x: p.x + 10, y: p.y + s.dy * 0.62, z: p.z - 3 });
    } // digestor: plain steel box
  }

  // colour a board by its decor material name (so the selected material shows in 3D)
  _decorMat(name) {
    const COL = { 'biela': 0xf0f0ec, 'white': 0xf0f0ec, 'dub': 0xc9a96a, 'sonoma': 0xc9a96a, 'antracit': 0x33373c, 'anthracite': 0x33373c, 'betón': 0x9a9a96, 'beton': 0x9a9a96, 'orech': 0x6b4a2f, 'walnut': 0x6b4a2f, 'čierna': 0x202326, 'cierna': 0x202326 };
    const key = (name || '').toLowerCase();
    let col = 0xcaa472;                 // default carcass board
    for (const [k, c] of Object.entries(COL)) if (key.includes(k)) { col = c; break; }
    this._decorCache = this._decorCache || {};
    if (!this._decorCache[col]) this._decorCache[col] = new THREE.MeshLambertMaterial({ color: col });
    return this._decorCache[col];
  }

  rebuild(room, selected = null) {
    this._lastRoom = room;
    this.root.clear();
    this.pickables = [];
    this._selHelper = null;
    const groups = new Map();
    // floor from room bounds
    let maxX = 0, maxZ = 0;
    for (const w of room.walls) { maxX = Math.max(maxX, w.a.x, w.b.x); maxZ = Math.max(maxZ, w.a.z, w.b.z); }
    if (maxX && maxZ) {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(maxX * MM, maxZ * MM), this.mat.floor);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(maxX / 2 * MM, 0, maxZ / 2 * MM);
      this.root.add(floor);
    }
    // walls as thin boxes
    for (const w of room.walls) {
      const len = w.length, ang = w.angle;
      const g = new THREE.BoxGeometry(len * MM, w.height * MM, w.thickness * MM);
      const m = new THREE.Mesh(g, this.mat.wall);
      const midX = (w.a.x + w.b.x) / 2, midZ = (w.a.z + w.b.z) / 2;
      m.position.set(midX * MM, w.height / 2 * MM, midZ * MM);
      m.rotation.y = -ang;
      this.root.add(m);
    }
    // cabinets
    for (const cab of room.cabinets) {
      const g = new THREE.Group();
      const T = cabTransform(cab);
      g.position.set(T.px * MM, T.py * MM, T.pz * MM);
      g.rotation.y = T.ry;
      g.userData.cabinet = cab;
      for (const part of cab.parts) {
        const mesh = (part.shape && part.shape !== 'rect') ? this._shapedMesh(part) : this._box(part.size, part.pos, this._matFor(part));
        this.pickables.push(mesh);
        g.add(mesh);
        if (part.code === 'DOR' || part.code === 'DF') {           // fronts: style + handle
          this._addDoorStyle(g, part, cab);
          this._addHandle(g, part, cab);
        }
        this._addPartCad(g, part);                                 // drilling + cutouts (CAD editor)
      }
      // carcass connectors (spojovacia technika)
      for (const con of cab.connectors()) {
        const isDowel = con.type === 'dowel';
        const g2 = new THREE.CylinderGeometry((isDowel ? 4 : 7) * MM, (isDowel ? 4 : 7) * MM, (isDowel ? 30 : 12) * MM, 14);
        g2.rotateZ(Math.PI / 2);                                 // axis along X (through the side)
        const m = new THREE.Mesh(g2, this.mat.connector);
        m.position.set(con.x * MM, con.y * MM, con.z * MM);
        g.add(m);
      }

      this.root.add(g);
      groups.set(cab, g);
    }

    // worktops (pracovná doska) over runs of floor cabinets — with sink/hob cutouts
    if (room.worktop !== false) {
      for (const wt of computeWorktops(room, room.worktopOpts || {})) this.root.add(this._worktopMesh(wt));
    }

    // appliances (spotrebiče)
    for (const ap of room.appliances || []) this._addAppliance(ap);

    // accessories (doplnky) — carpentry trim in the chosen decor
    for (const ac of room.accessories || []) {
      const mesh = this._box(ac.size, { x: ac.x, y: ac.y, z: ac.z }, this._decorMat(ac.material || 'Board 18'));
      this.root.add(mesh);
    }

    // highlight the selected cabinet with a bright outline box
    if (selected && groups.has(selected)) {
      const helper = new THREE.BoxHelper(groups.get(selected), 0xffcc33);
      helper.material.depthTest = false;
      this.root.add(helper);
      this._selHelper = helper;
    }
  }

  frame(room) {
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    this.controls.target.copy(c);
    this.camera.position.set(c.x + s.x * 0.8, c.y + s.y * 1.1, c.z + s.z * 1.6 + 1);
  }
}
