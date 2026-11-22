#!/usr/bin/env node
// cvjkit — decode-progress probe. Decodes a .cvj Contents stream with the
// registered class codecs and reports how far it gets / first unmapped class.
import { readFile } from 'node:fs/promises';
import { openContainer, getStream } from '../app/cvj.js';
import './codecs.mjs';            // registers class codecs
import './foundations.mjs';       // wires CVBase/CXObject foundation readers
import { probe } from './contents.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node src/probe.mjs <file.cvj>'); process.exit(1); }

const data = new Uint8Array(await readFile(file));
const contents = getStream(openContainer(data), 'Contents');
if (!contents) { console.error('no Contents stream'); process.exit(1); }

const res = probe(contents);
console.log('Contents:', contents.length, 'B');
if (res.status === 'decoded') {
  console.log(`✓ decoded fully — consumed ${res.consumed}/${res.total} B`);
  console.log('classes:', res.classes.join(', '));
} else if (res.status === 'unmapped') {
  const pct = ((res.at / contents.length) * 100).toFixed(1);
  console.log(`⏳ stopped at unmapped class "${res.className}" @${res.at} (${pct}% of ${contents.length})`);
  console.log('classes decoded so far:', res.classesSoFar.join(', ') || '(none)');
} else {
  const pct = ((res.at / contents.length) * 100).toFixed(1);
  console.log(`✗ error @${res.at}: ${res.message} (${pct}%)`);
}
if (res.stack && res.stack.length) {
  console.log('\nlive decode stack (outer→inner):');
  for (const f of res.stack) console.log(`  ${f.cls.padEnd(22)} start@${f.start} idx#${f.idx}`);
}
if (res.trail && res.trail.length) {
  console.log('\nlast completed objects:');
  for (const f of res.trail) console.log(`  ${f.cls.padEnd(22)} [${f.start}..${f.end}] idx#${f.idx}`);
}
