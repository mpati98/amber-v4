// Biểu thức luật kinh tế — tập con kiểu Python, KHÔNG dùng eval.
// Hỗ trợ: số, True/False, biến trạng thái, e.<trường>, + - * /, so sánh, and/or/not,
// `a if cond else b`, min/max/abs. Biên dịch một lần lúc nạp luật: sai cú pháp, sai tên biến
// hay sai kiểu (vd cộng số với bool) đều báo lỗi ngay lúc nạp, không đợi tới lúc chạy.

export type ExprType = "number" | "boolean";
export type ExprValue = number | boolean;

/** Kiểu của các tên được phép: biến trạng thái và trường của sự kiện (`e.*`). */
export type ExprScope = { vars: Record<string, ExprType>; eventFields: Record<string, ExprType> };
export type ExprEnv = { vars: Record<string, ExprValue>; e: Record<string, unknown> };

type Node =
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "var"; name: string }
  | { k: "field"; name: string }
  | { k: "unary"; op: "-" | "not"; x: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "if"; cond: Node; then: Node; else: Node }
  | { k: "call"; fn: "min" | "max" | "abs"; args: Node[] };

export class ExprError extends Error {}

type Tok = { t: "num" | "id" | "op" | "end"; v: string; pos: number };

const KEYWORDS = new Set(["and", "or", "not", "if", "else", "True", "False"]);
const FUNCS = new Set(["min", "max", "abs"]);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    const num = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: num[0], pos: i }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: "id", v: id[0], pos: i }); i += id[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!="].includes(two)) { out.push({ t: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/<>(),.".includes(c)) { out.push({ t: "op", v: c, pos: i }); i++; continue; }
    throw new ExprError(`Ký tự không hợp lệ '${c}' ở vị trí ${i}`);
  }
  out.push({ t: "end", v: "", pos: src.length });
  return out;
}

// Độ ưu tiên (thấp → cao): if-else < or < and < not < so sánh < + - < * / < dấu âm < gọi hàm/thuộc tính.
function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const isKw = (v: string) => peek().t === "id" && peek().v === v;
  const fail = (msg: string): never => { throw new ExprError(`${msg} ở vị trí ${peek().pos}`); };
  const expectOp = (v: string) => { if (!isOp(v)) fail(`Thiếu '${v}'`); p++; };

  function ternary(): Node {
    const then = orExpr();
    if (!isKw("if")) return then;
    p++;
    const cond = orExpr();
    if (!isKw("else")) fail("Thiếu 'else'");
    p++;
    return { k: "if", cond, then, else: ternary() };
  }
  function orExpr(): Node {
    let a = andExpr();
    while (isKw("or")) { p++; a = { k: "bin", op: "or", a, b: andExpr() }; }
    return a;
  }
  function andExpr(): Node {
    let a = notExpr();
    while (isKw("and")) { p++; a = { k: "bin", op: "and", a, b: notExpr() }; }
    return a;
  }
  function notExpr(): Node {
    if (isKw("not")) { p++; return { k: "unary", op: "not", x: notExpr() }; }
    return comparison();
  }
  function comparison(): Node {
    const a = additive();
    const op = peek().v;
    if (peek().t === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(op)) {
      p++;
      const node: Node = { k: "bin", op, a, b: additive() };
      if (peek().t === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(peek().v)) fail("Không hỗ trợ so sánh nối chuỗi (a < b < c)");
      return node;
    }
    return a;
  }
  function additive(): Node {
    let a = multiplicative();
    while (isOp("+") || isOp("-")) { const op = toks[p++].v; a = { k: "bin", op, a, b: multiplicative() }; }
    return a;
  }
  function multiplicative(): Node {
    let a = unary();
    while (isOp("*") || isOp("/")) { const op = toks[p++].v; a = { k: "bin", op, a, b: unary() }; }
    return a;
  }
  function unary(): Node {
    if (isOp("-")) { p++; return { k: "unary", op: "-", x: unary() }; }
    if (isOp("+")) { p++; return unary(); }
    return primary();
  }
  function primary(): Node {
    const tok = peek();
    if (tok.t === "num") { p++; return { k: "num", v: Number(tok.v) }; }
    if (isOp("(")) { p++; const x = ternary(); expectOp(")"); return x; }
    if (tok.t !== "id") return fail("Thiếu toán hạng");
    p++;
    if (tok.v === "True" || tok.v === "False") return { k: "bool", v: tok.v === "True" };
    if (KEYWORDS.has(tok.v)) return fail(`Từ khoá '${tok.v}' đặt sai chỗ`);
    if (tok.v === "e" && isOp(".")) {
      p++;
      const f = peek();
      if (f.t !== "id") fail("Thiếu tên trường sau 'e.'");
      p++;
      return { k: "field", name: f.v };
    }
    if (isOp("(")) {
      if (!FUNCS.has(tok.v)) fail(`Hàm '${tok.v}' không được phép`);
      p++;
      const args: Node[] = [];
      if (!isOp(")")) {
        args.push(ternary());
        while (isOp(",")) { p++; args.push(ternary()); }
      }
      expectOp(")");
      return { k: "call", fn: tok.v as "min" | "max" | "abs", args };
    }
    return { k: "var", name: tok.v };
  }

  const root = ternary();
  if (peek().t !== "end") fail(`Thừa '${peek().v}'`);
  return root;
}

function typeOf(n: Node, scope: ExprScope): ExprType {
  const need = (x: Node, t: ExprType, what: string) => {
    const got = typeOf(x, scope);
    if (got !== t) throw new ExprError(`${what} cần ${t}, nhận ${got}`);
  };
  switch (n.k) {
    case "num": return "number";
    case "bool": return "boolean";
    case "var": {
      // hasOwn: không để "constructor", "toString"… lọt qua prototype của object
      const t = Object.hasOwn(scope.vars, n.name) ? scope.vars[n.name] : undefined;
      if (!t) throw new ExprError(`Biến không tồn tại: ${n.name}`);
      return t;
    }
    case "field": {
      const t = Object.hasOwn(scope.eventFields, n.name) ? scope.eventFields[n.name] : undefined;
      if (!t) throw new ExprError(`Sự kiện không có trường: e.${n.name}`);
      return t;
    }
    case "unary":
      need(n.x, n.op === "-" ? "number" : "boolean", `'${n.op}'`);
      return n.op === "-" ? "number" : "boolean";
    case "bin":
      if (n.op === "and" || n.op === "or") { need(n.a, "boolean", `'${n.op}'`); need(n.b, "boolean", `'${n.op}'`); return "boolean"; }
      if (n.op === "==" || n.op === "!=") {
        if (typeOf(n.a, scope) !== typeOf(n.b, scope)) throw new ExprError(`'${n.op}' so sánh hai kiểu khác nhau`);
        return "boolean";
      }
      need(n.a, "number", `'${n.op}'`);
      need(n.b, "number", `'${n.op}'`);
      return ["<", "<=", ">", ">="].includes(n.op) ? "boolean" : "number";
    case "if": {
      need(n.cond, "boolean", "Điều kiện if");
      const t = typeOf(n.then, scope);
      need(n.else, t, "Nhánh else");
      return t;
    }
    case "call":
      if (n.fn === "abs" ? n.args.length !== 1 : n.args.length < 2) throw new ExprError(`Số tham số của ${n.fn}() không hợp lệ`);
      n.args.forEach((a) => need(a, "number", `${n.fn}()`));
      return "number";
  }
}

function evaluate(n: Node, env: ExprEnv): ExprValue {
  switch (n.k) {
    case "num": case "bool": return n.v;
    case "var": return env.vars[n.name];
    case "field": {
      const v = Object.hasOwn(env.e, n.name) ? env.e[n.name] : undefined;
      if (typeof v !== "number" && typeof v !== "boolean") throw new ExprError(`Sự kiện thiếu trường e.${n.name}`);
      return v;
    }
    case "unary": return n.op === "-" ? -(evaluate(n.x, env) as number) : !evaluate(n.x, env);
    case "bin": {
      if (n.op === "and") return (evaluate(n.a, env) as boolean) && (evaluate(n.b, env) as boolean);
      if (n.op === "or") return (evaluate(n.a, env) as boolean) || (evaluate(n.b, env) as boolean);
      const a = evaluate(n.a, env), b = evaluate(n.b, env);
      switch (n.op) {
        case "==": return a === b;
        case "!=": return a !== b;
        case "<": return (a as number) < (b as number);
        case "<=": return (a as number) <= (b as number);
        case ">": return (a as number) > (b as number);
        case ">=": return (a as number) >= (b as number);
        case "+": return (a as number) + (b as number);
        case "-": return (a as number) - (b as number);
        case "*": return (a as number) * (b as number);
        case "/": {
          if (b === 0) throw new ExprError("Chia cho 0");
          return (a as number) / (b as number);
        }
      }
      throw new ExprError(`Toán tử lạ ${n.op}`);
    }
    case "if": return evaluate(n.cond, env) ? evaluate(n.then, env) : evaluate(n.else, env);
    case "call": {
      const xs = n.args.map((a) => evaluate(a, env) as number);
      return n.fn === "abs" ? Math.abs(xs[0]) : n.fn === "min" ? Math.min(...xs) : Math.max(...xs);
    }
  }
}

export type CompiledExpr = { src: string; type: ExprType; run: (env: ExprEnv) => ExprValue };

/** Biên dịch + kiểm kiểu. `expect` (nếu có) bắt biểu thức phải ra đúng kiểu đó. */
export function compileExpr(src: string, scope: ExprScope, expect?: ExprType): CompiledExpr {
  const ast = parse(src);
  const type = typeOf(ast, scope);
  if (expect && type !== expect) throw new ExprError(`Biểu thức "${src}" cần ra ${expect}, nhưng ra ${type}`);
  return {
    src,
    type,
    run: (env) => {
      const v = evaluate(ast, env);
      if (typeof v === "number" && !Number.isFinite(v)) throw new ExprError(`Biểu thức "${src}" ra số không hữu hạn`);
      return v;
    },
  };
}
