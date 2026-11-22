// Export a price snapshot from CVData → app/prices.json so the browser app can
// price without SQL. Material name → DefaultCost (shop cost). Node-only.
import { writeFileSync } from 'node:fs';
import { query, findSource } from './cvdata.mjs';
const src = findSource();
if (!src.server) { console.error('CVData nedostupná:', src.errors?.join('; ')); process.exit(1); }
// materials with a cost (DefaultCost>0). Keep name + cost + unit.
const rows = query(src, `SELECT Name name, CAST(DefaultCost AS float) cost, UnitOfIssueID unit FROM Material WHERE DefaultCost > 0 AND Name IS NOT NULL`);
const mats = {};
for (const r of rows) { const n = String(r.name).replace(/^\{[a-z]\}/i, '').trim(); if (n && !(n in mats)) mats[n] = +(+r.cost).toFixed(4); }
const out = { source: `${src.server}/${src.database}`, created: new Date().toISOString(), count: Object.keys(mats).length, materials: mats };
writeFileSync('app/prices.json', JSON.stringify(out));
console.log(`exportovaných ${out.count} materiálov s cenou → app/prices.json (${(JSON.stringify(out).length/1024).toFixed(0)} KB)`);
// show a few board/edge/hardware examples
const ex = Object.entries(mats).filter(([n])=>/DTD|ABS|0197|pant|vedenie|Blum/i.test(n)).slice(0,8);
for (const [n,c] of ex) console.log(`  ${c} €  ${n}`);
