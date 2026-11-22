// cvjkit — CVData (SQL) access: the UCS / construction-template layer.
// A saved .cvj is baked (part dims stored as values). The LIVE construction rules
// — how a cabinet of a given W/H/D generates its parts and their dimensions — live
// in CV's CVData SQL database as Assembly → AssemblyPart templates whose
// Width/Length/Depth are FORMULA strings in the same language as .cvj equations.
// Loading a template + evaluating those formulas with engine.mjs = parametric
// rebuild (change width → parts recompute), the real replacement of CV's engine.
//
// Connection mirrors the CVRE approach: sqlcmd with Windows auth (-E), trying the
// live .\CV25 instance first, then the .\SQLEXPRESS copy. Output via a UTF-16 temp
// file (FOR JSON PATH) so diacritics survive.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IN = 25.4;
const SQLCMD = 'sqlcmd';
export const DEFAULT_SOURCES = [
  { server: '.\\CV25', database: 'CVData' },
  { server: '.\\SQLEXPRESS', database: 'CVData', copy: true },
];

// run a query, return rows as objects (via FOR JSON PATH)
export function query(src, sqlText) {
  const tmp = path.join(os.tmpdir(), `cvjkit-sql-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  try {
    execFileSync(SQLCMD, ['-S', src.server, '-E', '-C', '-d', src.database, '-y', '0', '-b', '-u', '-o', tmp,
      '-Q', `SET NOCOUNT ON; SELECT (${sqlText} FOR JSON PATH)`],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    const txt = fs.readFileSync(tmp).toString('utf16le').replace(/^﻿/, '').replace(/\r?\n/g, '').trim();
    if (/^(Msg \d+|Sqlcmd: Error)/.test(txt)) throw Object.assign(new Error(txt.slice(0, 300)), { stderr: txt });
    return txt && txt !== 'NULL' ? JSON.parse(txt) : [];
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}

// first reachable source (live CV25, else the SQLEXPRESS copy)
export function findSource(sources = DEFAULT_SOURCES) {
  const errors = [];
  for (const s of sources) {
    try {
      const [info] = query(s, "SELECT CONVERT(varchar(19), create_date, 126) created FROM sys.databases WHERE name = DB_NAME()");
      return { ...s, created: info && info.created };
    } catch (e) {
      errors.push(`${s.server}/${s.database}: ${String(e.stderr || e.message).split(/\r?\n/)[0]}`);
    }
  }
  return { server: null, errors };
}

// CVData value → engine parameter. nvarchar holds either a number (mm, or inch for
// type 1 length) or a formula string "cond|formula|cond|formula…" (inch constants).
const TYPE = (id) => (id === 1 ? 1 : id === 2 || id === 3 ? 2 : id === 8 ? 8 : id === 4 || id === 5 || id === 10 ? 4 : 6);
export function toParam(name, raw, typeId = 6) {
  const type = TYPE(typeId);
  const s = raw == null ? '' : String(raw);
  const p = { __class: 'CVParameter', name, type };
  if (s.includes('|')) {
    const parts = s.split('|');
    p.equations = [];
    for (let i = 0; i + 1 < parts.length; i += 2) p.equations.push({ condition: parts[i], formula: parts[i + 1] });
    p.value = { value: 0 };
  } else {
    p.equations = [];
    if (type === 8) p.value = { value: s };
    else { const v = parseFloat(s.replace(',', '.')) || 0; p.value = { value: type === 1 ? v / IN : v }; }
  }
  return p;
}

// Load a cabinet Assembly TEMPLATE: its part tree with dimension/position formulas
// and named parameters. Returns { assembly, parts: [{id,parentId,name,subAssembly,
// dims:{W,L,D,X,Y,Z,...}, params:[CVParameter]}] } ready to feed the engine.
export function loadAssembly(src, assemblyId) {
  const [asm] = query(src, `SELECT ID id, Name name, Width width, Height height, Depth depth FROM Assembly WHERE ID = ${Number(assemblyId)}`);
  if (!asm) throw new Error(`Assembly ${assemblyId} not found`);
  const rawParts = query(src, `SELECT ID id, ParentID parentId, Name name, SubAssembly sub,
    Width W, Length L, Depth D, XPosition X, YPosition Y, ZPosition Z,
    XRotation AX, YRotation AY, ZRotation AZ
    FROM AssemblyPart WHERE AssemblyID = ${Number(assemblyId)} ORDER BY ID`);
  const partIds = rawParts.map((p) => p.id);
  // part parameters (chunked to stay under sqlcmd's command-line length limit)
  const extra = new Map(); // partId -> [CVParameter]
  const opsByPart = new Map(); // partId -> [operation]
  for (let i = 0; i < partIds.length; i += 400) {
    const chunk = partIds.slice(i, i + 400);
    if (!chunk.length) break;
    const inList = chunk.join(',');
    const rows = query(src, `SELECT AssemblyPartID pid, Name name, ParameterTypeID t, ParamValue v
      FROM AssemblyPartParameter WHERE AssemblyPartID IN (${inList})`);
    for (const r of rows) {
      if (!extra.has(r.pid)) extra.set(r.pid, []);
      extra.get(r.pid).push(toParam(r.name, r.v, r.t));
    }
    // machining operations (holes, dados, linebore, route) with position formulas
    const ops = query(src, `SELECT ID id, AssemblyPartID pid, Name name, OperationTypeID type,
      WorkPlaneTypeID wp, XPosition X, YPosition Y, ZPosition Z, Width W, Length L, Depth D,
      [Repeat] rep, Spacing sp, ToolID tool
      FROM AssemblyPartOperation WHERE AssemblyPartID IN (${inList}) ORDER BY ID`);
    for (const o of ops) {
      if (!opsByPart.has(o.pid)) opsByPart.set(o.pid, []);
      opsByPart.get(o.pid).push({
        id: o.id, name: o.name, type: o.type, tool: o.tool,
        X: toParam('X', o.X, 1), Y: toParam('Y', o.Y, 1), Z: toParam('Z', o.Z, 1),
        W: toParam('DX', o.W, 1), L: toParam('DY', o.L, 1), D: toParam('DZ', o.D, 1),
        REPT: toParam('REPT', o.rep, 4), SPCNG: toParam('SPCNG', o.sp, 1),
      });
    }
  }
  const parts = rawParts.map((p) => ({
    id: p.id, parentId: p.parentId, name: p.name, subAssembly: !!p.sub,
    dims: {
      W: toParam('DX', p.W, 1), L: toParam('DY', p.L, 1), D: toParam('DZ', p.D, 1),
      X: toParam('X', p.X, 1), Y: toParam('Y', p.Y, 1), Z: toParam('Z', p.Z, 1),
      AX: toParam('AX', p.AX, 2), AY: toParam('AY', p.AY, 2), AZ: toParam('AZ', p.AZ, 2),
    },
    params: extra.get(p.id) || [],
    ops: opsByPart.get(p.id) || [],
  }));
  return { assembly: { id: asm.id, name: asm.name, width: asm.width, height: asm.height, depth: asm.depth }, parts };
}
