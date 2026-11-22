// cvjkit — Contents (MFC CArchive object graph) codec framework.
// The object-graph machinery (class registry, object registry, tag dispatch) is
// complete. Per-class body codecs are registered into CLASS_CODECS from the
// decompiled serializer layouts (format/LAYOUT.md) — see registerClass().
import { Reader, Writer } from './archive.mjs';

// ---- read context ----
// MFC CArchive keeps ONE index space (m_pLoadArray) shared by classes and
// objects, appended in encounter order starting at index 1. A class-ref and an
// object-ref both index into this single array.
export class ReadCtx {
  constructor(reader) {
    this.r = reader;
    this.map = [null];               // index 0 reserved; 1-based like MFC
    this.stack = [];                 // live decode frames (for drift diagnosis)
    this.trail = [];                 // last N completed objects {cls,start,end}
    this.classSchemas = new Map();   // class name -> newclass tag schema u16 (for the writer)
  }
  registerClass(name) { this.map.push({ cls: name }); return this.map.length - 1; }
  registerObject(obj) { this.map.push({ obj }); return this.map.length - 1; }
  classAt(i) { const e = this.map[i]; return e && e.cls; }
  objAt(i) { const e = this.map[i]; return e && e.obj; }
}
export class WriteCtx {
  constructor(writer) { this.w = writer; this.map = new Map(); this.count = 1; }
}

export const CLASS_CODECS = new Map();
// codec: { read(reader, ctx) -> object, write(writer, ctx, object) }
export function registerClass(name, codec) { CLASS_CODECS.set(name, codec); return codec; }
export function hasCodec(name) { return CLASS_CODECS.has(name); }

// ---- object read: resolves tags, dispatches to the class codec ----
export function readObject(ctx) {
  const r = ctx.r;
  const tag = r.tag();
  if (tag.kind === 'null') return null;
  let className;
  if (tag.kind === 'newclass') { ctx.registerClass(tag.name); className = tag.name;
    if (!ctx.classSchemas.has(tag.name)) ctx.classSchemas.set(tag.name, tag.schema); }
  else if (tag.kind === 'classref') { className = ctx.classAt(tag.idx); }
  else if (tag.kind === 'objref') { return ctx.objAt(tag.idx); }
  const codec = CLASS_CODECS.get(className);
  if (!codec) throw new UnmappedClass(className, r.p);
  const obj = { __class: className };
  ctx.registerObject(obj);              // register BEFORE body (self-refs)
  const frame = { cls: className, start: r.p, idx: ctx.map.length - 1 };
  ctx.stack.push(frame);
  codec.read(r, ctx, obj);
  ctx.stack.pop();
  frame.end = r.p;
  ctx.trail.push(frame);
  if (ctx.trail.length > 24) ctx.trail.shift();
  return obj;
}

export class UnmappedClass extends Error {
  constructor(name, offset) { super(`unmapped class "${name}" @${offset}`); this.className = name; this.offset = offset; }
}

// ---- round-trip harness: decode a Contents buffer, re-emit, compare ----
// Works once all classes encountered have codecs. Returns {ok, decodedAt, error}.
export function tryDecode(contents) {
  const r = new Reader(contents);
  const ctx = new ReadCtx(r);
  try {
    const root = readObject(ctx);
    return { ok: true, root, consumed: r.p, total: contents.length, ctx };
  } catch (e) {
    return { ok: false, error: e, at: r.p, className: e.className, ctx };
  }
}

// How far can we get: report the first unmapped class and the offset.
export function probe(contents) {
  const clsNames = (ctx) => ctx.map.filter((e) => e && e.cls).map((e) => e.cls);
  const res = tryDecode(contents);
  if (res.ok) return { status: 'decoded', consumed: res.consumed, total: res.total,
    classes: clsNames(res.ctx) };
  if (res.error instanceof UnmappedClass)
    return { status: 'unmapped', className: res.error.className, at: res.error.offset,
      classesSoFar: clsNames(res.ctx), stack: res.ctx.stack, trail: res.ctx.trail };
  return { status: 'error', message: res.error.message, at: res.at, classesSoFar: clsNames(res.ctx),
    stack: res.ctx.stack, trail: res.ctx.trail };
}
