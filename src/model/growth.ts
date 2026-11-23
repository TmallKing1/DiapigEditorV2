// 成长曲线：把“等级 x 的函数”算成 1–200 级的倍率表并导出 CSV。
// 表达式语法、数字格式与 CSV 格式与旧版 GrowthGeneratorPage.java 保持一致：
// 支持 + - * / ^（右结合）、括号、隐式乘法（2x、3(x+1)）、x / pi / e，
// 以及 sin cos tan sqrt abs log(以 10 为底) ln exp max(a,b) min(a,b)。
// 在此之上扩充（旧版写不出这些，所以旧公式的结果不变）：floor ceil round、
// root(x, n)（n 次方根，奇数次可开负数）、max / min 接受两个以上参数、π 可代替 pi。
// 先解析成语法树（数学键盘要用它与公式框互转），再编译成求值函数。

export const MAX_LEVEL = 200;
export const CURVES = [
  { key: "hp", name: "生命", column: "生命值倍率", fallback: "0.1x" },
  { key: "atk", name: "攻击", column: "攻击力倍率", fallback: "0.05x" },
  { key: "def", name: "防御", column: "防御力倍率", fallback: "0.02x" },
] as const;

export type Expr = (x: number) => number;

export class ExprError extends Error {}

/** 语法树。保留括号与“隐式乘法”，便于原样还原成源码 */
export type Ast =
  | { k: "num"; text: string }
  | { k: "x" }
  | { k: "const"; name: "pi" | "e" }
  | { k: "unary"; op: "+" | "-"; a: Ast }
  /** op 为空串表示隐式乘法（2x、3(x+1)） */
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^" | ""; a: Ast; b: Ast }
  | { k: "paren"; a: Ast }
  | { k: "call"; name: string; args: Ast[] };

const isLetter = (c: string) => /\p{L}/u.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

/** n 次方根：奇数次根对负数取实根（Math.pow 会给 NaN） */
function nthRoot(v: number, n: number): number {
  if (v < 0 && Number.isInteger(n) && Math.abs(n % 2) === 1) return -Math.pow(-v, 1 / n);
  return Math.pow(v, 1 / n);
}

const FN1: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};
const FN2: Record<string, (a: number, b: number) => number> = { root: nthRoot };
/** 参数个数可变（至少两个） */
const FNN: Record<string, (...v: number[]) => number> = { max: Math.max, min: Math.min };

/** 支持的函数名与参数个数（"2+" 为至少两个）；数学键盘按它识别函数名 */
export const FUNCTIONS: Readonly<Record<string, 1 | 2 | "2+">> = {
  ...Object.fromEntries(Object.keys(FN1).map((n) => [n, 1 as const])),
  ...Object.fromEntries(Object.keys(FN2).map((n) => [n, 2 as const])),
  ...Object.fromEntries(Object.keys(FNN).map((n) => [n, "2+" as const])),
};

/** 去掉空格与开头的 y =，与求值时看到的字符串相同 */
export function normalizeSource(source: string): string {
  let s = source.trim().replaceAll(" ", "");
  if (s.startsWith("y=") || s.startsWith("Y=")) s = s.slice(2).trim();
  return s;
}

/** 解析表达式；出错时抛出带位置（从 1 起）的 ExprError */
export function parseExpr(source: string): Expr {
  return compileAst(parseAst(source));
}

/** 把语法树编译成求值函数（运算顺序与旧版逐项相同，结果逐位一致） */
export function compileAst(t: Ast): Expr {
  switch (t.k) {
    case "num": {
      const v = Number(t.text);
      return () => v;
    }
    case "x":
      return (x) => x;
    case "const": {
      const v = t.name === "pi" ? Math.PI : Math.E;
      return () => v;
    }
    case "unary": {
      const a = compileAst(t.a);
      return t.op === "+" ? a : (x) => -a(x);
    }
    case "paren":
      return compileAst(t.a);
    case "bin": {
      const a = compileAst(t.a);
      const b = compileAst(t.b);
      switch (t.op) {
        case "+":
          return (x) => a(x) + b(x);
        case "-":
          return (x) => a(x) - b(x);
        case "/":
          return (x) => a(x) / b(x);
        case "^":
          return (x) => Math.pow(a(x), b(x));
        default:
          return (x) => a(x) * b(x);
      }
    }
    case "call": {
      const args = t.args.map(compileAst);
      if (FNN[t.name]) {
        const f = FNN[t.name];
        return (x) => f(...args.map((a) => a(x)));
      }
      if (FN2[t.name]) {
        const f = FN2[t.name];
        const [a, b] = args;
        return (x) => f(a(x), b(x));
      }
      const f = FN1[t.name];
      const [a] = args;
      return (x) => f(a(x));
    }
  }
}

/** 解析成语法树；出错时抛出带位置（从 1 起）的 ExprError */
export function parseAst(source: string): Ast {
  const s = normalizeSource(source);
  if (!s) throw new ExprError("函数不能为空");
  let pos = 0;
  const err = (msg: string) => new ExprError(`${msg}（位置 ${pos + 1}）`);
  const require = (ch: string) => {
    if (s[pos] !== ch) throw err(`缺少 '${ch}'`);
    pos++;
  };
  const startsPrimary = (c: string) => c === "(" || c === "." || isDigit(c) || isLetter(c);

  function additive(): Ast {
    let left = multiplicative();
    while (pos < s.length) {
      const op = s[pos];
      if (op !== "+" && op !== "-") break;
      pos++;
      const right = multiplicative();
      left = { k: "bin", op, a: left, b: right };
    }
    return left;
  }

  function multiplicative(): Ast {
    let left = power();
    while (pos < s.length) {
      const op = s[pos];
      if (op === "*" || op === "/") {
        pos++;
        const right = power();
        left = { k: "bin", op, a: left, b: right };
      } else if (startsPrimary(op)) {
        const right = power();
        left = { k: "bin", op: "", a: left, b: right };
      } else break;
    }
    return left;
  }

  function power(): Ast {
    const left = unary();
    if (s[pos] === "^") {
      pos++;
      const right = power();
      return { k: "bin", op: "^", a: left, b: right };
    }
    return left;
  }

  function unary(): Ast {
    const c = s[pos];
    if (c === "+" || c === "-") {
      pos++;
      const operand = unary();
      return { k: "unary", op: c, a: operand };
    }
    return primary();
  }

  function number(): Ast {
    const start = pos;
    while (pos < s.length) {
      const c = s[pos];
      const prev = s[pos - 1];
      const ok =
        isDigit(c) || c === "." || c === "e" || c === "E" || ((c === "+" || c === "-") && pos > start && (prev === "e" || prev === "E"));
      if (!ok) break;
      pos++;
    }
    const text = s.slice(start, pos);
    // 与 Java Double.parseDouble 对齐：至少要有一位数字
    if (!/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) throw err("数字格式错误");
    return { k: "num", text };
  }

  function primary(): Ast {
    if (pos >= s.length) throw err("函数表达式不完整");
    const c = s[pos];
    if (c === "(") {
      pos++;
      const inner = additive();
      require(")");
      return { k: "paren", a: inner };
    }
    if (isDigit(c) || c === ".") return number();
    if (isLetter(c)) {
      const start = pos;
      while (pos < s.length && isLetter(s[pos])) pos++;
      const name = s.slice(start, pos).toLowerCase();
      if (name === "x") return { k: "x" };
      if (name === "pi" || name === "π") return { k: "const", name: "pi" };
      if (name === "e") return { k: "const", name: "e" };
      require("(");
      const args = [additive()];
      const arity = FUNCTIONS[name];
      // 与旧版相同：先读完参数和右括号，再报“不支持的函数”
      if (arity === 2 || arity === "2+") {
        require(",");
        args.push(additive());
        while (arity === "2+" && s[pos] === ",") {
          pos++;
          args.push(additive());
        }
      }
      require(")");
      if (!arity) throw new ExprError(`不支持的函数：${s.slice(start, start + name.length)}`);
      return { k: "call", name, args };
    }
    throw err("无法识别的字符");
  }

  const result = additive();
  if (pos !== s.length) throw err("无法识别的字符");
  return result;
}

/**
 * 与 Java `new DecimalFormat("0.####")`（Locale.ROOT）相同：最多 4 位小数、去掉末尾 0、
 * 不分组、按双精度数的精确十进制值做“四舍六入五成双”，负数归零时写作 "-0"。
 */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) throw new ExprError("函数结果不是有效数字");
  const negative = v < 0 || Object.is(v, -0);
  // toFixed(100) 给出该双精度数的精确十进制展开（对 ≥ 2^-40 的数足够），避免 v×10^4 的二次舍入
  // ≥ 1e21 时 toFixed 会改用指数写法；这么大的双精度数本身就是整数
  const abs = Math.abs(v);
  const exact = abs >= 1e21 ? BigInt(abs).toString() + ".0000" : abs.toFixed(100);
  const [intPart, frac] = exact.split(".");
  let n = BigInt(intPart + frac.slice(0, 4));
  const rest = frac.slice(4);
  const first = rest.charCodeAt(0) - 48;
  const tail = /[1-9]/.test(rest.slice(1));
  if (first > 5 || (first === 5 && tail) || (first === 5 && !tail && n % 2n === 1n)) n += 1n;
  const digits = n.toString().padStart(5, "0");
  const fracOut = digits.slice(-4).replace(/0+$/, "");
  const body = digits.slice(0, -4) + (fracOut ? "." + fracOut : "");
  return (negative ? "-" : "") + body;
}

/** 某条曲线 1..MAX_LEVEL 的值；有非有限值时抛出 */
export function sampleCurve(expr: Expr): number[] {
  const out: number[] = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const v = expr(level);
    if (!Number.isFinite(v)) throw new ExprError(`等级 ${level} 的结果不是有效数字`);
    out.push(v);
  }
  return out;
}

/** 导出内容：UTF-8 BOM + 表头 + 每级一行，换行为 \n（与旧版一致） */
export function growthCsv(exprs: readonly Expr[]): string {
  let csv = "﻿等级," + CURVES.map((c) => c.column).join(",") + "\n";
  for (let level = 1; level <= MAX_LEVEL; level++) {
    csv += level + "," + exprs.map((e) => formatNumber(e(level))).join(",") + "\n";
  }
  return csv;
}

// —— 页面参数的保存与重置 ——
// 成长曲线页的全部持久状态只有这一个 localStorage 键（公式、曲线开关、预览等级）。
// 放在模块里而不是组件里：左侧栏「重置」可能在页面没挂载时调用。

export const GROWTH_KEY = "diapig.growth";

export interface GrowthSaved {
  formulas: string[];
  shown: boolean[];
  level: number;
}

export function loadGrowth(): GrowthSaved | null {
  try {
    const v = JSON.parse(localStorage.getItem(GROWTH_KEY) ?? "null");
    if (v && Array.isArray(v.formulas) && v.formulas.length === CURVES.length) return v;
  } catch {
    // 读不到就用默认值
  }
  return null;
}

export function saveGrowth(data: GrowthSaved) {
  try {
    localStorage.setItem(GROWTH_KEY, JSON.stringify(data));
  } catch {
    // 忽略
  }
}

/** 恢复默认：删掉保存的参数，页面重新挂载时按默认值初始化 */
export function resetGrowth() {
  try {
    localStorage.removeItem(GROWTH_KEY);
  } catch {
    // 忽略
  }
}
