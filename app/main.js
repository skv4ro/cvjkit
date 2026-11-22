// cvjkit — app bootstrap: wire model + 3D view + UI + .cvj import.
import { Room, Cabinet, TYPE_LABEL, computeWorktops, Appliance, APPLIANCE_LABEL, partBanding, partFace, partOutline, Accessory, ACCESSORY_LABEL, DEFAULT_CONSTRUCTION, constructionFrom } from './model.js';
import { View3D } from './view3d.js';
import { importCvj, openContainer, getStream, setStream, writeContainer } from './cvj.js';
import { decodeStream, writeGraphMulti } from '../src/writer.mjs';
import { resizeGraph, cabinetSize, leafParts, axisMap, IN } from '../src/resize.mjs';
import { priceJob, DEFAULT_RATES, resolveMaterials } from '../src/pricing.mjs';
import { nest } from '../src/nesting.mjs';
import * as MatPrices from '../src/matprices.mjs';
import { saveTemplate, getTemplate, listTemplates } from './templates.js';
import * as Edit from './cvjedit.js';

// real CVData price snapshot (optional) — material name → cost
let PRICES = null;
fetch('./prices.json').then((r) => r.ok ? r.json() : null).then((p) => { PRICES = p && p.materials; }).catch(() => {});

// real CVData catalog (optional) — materials, hardware, cabinets, construction
let CV = null;
fetch('./cvcatalog.json').then((r) => r.ok ? r.json() : null).then((c) => { if (c) { CV = c; onCatalogLoaded(); } }).catch(() => {});
// CV-exact parts per cabinet id (optional) — real template geometry from CVData
let CVPARTS = null;
fetch('./cvparts.json').then((r) => r.ok ? r.json() : null).then((c) => { if (c) CVPARTS = c.parts; }).catch(() => {});
function onCatalogLoaded() {
  if (!CV) return;
  const sec = $('cvCatSection'); if (sec) sec.hidden = false;
  if ($('cvCatCount')) $('cvCatCount').textContent = `· ${CV.counts.cabinets} skriniek, ${CV.counts.materials} mat., ${CV.counts.hardware} kovaní`;
  fillCvCabinets('');
  if (selected) populateMaterials(selected.params.material);  // real boards into the dropdown
  if (typeof fillConstructionPresets === 'function') fillConstructionPresets();
}
// searchable cabinet catalog
function fillCvCabinets(q) {
  const sel = $('cvCabSel'); if (!sel || !CV) return;
  const ql = (q || '').toLowerCase();
  const list = CV.cabinets.filter((c) => !ql || c.name.toLowerCase().includes(ql) || (c.cls || '').toLowerCase().includes(ql)).slice(0, 300);
  sel.innerHTML = list.map((c, i) => `<option value="${CV.cabinets.indexOf(c)}">${c.name} · ${c.kind} · ${c.W}×${c.H}×${c.D}</option>`).join('');
}
function wireCvCatalog() {
  $('cvCabSearch') && ($('cvCabSearch').oninput = () => fillCvCabinets($('cvCabSearch').value));
  $('btnCvCabAdd') && ($('btnCvCabAdd').onclick = () => {
    if (!CV) return; const sel = $('cvCabSel'); const c = CV.cabinets[+sel.value]; if (!c) { toast('Vyber skrinku'); return; }
    const n = room.cabinets.length;
    const cvp = CVPARTS && CVPARTS[c.id];                      // CV-exact template parts, if exported
    const cab = new Cabinet({ type: c.kind, name: c.name, x: 50 + n * 650, z: 40,
      params: { W: c.W, H: c.H, D: c.D, ...constructionFrom(room.construction || {}) },
      cvParts: cvp ? cvp.parts : null, cvDef: cvp ? { W: cvp.W, H: cvp.H, D: cvp.D } : null });
    const exact = cvp && cab._cvUsable();
    room.addCabinet(cab); selectCabinet(cab); refresh(); view.frame(room);
    if ($('cvCatInfo')) $('cvCatInfo').textContent = `${c.name} (${c.cls}) · ${c.W}×${c.H}×${c.D} mm · ${exact ? '✓ CV-presné diely (' + cab.parts.length + ')' : 'parametrické diely'}`;
    toast('Skrinka z katalógu: ' + c.name + (exact ? ' (CV-presné)' : ''));
  });
}

// decoded .cvj leaf parts → axis-aligned world boxes (mm) for the 3D view.
// rotation maps each local dim onto a world axis (W/H/D), giving the box's world size.
function cvjToBoxes(objs) {
  const getP = (o, n) => (o.params || []).find((p) => p.__class === 'CVParameter' && p.name === n);
  const v = (p) => (p && p.value && typeof p.value === 'object' ? p.value.value : undefined);
  const boxes = [];
  for (const o of leafParts(objs)) {
    const m = axisMap(v(getP(o, 'AX')) || 0, v(getP(o, 'AY')) || 0, v(getP(o, 'AZ')) || 0);
    const world = { W: 0, H: 0, D: 0 };
    for (const dn of ['DX', 'DY', 'DZ']) { const d = v(getP(o, dn)); if (typeof d === 'number') world[m[dn]] = Math.abs(d); }
    const x = v(getP(o, 'X')) || 0, y = v(getP(o, 'Y')) || 0, z = v(getP(o, 'Z')) || 0;
    if (!(world.W && world.H) && !(world.W && world.D) && !(world.H && world.D)) continue; // skip degenerate
    boxes.push({ pos: { x: x * IN, y: y * IN, z: z * IN }, size: { dx: world.W * IN, dy: world.H * IN, dz: world.D * IN }, code: o.name });
  }
  return boxes;
}

const $ = (id) => document.getElementById(id);
const view = new View3D($('gl'));
let room = Room.rectangle(4000, 3000, 2440);
let selected = null;
room.construction = { ...DEFAULT_CONSTRUCTION };
wireCvCatalog();
wireConstruction();

// --- construction method (konštrukcia): the configurable generation rule-set ---
function fillConstructionPresets() {
  const sel = $('conPreset'); if (!sel) return;
  const names = ['Štandard 18', ...(CV && CV.construction ? CV.construction.map((c) => c.name) : [])];
  const seen = new Set(); const opts = [];
  for (const n of names) { if (seen.has(n)) continue; seen.add(n); opts.push(n); if (opts.length > 300) break; }
  sel.innerHTML = opts.map((n) => `<option>${n}</option>`).join('');
}
function readConstructionUi() {
  const c = room.construction || (room.construction = { ...DEFAULT_CONSTRUCTION });
  c.name = $('conPreset') && $('conPreset').value || c.name;
  c.T = +$('conT').value || 18; c.BT = +$('conBT').value || 6; c.doorGap = +$('conGap').value || 0;
  c.toe = +$('conToe').value || 0; c.doorOverlay = $('conOverlay').value; c.backJoint = $('conBackJoint').value;
  c.joint = $('conJoint').value;
  return c;
}
function applyConstruction() {
  const c = readConstructionUi();
  const fields = constructionFrom(c);
  for (const cab of room.cabinets) {
    Object.assign(cab.params, fields);           // construction drives the generator
    cab.joineryType = c.joint;
    cab.generate();
    if (cab.sys32) cab.applySystem32(true);
    if (cab.hwDrill) cab.applyHardwareDrilling(true);
  }
  refresh(); if (selected) selectCabinet(selected);
  if ($('conInfo')) $('conInfo').textContent = `Profil „${c.name}" použitý na ${room.cabinets.length} skriniek · hr. ${c.T}/${c.BT} · vôľa ${c.doorGap} · dvierka ${c.doorOverlay} · chrbát ${c.backJoint}`;
  toast('Konštrukcia použitá');
}
function wireConstruction() {
  fillConstructionPresets();
  $('btnConApply') && ($('btnConApply').onclick = applyConstruction);
  $('conPreset') && ($('conPreset').onchange = () => { if (room.construction) room.construction.name = $('conPreset').value; });
}

const NUM_PARAMS = [
  ['W', 'Šírka'], ['H', 'Výška'], ['D', 'Hĺbka'], ['T', 'Hrúbka'],
  ['toe', 'Sokel'], ['shelves', 'Police'], ['BT', 'Chrbát'], ['backInset', 'Zápust chrbta'],
];

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

function refresh() {
  view.rebuild(room, selected);
  const s = room.stats();
  $('stats').textContent =
    `Skrinky:   ${s.cabinets}\nDiely:     ${s.parts}\nPlocha:    ${s.area} m²\nObjem:     ${s.volume} m³`;
  updateCabList();
  updateParts();
  if (typeof updateApplList === 'function') updateApplList();
  if (typeof updateAccList === 'function') updateAccList();
  autosave();
}

// list of all cabinets in the panel; click to select
function updateCabList() {
  const ul = $('cabList'); ul.innerHTML = '';
  room.cabinets.forEach((cab, i) => {
    const li = document.createElement('li');
    li.className = 'cabitem' + (cab === selected ? ' active' : '');
    li.textContent = `${i + 1}. ${cab.name} · ${TYPE_LABEL[cab.type]}`;
    li.addEventListener('click', () => { selectCabinet(cab); refresh(); });
    ul.appendChild(li);
  });
  if (!room.cabinets.length) ul.innerHTML = '<li class="muted">Žiadne skrinky</li>';
}

// parts table for the whole job
function updateParts() {
  const tb = $('partsTable').querySelector('tbody'); tb.innerHTML = '';
  room.cabinets.forEach((cab, ci) => {
    for (const p of cab.parts) {
      const tr = document.createElement('tr');
      if (cab === selected) tr.className = 'sel';
      const dims = `${Math.round(p.size.dx)}×${Math.round(p.size.dy)}×${Math.round(p.size.dz)}`;
      for (const v of [`${ci + 1}`, p.code, p.name, dims, p.material]) {
        const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
  });
}

function selectCabinet(cab) {
  selected = cab;
  const sec = $('cabSection');
  if (!cab) { sec.hidden = true; const cs = $('cadSection'); if (cs) cs.hidden = true; return; }
  sec.hidden = false;
  $('cabName').textContent = `#${cab.id}`;
  $('pType').value = cab.type;
  if ($('pRot')) $('pRot').value = String(cab.rot || 0);
  if ($('pX')) $('pX').value = Math.round(cab.x);
  if ($('pZ')) $('pZ').value = Math.round(cab.z);
  const grid = $('cabParams'); grid.innerHTML = '';
  for (const [key, label] of NUM_PARAMS) {
    const cell = document.createElement('div'); cell.className = 'cell';
    cell.innerHTML = `<label>${label}</label>`;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = cab.params[key];
    inp.addEventListener('input', () => { cab.setParam(key, +inp.value || 0); refresh(); });
    cell.appendChild(inp); grid.appendChild(cell);
  }
  populateMaterials(cab.params.material);
  renderCatalog(cab);
  if (typeof openCadFor === 'function') openCadFor(cab);
  $('pDoors').value = String(cab.params.doors);
  $('pDrawers').value = String(cab.params.drawers);
  $('pTopType').value = cab.params.topType;
  // show the drawers control only for drawer cabinets, doors for the rest
  $('pDrawers').closest('.row').style.display = cab.type === 'drawer' ? '' : 'none';
  $('pDoors').closest('.row').style.display = cab.type === 'drawer' ? 'none' : '';
}

// --- toolbar ---
$('btnNew').onclick = () => {
  room = Room.rectangle(+$('roomW').value, +$('roomD').value, +$('roomH').value);
  selectCabinet(null); refresh(); view.frame(room); toast('Nová miestnosť');
};
$('btnRoom').onclick = () => {
  const nr = Room.rectangle(+$('roomW').value, +$('roomD').value, +$('roomH').value);
  nr.cabinets = room.cabinets; nr.worktop = room.worktop; nr.worktopOpts = room.worktopOpts; room = nr; refresh(); toast('Miestnosť prekreslená');
};
// worktop (pracovná doska) toggle + thickness
function applyWorktopUi() {
  room.worktop = $('roomWorktop').checked;
  room.worktopOpts = { ...(room.worktopOpts || {}), thickness: +$('roomWtThick').value || 38 };
}
$('roomWorktop').onchange = () => { applyWorktopUi(); refresh(); toast(room.worktop ? 'Doska zapnutá' : 'Doska vypnutá'); };
$('roomWtThick').onchange = () => { applyWorktopUi(); refresh(); };

// --- appliances (spotrebiče) ---
let selAppl = null;
function updateApplList() {
  const ul = $('applList'); if (!ul) return; ul.innerHTML = '';
  for (const ap of room.appliances) {
    const li = document.createElement('li');
    li.textContent = `${ap.name} · ${Math.round(ap.size.dx)}×${Math.round(ap.size.dy)}`;
    if (ap === selAppl) li.classList.add('active');
    li.onclick = () => selectAppliance(ap);
    ul.appendChild(li);
  }
}
function selectAppliance(ap) {
  selAppl = ap;
  const sec = $('applSection'); if (!sec) return;
  if (!ap) { sec.hidden = true; updateApplList(); return; }
  sec.hidden = false;
  $('applName').textContent = ap.name;
  $('applX').value = Math.round(ap.x); $('applZ').value = Math.round(ap.z); $('applY').value = Math.round(ap.y);
  updateApplList();
}
function addAppliance(type) {
  const n = room.appliances.length;
  const ap = new Appliance({ type, x: 50 + n * 650, z: 40 });
  room.addAppliance(ap); selectAppliance(ap); refresh(); view.frame(room);
  toast(`${APPLIANCE_LABEL[type]} pridaný`);
}
for (const b of document.querySelectorAll('[data-appl]')) b.onclick = () => addAppliance(b.dataset.appl);
$('applX').oninput = () => { if (selAppl) { selAppl.x = +$('applX').value || 0; refresh(); } };
$('applZ').oninput = () => { if (selAppl) { selAppl.z = +$('applZ').value || 0; refresh(); } };
$('applY').oninput = () => { if (selAppl) { selAppl.y = +$('applY').value || 0; refresh(); } };
$('btnApplDel').onclick = () => {
  if (!selAppl) return;
  room.appliances = room.appliances.filter((a) => a !== selAppl);
  selectAppliance(null); refresh(); toast('Spotrebič zmazaný');
};

// --- accessories (doplnky: bočné panely / výplne / rímsy / sokel) ---
let selAcc = null;
function updateAccList() {
  const ul = $('accList'); if (!ul) return; ul.innerHTML = '';
  for (const ac of room.accessories) {
    const li = document.createElement('li');
    li.textContent = `${ac.name} · ${Math.round(ac.size.dx)}×${Math.round(ac.size.dy)}×${Math.round(ac.size.dz)}`;
    if (ac === selAcc) li.classList.add('active');
    li.onclick = () => selectAccessory(ac);
    ul.appendChild(li);
  }
}
function selectAccessory(ac) {
  selAcc = ac;
  const sec = $('accSection'); if (!sec) return;
  if (!ac) { sec.hidden = true; updateAccList(); return; }
  sec.hidden = false;
  $('accName').textContent = ac.name;
  $('accX').value = Math.round(ac.x); $('accZ').value = Math.round(ac.z); $('accY').value = Math.round(ac.y);
  $('accDx').value = Math.round(ac.size.dx); $('accDy').value = Math.round(ac.size.dy); $('accDz').value = Math.round(ac.size.dz);
  updateAccList();
}
function addAccessory(type) {
  const n = room.accessories.length;
  const ac = new Accessory({ type, x: 50 + n * 120, z: 40, material: selected?.params.material || 'Board 18' });
  room.addAccessory(ac); selectAccessory(ac); refresh(); view.frame(room);
  toast(`${ACCESSORY_LABEL[type]} pridaný`);
}
for (const b of document.querySelectorAll('[data-acc]')) b.onclick = () => addAccessory(b.dataset.acc);
$('accX').oninput = () => { if (selAcc) { selAcc.x = +$('accX').value || 0; refresh(); } };
$('accZ').oninput = () => { if (selAcc) { selAcc.z = +$('accZ').value || 0; refresh(); } };
$('accY').oninput = () => { if (selAcc) { selAcc.y = +$('accY').value || 0; refresh(); } };
$('accDx').oninput = () => { if (selAcc) { selAcc.size.dx = +$('accDx').value || 1; refresh(); } };
$('accDy').oninput = () => { if (selAcc) { selAcc.size.dy = +$('accDy').value || 1; refresh(); } };
$('accDz').oninput = () => { if (selAcc) { selAcc.size.dz = +$('accDz').value || 1; refresh(); } };
$('btnAccDel').onclick = () => {
  if (!selAcc) return;
  room.accessories = room.accessories.filter((a) => a !== selAcc);
  selectAccessory(null); refresh(); toast('Doplnok zmazaný');
};

// --- part CAD editor: graphical drilling + cutouts on a studio part ---
const cad = { tool: 'hole', part: null };
function openCadFor(cab) {
  const sec = $('cadSection'); if (!sec) return;
  if (!cab || !cab.parts.length) { sec.hidden = true; cad.part = null; return; }
  sec.hidden = false;
  const sel = $('cadPart'); sel.innerHTML = cab.parts.map((p, i) =>
    `<option value="${i}">${p.key} · ${p.name} (${Math.round(p.size.dx)}×${Math.round(p.size.dy)}×${Math.round(p.size.dz)})</option>`).join('');
  const keep = cad.part ? cab.parts.indexOf(cad.part) : -1;
  sel.value = keep >= 0 ? keep : 0;
  cad.part = cab.parts[+sel.value] || cab.parts[0];
  if ($('cadSys32')) $('cadSys32').checked = !!cab.sys32;
  if ($('cadHwDrill')) $('cadHwDrill').checked = !!cab.hwDrill;
  if ($('cadJoin')) $('cadJoin').checked = !!cab.joinery;
  if ($('cadJoinType')) $('cadJoinType').value = cab.joineryType || 'minifix';
  renderCad();
}
$('cadPart') && ($('cadPart').onchange = () => { cad.part = selected?.parts[+$('cadPart').value]; renderCad(); });
for (const b of document.querySelectorAll('#cadTools [data-tool]'))
  b.onclick = () => { cad.tool = b.dataset.tool; document.querySelectorAll('#cadTools [data-tool]').forEach((x) => x.classList.toggle('active', x === b)); };
function renderCad() {
  const box = $('cadCanvas'); if (!box) return;
  const pt = cad.part; if (!pt) { box.innerHTML = ''; return; }
  const F = partFace(pt.size);
  const SC = Math.min(260 / F.uLen, 180 / F.vLen, 1);
  const W = F.uLen * SC, H = F.vLen * SC;
  const holes = (pt.cad.drilling || []).map((h, i) =>
    `<circle data-h="${i}" cx="${h.x * SC}" cy="${(F.vLen - h.y) * SC}" r="${Math.max(2, h.d / 2 * SC)}" fill="#20242a"/>`).join('');
  const cuts = (pt.cad.cutouts || []).map((c, i) =>
    `<rect data-c="${i}" x="${c.x * SC}" y="${(F.vLen - c.y - c.h) * SC}" width="${c.w * SC}" height="${c.h * SC}" fill="#20242a" opacity="0.8"/>`).join('');
  const face = (pt.shape && pt.shape !== 'rect')
    ? `<polygon points="${partOutline(pt).map(([x, y]) => `${x * SC},${(F.vLen - y) * SC}`).join(' ')}" fill="#d6e2f0" stroke="#2a6cb0" stroke-width="1.4"/>`
    : `<rect x="0" y="0" width="${W}" height="${H}" fill="#d6e2f0" stroke="#2a6cb0" stroke-width="1.2"/>`;
  box.innerHTML = `<svg id="cadSvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#f6f8fa;border:1px solid #9aa7b4;cursor:crosshair">
    ${face}${cuts}${holes}</svg>`;
  const svg = $('cadSvg');
  svg.onclick = (e) => {
    const r = svg.getBoundingClientRect();
    const fu = (e.clientX - r.left) / SC, fv = F.vLen - (e.clientY - r.top) / SC;   // face-local mm (v from bottom)
    if (cad.tool === 'hole') { pt.cad.drilling.push({ x: Math.round(fu), y: Math.round(fv), d: +$('cadDia').value || 8 }); }
    else if (cad.tool === 'cut') { const w = +$('cadCutW').value || 100, h = +$('cadCutH').value || 100; pt.cad.cutouts.push({ x: Math.round(fu - w / 2), y: Math.round(fv - h / 2), w, h }); }
    else if (cad.tool === 'del') {
      // remove nearest hole, else a cutout under the point
      let bi = -1, bd = 1e9; pt.cad.drilling.forEach((h, i) => { const d = Math.hypot(h.x - fu, h.y - fv); if (d < bd) { bd = d; bi = i; } });
      if (bi >= 0 && bd < 40) pt.cad.drilling.splice(bi, 1);
      else { const ci = pt.cad.cutouts.findIndex((c) => fu >= c.x && fu <= c.x + c.w && fv >= c.y && fv <= c.y + c.h); if (ci >= 0) pt.cad.cutouts.splice(ci, 1); }
    }
    refresh(); renderCad(); updateCadInfo();
  };
  updateCadInfo();
}
function updateCadInfo() {
  const pt = cad.part; if (!pt) return;
  $('cadInfo').textContent = `${pt.key}: ${pt.cad.drilling.length} dier, ${pt.cad.cutouts.length} výrezov`;
}
$('btnCadAddCust') && ($('btnCadAddCust').onclick = () => {
  if (!selected) return;
  const shape = $('cadShape') ? $('cadShape').value : 'rect';
  const name = { rect: 'Vlastný diel', lcut: 'Diel L-výrez', angle: 'Diel zrez. roh', round: 'Diel zaoblený' }[shape] || 'Vlastný diel';
  selected.addCustomPart({ name, shape, pos: { x: 20, y: 20, z: -60 }, size: { dx: 400, dy: 400, dz: 18 } });
  refresh(); openCadFor(selected); toast(name + ' pridaný');
});
$('btnCadClear') && ($('btnCadClear').onclick = () => { if (cad.part) { cad.part.cad.drilling = (cad.part.cad.drilling || []).filter((h) => h.sys); cad.part.cad.cutouts = []; refresh(); renderCad(); toast('Diel vyčistený'); } });
$('cadSys32') && ($('cadSys32').onchange = () => {
  if (!selected) return;
  selected.applySystem32($('cadSys32').checked);
  refresh(); renderCad();
  toast(selected.sys32 ? '32 mm systém zapnutý' : '32 mm systém vypnutý');
});
$('cadHwDrill') && ($('cadHwDrill').onchange = () => { if (selected) { selected.applyHardwareDrilling($('cadHwDrill').checked); refresh(); renderCad(); toast(selected.hwDrill ? 'Vŕtanie kovania zapnuté' : 'Vypnuté'); } });
$('cadJoin') && ($('cadJoin').onchange = () => { if (selected) { selected.joinery = $('cadJoin').checked; refresh(); toast(selected.joinery ? 'Spoje zapnuté' : 'Spoje vypnuté'); } });
$('cadJoinType') && ($('cadJoinType').onchange = () => { if (selected) { selected.joineryType = $('cadJoinType').value; refresh(); } });
$('btnCadPrint') && ($('btnCadPrint').onclick = () => printPartCad());
function printPartCad() {
  const pt = cad.part; if (!pt) { toast('Vyber diel'); return; }
  const F = partFace(pt.size); const SC = Math.min(640 / F.uLen, 1); const W = F.uLen * SC, H = F.vLen * SC;
  const holes = (pt.cad.drilling || []).map((h) => `<circle cx="${h.x * SC}" cy="${(F.vLen - h.y) * SC}" r="${Math.max(2, h.d / 2 * SC)}" fill="none" stroke="#b00" stroke-width="1"/><text x="${h.x * SC + 5}" y="${(F.vLen - h.y) * SC - 4}" font-size="9" fill="#b00">⌀${h.d}</text>`).join('');
  const cuts = (pt.cad.cutouts || []).map((c) => `<rect x="${c.x * SC}" y="${(F.vLen - c.y - c.h) * SC}" width="${c.w * SC}" height="${c.h * SC}" fill="none" stroke="#b00" stroke-width="1.2"/><text x="${(c.x + c.w / 2) * SC}" y="${(F.vLen - c.y - c.h / 2) * SC}" font-size="9" text-anchor="middle" fill="#b00">${c.w}×${c.h}</text>`).join('');
  const dRows = (pt.cad.drilling || []).map((h, i) => `<tr><td>D${i + 1}</td><td>⌀${h.d}</td><td>${h.x}, ${h.y}</td></tr>`).join('');
  const cRows = (pt.cad.cutouts || []).map((c, i) => `<tr><td>V${i + 1}</td><td>${c.w}×${c.h}</td><td>${c.x}, ${c.y}</td></tr>`).join('');
  const html = `<!doctype html><meta charset=utf-8><title>Diel ${pt.key} — ${selected.name}</title>
    <style>body{font:13px system-ui;margin:28px;color:#222}h1{font-size:18px}table{border-collapse:collapse;margin:8px 0;font-size:12px}td,th{border-bottom:1px solid #ddd;padding:3px 10px;text-align:left}</style>
    <h1>${pt.key} · ${pt.name} — ${selected.name}</h1>
    <div>Rozmer: ${Math.round(pt.size.dx)}×${Math.round(pt.size.dy)}×${Math.round(pt.size.dz)} mm · plocha ${Math.round(F.uLen)}×${Math.round(F.vLen)} mm · materiál ${pt.material}</div>
    <svg width="${W + 2}" height="${H + 2}" style="background:#fff;margin:10px 0"><polygon points="${partOutline(pt).map(([x, y]) => `${x * SC},${(F.vLen - y) * SC}`).join(' ')}" fill="#f6f8fa" stroke="#222"/>${cuts}${holes}</svg>
    <h3>Vŕtanie</h3><table><thead><tr><th>#</th><th>⌀</th><th>Poloha (u,v)</th></tr></thead><tbody>${dRows || '<tr><td colspan=3>—</td></tr>'}</tbody></table>
    <h3>Výrezy</h3><table><thead><tr><th>#</th><th>Š×V</th><th>Poloha (u,v)</th></tr></thead><tbody>${cRows || '<tr><td colspan=3>—</td></tr>'}</tbody></table>
    <div style="color:#888;font-size:11px">cvjkit CAD dielu · ${new Date().toLocaleDateString('sk')}</div>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } else toast('Povoľ okná');
}

// --- CNC / DXF export (universal CAM interchange, no CV licence needed) ---
function downloadText(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}
// minimal R12 DXF: panel outline (LINE) + drilling (CIRCLE) + cutouts (LINE rect)
function partDxf(part) {
  const F = partFace(part.size);
  const o = []; const e = (...a) => { for (const x of a) o.push(x); };
  e('0', 'SECTION', '2', 'ENTITIES');
  const poly = (part.shape && part.shape !== 'rect') ? partOutline(part) : [[0, 0], [F.uLen, 0], [F.uLen, F.vLen], [0, F.vLen]];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; e('0', 'LINE', '8', 'OUTLINE', '10', a[0], '20', a[1], '11', b[0], '21', b[1]); }
  for (const h of (part.cad && part.cad.drilling) || []) e('0', 'CIRCLE', '8', 'DRILL', '10', h.x, '20', h.y, '40', (h.d || 8) / 2);
  for (const c of (part.cad && part.cad.cutouts) || []) { const p = [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]]; for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4]; e('0', 'LINE', '8', 'CUTOUT', '10', a[0], '20', a[1], '11', b[0], '21', b[1]); } }
  e('0', 'ENDSEC', '0', 'EOF');
  return o.join('\n');
}
$('btnCadDxf') && ($('btnCadDxf').onclick = () => {
  const pt = cad.part; if (!pt) { toast('Vyber diel'); return; }
  downloadText(`${selected.name}-${pt.key}.dxf`, partDxf(pt), 'application/dxf');
  toast('DXF dielu stiahnuté');
});
// G-code (3-axis router): drill cycles + contour routing of cutouts
function partGcode(part) {
  const F = partFace(part.size), thru = Math.round(F.nLen + 1);
  const L = ['%', '( cvjkit ' + part.key + ' ' + part.name + ' )', 'G21', 'G90', 'G0 Z5', 'M3 S18000'];
  for (const h of (part.cad && part.cad.drilling) || []) {
    const dep = h.sys ? 12 : thru;
    L.push(`G0 X${h.x} Y${h.y}`, `G1 Z-${dep} F300`, 'G0 Z5');
  }
  for (const c of (part.cad && part.cad.cutouts) || []) {
    L.push(`G0 X${c.x} Y${c.y}`, `G1 Z-${thru} F800`, `G1 X${c.x + c.w} Y${c.y}`, `G1 X${c.x + c.w} Y${c.y + c.h}`, `G1 X${c.x} Y${c.y + c.h}`, `G1 X${c.x} Y${c.y}`, 'G0 Z5');
  }
  L.push('M5', 'G0 X0 Y0', 'M30', '%');
  return L.join('\n');
}
$('btnCadGcode') && ($('btnCadGcode').onclick = () => {
  const pt = cad.part; if (!pt) { toast('Vyber diel'); return; }
  const drills = (pt.cad && pt.cad.drilling || []).length, cuts = (pt.cad && pt.cad.cutouts || []).length;
  if (!drills && !cuts) { toast('Diel bez vŕtania/výrezov'); return; }
  downloadText(`${selected.name}-${pt.key}.nc`, partGcode(pt), 'text/plain');
  toast(`G-kód: ${drills} dier, ${cuts} výrezov`);
});
// project CNC drilling CSV: every hole across all parts (machine import)
$('btnCncCsv') && ($('btnCncCsv').onclick = () => {
  const rows = [['Skrinka', 'Diel', 'Kód', 'Priemer(mm)', 'U(mm)', 'V(mm)', 'Hĺbka(mm)']];
  for (const c of room.cabinets) for (const p of c.parts) {
    const F = partFace(p.size);
    for (const h of (p.cad && p.cad.drilling) || []) rows.push([c.name, p.key, p.code, h.d || 8, h.x, h.y, h.sys ? 'systém' : 'priechod']);
    void F;
  }
  if (rows.length === 1) { toast('Žiadne vŕtanie — zapni 32 mm systém alebo navŕtaj diel'); return; }
  const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  downloadText((room.name || 'projekt') + '-cnc.csv', '﻿' + csv, 'text/csv');
  toast(`CNC CSV: ${rows.length - 1} dier`);
});
function addCabinet(type) {
  const n = room.cabinets.length;
  const cab = new Cabinet({ type, name: `${TYPE_LABEL[type]} ${n + 1}`, x: 50 + n * 650, z: 40, params: { ...constructionFrom(room.construction || {}) }, joineryType: (room.construction || {}).joint });
  room.addCabinet(cab); selectCabinet(cab); refresh(); view.frame(room);
  toast(`${TYPE_LABEL[type]} pridaná`);
}
$('btnAddCab').onclick = () => addCabinet('base');
for (const b of document.querySelectorAll('[data-add]')) {
  b.onclick = () => addCabinet(b.dataset.add);
}
$('btnFill').onclick = () => {
  const added = room.fillFrontWall({ z: 40 });
  if (added.length) selectCabinet(added[0]);
  refresh(); view.frame(room);
  toast(`Stena vyplnená: ${added.length} skriniek`);
};
$('btnDelCab').onclick = () => {
  if (!selected) return;
  room.cabinets = room.cabinets.filter((c) => c !== selected);
  selectCabinet(null); refresh(); toast('Skrinka zmazaná');
};
$('pType').onchange = (e) => {
  if (!selected) return;
  selected.setType(e.target.value);
  selectCabinet(selected); refresh(); view.frame(room);
};
$('pX') && ($('pX').oninput = () => { if (selected) { selected.x = +$('pX').value || 0; refresh(); } });
$('pZ') && ($('pZ').oninput = () => { if (selected) { selected.z = +$('pZ').value || 0; refresh(); } });
$('pRot') && ($('pRot').onchange = (e) => { if (selected) { selected.setRot(+e.target.value); refresh(); view.frame(room); toast('Natočenie ' + e.target.value + '°'); } });
$('pDoors').onchange = (e) => { if (selected) { selected.setParam('doors', +e.target.value); refresh(); } };
$('pDrawers').onchange = (e) => { if (selected) { selected.setParam('drawers', +e.target.value); refresh(); } };
$('pTopType').onchange = (e) => { if (selected) { selected.setParam('topType', e.target.value); refresh(); } };
$('pMaterial').onchange = (e) => { if (selected) { selected.setParam('material', e.target.value); refresh(); } };

// material dropdown: default decors, enriched with board decors from prices.json when present
const DEFAULT_MATERIALS = ['Board 18', 'Biela', 'Dub Sonoma', 'Antracit', 'Betón', 'Orech'];
function boardMaterials() {
  const set = new Set(DEFAULT_MATERIALS);
  if (CV && CV.materials) for (const m of CV.materials) { set.add(m.name.slice(0, 48)); if (set.size > 400) break; } // real CVData boards
  if (PRICES) for (const n of Object.keys(PRICES)) { if (/DTD|LTD|lamino/i.test(n) && /\d{2}([.,]\d)?mm/i.test(n)) { set.add(n.slice(0, 40)); if (set.size > 400) break; } }
  return [...set];
}
function populateMaterials(current) {
  const sel = $('pMaterial'); const mats = boardMaterials();
  if (current && !mats.includes(current)) mats.unshift(current);
  sel.innerHTML = mats.map((m) => `<option${m === current ? ' selected' : ''}>${m}</option>`).join('');
  renderSwatches(current);
}
// visual material swatches (click a colour to set the cabinet material) — ProdBoard feel
const SWATCHES = [['Board 18', '#caa472'], ['Biela', '#f0f0ec'], ['Dub Sonoma', '#c9a96a'], ['Antracit', '#33373c'], ['Betón', '#9a9a96'], ['Orech', '#6b4a2f'], ['Čierna', '#202326']];
function renderSwatches(current) {
  const box = $('matSwatches'); if (!box) return; box.innerHTML = '';
  for (const [name, col] of SWATCHES) {
    const sw = document.createElement('button'); sw.className = 'swatch' + (name === current ? ' active' : '');
    sw.style.background = col; sw.title = name;
    sw.onclick = () => { if (selected) { selected.setParam('material', name); populateMaterials(name); refresh(); toast('Materiál: ' + name); } };
    box.appendChild(sw);
  }
}

// --- visual catalog: door styles + handles (ProdBoard-style gallery) ---
// Each entry has an inline SVG thumbnail so the studio picks by picture, not by word.
const DOOR_STYLES = [
  ['slab',   'Hladké',  '<rect x="4" y="3" width="40" height="52" rx="2" fill="#d8c49a" stroke="#9c8352"/>'],
  ['shaker', 'Rámové',  '<rect x="4" y="3" width="40" height="52" rx="2" fill="#d8c49a" stroke="#9c8352"/><rect x="11" y="11" width="26" height="36" fill="#c6ad7c" stroke="#9c8352"/>'],
  ['raised', 'Kazeta',  '<rect x="4" y="3" width="40" height="52" rx="2" fill="#d8c49a" stroke="#9c8352"/><rect x="11" y="11" width="26" height="36" fill="#e4d2a8" stroke="#9c8352"/><rect x="15" y="15" width="18" height="28" fill="#d8c49a" stroke="#9c8352"/>'],
  ['glass',  'Sklo',    '<rect x="4" y="3" width="40" height="52" rx="2" fill="#d8c49a" stroke="#9c8352"/><rect x="11" y="11" width="26" height="36" fill="#bcd6e4" stroke="#7fa6bb"/><line x1="11" y1="11" x2="37" y2="47" stroke="#fff" opacity=".5"/>'],
];
const HANDLES = [
  ['bar',  'Madlo',  '<rect x="6" y="4" width="36" height="50" rx="2" fill="#d8c49a" stroke="#9c8352"/><rect x="33" y="18" width="4" height="22" rx="2" fill="#4a4f55"/>'],
  ['knob', 'Knopka', '<rect x="6" y="4" width="36" height="50" rx="2" fill="#d8c49a" stroke="#9c8352"/><circle cx="35" cy="29" r="4" fill="#4a4f55"/>'],
  ['gola', 'Gola',   '<rect x="6" y="4" width="36" height="50" rx="2" fill="#d8c49a" stroke="#9c8352"/><rect x="8" y="5" width="32" height="5" rx="1" fill="#4a4f55"/>'],
  ['none', 'Bez',    '<rect x="6" y="4" width="36" height="50" rx="2" fill="#d8c49a" stroke="#9c8352"/><text x="24" y="33" font-size="9" text-anchor="middle" fill="#9c8352">push</text>'],
];
function renderGallery(boxId, items, current, apply) {
  const box = $(boxId); if (!box) return; box.innerHTML = '';
  for (const [key, label, svg] of items) {
    const b = document.createElement('button');
    b.className = 'tile' + (key === current ? ' active' : '');
    b.innerHTML = `<svg viewBox="0 0 48 58">${svg}</svg><span>${label}</span>`;
    b.onclick = () => { if (selected) { apply(key); refresh(); renderCatalog(selected); toast(label); } };
    box.appendChild(b);
  }
}
function renderCatalog(cab) {
  renderGallery('doorStyles', DOOR_STYLES, cab.params.doorStyle, (k) => cab.setParam('doorStyle', k));
  renderGallery('handleStyles', HANDLES, cab.params.handle, (k) => cab.setParam('handle', k));
}
$('btnFrame').onclick = () => { view.setViewMode('3d'); $('btnView2d').textContent = '2D pôdorys'; };
let view2d = false;
$('btnView2d').onclick = () => { view2d = !view2d; view.setViewMode(view2d ? 'top' : '3d'); $('btnView2d').textContent = view2d ? '3D pohľad' : '2D pôdorys'; };

// click-to-select in 3D
view.onPick = (cab) => { selectCabinet(cab); refresh(); };

// drag cabinets along the floor with snapping — ProdBoard-style arranging
view.onDragMove = (cab, x, z) => {
  const W = cab.params.W || 600;
  let maxX = 0; for (const w of room.walls) maxX = Math.max(maxX, w.a.x, w.b.x); maxX = maxX || 4000;
  x = Math.max(0, Math.min(x, maxX - W));
  for (const o of room.cabinets) { if (o === cab) continue; const ow = o.params.W || 600;
    if (Math.abs(x - (o.x + ow)) < 45) x = o.x + ow;                 // snap my left edge to its right
    else if (Math.abs((x + W) - o.x) < 45) x = o.x - W;              // snap my right edge to its left
  }
  z = Math.max(0, z); if (z < 45) z = 0;                             // snap to back wall
  cab.x = x; cab.z = z; refresh();
};
view.onDragEnd = (cab) => { selectCabinet(cab); };

$('btnExportJson').onclick = () => {
  const data = {
    room: { name: room.name, walls: room.walls.map((w) => ({ a: w.a, b: w.b, height: w.height })) },
    cabinets: room.cabinets.map((c) => ({ name: c.name, type: c.type, pos: { x: c.x, y: c.y, z: c.z }, params: c.params,
      parts: c.parts.map((p) => ({ code: p.code, name: p.name, pos: p.pos, size: p.size, material: p.material })) })),
    stats: room.stats(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'job.json'; a.click();
  toast('JSON exportovaný');
};

// --- project save / load (localStorage autosave + JSON file) ---
const PROJ_KEY = 'cvjkit-project';
function projectData() {
  let maxX = 0, maxZ = 0, h = 2440;
  for (const w of room.walls) { maxX = Math.max(maxX, w.a.x, w.b.x); maxZ = Math.max(maxZ, w.a.z, w.b.z); h = w.height || h; }
  return { v: 1, name: room.name, room: { W: Math.round(maxX) || 4000, D: Math.round(maxZ) || 3000, H: Math.round(h) },
    worktop: room.worktop !== false, worktopOpts: room.worktopOpts || { thickness: 38 },
    construction: room.construction || null,
    appliances: room.appliances.map((a) => ({ type: a.type, name: a.name, x: a.x, y: a.y, z: a.z, size: { ...a.size } })),
    accessories: room.accessories.map((a) => ({ type: a.type, name: a.name, x: a.x, y: a.y, z: a.z, size: { ...a.size }, material: a.material })),
    cabinets: room.cabinets.map((c) => ({ type: c.type, name: c.name, x: c.x, y: c.y, z: c.z, params: { ...c.params }, partCad: c.partCad, customParts: c.customParts, sys32: c.sys32, rot: c.rot, joinery: c.joinery, joineryType: c.joineryType, hwDrill: c.hwDrill, cvParts: c.cvParts, cvDef: c.cvDef })) };
}
function applyProject(d) {
  room = Room.rectangle(d.room.W, d.room.D, d.room.H); room.name = d.name || room.name;
  room.worktop = d.worktop !== false; room.worktopOpts = d.worktopOpts || { thickness: 38 };
  room.construction = d.construction || { ...DEFAULT_CONSTRUCTION };
  room.cabinets = []; room.appliances = [];
  for (const c of d.cabinets || []) room.addCabinet(new Cabinet({ type: c.type, name: c.name, x: c.x, y: c.y, z: c.z, params: c.params, partCad: c.partCad, customParts: c.customParts, sys32: c.sys32, rot: c.rot, joinery: c.joinery, joineryType: c.joineryType, hwDrill: c.hwDrill, cvParts: c.cvParts, cvDef: c.cvDef }));
  for (const a of d.appliances || []) room.addAppliance(new Appliance({ type: a.type, name: a.name, x: a.x, y: a.y, z: a.z, size: a.size }));
  for (const a of d.accessories || []) room.addAccessory(new Accessory({ type: a.type, name: a.name, x: a.x, y: a.y, z: a.z, size: a.size, material: a.material }));
  if ($('roomWorktop')) $('roomWorktop').checked = room.worktop;
  if ($('roomWtThick')) $('roomWtThick').value = room.worktopOpts.thickness || 38;
  selectCabinet(room.cabinets[0] || null); refresh(); view.frame(room);
}
function autosave() { try { localStorage.setItem(PROJ_KEY, JSON.stringify(projectData())); } catch (_) { /* private mode */ } }

$('btnSaveProj').onclick = () => {
  autosave();
  const blob = new Blob([JSON.stringify(projectData(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (room.name || 'projekt') + '.json'; a.click();
  toast('Projekt uložený');
};
$('fileProj').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { applyProject(JSON.parse(await f.text())); toast('Projekt načítaný'); } catch (err) { toast('Chyba: ' + err.message); }
};

// --- cut-list CSV (from the designed cabinets' parts) ---
$('btnCutlist').onclick = () => {
  const rows = [['Skrinka', 'Kód', 'Diel', 'Dĺžka(mm)', 'Šírka(mm)', 'Hrúbka(mm)', 'Materiál', 'Olepenie', 'Hrana(mm)']];
  for (const c of room.cabinets) for (const p of c.parts) {
    const d = [p.size.dx, p.size.dy, p.size.dz].sort((a, b) => b - a);
    const bnd = partBanding(p);
    rows.push([c.name, p.code, p.name, Math.round(d[0]), Math.round(d[1]), Math.round(d[2]), p.material, bnd.edges ? `${bnd.desc} ${bnd.material}` : '', bnd.mm || '']);
  }
  if (room.worktop !== false) computeWorktops(room, room.worktopOpts || {}).forEach((wt, i) => {
    rows.push(['Doska', 'WT', `Pracovná doska ${i + 1}`, wt.length, wt.depth, wt.thickness, wt.material, '', '']);
    (wt.cutouts || []).forEach((c) => rows.push(['Doska', 'VÝREZ', `Výrez ${c.name} (x=${c.x}, z=${c.z})`, c.w, c.d, '', '', '', '']));
  });
  for (const a of room.accessories || []) {
    const d = [a.size.dx, a.size.dy, a.size.dz].sort((x, y) => y - x);
    rows.push(['Doplnok', 'ACC', a.name, Math.round(d[0]), Math.round(d[1]), Math.round(d[2]), a.material || 'Board 18', 'čelo ABS 2mm', Math.round(d[0])]);
  }
  const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (room.name || 'projekt') + '-cutlist.csv'; a.click();
  toast(`Cut-list: ${rows.length - 1} dielov`);
};

// --- shop drawing: 2D front elevation with dimensions (selected cabinet) ---
$('btnDraw').onclick = () => {
  if (!selected) { toast('Vyber skrinku'); return; }
  const p = selected.params; const W = p.W, H = p.H;
  const SC = Math.min(1, 540 / W); const sw = W * SC, sh = H * SC;
  const fy = (y, dy) => (H - (y + dy)) * SC;                         // flip Y (cabinet up → svg down)
  const fronts = selected.parts.filter((pt) => pt.code === 'DOR' || pt.code === 'DF');
  const style = p.doorStyle || 'slab', handle = p.handle || 'bar';
  const rects = fronts.map((pt) => {
    const x = pt.pos.x * SC, y = fy(pt.pos.y, pt.size.dy), w = pt.size.dx * SC, h = pt.size.dy * SC;
    const fill = style === 'glass' ? '#e7f0f6' : '#eef4fa';
    let inner = '';
    if (style !== 'slab') {                                      // inset frame for shaker/raised/glass
      const m = Math.max(10, Math.min(w, h) * 0.14);
      inner = `<rect x="${x + m}" y="${y + m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="#2a6cb0" stroke-width="0.8"/>`;
      if (style === 'raised') inner += `<rect x="${x + m + 4}" y="${y + m + 4}" width="${w - 2 * m - 8}" height="${h - 2 * m - 8}" fill="none" stroke="#6b96c0" stroke-width="0.6"/>`;
      if (style === 'glass') inner += `<line x1="${x + m}" y1="${y + m}" x2="${x + w - m}" y2="${y + h - m}" stroke="#9cc" stroke-width="0.6"/>`;
    }
    const cy = y + h / 2;
    let hndl = '';                                               // handle marker
    if (handle === 'bar') hndl = `<rect x="${x + w - 9}" y="${cy - 11}" width="2.4" height="22" rx="1" fill="#333"/>`;
    else if (handle === 'knob') hndl = `<circle cx="${x + w - 8}" cy="${cy}" r="2.6" fill="#333"/>`;
    else if (handle === 'gola') hndl = `<rect x="${x + 3}" y="${y + 1.5}" width="${w - 6}" height="2.4" fill="#333"/>`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="#2a6cb0" stroke-width="1"/>${inner}${hndl}
      <text x="${x + w / 2}" y="${y + h / 2 + 4}" font-size="11" text-anchor="middle" fill="#345">${Math.round(pt.size.dx)}×${Math.round(pt.size.dy)}</text>`;
  }).join('');
  const toe = p.toe | 0; const toeLine = toe > 0 ? `<line x1="0" y1="${sh - toe * SC}" x2="${sw}" y2="${sh - toe * SC}" stroke="#888" stroke-dasharray="4 3"/>` : '';
  const dimW = `<line x1="0" y1="${sh + 24}" x2="${sw}" y2="${sh + 24}" stroke="#333"/><line x1="0" y1="${sh + 18}" x2="0" y2="${sh + 30}" stroke="#333"/><line x1="${sw}" y1="${sh + 18}" x2="${sw}" y2="${sh + 30}" stroke="#333"/><text x="${sw / 2}" y="${sh + 40}" font-size="13" text-anchor="middle">${Math.round(W)} mm</text>`;
  const dimH = `<line x1="-24" y1="0" x2="-24" y2="${sh}" stroke="#333"/><line x1="-30" y1="0" x2="-18" y2="0" stroke="#333"/><line x1="-30" y1="${sh}" x2="-18" y2="${sh}" stroke="#333"/><text x="-30" y="${sh / 2}" font-size="13" text-anchor="middle" transform="rotate(-90 -30 ${sh / 2})">${Math.round(H)} mm</text>`;
  const svg = `<svg width="${sw + 120}" height="${sh + 70}" viewBox="-60 -16 ${sw + 120} ${sh + 70}" style="background:#fff">
    <rect x="0" y="0" width="${sw}" height="${sh}" fill="#f6f8fa" stroke="#222" stroke-width="1.6"/>${toeLine}${rects}${dimW}${dimH}</svg>`;
  const partRows = selected.parts.map((pt) => { const bnd = partBanding(pt); return `<tr><td>${pt.code}</td><td>${pt.name}</td><td style="text-align:right">${[pt.size.dx, pt.size.dy, pt.size.dz].map(Math.round).join(' × ')}</td><td>${bnd.edges ? bnd.desc : '—'}</td></tr>`; }).join('');
  const html = `<!doctype html><meta charset=utf-8><title>Výkres — ${selected.name}</title>
    <style>body{font:13px system-ui;margin:28px;color:#222}h1{font-size:19px}table{border-collapse:collapse;margin:12px 0;font-size:12px}td,th{border-bottom:1px solid #ddd;padding:4px 10px;text-align:left}</style>
    <h1>Výkres — ${selected.name}</h1>
    <div>${selected.type} · ${Math.round(W)}×${Math.round(H)}×${Math.round(p.D)} mm · materiál ${p.material || 'Board 18'}</div>
    <div style="color:#555">Front: ${({slab:'hladké',shaker:'rámové',raised:'kazeta',glass:'sklo'})[style] || style} · úchytka: ${({bar:'madlo',knob:'knopka',gola:'gola',none:'bez (push)'})[handle] || handle}</div>
    ${svg}
    <h3>Kusovník</h3><table><thead><tr><th>Kód</th><th>Diel</th><th>Rozmer (mm)</th><th>Olepenie</th></tr></thead><tbody>${partRows}</tbody></table>
    <div style="color:#888;font-size:11px">cvjkit výkres · ${new Date().toLocaleDateString('sk')}</div>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } else toast('Povoľ vyskakovacie okná');
  toast('Výkres vygenerovaný');
};

// --- full-wall elevation: all front-wall cabinets to scale with dimensions ---
$('btnWallDraw').onclick = () => {
  const cabs = room.cabinets.filter((c) => (c.rot || 0) === 0).sort((a, b) => a.x - b.x);
  if (!cabs.length) { toast('Žiadne čelné skrinky'); return; }
  const minX = Math.min(...cabs.map((c) => c.x)), maxX = Math.max(...cabs.map((c) => c.x + c.params.W));
  const maxTop = Math.max(...cabs.map((c) => c.y + c.params.H));
  const totalW = maxX - minX;
  const SC = Math.min(1000 / totalW, 0.5);
  const sw = totalW * SC, sh = maxTop * SC;
  const X = (x) => (x - minX) * SC, Y = (y) => (maxTop - y) * SC;   // world → svg
  let body = '', dims = '';
  for (const c of cabs) {
    const p = c.params, style = p.doorStyle || 'slab', handle = p.handle || 'bar';
    const cx = X(c.x), cw = p.W * SC, cyTop = Y(c.y + p.H), ch = p.H * SC;
    body += `<rect x="${cx}" y="${cyTop}" width="${cw}" height="${ch}" fill="#f6f8fa" stroke="#222" stroke-width="1.2"/>`;
    // toe
    const toe = (c.type === 'wall') ? 0 : (p.toe | 0);
    if (toe > 0) body += `<line x1="${cx}" y1="${Y(c.y + toe)}" x2="${cx + cw}" y2="${Y(c.y + toe)}" stroke="#999" stroke-dasharray="4 3"/>`;
    // fronts
    for (const pt of c.parts) {
      if (pt.code !== 'DOR' && pt.code !== 'DF') continue;
      const fx = X(c.x + pt.pos.x), fw = pt.size.dx * SC, fyTop = Y(c.y + pt.pos.y + pt.size.dy), fh = pt.size.dy * SC;
      const fill = style === 'glass' ? '#e7f0f6' : '#eef4fa';
      body += `<rect x="${fx}" y="${fyTop}" width="${fw}" height="${fh}" fill="${fill}" stroke="#2a6cb0" stroke-width="0.8"/>`;
      if (style !== 'slab') { const m = Math.max(6, Math.min(fw, fh) * 0.14); body += `<rect x="${fx + m}" y="${fyTop + m}" width="${fw - 2 * m}" height="${fh - 2 * m}" fill="none" stroke="#6b96c0" stroke-width="0.6"/>`; }
      const cyMid = fyTop + fh / 2;
      if (handle === 'bar') body += `<rect x="${fx + fw - 7}" y="${cyMid - 10}" width="2" height="20" fill="#333"/>`;
      else if (handle === 'knob') body += `<circle cx="${fx + fw - 6}" cy="${cyMid}" r="2.4" fill="#333"/>`;
      else if (handle === 'gola') body += `<rect x="${fx + 2}" y="${fyTop + 1}" width="${fw - 4}" height="2" fill="#333"/>`;
    }
    // worktop slab line for floor cabinets
    if (['base', 'sink', 'drawer', 'corner'].includes(c.type)) {
      const wt = (room.worktopOpts && room.worktopOpts.thickness) || 38;
      body += `<rect x="${cx - 2}" y="${Y(c.y + p.H + wt)}" width="${cw + 4}" height="${wt * SC}" fill="#c9ced3" stroke="#555" stroke-width="0.6"/>`;
    }
    // per-cabinet width dim
    dims += `<text x="${cx + cw / 2}" y="${sh + 14}" font-size="10" text-anchor="middle" fill="#345">${Math.round(p.W)}</text>`;
  }
  const overall = `<line x1="0" y1="${sh + 28}" x2="${sw}" y2="${sh + 28}" stroke="#333"/><text x="${sw / 2}" y="${sh + 42}" font-size="12" text-anchor="middle">${Math.round(totalW)} mm</text>`;
  const heightDim = `<line x1="-20" y1="0" x2="-20" y2="${sh}" stroke="#333"/><text x="-26" y="${sh / 2}" font-size="12" text-anchor="middle" transform="rotate(-90 -26 ${sh / 2})">${Math.round(maxTop)} mm</text>`;
  const svg = `<svg width="${sw + 90}" height="${sh + 60}" viewBox="-50 -14 ${sw + 90} ${sh + 60}" style="background:#fff">${body}${dims}${overall}${heightDim}</svg>`;
  const html = `<!doctype html><meta charset=utf-8><title>Nárys steny — ${room.name}</title>
    <style>body{font:13px system-ui;margin:28px;color:#222}h1{font-size:19px}</style>
    <h1>Nárys steny — ${room.name}</h1>
    <div>${cabs.length} skriniek · šírka ${Math.round(totalW)} mm · výška ${Math.round(maxTop)} mm</div>
    ${svg}
    <div style="color:#888;font-size:11px;margin-top:12px">cvjkit nárys steny · ${new Date().toLocaleDateString('sk')}</div>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } else toast('Povoľ vyskakovacie okná');
  toast('Nárys steny vygenerovaný');
};

// --- nesting (cutting optimization) — visual sheet layouts from the design ---
$('btnNest').onclick = () => {
  const parts = [];
  for (const c of room.cabinets) for (const p of c.parts) {
    const d = [p.size.dx, p.size.dy, p.size.dz].sort((a, b) => b - a);
    if (d[2] < 3 || d[2] > 50 || d[1] < 20) continue;             // real boards only (by thickness)
    parts.push({ w: d[1], l: d[0], name: `${c.name}·${p.code}`, material: p.material });
  }
  if (!parts.length) { toast('Žiadne diely na nesting'); return; }
  const r = nest(parts);
  const SC = 0.16;                                                 // mm → px for the SVG preview
  const sheetSvg = (s) => {
    const rects = s.placements.map((p) => `<rect x="${p.x * SC}" y="${p.y * SC}" width="${p.w * SC}" height="${p.l * SC}" fill="#cfe0f2" stroke="#2a6cb0" stroke-width="0.6"/><text x="${(p.x + p.w / 2) * SC}" y="${(p.y + p.l / 2) * SC}" font-size="7" text-anchor="middle" fill="#234">${Math.round(p.l)}×${Math.round(p.w)}</text>`).join('');
    return `<div style="margin:10px 0"><b>${s.material} — doska ${s.index}</b> (${r.sheet.W}×${r.sheet.L} mm · využitie ${s.used}%)<br>
      <svg width="${r.sheet.W * SC}" height="${r.sheet.L * SC}" style="background:#f0f3f6;border:1px solid #888">${rects}</svg></div>`;
  };
  const rep = Object.entries(r.byMaterial).map(([m, b]) => `<tr><td>${m}</td><td style="text-align:right">${b.sheets}</td><td style="text-align:right">${b.areaParts} m²</td><td style="text-align:right">${b.wastePct} %</td></tr>`).join('');
  const html = `<!doctype html><meta charset=utf-8><title>Nesting — ${room.name}</title>
    <style>body{font:13px system-ui;margin:28px;color:#222}h1{font-size:19px}table{border-collapse:collapse;margin:10px 0}td,th{border-bottom:1px solid #ddd;padding:5px 10px;text-align:left}</style>
    <h1>Nesting — ${room.name}</h1>
    <div>Dosiek spolu: <b>${r.totalSheets}</b> · formát ${r.sheet.W}×${r.sheet.L} mm · rez ${r.sheet.kerf} mm</div>
    <table><thead><tr><th>Materiál</th><th>Dosiek</th><th>Diely</th><th>Odpad</th></tr></thead><tbody>${rep}</tbody></table>
    ${r.sheets.map(sheetSvg).join('')}
    <div style="color:#888;font-size:11px;margin-top:16px">cvjkit nesting · ${new Date().toLocaleDateString('sk')}</div>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } else toast('Povoľ vyskakovacie okná');
  toast(`Nesting: ${r.totalSheets} dosiek`);
};

// --- Code 39 barcode → SVG (scannable part ID on every label) ---
const C39 = { '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn', 'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn' };
function barcodeSvg(text, h = 34) {
  const s = '*' + String(text).toUpperCase().replace(/[^0-9A-Z. -]/g, '-') + '*';
  const nw = 1.7, ww = nw * 2.6; let x = 0; const bars = [];
  for (const ch of s) {
    const pat = C39[ch] || C39['-'];
    for (let i = 0; i < 9; i++) {
      const w = pat[i] === 'w' ? ww : nw;
      if (i % 2 === 0) bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${h}" fill="#111"/>`);
      x += w;
    }
    x += nw; // inter-character gap
  }
  return `<svg width="${Math.ceil(x)}" height="${h}" viewBox="0 0 ${Math.ceil(x)} ${h}">${bars.join('')}</svg>`;
}

// --- Štítky: one printable label per part (ID barcode + dims + material) ---
$('btnLabels').onclick = () => {
  const src = selected ? [selected] : room.cabinets;
  if (!src.length) { toast('Žiadne skrinky'); return; }
  const labels = [];
  for (const c of src) {
    const cabId = `C${c.id}`;
    c.parts.forEach((pt, i) => {
      const id = `${cabId}-${pt.code}${i + 1}`;
      const dims = [pt.size.dx, pt.size.dy, pt.size.dz].map(Math.round);
      const bnd = partBanding(pt);
      const bndLine = bnd.edges ? `<div class="le">Hrana: ${bnd.desc} · ${bnd.material} · ${bnd.mm} mm</div>` : '';
      labels.push(`<div class="lbl">
        <div class="lh"><b>${c.name}</b><span>${id}</span></div>
        <div class="lp">${pt.code} · ${pt.name}</div>
        <div class="ld">${dims[0]} × ${dims[1]} × ${dims[2]} mm</div>
        <div class="lm">${pt.material || 'Board 18'}</div>
        ${bndLine}
        <div class="lb">${barcodeSvg(id)}</div>
      </div>`);
    });
  }
  const html = `<!doctype html><meta charset=utf-8><title>Štítky — ${room.name}</title>
    <style>
      @page{margin:8mm}
      body{font:11px system-ui;margin:0;color:#111}
      h1{font-size:16px;margin:10px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;padding:6mm}
      .lbl{border:1px solid #333;border-radius:3px;padding:6px 8px;height:34mm;display:flex;flex-direction:column;justify-content:space-between;page-break-inside:avoid}
      .lh{display:flex;justify-content:space-between;align-items:baseline}
      .lh span{font:600 10px ui-monospace,monospace;color:#2a6cb0}
      .lp{color:#444}.ld{font-size:14px;font-weight:700}.lm{color:#666;font-size:10px}.le{color:#2a6cb0;font-size:9px}
      .lb{margin-top:2px}.lb svg{max-width:100%}
      @media print{h1{display:none}}
    </style>
    <h1>Štítky dielov — ${room.name} (${labels.length} ks)</h1>
    <div class="grid">${labels.join('')}</div>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } else toast('Povoľ vyskakovacie okná');
  toast(`Štítky: ${labels.length} ks`);
};

// --- Výrobný list: production report for the whole project ---
$('btnReport').onclick = () => {
  const cabs = room.cabinets;
  if (!cabs.length) { toast('Žiadne skrinky'); return; }
  let totParts = 0, totArea = 0; const matArea = {};
  const cabRows = cabs.map((c) => {
    const p = c.params; let a = 0; const hw = {};
    for (const pt of c.parts) { const d = [pt.size.dx, pt.size.dy, pt.size.dz].sort((x, y) => y - x); const a2 = d[0] * d[1] / 1e6; a += a2; matArea[pt.material] = (matArea[pt.material] || 0) + a2; }
    totParts += c.parts.length; totArea += a;
    const hinges = (p.doors | 0) * 2;                 // 2 hinges per door leaf
    const runners = c.type === 'drawer' ? (p.drawers | 0) : 0;
    return `<tr><td>${c.name}</td><td>${c.type}</td><td>${Math.round(p.W)}×${Math.round(p.H)}×${Math.round(p.D)}</td>
      <td>${({slab:'hladké',shaker:'rámové',raised:'kazeta',glass:'sklo'})[p.doorStyle] || p.doorStyle}</td>
      <td>${({bar:'madlo',knob:'knopka',gola:'gola',none:'bez'})[p.handle] || p.handle}</td>
      <td style="text-align:right">${c.parts.length}</td><td style="text-align:right">${hinges}</td><td style="text-align:right">${runners}</td></tr>`;
  }).join('');
  for (const a of room.accessories || []) { const d = [a.size.dx, a.size.dy, a.size.dz].sort((x, y) => y - x); matArea[a.material || 'Board 18'] = (matArea[a.material || 'Board 18'] || 0) + d[0] * d[1] / 1e6; }
  const matRows = Object.entries(matArea).map(([m, a]) => `<tr><td>${m}</td><td style="text-align:right">${a.toFixed(2)} m²</td></tr>`).join('');
  const accTile = (room.accessories || []).length ? `<div>Doplnky<b>${room.accessories.length} ks</b></div>` : '';
  const totalHinges = cabs.reduce((s, c) => s + (c.params.doors | 0) * 2, 0);
  const totalRunners = cabs.reduce((s, c) => s + (c.type === 'drawer' ? (c.params.drawers | 0) : 0), 0);
  const bandMm = cabs.reduce((s, c) => s + c.parts.reduce((t, p) => t + partBanding(p).mm, 0), 0);
  const bandTile = bandMm ? `<div>Olepovanie hrán<b>${(bandMm / 1000).toFixed(2)} bm</b></div>` : '';
  const holeCount = cabs.reduce((s, c) => s + c.parts.reduce((t, p) => t + ((p.cad && p.cad.drilling) ? p.cad.drilling.length : 0), 0), 0);
  const holeTile = holeCount ? `<div>Vŕtanie<b>${holeCount} ks</b></div>` : '';
  const conByType = {};
  for (const c of cabs) for (const con of c.connectors()) conByType[con.type] = (conByType[con.type] || 0) + 1;
  const conTotal = Object.values(conByType).reduce((a, b) => a + b, 0);
  const CON_LABEL = { minifix: 'Minifix', dowel: 'Kolík', confirmat: 'Confirmat' };
  const conTile = conTotal ? `<div>Spoje<b>${conTotal} ks</b></div>` : '';
  const conRows = Object.entries(conByType).map(([t, n]) => `<tr><td>${CON_LABEL[t] || t}</td><td style="text-align:right">${n} ks</td></tr>`).join('');
  const conSection = conTotal ? `<h3>Spojovacia technika</h3><table><thead><tr><th>Typ</th><th>Počet</th></tr></thead><tbody>${conRows}</tbody></table>` : '';
  const wts = room.worktop !== false ? computeWorktops(room, room.worktopOpts || {}) : [];
  const wtMm = wts.reduce((s, w) => s + w.length, 0);
  const wtArea = wts.reduce((s, w) => s + w.length * w.depth / 1e6, 0);
  const wtTile = wts.length ? `<div>Pracovná doska<b>${(wtMm / 1000).toFixed(2)} bm</b></div>` : '';
  const wtCuts = wts.reduce((a, w) => a.concat((w.cutouts || []).map((c) => `${c.name} ${c.w}×${c.d}`)), []);
  const wtRow = wts.length ? `<tr><td>Pracovná doska (${wts.length} ks)${wtCuts.length ? ` · výrezy: ${wtCuts.join(', ')}` : ''}</td><td style="text-align:right">${wtArea.toFixed(2)} m² · ${(wtMm / 1000).toFixed(2)} bm</td></tr>` : '';
  const appls = room.appliances || [];
  const applRows = appls.map((a) => `<tr><td>${a.name}</td><td>${Math.round(a.size.dx)}×${Math.round(a.size.dy)}×${Math.round(a.size.dz)}</td></tr>`).join('');
  const applSection = appls.length ? `<h3>Spotrebiče (${appls.length})</h3><table><thead><tr><th>Spotrebič</th><th>Rozmer (mm)</th></tr></thead><tbody>${applRows}</tbody></table>` : '';
  const con = room.construction || {};
  const conLine = `<div style="color:#555;margin:4px 0">Konštrukcia: <b>${con.name || 'Štandard'}</b> · hrúbka ${con.T || 18}/${con.BT || 6} mm · vôľa ${con.doorGap ?? 3} · dvierka ${con.doorOverlay || 'overlay'} · chrbát ${con.backJoint || 'applied'} · spoj ${con.joint || 'minifix'} · hrana ${con.bandDoor || 'ABS 2mm'}</div>`;
  const html = `<!doctype html><meta charset=utf-8><title>Výrobný list — ${room.name}</title>
    <style>body{font:12px system-ui;margin:28px;color:#111}h1{font-size:19px}h3{margin:16px 0 4px}
      table{border-collapse:collapse;margin:6px 0;font-size:12px}td,th{border-bottom:1px solid #ddd;padding:4px 9px;text-align:left}
      .sum{display:flex;gap:24px;margin:10px 0;font-size:13px}.sum b{font-size:17px;display:block}</style>
    <h1>Výrobný list — ${room.name}</h1>
    ${conLine}
    <div class="sum"><div>Skriniek<b>${cabs.length}</b></div><div>Dielov<b>${totParts}</b></div>
      <div>Plocha dosky<b>${totArea.toFixed(2)} m²</b></div><div>Pántov<b>${totalHinges}</b></div><div>Súprav pojazdov<b>${totalRunners}</b></div>${bandTile}${holeTile}${conTile}${wtTile}${accTile}</div>
    <h3>Skrinky</h3>
    <table><thead><tr><th>Skrinka</th><th>Typ</th><th>Š×V×H</th><th>Front</th><th>Úchytka</th><th>Diely</th><th>Pánty</th><th>Pojazdy</th></tr></thead><tbody>${cabRows}</tbody></table>
    <h3>Materiál</h3>
    <table><thead><tr><th>Materiál</th><th>Plocha</th></tr></thead><tbody>${matRows}${wtRow}</tbody></table>
    ${conSection}
    ${applSection}
    <div style="color:#888;font-size:11px;margin-top:16px">cvjkit výrobný list · ${new Date().toLocaleString('sk')}</div>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } else toast('Povoľ vyskakovacie okná');
  toast('Výrobný list vygenerovaný');
};

// --- ponuka (printable quote from the design) ---
$('btnQuote').onclick = () => {
  let area = 0, parts = 0; const mat = {};
  for (const c of room.cabinets) for (const p of c.parts) { parts++; const d = [p.size.dx, p.size.dy, p.size.dz].sort((a, b) => b - a); const a2 = d[0] * d[1] / 1e6; area += a2; mat[p.material] = (mat[p.material] || 0) + a2; }
  const rate = +($('rBoard') && $('rBoard').value) || 25;
  const matRows = Object.entries(mat).map(([m, a]) => `<tr><td>${m}</td><td style="text-align:right">${a.toFixed(2)} m²</td><td style="text-align:right">${(a * rate).toFixed(2)} €</td></tr>`).join('');
  // worktop priced per running metre (odhad)
  const wtRate = 95;                                             // €/bm odhad pracovnej dosky
  const wts = room.worktop !== false ? computeWorktops(room, room.worktopOpts || {}) : [];
  const wtMm = wts.reduce((s, w) => s + w.length, 0), wtBm = wtMm / 1000;
  const wtCost = wtBm * wtRate;
  const wtRow = wts.length ? `<tr><td>Pracovná doska</td><td style="text-align:right">${wtBm.toFixed(2)} bm</td><td style="text-align:right">${wtCost.toFixed(2)} €</td></tr>` : '';
  const total = area * rate + wtCost;
  const html = `<!doctype html><meta charset=utf-8><title>Ponuka — ${room.name}</title>
    <style>body{font:14px system-ui;margin:32px;color:#222}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}tfoot td{font-weight:700;border-top:2px solid #333}</style>
    <h1>Cenová ponuka — ${room.name}</h1>
    <div>Skriniek: ${room.cabinets.length} · dielov: ${parts} · plocha: ${area.toFixed(2)} m²</div>
    <div style="color:#b00;font-size:12px;margin:6px 0">ODHAD (sadzba ${rate} €/m²) — pravé ceny budú z ProdBoardu</div>
    <table><thead><tr><th>Materiál</th><th style="text-align:right">Plocha</th><th style="text-align:right">Cena</th></tr></thead>
    <tbody>${matRows}${wtRow}</tbody><tfoot><tr><td>SPOLU</td><td></td><td style="text-align:right">${total.toFixed(2)} €</td></tr></tfoot></table>
    <div style="color:#888;font-size:11px;margin-top:20px">Vygenerované cvjkit · ${new Date().toLocaleDateString('sk')}</div>
    <script>print()</script>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } else toast('Povoľ vyskakovacie okná');
};

// --- .cvj import ---
let cvjBuf = null, cvjName = 'job.cvj';
$('fileCvj').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    cvjBuf = buf; cvjName = f.name;
    openEditor(buf);
    // read the cabinet's current size → prefill the manufacturing resize panel
    try {
      const { ctx } = decodeStream(getStream(openContainer(buf), 'Contents'));
      const objs = ctx.map.filter((x) => x && x.obj).map((x) => x.obj);
      const s = cabinetSize(objs);
      if (s) {
        $('mfgW').value = Math.round(s.mm.W); $('mfgH').value = Math.round(s.mm.H); $('mfgD').value = Math.round(s.mm.D);
        $('mfgSection').hidden = false; $('priceSection').hidden = false;
        $('mfgInfo').textContent = `Skrinka ${s.cab.name || ''}: ${Math.round(s.mm.W)}×${Math.round(s.mm.H)}×${Math.round(s.mm.D)} mm`;
      }
    } catch (_) { $('mfgSection').hidden = true; }
    const r = importCvj(buf);
    const lines = [`Súbor: ${f.name}  (${(buf.length / 1024 / 1024).toFixed(1)} MB)`,
      `Streamy (${r.streams.length}):`];
    for (const s of r.streams.slice(0, 12)) lines.push(`  ${s.name.padEnd(12)} ${s.size} B`);
    if (r.header.found) {
      lines.push(`CVJob hlavička @${r.header.offset}:`);
      lines.push(`  jednotky: ${r.header.unitSymbol ?? '?'} / ${r.header.unitName ?? '?'}`);
      if (r.header.texts) { const t = r.header.texts.filter(Boolean); if (t.length) lines.push(`  texty: ${t.join(' | ')}`); }
    } else lines.push('CVJob hlavička: nenájdená');
    $('cvjInfo').textContent = lines.join('\n');
    toast('.cvj načítaný');
  } catch (err) { $('cvjInfo').textContent = 'Chyba: ' + err.message; toast('Chyba pri čítaní .cvj'); }
};

// --- show the opened (optionally resized) .cvj as real parts in 3D ---
$('btnMfgShow3d').onclick = () => {
  if (!cvjBuf) { toast('Najprv otvor .cvj'); return; }
  try {
    const { ctx } = decodeStream(getStream(openContainer(cvjBuf), 'Contents'));
    const objs = ctx.map.filter((x) => x && x.obj).map((x) => x.obj);
    const t = { W: +$('mfgW').value || undefined, H: +$('mfgH').value || undefined, D: +$('mfgD').value || undefined };
    resizeGraph(objs, t);                 // apply the entered size before rendering
    const boxes = cvjToBoxes(objs);
    const n = view.showCvjParts(boxes);
    $('mfgInfo').textContent = `3D: ${n} dielov zobrazených (${t.W || '?'}×${t.H || '?'}×${t.D || '?'} mm)`;
    toast(`${n} dielov v 3D`);
  } catch (err) { $('mfgInfo').textContent = 'Chyba 3D: ' + err.message; toast('Chyba pri 3D'); }
};

// --- part-level .cvj editor (dimensions, position, material, banding, drilling) ---
let cvjJob = null, cvjParts = [], edIdx = 0;
function renderCvj3D() { if (cvjJob) view.showCvjParts(cvjToBoxes(cvjJob.objs)); }
function openEditor(buf) {
  try {
    cvjJob = Edit.decodeJob(buf);
    cvjParts = Edit.leafParts(cvjJob.objs);
    const sel = $('edPart');
    sel.innerHTML = cvjParts.map((p, i) => { const mm = (n) => Math.round(Edit.toMm(Edit.getParam(p, n) || 0)); return `<option value="${i}">${i + 1}. ${p.name || '?'} (${mm('DX')}×${mm('DY')}×${mm('DZ')})</option>`; }).join('');
    $('editSection').hidden = cvjParts.length === 0;
    edIdx = 0; renderEdFields(); renderAllParams(); renderCvj3D();
    cvjHw = Edit.hardwareObjs(cvjJob.objs); hwIdx = 0; refreshHwList(); renderHwFields();
    $('hwSection').hidden = cvjHw.length === 0;
    $('edInfo').textContent = `${cvjParts.length} dielov načítaných na úpravu.`;
  } catch (_) { $('editSection').hidden = true; }
}
function renderEdFields() {
  const part = cvjParts[edIdx]; const box = $('edFields'); box.innerHTML = ''; if (!part) return;
  for (const g of Edit.partFields(part)) {
    const h = document.createElement('div'); h.className = 'edgroup'; h.textContent = g.title; box.appendChild(h);
    for (const f of g.fields) {
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = f.label; row.appendChild(lab);
      const raw = Edit.getParam(part, f.param); const inp = document.createElement('input');
      if (f.kind === 'bool') { inp.type = 'checkbox'; inp.checked = !!raw; }
      else if (f.kind === 'text') { inp.type = 'text'; inp.value = raw == null ? '' : String(raw); }
      else { inp.type = 'number'; inp.step = f.kind === 'mm' ? '0.5' : '1'; inp.value = f.kind === 'mm' ? Math.round(Edit.toMm(raw) * 10) / 10 : raw; }
      inp.addEventListener('change', () => {
        let v; if (f.kind === 'bool') v = inp.checked ? 1 : 0; else if (f.kind === 'text') v = inp.value; else if (f.kind === 'mm') v = Edit.toIn(+inp.value || 0); else v = +inp.value || 0;
        Edit.setParam(part, f.param, v); renderCvj3D();
        $('edInfo').textContent = `Zmenené: ${part.name}.${f.param} = ${f.kind === 'mm' ? inp.value + ' mm' : v}`;
      });
      row.appendChild(inp); box.appendChild(row);
    }
  }
}
function renderAllParams() {
  const part = cvjParts[edIdx]; const box = $('edAllParams'); if (!box) return; box.innerHTML = '';
  if (!part) return;
  const q = ($('edSearch').value || '').toLowerCase();
  const all = Edit.allParams(part).filter((p) => !q || p.name.toLowerCase().includes(q));
  $('edAllCount').textContent = `(${all.length})`;
  for (const pr of all.slice(0, 300)) {
    const row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('label'); lab.textContent = pr.name; lab.title = pr.formula ? ('vzorec: ' + pr.formula) : pr.name; row.appendChild(lab);
    const inp = document.createElement('input');
    if (pr.kind === 'num') { inp.type = 'number'; inp.step = 'any'; inp.value = Math.round(pr.value * 1e4) / 1e4; }
    else { inp.type = 'text'; inp.value = pr.value == null ? '' : String(pr.value); }
    if (pr.formula) inp.style.borderColor = '#7a6a3a';
    inp.addEventListener('change', () => {
      const v = pr.kind === 'num' ? (+inp.value || 0) : inp.value;
      Edit.setParamObj(pr.p, v); inp.style.borderColor = '';
      renderCvj3D(); $('edInfo').textContent = `Zmenené: ${part.name}.${pr.name} = ${v}`;
    });
    row.appendChild(inp); box.appendChild(row);
  }
}
$('edSearch').oninput = renderAllParams;
function refreshEdPartList() {
  const sel = $('edPart');
  sel.innerHTML = cvjParts.map((p, i) => { const mm = (n) => Math.round(Edit.toMm(Edit.getParam(p, n) || 0)); return `<option value="${i}">${i + 1}. ${p.name || '?'} (${mm('DX')}×${mm('DY')}×${mm('DZ')})</option>`; }).join('');
  sel.value = String(edIdx);
}
$('edPart').onchange = () => { edIdx = +$('edPart').value || 0; renderEdFields(); renderAllParams(); renderCvj3D(); };
$('btnEdDup').onclick = () => {
  const part = cvjParts[edIdx]; if (!cvjJob || !part) return;
  const clone = Edit.duplicatePart(cvjJob, part, (part.name || 'DIEL') + '_kópia');
  if (!clone) { toast('Diel nemá rodiča'); return; }
  cvjParts = Edit.leafParts(cvjJob.objs); edIdx = cvjParts.indexOf(clone);
  refreshEdPartList(); renderEdFields(); renderAllParams(); renderCvj3D();
  $('edInfo').textContent = `Pridaný diel ${clone.name}. Uprav ho a zapíš .cvj.`; toast('Diel duplikovaný');
};
$('btnEdDel').onclick = () => {
  const part = cvjParts[edIdx]; if (!cvjJob || !part) return;
  if (!confirm(`Zmazať diel ${part.name}?`)) return;
  Edit.deletePart(cvjJob, part);
  cvjParts = Edit.leafParts(cvjJob.objs); edIdx = Math.min(edIdx, cvjParts.length - 1);
  refreshEdPartList(); renderEdFields(); renderAllParams(); renderCvj3D();
  $('edInfo').textContent = `Diel zmazaný. Zostáva ${cvjParts.length} dielov.`; toast('Diel zmazaný');
};
// --- hardware editor (hinges/guides/legs — position, add/delete) ---
let cvjHw = [], hwIdx = 0;
function refreshHwList() {
  const sel = $('hwSel'); if (!sel) return;
  sel.innerHTML = cvjHw.map((h, i) => `<option value="${i}">${i + 1}. ${Edit.hwDesc(h)} [${h.__class.replace('CV', '')}]</option>`).join('');
  sel.value = String(hwIdx);
}
function renderHwFields() {
  const hw = cvjHw[hwIdx]; const box = $('hwFields'); if (!box) return; box.innerHTML = ''; if (!hw) return;
  for (const f of Edit.hwFields(hw)) {
    const row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('label'); lab.textContent = f.label; row.appendChild(lab);
    const raw = Edit.getParam(hw, f.param); const inp = document.createElement('input'); inp.type = 'number'; inp.step = f.kind === 'mm' ? '0.5' : '1';
    inp.value = f.kind === 'mm' ? Math.round(Edit.toMm(raw) * 10) / 10 : raw;
    inp.addEventListener('change', () => { const v = f.kind === 'mm' ? Edit.toIn(+inp.value || 0) : (+inp.value || 0); Edit.setParam(hw, f.param, v); $('hwInfo').textContent = `Zmenené: ${Edit.hwDesc(hw)}.${f.param} = ${f.kind === 'mm' ? inp.value + ' mm' : v}`; });
    row.appendChild(inp); box.appendChild(row);
  }
}
$('hwSel').onchange = () => { hwIdx = +$('hwSel').value || 0; renderHwFields(); };
$('btnHwDup').onclick = () => {
  const hw = cvjHw[hwIdx]; if (!cvjJob || !hw) return;
  const clone = Edit.duplicatePart(cvjJob, hw);
  if (!clone) { toast('Kovanie nemá rodiča'); return; }
  cvjHw = Edit.hardwareObjs(cvjJob.objs); hwIdx = cvjHw.indexOf(clone);
  refreshHwList(); renderHwFields(); $('hwInfo').textContent = `Pridané kovanie ${Edit.hwDesc(clone)}. Nastav pozíciu a zapíš.`; toast('Kovanie duplikované');
};
$('btnHwDel').onclick = () => {
  const hw = cvjHw[hwIdx]; if (!cvjJob || !hw) return;
  if (!confirm(`Zmazať kovanie ${Edit.hwDesc(hw)}?`)) return;
  Edit.deletePart(cvjJob, hw);
  cvjHw = Edit.hardwareObjs(cvjJob.objs); hwIdx = Math.min(hwIdx, cvjHw.length - 1);
  refreshHwList(); renderHwFields(); $('hwInfo').textContent = `Kovanie zmazané. Zostáva ${cvjHw.length}.`; toast('Kovanie zmazané');
};

$('btnEdExport').onclick = () => {
  if (!cvjJob) { toast('Najprv otvor .cvj'); return; }
  try {
    const out = Edit.encodeJob(cvjJob);
    const name = (cvjName || 'job').replace(/\.cvj$/i, '') + '-upravene.cvj';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out])); a.download = name; a.click();
    $('edInfo').textContent = `Zapísané ${name} (${cvjParts.length} dielov).`;
    toast('.cvj so zmenami stiahnutý');
  } catch (err) { $('edInfo').textContent = 'Chyba: ' + err.message; toast('Chyba pri zápise'); }
};

// --- katalóg skriniek (real shop types from corpus) + generovanie zo šablóny ---
let templateCodes = new Set();
async function refreshTemplates() { try { templateCodes = new Set(await listTemplates()); } catch (_) { templateCodes = new Set(); } markCatalogTemplates(); populateTemplateSelect(); }
function populateTemplateSelect() {
  const sel = $('pTemplate'); if (!sel) return;
  const keys = [...templateCodes];
  sel.innerHTML = keys.length ? keys.map((k) => `<option>${k}</option>`).join('') : '<option value="">— ulož .cvj ako šablónu —</option>';
}
// studio design → manufacturing .cvj: resize a stored template to this cabinet's W/H/D
$('btnMakeCvj').onclick = async () => {
  if (!selected) { toast('Vyber skrinku'); return; }
  const code = $('pTemplate').value; if (!code) { toast('Najprv ulož .cvj ako šablónu (sekcia Výroba)'); return; }
  try {
    const tpl = await getTemplate(code); if (!tpl) { toast('Šablóna nenájdená'); return; }
    const p = selected.params;
    const container = openContainer(new Uint8Array(tpl.bytes));
    const { roots, ctx } = decodeStream(getStream(container, 'Contents'));
    const objs = ctx.map.filter((x) => x && x.obj).map((x) => x.obj);
    const { to } = resizeGraph(objs, { W: p.W, H: p.H, D: p.D });
    const { buf } = writeGraphMulti(roots, ctx.classSchemas);
    setStream(container, 'Contents', buf);
    const out = writeContainer(container);
    const name = `${(selected.name || 'skrinka').replace(/\s+/g, '_')}-${Math.round(to.W)}x${Math.round(to.H)}x${Math.round(to.D)}.cvj`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out])); a.download = name; a.click();
    toast(`.cvj vyrobený (${Math.round(to.W)}×${Math.round(to.H)}×${Math.round(to.D)})`);
  } catch (err) { toast('Chyba: ' + err.message); }
};
function markCatalogTemplates() {
  const sel = $('catSel'); if (!sel) return;
  for (const o of sel.options) { if (!o.dataset.code) continue; const has = templateCodes.has(o.dataset.code); o.textContent = `${has ? '✓ ' : ''}${o.dataset.code}  (${o.dataset.dims})`; }
}
(async () => {
  try {
    const cat = await (await fetch('./catalog.json')).json();
    const sel = $('catSel');
    for (const c of cat) { const o = document.createElement('option'); o.value = JSON.stringify([c.W, c.H, c.D]); o.dataset.code = c.code; o.dataset.dims = `${c.W}×${c.H}×${c.D}`; o.textContent = `${c.code}  (${o.dataset.dims})`; sel.appendChild(o); }
    await refreshTemplates();
    sel.onchange = () => {
      const o = sel.options[sel.selectedIndex];
      if (!sel.value) { $('btnCatGen').hidden = true; return; }
      const [w, h, d] = JSON.parse(sel.value);
      if (!$('mfgSection').hidden) { $('mfgW').value = w; $('mfgH').value = h; $('mfgD').value = d; }
      const has = templateCodes.has(o.dataset.code);
      $('btnCatGen').hidden = !has;
      $('catInfo').textContent = `${o.dataset.code} — rozmer ${w}×${h}×${d} mm${has ? ' · šablóna k dispozícii → Generovať' : ' · bez šablóny (otvor .cvj tohto typu a ulož ako šablónu)'}`;
      toast('Katalóg: ' + o.dataset.code);
    };
  } catch (_) { /* katalóg voliteľný */ }
})();

// generate a .cvj from the stored template of the selected catalog type, resized
$('btnCatGen').onclick = async () => {
  const sel = $('catSel'); const o = sel.options[sel.selectedIndex]; if (!o || !o.dataset.code) return;
  try {
    const tpl = await getTemplate(o.dataset.code);
    if (!tpl) { toast('Šablóna nenájdená'); return; }
    const [cw, ch, cd] = JSON.parse(sel.value);
    const W = +$('mfgW').value || cw, H = +$('mfgH').value || ch, D = +$('mfgD').value || cd;
    const container = openContainer(new Uint8Array(tpl.bytes));
    const { roots, ctx } = decodeStream(getStream(container, 'Contents'));
    const objs = ctx.map.filter((x) => x && x.obj).map((x) => x.obj);
    const { to } = resizeGraph(objs, { W, H, D });
    const { buf } = writeGraphMulti(roots, ctx.classSchemas);
    setStream(container, 'Contents', buf);
    const out = writeContainer(container);
    const name = `${o.dataset.code}-${Math.round(to.W)}x${Math.round(to.H)}x${Math.round(to.D)}.cvj`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out])); a.download = name; a.click();
    $('catInfo').textContent = `Vygenerované ${name} zo šablóny (${o.dataset.code}).`;
    toast('.cvj vygenerovaný zo šablóny');
  } catch (err) { $('catInfo').textContent = 'Chyba: ' + err.message; toast('Chyba generovania'); }
};

// save the opened .cvj as the template for its cabinet type (by its cabinet name = type code)
$('btnSaveTemplate').onclick = async () => {
  if (!cvjBuf) { toast('Najprv otvor .cvj'); return; }
  try {
    const { ctx } = decodeStream(getStream(openContainer(cvjBuf), 'Contents'));
    const objs = ctx.map.filter((x) => x && x.obj).map((x) => x.obj);
    const s = cabinetSize(objs); if (!s) { toast('Žiadna skrinka v .cvj'); return; }
    const code = (s.cab.name || '').trim(); if (!code) { toast('Skrinka bez názvu'); return; }
    await saveTemplate(code, { bytes: cvjBuf.buffer.slice(0), name: cvjName, W: Math.round(s.mm.W), H: Math.round(s.mm.H), D: Math.round(s.mm.D), savedAt: Date.now() });
    await refreshTemplates();
    $('mfgInfo').textContent = `Uložené ako šablóna typu "${code}" (${Math.round(s.mm.W)}×${Math.round(s.mm.H)}×${Math.round(s.mm.D)}). V katalógu je teraz ✓.`;
    toast('Šablóna uložená: ' + code);
  } catch (err) { $('mfgInfo').textContent = 'Chyba: ' + err.message; toast('Chyba pri ukladaní šablóny'); }
};

// --- preset standard sizes (quick-fill the resize fields) ---
document.querySelectorAll('#presets button').forEach((b) => {
  b.onclick = () => { const [w, h, d] = b.dataset.whd.split(','); $('mfgW').value = w; $('mfgH').value = h; $('mfgD').value = d; toast(`Rozmer ${w}×${h}×${d}`); };
});

// --- cenotvorba: bill of materials + price for the opened (optionally resized) cabinet ---
$('btnPrice').onclick = () => {
  if (!cvjBuf) { toast('Najprv otvor .cvj'); return; }
  try {
    const { ctx } = decodeStream(getStream(openContainer(cvjBuf), 'Contents'));
    const objs = ctx.map.filter((x) => x && x.obj).map((x) => x.obj);
    resizeGraph(objs, { W: +$('mfgW').value || undefined, H: +$('mfgH').value || undefined, D: +$('mfgD').value || undefined });
    const rates = { ...DEFAULT_RATES, boardPerM2: +$('rBoard').value || DEFAULT_RATES.boardPerM2, bandPerM: +$('rBand').value || DEFAULT_RATES.bandPerM, hinge: +$('rHinge').value || DEFAULT_RATES.hinge };
    // real materials from CVData price snapshot + the job's Materials stream
    let resolved = null;
    try { const matBuf = getStream(openContainer(cvjBuf), 'Materials'); if (PRICES && matBuf) resolved = resolveMaterials(matBuf, PRICES, MatPrices); } catch (_) { /* placeholder rates */ }
    const r = priceJob(objs, rates, resolved);
    const lines = r.lines.map((l) => `${l.label.padEnd(22)} ${l.qty.toFixed(1).padStart(7)} ${l.unit.padEnd(4)} × ${l.rate} = ${l.cost.toFixed(2)} €`);
    lines.push('─'.repeat(44));
    lines.push(`SPOLU: ${r.total.toFixed(2)} €   (${r.boards} dielov, ${r.totalAreaM2.toFixed(2)} m²)`);
    lines.unshift(r.real ? `○ ODHAD (doska ${r.resolved.board.cost} €/m², nákl. z CV) — pravé ceny budú z ProdBoardu` : '○ ODHAD (editovateľné sadzby) — pravé ceny budú z ProdBoardu', '');
    $('priceInfo').textContent = lines.join('\n');
    toast(`Cena: ${r.total.toFixed(0)} €`);
  } catch (err) { $('priceInfo').textContent = 'Chyba: ' + err.message; toast('Chyba pri cenotvorbe'); }
};

// --- manufacturing: resize the opened cabinet and download a new .cvj for S2M ---
$('btnMfgExport').onclick = () => {
  if (!cvjBuf) { toast('Najprv otvor .cvj'); return; }
  try {
    const container = openContainer(cvjBuf);
    const { roots, ctx } = decodeStream(getStream(container, 'Contents'));
    const objs = ctx.map.filter((x) => x && x.obj).map((x) => x.obj);
    const target = { W: +$('mfgW').value || undefined, H: +$('mfgH').value || undefined, D: +$('mfgD').value || undefined };
    const { from, to, rows } = resizeGraph(objs, target);
    const { buf } = writeGraphMulti(roots, ctx.classSchemas);
    setStream(container, 'Contents', buf);
    const outBytes = writeContainer(container);
    const changed = rows.filter((r) => Object.values(r.dims).some((d) => d.scales)).length;
    const name = cvjName.replace(/\.cvj$/i, '') + `-${Math.round(to.W)}x${Math.round(to.H)}x${Math.round(to.D)}.cvj`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([outBytes])); a.download = name; a.click();
    $('mfgInfo').textContent = `${Math.round(from.W)}×${Math.round(from.H)}×${Math.round(from.D)} → ${Math.round(to.W)}×${Math.round(to.H)}×${Math.round(to.D)} mm · ${rows.length} dielov (${changed} prepočítaných) · stiahnuté ${name}`;
    toast('.cvj vygenerovaný');
  } catch (err) { $('mfgInfo').textContent = 'Chyba: ' + err.message; toast('Chyba pri generovaní'); }
};

// start with one cabinet
// restore the last project from localStorage, else start with one cabinet
let restored = false;
try { const saved = localStorage.getItem(PROJ_KEY); if (saved) { applyProject(JSON.parse(saved)); restored = true; } } catch (_) { /* ignore */ }
if (!restored) {
  const first = new Cabinet({ name: 'Skrinka 1', x: 50, y: 0, z: 40 });
  room.addCabinet(first); selectCabinet(first); refresh(); view.frame(room);
}
