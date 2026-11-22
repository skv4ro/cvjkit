// Verify the writer re-serializes decoded Contents byte-for-byte.
// Usage: node src/verify_writer.mjs <file.cvj> [more.cvj ...]
import { readFile } from 'node:fs/promises';
import { openContainer, getStream } from '../app/cvj.js';
import { reserializeCheck } from './writer.mjs';

const files = process.argv.slice(2);
let pass = 0, fail = 0;
for (const f of files) {
  const data = new Uint8Array(await readFile(f));
  const contents = getStream(openContainer(data), 'Contents');
  if (!contents) { console.log(`?? no Contents       ${f}`); continue; }
  let r;
  try { r = reserializeCheck(contents); }
  catch (e) { console.log(`ER ${String(e.message).slice(0, 60).padEnd(60)} ${f}`); fail++; continue; }
  const pct = ((r.consumed / r.total) * 100).toFixed(0);
  const tail = `${r.roots} objs, ${pct}% of stream${r.frontier ? `, stop:${r.frontier}` : ''}`;
  if (r.ok) { console.log(`OK byte-exact  ${String(r.consumed).padStart(8)}B  ${tail}  ${f.split(/[\\/]/).pop()}`); pass++; }
  else {
    const why = r.firstDiff >= 0 ? `diff@${r.firstDiff}` : `len out=${r.outLen} vs consumed=${r.consumed}`;
    console.log(`XX ${why.padEnd(28)} ${tail}  ${f.split(/[\\/]/).pop()}`); fail++;
  }
}
console.log(`\n${pass} byte-exact, ${fail} mismatched, of ${files.length}`);
