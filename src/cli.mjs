#!/usr/bin/env node
// cvjkit CLI — inspect and round-trip .cvj files (interoperability).
import { readFile, writeFile } from 'node:fs/promises';
import { openContainer, getStream, importCvj, decodeJobHeader, roundTripCheck, writeContainer, setStream } from '../app/cvj.js';
import { scanParams, patchParam } from './params.mjs';
import { extractModelFromCvj } from './jobmodel.mjs';
import { reserializeCheck, editStream, decodeStream, writeGraphMulti } from './writer.mjs';
import { newJob, newCabinet, newParameter, serializeContents, deepClone,
         findFirst, findAll, findParts, duplicateInto, partDimsMm } from './builder.mjs';

const [cmd, ...args] = process.argv.slice(2);
const u8 = (b) => new Uint8Array(b);

function usage() {
  console.log(`cvjkit <command> <file.cvj> [args]

  streams <file>            list OLE streams and sizes
  header  <file>            decode CVJob header block from Contents
  info    <file>            streams + header summary
  roundtrip <file>          re-serialize container, assert byte-exact streams
  dump    <file> <stream> <out.bin>   extract one stream to a file
  params  <file> [regex]    list CVParameters (name, variant type, value)
  set     <file> <name> <value> <out.cvj>   change a parameter value in place, save
  model   <file> [--json]   decode the object tree -> job model (cabinets, sizes, counts)
  reserialize <file>        decode + re-emit the object tree, assert byte-exact
  relabel <file> <suffix> <out.cvj>   structural edit: append <suffix> to every cabinet label, save
  gen     <out.cvj> [--template <file>]   build a CVJob from scratch, wrap in a container, save
  parts   <file>            list the cabinet's parts (leaf panels) with mm dimensions
  compose <file> <out.cvj> [--dup-cabinet] [--add-shelf WxHxT]   clone the job, add/duplicate parts, save
`);
}

async function main() {
  if (!cmd || cmd === 'help' || !args[0]) return usage();
  const file = args[0];
  // `gen` takes an OUTPUT path as args[0]; everything else reads it as input.
  const data = cmd === 'gen' ? null : u8(await readFile(file));

  if (cmd === 'streams') {
    const c = openContainer(data);
    for (const s of c.streams) console.log(`${String(s.size).padStart(10)}  ${s.name}`);
  } else if (cmd === 'header') {
    const contents = getStream(openContainer(data), 'Contents');
    if (!contents) return console.log('no Contents stream');
    console.log(JSON.stringify(decodeJobHeader(contents), (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  } else if (cmd === 'info') {
    const r = importCvj(data);
    console.log(`streams: ${r.streams.length}`);
    for (const s of r.streams) console.log(`  ${String(s.size).padStart(10)}  ${s.name}`);
    console.log('header:', r.header.found ? `@${r.header.offset} units=${r.header.unitSymbol}/${r.header.unitName}` : 'not found');
    if (r.header.texts) { const t = r.header.texts.filter(Boolean); if (t.length) console.log('  texts:', t.join(' | ')); }
  } else if (cmd === 'roundtrip') {
    const r = roundTripCheck(data);
    console.log(`streams: ${r.streams}, mismatched: ${r.mismatched.length}`, r.mismatched.length ? r.mismatched : '✓ byte-exact');
    process.exitCode = r.mismatched.length ? 1 : 0;
  } else if (cmd === 'dump') {
    const [, stream, out] = args;
    const b = getStream(openContainer(data), stream);
    if (!b) return console.log('stream not found:', stream);
    await writeFile(out, b); console.log(`wrote ${b.length} B -> ${out}`);
  } else if (cmd === 'params') {
    const re = args[1] ? new RegExp(args[1], 'i') : null;
    const contents = getStream(openContainer(data), 'Contents');
    if (!contents) return console.log('no Contents stream');
    const ps = scanParams(contents).filter((p) => !re || re.test(p.name));
    for (const p of ps) console.log(`${p.name.padEnd(24)} type${p.type}  ${p.value}`);
    console.log(`\n${ps.length} parameter(s)`);
  } else if (cmd === 'set') {
    const [, name, valueStr, out] = args;
    if (!name || valueStr === undefined || !out) return console.log('usage: set <file> <name> <value> <out.cvj>');
    const container = openContainer(data);
    const contents = getStream(container, 'Contents');
    const ps = scanParams(contents).filter((p) => p.name === name);
    if (ps.length === 0) return console.log(`parameter not found: ${name}`);
    if (ps.length > 1) console.log(`note: ${ps.length} params named "${name}" — changing all`);
    let buf = contents;
    for (const p of ps) buf = patchParam(buf, p, Number(valueStr));
    setStream(container, 'Contents', buf);
    await writeFile(out, writeContainer(container));
    console.log(`set ${name} = ${valueStr} (${ps.length}×) -> ${out}`);
  } else if (cmd === 'model') {
    const m = extractModelFromCvj(data);
    if (args.includes('--json')) { console.log(JSON.stringify(m, null, 2)); return; }
    const pct = ((m.consumed / m.total) * 100).toFixed(1);
    console.log(`decode: ${m.decoded} (${pct}% , ${m.consumed}/${m.total} B)${m.frontier ? ` — frontier: ${m.frontier}` : ''}`);
    if (m.unit) console.log(`unit: ${m.unit.symbol} / ${m.unit.name}`);
    const c = m.counts;
    console.log(`counts: ${c.cabinets} cabinets, ${c.parts} parts, ${c.hardware} hardware, ${c.doors} doors, ${c.walls} walls, ${c.parameters} params`);
    console.log('\ncabinets (size in mm):');
    for (const cab of m.cabinets) {
      const s = cab.sizeMm ? `${cab.sizeMm.w}×${cab.sizeMm.h}×${cab.sizeMm.d}` : '(no size)';
      console.log(`  ${(cab.name || '?').padEnd(16)} ${s.padEnd(20)} ${cab.label}`);
    }
  } else if (cmd === 'reserialize') {
    const contents = getStream(openContainer(data), 'Contents');
    if (!contents) return console.log('no Contents stream');
    const r = reserializeCheck(contents);
    const pct = ((r.consumed / r.total) * 100).toFixed(0);
    console.log(`decoded ${r.roots} top-level object(s), ${r.consumed}/${r.total} B (${pct}%)` +
      (r.frontier ? `, stops at: ${r.frontier}` : ''));
    console.log(r.ok ? `✓ re-serialized byte-exact (${r.outLen} B)`
                     : `✗ mismatch: ${r.firstDiff >= 0 ? `first diff @${r.firstDiff}` : `length ${r.outLen} vs ${r.consumed}`}`);
    process.exitCode = r.ok ? 0 : 1;
  } else if (cmd === 'relabel') {
    const [, suffix, out] = args;
    if (!suffix || !out) return console.log('usage: relabel <file> <suffix> <out.cvj>');
    const container = openContainer(data);
    const contents = getStream(container, 'Contents');
    let count = 0;
    const edited = editStream(contents, ({ ctx }) => {
      for (const e of ctx.map) if (e && e.obj && e.obj.__class === 'CVCabinet') { e.obj.label += suffix; count++; }
    });
    setStream(container, 'Contents', edited);
    await writeFile(out, writeContainer(container));
    console.log(`relabelled ${count} cabinet(s), Contents ${contents.length} -> ${edited.length} B -> ${out}`);
  } else if (cmd === 'gen') {
    const out = args[0];
    if (!out) return console.log('usage: gen <out.cvj> [--template <file>]');
    const ti = args.indexOf('--template');
    const template = ti >= 0 ? args[ti + 1] : null;
    // build a small demo job from scratch
    const cab = newCabinet({ name: 'D-600', label: 'Spodná skrinka 600 (cvjkit)', w: 600, h: 720, d: 560,
      params: [newParameter('_BW', 600), newParameter('_BH', 720), newParameter('_BD', 560)] });
    const job = newJob({ children: [cab] });
    const contents = serializeContents(job);
    if (template) {
      const container = openContainer(u8(await readFile(template)));
      setStream(container, 'Contents', contents);
      await writeFile(out, writeContainer(container));
      console.log(`generated job -> ${out} (Contents ${contents.length} B, container streams from ${template})`);
      console.log('NOTE: library streams (Catalogs/Materials/Construction…) are reused from the template.');
      console.log('      Open in CV/S2M to validate; synthesized Contents acceptance is unverified.');
    } else {
      await writeFile(out, contents);
      console.log(`generated Contents stream (raw, no container) -> ${out} (${contents.length} B)`);
      console.log('pass --template <real.cvj> to wrap it in a full .cvj container.');
    }
  } else if (cmd === 'parts') {
    const contents = getStream(openContainer(data), 'Contents');
    const { ctx } = decodeStream(contents);
    const job = ctx.map.find((e) => e && e.obj && e.obj.__class === 'CVJob')?.obj;
    if (!job) return console.log('no decodable CVJob');
    const parts = findParts(job);
    console.log(`${findAll(job, 'CVCabinet').length} cabinet(s), ${parts.length} part(s) (leaf panels):`);
    for (const p of parts) { const d = partDimsMm(p); console.log(`  ${(p.name || '?').padEnd(8)} ${d.dx}×${d.dy}×${d.dz} mm`); }
  } else if (cmd === 'compose') {
    const [, out] = args;
    if (!out) return console.log('usage: compose <file> <out.cvj> [--dup-cabinet] [--add-shelf WxHxT]');
    const container = openContainer(data);
    const contents = getStream(container, 'Contents');
    // decode just object #0 (the job) and own it fully
    const { roots } = decodeStream(contents);
    const job = deepClone(roots[0]);
    if (!job || job.__class !== 'CVJob') return console.log('first object is not a decodable CVJob');
    const cab = findFirst(job, 'CVCabinet');
    const log = [];
    const shelfArg = args.includes('--add-shelf') ? args[args.indexOf('--add-shelf') + 1] : null;
    if (shelfArg) {
      const [w, h, t] = shelfArg.split(/[x×*]/i).map(Number);
      const caseAsm = cab.children.find((c) => c && c.__class === 'CVAssembly' && c.name === 'Case') || cab;
      const src = findParts(job)[0];
      duplicateInto(caseAsm, src, { name: 'POL', label: 'Polica (cvjkit)', dims: { dx: w, dy: h, dz: t } });
      log.push(`+1 polica ${w}×${h}×${t} mm (klon dielu ${src.name})`);
    }
    if (args.includes('--dup-cabinet')) {
      const wf = findFirst(job, 'CVWallFace');
      duplicateInto(wf, cab, { name: cab.name + '_KOPIA', label: cab.label + ' (kópia)' });
      log.push('+1 skrinka (kópia)');
    }
    const newContents = serializeContents(job);
    // self-check: composed graph must round-trip byte-exact
    const dec = decodeStream(newContents);
    const rt = writeGraphMulti(dec.roots, dec.ctx.classSchemas).buf;
    let diff = -1; for (let i = 0; i < Math.min(rt.length, newContents.length); i++) if (rt[i] !== newContents[i]) { diff = i; break; }
    const ok = diff === -1 && rt.length === newContents.length && dec.consumed === newContents.length;
    setStream(container, 'Contents', newContents);
    await writeFile(out, writeContainer(container));
    console.log(`compose: ${log.join(', ') || '(no changes)'}  -> ${out}`);
    console.log(`Contents ${contents.length} -> ${newContents.length} B; graph round-trip ${ok ? '✓ byte-exact, decodes 100%' : '✗ diff@' + diff}`);
    console.log('NOTE: knižničné streamy a objektové _id sa preberajú zo šablóny; závislé parametre');
    console.log('      (hrany/vŕtanie) sa neprepočítavajú. Over v CV/S2M.');
    process.exitCode = ok ? 0 : 1;
  } else { usage(); }
}
main().catch((e) => { console.error('error:', e.message); process.exit(1); });
