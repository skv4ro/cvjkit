// Export the full CVData catalog → app/cvcatalog.json so the browser app uses
// the REAL materials, hardware, cabinets and construction methods (not generic
// placeholders). Node-only. Pricing stays ProdBoard-driven; CV cost is carried
// only as a reference. Run: node src/export_catalog.mjs
import { writeFileSync } from 'node:fs';
import { query, findSource } from './cvdata.mjs';

const IN = 25.4;
const clean = (s) => String(s == null ? '' : s).replace(/^\{[a-z]\}/i, '').trim();

const src = findSource();
if (!src.server) { console.error('CVData nedostupná:', src.errors?.join('; ')); process.exit(1); }
console.log(`CVData: ${src.server}/${src.database}`);

// ---- materials (boards / laminate / counter tops) with thickness ----
const BOARD_TYPES = ['Panel Stock', 'Board Stock', 'Laminate', 'Composite', 'Counter Top'];
const matRows = query(src, `SELECT m.Name name, rt.Name type, CAST(m.DefaultCost AS float) cost,
  (SELECT TOP 1 CAST(Thickness AS float) FROM MaterialExtraSizeInfo s WHERE s.MaterialID=m.ID) thick
  FROM Material m JOIN refMaterialType rt ON rt.ID=m.MaterialTypeID
  WHERE m.Deleted=0 AND m.Name IS NOT NULL AND rt.Name IN ('${BOARD_TYPES.join("','")}')`);
const materials = [];
const seenM = new Set();
for (const r of matRows) { const n = clean(r.name); if (!n || seenM.has(n)) continue; seenM.add(n);
  materials.push({ name: n, type: r.type, mm: r.thick ? +(r.thick * IN).toFixed(1) : null, cvCost: +(+r.cost || 0).toFixed(2) }); }

// ---- edge banding ----
const bandRows = query(src, `SELECT m.Name name, CAST(m.DefaultCost AS float) cost FROM Material m
  JOIN refMaterialType rt ON rt.ID=m.MaterialTypeID WHERE m.Deleted=0 AND rt.Name='Banding' AND m.Name IS NOT NULL`);
const banding = []; const seenB = new Set();
for (const r of bandRows) { const n = clean(r.name); if (!n || seenB.has(n)) continue; seenB.add(n); banding.push({ name: n, cvCost: +(+r.cost || 0).toFixed(2) }); }

// ---- hardware (hinges, plates, guides, pulls, connectors, legs, baskets) ----
const HW_TYPES = ['Hinge', 'Hinge Plate', 'Drawer Guide', 'Pull', 'Finger Pull', 'Connector', 'Leg', 'Leg Leveler', 'Caster', 'Wire Basket', 'Rod', 'Molding'];
const hwRows = query(src, `SELECT m.Name name, rt.Name type, CAST(m.DefaultCost AS float) cost FROM Material m
  JOIN refMaterialType rt ON rt.ID=m.MaterialTypeID WHERE m.Deleted=0 AND m.Name IS NOT NULL AND rt.Name IN ('${HW_TYPES.join("','")}')`);
const hardware = []; const seenH = new Set();
for (const r of hwRows) { const n = clean(r.name); const k = r.type + '|' + n; if (!n || seenH.has(k)) continue; seenH.add(k);
  hardware.push({ name: n, type: r.type, cvCost: +(+r.cost || 0).toFixed(2) }); }

// ---- cabinets (Assembly) with default dims + class ----
const CAB_CLASSES = ['Base', 'Upper', 'Wall', 'Tall', 'Vanity', 'Appliance', 'Closet', 'Closet Base', 'Closet Upper'];
const KIND = { Base: 'base', Vanity: 'base', 'Closet Base': 'base', Upper: 'wall', Wall: 'wall', 'Wall Face': 'wall', 'Closet Upper': 'wall', Tall: 'tall', Closet: 'tall', Appliance: 'tall' };
const cabRows = query(src, `SELECT a.ID id, a.Name name, ct.Name cls, a.Width W, a.Height H, a.Depth D,
  a.HingeChar hinge, CAST(a.Price AS float) price, a.Tags tags
  FROM Assembly a JOIN refAssemblyClassType ct ON ct.ID=a.AssemblyClassTypeID
  WHERE a.Width>0 AND a.Height>0 AND ISNULL(a.AliasOf,0)=0 AND a.Name IS NOT NULL AND ct.Name IN ('${CAB_CLASSES.join("','")}')`);
const cabinets = []; const seenC = new Set();
for (const r of cabRows) { const n = clean(r.name); if (!n || seenC.has(n)) continue; seenC.add(n);
  cabinets.push({ id: r.id, name: n, cls: r.cls, kind: KIND[r.cls] || 'base',
    W: Math.round(r.W), H: Math.round(r.H), D: Math.round(r.D), price: +(+r.price || 0).toFixed(2), tags: clean(r.tags) || undefined }); }

// ---- construction methods ----
const conRows = query(src, `SELECT c.Name name, ct.Name type FROM Construction c
  LEFT JOIN refConstructionType ct ON ct.ID=c.ConstructionTypeID WHERE c.Name IS NOT NULL`);
const construction = []; const seenCon = new Set();
for (const r of conRows) { const n = clean(r.name); if (!n || seenCon.has(n)) continue; seenCon.add(n); construction.push({ name: n, type: r.type || 'Case' }); }

const out = { source: `${src.server}/${src.database}`, created: new Date().toISOString(),
  counts: { materials: materials.length, banding: banding.length, hardware: hardware.length, cabinets: cabinets.length, construction: construction.length },
  materials, banding, hardware, cabinets, construction };
writeFileSync('app/cvcatalog.json', JSON.stringify(out));
console.log('→ app/cvcatalog.json', JSON.stringify(out.counts), `(${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
