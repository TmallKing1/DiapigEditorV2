import { describe, expect, it } from "vitest";
import { MAX_LEVEL, parseExpr } from "./growth";
import { apply, emptyState, fromSource, keyAction, stateFromSource, toSource, type MathAction, type MathState } from "./mathExpr";

const tree = (s: string) => {
  const r = fromSource(s);
  if (!r.ok) throw new Error(r.error);
  return r.row;
};
const round = (s: string) => toSource(tree(s));

/** 1..MAX_LEVEL 逐级求值结果相同（NaN 视为相等） */
function sameValues(a: string, b: string) {
  const fa = parseExpr(a);
  const fb = parseExpr(b);
  for (let x = 1; x <= MAX_LEVEL; x++) {
    const va = fa(x);
    const vb = fb(x);
    if (Number.isNaN(va)) expect(Number.isNaN(vb)).toBe(true);
    else expect(vb).toBe(va);
  }
}

/** 依次执行：字符串按物理键盘逐字符键入，对象为动作 */
function run(...steps: (string | MathAction)[]): MathState {
  let st = emptyState();
  for (const s of steps) {
    if (typeof s === "string") {
      for (const c of s) {
        const a = keyAction(c);
        if (a) st = apply(st, a);
      }
    } else st = apply(st, s);
  }
  return st;
}
const src = (st: MathState) => toSource(st.root);

describe("growth extensions", () => {
  const ev = (s: string, x = 2) => parseExpr(s)(x);
  it("evaluates the added functions", () => {
    expect(ev("floor(x/3)", 7)).toBe(2);
    expect(ev("ceil(x/3)", 7)).toBe(3);
    expect(ev("round(x/4)", 6)).toBe(2);
    expect(ev("root(x, 3)", 27)).toBeCloseTo(3);
    expect(ev("root(-x, 3)", 8)).toBeCloseTo(-2); // 奇数次根可开负数
    expect(Number.isNaN(ev("root(-x, 2)", 4))).toBe(true);
    expect(ev("max(1, x, 50)", 7)).toBe(50);
    expect(ev("min(9, x, 3, 4)", 7)).toBe(3);
    expect(ev("2π")).toBeCloseTo(2 * Math.PI);
  });
  it("keeps the old errors", () => {
    expect(() => parseExpr("max(x)")).toThrow("缺少 ','");
    expect(() => parseExpr("root(x)")).toThrow("缺少 ','");
    expect(() => parseExpr("sin(x, 2)")).toThrow("缺少 ')'");
    expect(() => parseExpr("foo(x, 2)")).toThrow("缺少 ')'");
  });
});

describe("source ↔ tree", () => {
  const samples = [
    "0.1x",
    "y = 2x^2 + 1",
    "2^3^2",
    "-x^2",
    "3(x+1)",
    "max(x, 5)",
    "log(100)+ln(e)",
    "1e2x",
    "2pi",
    "(x+1)/(x-1)",
    "x/2+1/2x",
    "2x/3",
    "1/2^3",
    "x^(1/2)",
    "x^-1",
    "-x/2",
    "2*-x/3",
    "x/2/3",
    "sqrt(x)+sin(x)^2",
    "abs(x-100)",
    "exp(x/50)",
    "1.5e-3x^2",
    "(1/2)^x",
    "x/(2x)",
    "x-(x+1)",
    "+x",
    "tan(cos(sin(x)))",
    "min(max(x,10),150)",
    "x^2^-1",
    "0.02x + 3e+1",
    "X+PI+E",
    // 扩充的函数
    "floor(x/10)+ceil(x/3)+round(x/7)",
    "root(x, 3)",
    "max(1, x, 50)",
    "2π",
  ];
  it("round-trips with identical values", () => {
    for (const s of samples) sameValues(s, round(s));
  });
  it("is stable after one normalization", () => {
    for (const s of samples) expect(round(round(s))).toBe(round(s));
  });
  it("produces tidy source", () => {
    expect(round("y = 2x^2 + 1")).toBe("2x^2 + 1");
    expect(round("(x+1)/(x-1)")).toBe("(x + 1)/(x - 1)");
    expect(round("max(x,5)")).toBe("max(x, 5)");
    expect(round("1e2x")).toBe("1E2x");
    expect(round("x^(1/2)")).toBe("x^(1/2)");
    expect(round("-x/2")).toBe("-x/2");
    expect(round("X+PI")).toBe("x + pi");
    expect(round("2π")).toBe("2pi");
  });
  it("builds structures from source", () => {
    expect(tree("1/2")).toEqual([{ t: "frac", num: [{ t: "ch", v: "1" }], den: [{ t: "ch", v: "2" }] }]);
    expect(tree("(x+1)/2")[0]).toMatchObject({ t: "frac", num: [{ t: "sym" }, { v: "+" }, { v: "1" }] });
    expect(tree("x^(2)")).toEqual([{ t: "sym", v: "x" }, { t: "pow", exp: [{ t: "ch", v: "2" }] }]);
    expect(tree("sqrt(x)")[0].t).toBe("sqrt");
    expect(tree("root(x,3)")[0]).toMatchObject({ t: "root", index: [{ v: "3" }], body: [{ v: "x" }] });
    expect(tree("abs(x)")[0]).toMatchObject({ t: "fn", name: "abs" });
  });
  it("reports invalid source", () => {
    expect(fromSource("2x+").ok).toBe(false);
    expect(fromSource("foo(x)")).toEqual({ ok: false, error: "不支持的函数：foo" });
    expect(fromSource("  ")).toEqual({ ok: true, row: [] });
  });
  it("inserts * where tokens would merge", () => {
    const x = { t: "sym", v: "x" } as const;
    const e = { t: "sym", v: "e" } as const;
    const d = (v: string) => ({ t: "ch", v }) as const;
    expect(toSource([x, x])).toBe("x*x");
    expect(toSource([d("2"), e])).toBe("2*e");
    expect(toSource([d("2"), { t: "fn", name: "exp", args: [[x]] }])).toBe("2*exp(x)");
    expect(toSource([d("2"), { t: "frac", num: [d("3")], den: [d("4")] }])).toBe("2*3/4");
    expect(toSource([{ t: "frac", num: [d("1")], den: [d("2")] }, d("3")])).toBe("1/2*3");
    expect(toSource([x, { t: "pow", exp: [d("2")] }, d("3")])).toBe("x^2*3");
    expect(toSource([{ t: "frac", num: [d("1")], den: [d("2")] }, { t: "pow", exp: [x] }])).toBe("(1/2)^x");
    expect(toSource([d("3"), { t: "frac", num: [d("-"), x], den: [d("2")] }])).toBe("3(-x)/2");
  });
});

describe("editing", () => {
  it("types plain formulas", () => {
    expect(src(run("2x^2+1"))).toBe("2x^(2 + 1)");
    // ^ 之后光标在指数里，要先移出来
    expect(src(run("2x^2", { type: "right" }, "+1"))).toBe("2x^2 + 1");
    expect(src(run("0.1x"))).toBe("0.1x");
  });
  it("builds fractions", () => {
    expect(src(run("1/2"))).toBe("1/2");
    // 分子取光标前到运算符为止的内容
    expect(src(run("x+2x/3"))).toBe("x + 2x/3");
    expect(src(run("(x+1", { type: "close" }, "/2"))).toBe("(x + 1)/2");
    // 空分式：光标在分子
    const st = run({ type: "frac" }, "1");
    expect(st.cursor).toEqual({ path: [{ i: 0, s: 0 }], index: 1 });
    expect(src(apply(apply(st, { type: "right" }), { type: "insert", text: "x" }))).toBe("1/x");
  });
  it("builds powers, roots and squares", () => {
    expect(src(run("x", { type: "square" }, "+1"))).toBe("x^2 + 1");
    expect(src(run("x^2^3"))).toBe("x^2^3");
    expect(src(run({ type: "sqrt" }, "x+1"))).toBe("sqrt(x + 1)");
    expect(src(run({ type: "root" }, "3", { type: "right" }, "x"))).toBe("root(x, 3)");
    expect(src(run("2^", { type: "frac" }, "1", { type: "right" }, "2"))).toBe("2^(1/2)");
  });
  it("auto-pairs and closes brackets", () => {
    const st = run("3(x+1");
    expect(src(st)).toBe("3(x + 1)");
    expect(st.cursor.path).toHaveLength(1);
    expect(src(run("3(x+1)+2"))).toBe("3(x + 1) + 2");
    // 括号中间按 )：后半段移出括号
    expect(src(run("(x+1", { type: "left" }, { type: "left" }, ")"))).toBe("(x) + 1");
    // 没有左括号：把前面的内容包起来
    expect(src(run("x+1)^2"))).toBe("(x + 1)^2");
  });
  it("recognizes function names", () => {
    expect(src(run("sin", "x"))).toBe("sin(x)");
    expect(src(run("2sqrtx"))).toBe("2sqrt(x)");
    expect(src(run("exp", "x"))).toBe("exp(x)");
    expect(src(run("max", "x,5"))).toBe("max(x, 5)");
    expect(src(run("max", "1,2,3"))).toBe("max(1, 2, 3)");
    expect(src(run("2pi"))).toBe("2pi");
    expect(src(run("ln(x)+1"))).toBe("ln(x) + 1");
    expect(src(run("ex"))).toBe("e*x");
    expect(src(run({ type: "fn", name: "min" }, "x", { type: "right" }, "9"))).toBe("min(x, 9)");
    expect(src(run("|x-1"))).toBe("abs(x - 1)");
  });
  it("nests functions", () => {
    expect(src(run("sinsqrtx"))).toBe("sin(sqrt(x))");
    expect(src(run("ln", "1+exp", "x/2"))).toBe("ln(1 + exp(x/2))");
    expect(src(run("sqrt", "x", { type: "frac" }, "2"))).toBe("sqrt(x/2)");
  });
  it("moves through slots", () => {
    // 1/2 后：光标在分母末尾；← 进分子末尾，再 ← 到分子开头，再 ← 离开到分式前
    let st = run("1/2");
    expect(st.cursor).toEqual({ path: [{ i: 0, s: 1 }], index: 1 });
    st = apply(st, { type: "left" });
    expect(st.cursor).toEqual({ path: [{ i: 0, s: 1 }], index: 0 });
    st = apply(st, { type: "left" });
    expect(st.cursor).toEqual({ path: [{ i: 0, s: 0 }], index: 1 });
    st = apply(st, { type: "left" });
    expect(st.cursor).toEqual({ path: [{ i: 0, s: 0 }], index: 0 });
    st = apply(st, { type: "left" });
    expect(st.cursor).toEqual({ path: [], index: 0 });
    // → 依次：进分子、分子末尾、分母、分母末尾、分式之后
    const seen = [];
    for (let k = 0; k < 5; k++) {
      st = apply(st, { type: "right" });
      seen.push(JSON.stringify(st.cursor));
    }
    expect(seen).toEqual([
      '{"path":[{"i":0,"s":0}],"index":0}',
      '{"path":[{"i":0,"s":0}],"index":1}',
      '{"path":[{"i":0,"s":1}],"index":0}',
      '{"path":[{"i":0,"s":1}],"index":1}',
      '{"path":[],"index":1}',
    ]);
    // 根行两端不再移动
    expect(apply(st, { type: "right" }).cursor).toEqual({ path: [], index: 1 });
    // 上下键在分子分母间切换
    st = run("12/3");
    expect(apply(st, { type: "up" }).cursor).toEqual({ path: [{ i: 0, s: 0 }], index: 1 });
    expect(apply(apply(st, { type: "up" }), { type: "down" }).cursor).toEqual({ path: [{ i: 0, s: 1 }], index: 1 });
  });
  it("moves through function arguments and root slots", () => {
    let st = run("max", "1,2");
    st = apply(st, { type: "left" });
    st = apply(st, { type: "left" });
    expect(st.cursor).toEqual({ path: [{ i: 0, s: 0 }], index: 1 });
    st = stateFromSource("root(x, 3)")!;
    st = apply(st, { type: "left" });
    expect(st.cursor).toEqual({ path: [{ i: 0, s: 1 }], index: 1 }); // 被开方式末尾
    st = apply(apply(st, { type: "left" }), { type: "left" });
    expect(st.cursor).toEqual({ path: [{ i: 0, s: 0 }], index: 1 }); // 根指数末尾
  });
  it("backspace deletes, enters and unwraps structures", () => {
    expect(src(run("12", { type: "backspace" }))).toBe("1");
    // 结构后退格：先进入最后一个槽位
    let st = run("1/2", { type: "right" }, { type: "backspace" });
    expect(st.cursor).toEqual({ path: [{ i: 0, s: 1 }], index: 1 });
    // 空结构整个删掉
    expect(run({ type: "sqrt" }, { type: "left" }, { type: "right" }, { type: "right" }, { type: "backspace" }).root).toEqual([]);
    // 在分母开头退格：拆掉分式，内容留下
    st = run("1/2", { type: "left" }, { type: "backspace" });
    expect(src(st)).toBe("12");
    expect(st.cursor).toEqual({ path: [], index: 1 });
    // 在根式开头退格
    st = run("2", { type: "sqrt" }, "x", { type: "left" }, { type: "backspace" });
    expect(src(st)).toBe("2x");
    expect(st.cursor).toEqual({ path: [], index: 1 });
    // 指数开头退格：指数内容回到正常行
    expect(src(run("x^2", { type: "left" }, { type: "backspace" }))).toBe("x2");
    // 函数第二个参数开头退格：与前一个参数合并
    st = run("max", "1,2", { type: "left" }, { type: "backspace" });
    expect(src(st)).toBe("max(12)");
    // 函数第一个参数开头退格：拆掉函数
    expect(src(run("sin", "x", { type: "left" }, { type: "backspace" }))).toBe("x");
    // 根行开头什么也不做
    const empty = emptyState();
    expect(apply(empty, { type: "backspace" })).toBe(empty);
  });
  it("delete, clear and paste", () => {
    expect(src(run("12", { type: "home" }, { type: "delete" }))).toBe("2");
    expect(run("2x", { type: "clear" }).root).toEqual([]);
    expect(src(run("2", { type: "paste", text: "(x+1)/3" }))).toBe("2(x + 1)/3");
    expect(src(run({ type: "paste", text: "x+" }))).toBe("x + ");
  });
  it("ignores invalid cursors", () => {
    const st = run("1/2");
    expect(apply(st, { type: "set", cursor: { path: [{ i: 5, s: 0 }], index: 0 } })).toBe(st);
    expect(apply(st, { type: "set", cursor: { path: [], index: 0 } }).cursor).toEqual({ path: [], index: 0 });
  });
  it("edits values like the typed source", () => {
    sameValues(src(run("2x^2", { type: "right" }, "+1")), "2x^2+1");
    sameValues(src(run("sqrt", "x", { type: "right" }, "/", "2")), "sqrt(x)/2");
  });
});
