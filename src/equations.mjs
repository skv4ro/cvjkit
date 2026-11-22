// cvjkit — CV equation evaluator (the "construction brain" prototype).
// Parses and evaluates the CV parameter formula language so derived values
// (part dimensions, hole patterns, hardware positions, edge banding) can be
// RE-COMPUTED when inputs change — i.e. replicate CV's construction engine for
// a given shop whose rules live as formulas inside its .cvj files.
//
// Language (from corpus analysis): arithmetic (+ - * / unary-), parentheses,
// comparisons (< > <= >= == != → 1/0), numeric literals with optional unit
// (bare = internal inch unit; `Nmm` = N/25.4; `"` inch), functions Imp(x)=x/25.4,
// Trunc(x), Round(x), and identifiers: local `NAME`, self `:NAME`, computed
// `_NAME`, and dotted paths `Root.Child.NAME` resolved over the object tree.

const MM = 25.4;

// ---------- tokenizer ----------
function tokenize(src) {
  const toks = []; let i = 0;
  const push = (t, v) => toks.push({ t, v });
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c >= '0' && c <= '9' || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      let num = parseFloat(src.slice(i, j));
      // optional unit suffix
      if (src.slice(j, j + 2) === 'mm') { num /= MM; j += 2; }
      else if (src[j] === '"') { j += 1; }               // inch (internal unit)
      else if (src.slice(j, j + 2) === 'cm') { num *= 10 / MM; j += 2; }
      push('num', num); i = j; continue;
    }
    // identifier: letters, digits, _, ., leading :
    if (/[A-Za-z_:]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_.:]/.test(src[j])) j++;
      push('id', src.slice(i, j)); i = j; continue;
    }
    if ('<>=!'.includes(c)) {                            // comparison / assignment
      if (src[i + 1] === '=') { push('op', c + '='); i += 2; }
      else { push('op', c); i++; }
      continue;
    }
    if ('+-*/()'.includes(c)) { push('op', c); i++; continue; }
    if (c === ',') { push('comma'); i++; continue; }
    // unknown char — skip (robustness)
    i++;
  }
  return toks;
}

// ---------- parser (recursive descent, standard precedence) ----------
function parse(toks) {
  let p = 0;
  const peek = () => toks[p];
  const eat = (t, v) => { const tk = toks[p]; if (!tk || tk.t !== t || (v !== undefined && tk.v !== v)) throw new Error(`expected ${t} ${v ?? ''} at ${p}`); p++; return tk; };
  function parseExpr() { return parseCmp(); }
  function parseCmp() {
    let l = parseAdd();
    while (peek() && peek().t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek().v)) {
      const op = eat('op').v; const r = parseAdd(); l = { k: 'cmp', op, l, r };
    }
    return l;
  }
  function parseAdd() {
    let l = parseMul();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = eat('op').v; const r = parseMul(); l = { k: 'bin', op, l, r };
    }
    return l;
  }
  function parseMul() {
    let l = parseUnary();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = eat('op').v; const r = parseUnary(); l = { k: 'bin', op, l, r };
    }
    return l;
  }
  function parseUnary() {
    if (peek() && peek().t === 'op' && peek().v === '-') { eat('op'); return { k: 'neg', e: parseUnary() }; }
    if (peek() && peek().t === 'op' && peek().v === '+') { eat('op'); return parseUnary(); }
    return parseAtom();
  }
  function parseAtom() {
    const tk = peek();
    if (!tk) throw new Error('unexpected end');
    if (tk.t === 'num') { eat('num'); return { k: 'num', v: tk.v }; }
    if (tk.t === 'op' && tk.v === '(') { eat('op', '('); const e = parseExpr(); eat('op', ')'); return e; }
    if (tk.t === 'id') {
      eat('id');
      // function call?
      if (peek() && peek().t === 'op' && peek().v === '(') {
        eat('op', '('); const args = [];
        if (!(peek() && peek().t === 'op' && peek().v === ')')) {
          args.push(parseExpr());
          while (peek() && peek().t === 'comma') { eat('comma'); args.push(parseExpr()); }
        }
        eat('op', ')'); return { k: 'call', name: tk.v, args };
      }
      return { k: 'id', name: tk.v };
    }
    throw new Error(`unexpected ${tk.t} ${tk.v ?? ''}`);
  }
  const ast = parseExpr();
  if (p !== toks.length) throw new Error(`trailing tokens at ${p}`);
  return ast;
}

// ---------- evaluator ----------
const FUNCS = {
  imp: (x) => x / MM,          // mm → internal inch unit
  trunc: (x) => Math.trunc(x),
  round: (x) => Math.round(x),
  abs: (x) => Math.abs(x),
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  int: (x) => Math.trunc(x),
  sqrt: (x) => Math.sqrt(x),
};
function evalAst(ast, resolve) {
  switch (ast.k) {
    case 'num': return ast.v;
    case 'neg': return -evalAst(ast.e, resolve);
    case 'bin': {
      const a = evalAst(ast.l, resolve), b = evalAst(ast.r, resolve);
      return ast.op === '+' ? a + b : ast.op === '-' ? a - b : ast.op === '*' ? a * b : a / b;
    }
    case 'cmp': {
      const a = evalAst(ast.l, resolve), b = evalAst(ast.r, resolve);
      const r = ast.op === '<' ? a < b : ast.op === '>' ? a > b : ast.op === '<=' ? a <= b :
        ast.op === '>=' ? a >= b : ast.op === '==' ? a === b : a !== b;
      return r ? 1 : 0;
    }
    case 'call': {
      const fn = FUNCS[ast.name.toLowerCase()];
      if (!fn) throw new Error(`unknown function ${ast.name}`);
      return fn(...ast.args.map((x) => evalAst(x, resolve)));
    }
    case 'id': {
      const v = resolve(ast.name);
      if (v === undefined || v === null || Number.isNaN(v)) throw new Error(`unresolved ${ast.name}`);
      return v;
    }
    default: throw new Error('bad ast');
  }
}

export function compile(formula) { return parse(tokenize(formula)); }
export function evaluate(formula, resolve) { return evalAst(compile(formula), resolve); }

export { tokenize, parse, evalAst, FUNCS, MM };
