// cvjkit — construction ENGINE (phase 3).
// Where equations.mjs parses+evaluates one formula, this evaluates the WHOLE
// parameter graph of a decoded job in dependency order: each derived parameter
// is computed from its inputs (not from its stored value), exactly as CV's
// construction engine does. That lets us change a base dimension and recompute
// every derived value (part sizes, hole patterns, hardware positions, banding).
//
// Model: every CVParameter is a node. A node is an INPUT if it has no formula,
// else DERIVED. References inside a formula are resolved over the object tree
// (self `:NAME`, bare `NAME` scoped up the ancestors, dotted `Cab.Case.DX`),
// plus catalog constants (`_CV:350`). Evaluation is memoized; dependency cycles
// fall back to the stored value to stay total.

import { compile, evalAst } from './equations.mjs';

const storedVal = (p) => {
  const v = p && p.value;
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
};

// ---- build the navigable model from a decoded object list ----
export function buildModel(objs) {
  const parent = new Map();
  for (const o of objs) for (const c of (o.children || [])) if (c) parent.set(c, o);
  const objList = objs;
  const cabinetOf = (o) => {
    let x = o; while (x) { if (x.__class === 'CVCabinet') return x; x = parent.get(x); }
    return objList.find((z) => z.__class === 'CVCabinet');
  };
  const childNamed = (o, n) => ((o && o.children) || []).find((c) => c && c.name === n);
  // breadth-first search for the nearest descendant assembly named `n`
  const descNamed = (root, n) => {
    if (!root) return undefined;
    const q = [...(root.children || [])];
    while (q.length) {
      const c = q.shift();
      if (!c) continue;
      if (c.name === n) return c;
      if (c.children) for (const g of c.children) q.push(g);
    }
    return undefined;
  };
  const paramOf = (owner, name) => {
    if (!owner || !owner.params) return undefined;
    for (const p of owner.params) if (p.__class === 'CVParameter' && p.name === name) return p;
    return undefined;
  };
  // resolve a reference name (from an owner's scope) to a {owner,p} node
  const resolveNode = (owner, name) => {
    if (name.startsWith(':')) {
      // self dimension/param. CV hardware & sub-parts reference `:DZ` etc. of the
      // host frame: if this object lacks it, inherit from the nearest ancestor
      // that has it (self first, then up the tree).
      const bare = name.slice(1);
      let x = owner; while (x) { const p = paramOf(x, bare); if (p) return { owner: x, p }; x = parent.get(x); }
      return undefined;
    }
    if (name.indexOf('.') >= 0) {
      const segs = name.split('.');
      const cab = cabinetOf(owner);
      // first segment: This/Cab keywords, else a named assembly reached from the
      // owner, then its ancestors' subtrees, then the whole cabinet subtree.
      let cur;
      if (segs[0] === 'This') cur = owner;
      else if (segs[0] === 'Cab') cur = cab;
      else {
        cur = childNamed(owner, segs[0]) || descNamed(owner, segs[0]);
        for (let a = parent.get(owner); !cur && a; a = parent.get(a)) cur = childNamed(a, segs[0]);
        if (!cur) cur = descNamed(cab, segs[0]);
      }
      for (let k = 1; k < segs.length - 1 && cur; k++) cur = childNamed(cur, segs[k]) || descNamed(cur, segs[k]);
      const p = cur && paramOf(cur, segs[segs.length - 1]);
      return p ? { owner: cur, p } : undefined;
    }
    let x = owner; while (x) { const p = paramOf(x, name); if (p) return { owner: x, p }; x = parent.get(x); }
    return undefined;
  };
  return { objs: objList, parent, cabinetOf, childNamed, paramOf, resolveNode };
}

// ---- the engine: memoized dependency-ordered evaluation ----
export function makeEngine(model, opts = {}) {
  const catalog = opts.catalog || {};             // name -> number (e.g. "_CV:350": 350)
  const memo = new Map();                          // param obj -> computed value
  const inprog = new Set();
  const overrides = new Map();                     // param obj -> forced value
  const fellBack = new Set();                       // params whose formula could NOT be evaluated
  const stats = { cycles: 0, unresolved: {}, evalFail: 0 };

  const hasFormula = (p) => (p.equations || []).some((e) => e.formula);
  const isInput = (p) => !hasFormula(p);

  // choose the equation that applies (first whose condition holds; else first)
  function activeEquation(p, resolve) {
    const eqs = (p.equations || []).filter((e) => e.formula);
    for (const e of eqs) {
      if (!e.condition || e.condition === '1') return e;
      try { if (evalAst(compile(e.condition), resolve)) return e; } catch { /* fall through */ }
    }
    return eqs.find((e) => !e.condition || e.condition === '1') || eqs[0] || null;
  }

  function valueOf(node) {
    const p = node.p;
    if (overrides.has(p)) return overrides.get(p);
    if (memo.has(p)) return memo.get(p);
    if (inprog.has(p)) { stats.cycles++; return storedVal(p); }    // break cycle
    inprog.add(p);
    const resolve = (name) => {
      if (name in catalog) return catalog[name];
      // _EDGnDY = length of the part's edge n (CXTemplate::GetEdgeLength). For a
      // rectangular part the edges alternate DX,DY,DX,DY → odd edge = DX, even = DY
      // (empirically verified across the corpus). Resolve the dim from the nearest
      // ancestor that has it.
      const em = /^_EDG(\d+)DY$/.exec(name);
      if (em) {
        const dim = (Number(em[1]) % 2) ? 'DX' : 'DY';
        const t = model.resolveNode(node.owner, ':' + dim);
        if (t) return valueOf(t);
        stats.unresolved[name] = (stats.unresolved[name] || 0) + 1; return undefined;
      }
      const t = model.resolveNode(node.owner, name);
      if (!t) { stats.unresolved[name] = (stats.unresolved[name] || 0) + 1; return undefined; }
      return valueOf(t);
    };
    let val;
    const eq = activeEquation(p, resolve);
    if (eq) {
      try { val = evalAst(compile(eq.formula), resolve); }
      catch { stats.evalFail++; fellBack.add(p); val = storedVal(p); }
    } else val = storedVal(p);
    if (typeof val !== 'number' || Number.isNaN(val)) { fellBack.add(p); val = storedVal(p); }
    inprog.delete(p);
    memo.set(p, val);
    return val;
  }

  // evaluate the whole graph (optionally with input overrides); returns a fresh run
  function run(overrideList = []) {
    memo.clear(); inprog.clear(); overrides.clear(); fellBack.clear();
    stats.cycles = 0; stats.unresolved = {}; stats.evalFail = 0;
    for (const { p, value } of overrideList) overrides.set(p, value);
    const results = [];
    for (const o of model.objs) {
      if (!o.params) continue;
      for (const p of o.params) {
        if (p.__class !== 'CVParameter') continue;
        const value = valueOf({ owner: o, p });
        results.push({ owner: o, p, name: p.name, value, stored: storedVal(p), fellBack: fellBack.has(p) });
      }
    }
    return results;
  }

  return { valueOf, run, stats, isInput, hasFormula, activeEquation, storedVal, fellBack };
}

export { storedVal };
