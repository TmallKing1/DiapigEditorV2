// 成长曲线的“自然书写”公式编辑模型（数学键盘用）。
// 公式是一行（Row）原子；分式、乘方、根式、函数、括号等结构各含若干子行（槽位）。
// 光标 = 从根行出发的路径（每步：第 i 个原子的第 s 个槽位）+ 所在行里的索引，与 MathQuill 相同。
// 所有编辑都是纯函数 apply(state, action) → state，便于单测；界面只负责渲染与把按键翻译成动作。
// “源码”仍是 growth.ts 能求值的文本：toSource 生成，fromSource 经 parseAst 解析回来。
import { FUNCTIONS, normalizeSource, parseAst, type Ast } from "./growth";

export type Row = Atom[];
export type Atom =
  /** 数字、小数点、科学计数的 E、运算符 + - * ,，以及还没认出来的字母 */
  | { t: "ch"; v: string }
  | { t: "sym"; v: "x" | "pi" | "e" }
  | { t: "frac"; num: Row; den: Row }
  /** 指数：作用在前一个原子（或前面整个数字）上 */
  | { t: "pow"; exp: Row }
  | { t: "sqrt"; body: Row }
  | { t: "root"; index: Row; body: Row }
  | { t: "fn"; name: string; args: Row[] }
  | { t: "paren"; body: Row };

export interface Step {
  /** 原子在行里的索引 */
  i: number;
  /** 槽位序号（左 → 右 / 上 → 下的阅读顺序） */
  s: number;
}
export interface Cursor {
  path: Step[];
  index: number;
}
export interface MathState {
  root: Row;
  cursor: Cursor;
}

export type MathAction =
  | { type: "insert"; text: string }
  | { type: "frac" }
  | { type: "pow" }
  | { type: "square" }
  | { type: "sqrt" }
  | { type: "root" }
  | { type: "fn"; name: string }
  | { type: "open" }
  | { type: "close" }
  | { type: "comma" }
  | { type: "left" }
  | { type: "right" }
  | { type: "up" }
  | { type: "down" }
  | { type: "home" }
  | { type: "end" }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "clear" }
  | { type: "paste"; text: string }
  | { type: "set"; cursor: Cursor };

// —— 基础 ——

const OPS = "+-*,";
const isDigitCh = (v: string) => (v >= "0" && v <= "9") || v === ".";
const isLetterCh = (v: string) => /\p{L}/u.test(v);
const ch = (v: string): Atom => ({ t: "ch", v });
const isOp = (a: Atom | undefined) => a?.t === "ch" && OPS.includes(a.v);
/** 数字字面量的一部分：数字、小数点、E */
const isNumCh = (a: Atom | undefined) => a?.t === "ch" && (isDigitCh(a.v) || a.v === "E");

/** 原子的子行（没有子行的返回空数组） */
export function slots(a: Atom): Row[] {
  switch (a.t) {
    case "frac":
      return [a.num, a.den];
    case "pow":
      return [a.exp];
    case "sqrt":
    case "paren":
      return [a.body];
    case "root":
      return [a.index, a.body];
    case "fn":
      return a.args;
    default:
      return [];
  }
}

function setSlot(a: Atom, s: number, r: Row): Atom {
  switch (a.t) {
    case "frac":
      return s === 0 ? { ...a, num: r } : { ...a, den: r };
    case "pow":
      return { ...a, exp: r };
    case "sqrt":
    case "paren":
      return { ...a, body: r };
    case "root":
      return s === 0 ? { ...a, index: r } : { ...a, body: r };
    case "fn":
      return { ...a, args: a.args.map((x, k) => (k === s ? r : x)) };
    default:
      return a;
  }
}

export function rowAt(root: Row, path: readonly Step[]): Row {
  let r = root;
  for (const st of path) r = slots(r[st.i])[st.s];
  return r;
}

function withRow(root: Row, path: readonly Step[], next: Row): Row {
  if (!path.length) return next;
  const [st, ...rest] = path;
  const atom = root[st.i];
  const updated = setSlot(atom, st.s, withRow(slots(atom)[st.s], rest, next));
  return root.map((a, i) => (i === st.i ? updated : a));
}

/** 把当前行换成 next，光标放到 cursor */
function put(st: MathState, next: Row, cursor: Cursor): MathState {
  return { root: withRow(st.root, st.cursor.path, next), cursor };
}

const at = (path: Step[], index: number): Cursor => ({ path, index });
const into = (st: MathState, i: number, s: number, index = 0): Cursor => at([...st.cursor.path, { i, s }], index);

export function emptyState(): MathState {
  return { root: [], cursor: at([], 0) };
}

/** 光标位置的字符串键（界面用来判断光标画在哪） */
export function rowKey(path: readonly Step[]): string {
  return path.map((p) => `${p.i}.${p.s}`).join("/");
}

// —— 光标移动 ——

function moveLeft(st: MathState): MathState {
  const { path, index } = st.cursor;
  const row = rowAt(st.root, path);
  if (index > 0) {
    const prev = row[index - 1];
    const sl = slots(prev);
    if (sl.length) return { ...st, cursor: into(st, index - 1, sl.length - 1, sl[sl.length - 1].length) };
    return { ...st, cursor: at(path, index - 1) };
  }
  if (!path.length) return st;
  const parent = path.slice(0, -1);
  const last = path[path.length - 1];
  if (last.s > 0) {
    const sib = slots(rowAt(st.root, parent)[last.i])[last.s - 1];
    return { ...st, cursor: at([...parent, { i: last.i, s: last.s - 1 }], sib.length) };
  }
  return { ...st, cursor: at(parent, last.i) };
}

function moveRight(st: MathState): MathState {
  const { path, index } = st.cursor;
  const row = rowAt(st.root, path);
  if (index < row.length) {
    if (slots(row[index]).length) return { ...st, cursor: into(st, index, 0, 0) };
    return { ...st, cursor: at(path, index + 1) };
  }
  if (!path.length) return st;
  const parent = path.slice(0, -1);
  const last = path[path.length - 1];
  const count = slots(rowAt(st.root, parent)[last.i]).length;
  if (last.s + 1 < count) return { ...st, cursor: at([...parent, { i: last.i, s: last.s + 1 }], 0) };
  return { ...st, cursor: at(parent, last.i + 1) };
}

/** 上下键：在最近的分式里换到分子 / 分母，位置尽量不变 */
function moveVertical(st: MathState, down: boolean): MathState {
  const { path, index } = st.cursor;
  for (let k = path.length - 1; k >= 0; k--) {
    const parent = path.slice(0, k);
    const step = path[k];
    const atom = rowAt(st.root, parent)[step.i];
    if (atom.t !== "frac" || step.s !== (down ? 0 : 1)) continue;
    const target = down ? atom.den : atom.num;
    const pos = k === path.length - 1 ? Math.min(index, target.length) : target.length;
    return { ...st, cursor: at([...parent, { i: step.i, s: down ? 1 : 0 }], pos) };
  }
  return st;
}

// —— 插入 ——

/** 可以作为函数名一部分的原子对应的字母 */
function letters(a: Atom): string | null {
  if (a.t === "ch" && isLetterCh(a.v) && a.v !== "E") return a.v;
  if (a.t === "sym") return a.v;
  return null;
}

/** 识别用的名字，长的优先（避免 sqrt 之类被更短的名字截走） */
const NAMES = [...Object.keys(FUNCTIONS), "pi"].sort((a, b) => b.length - a.length);

/** 新建结构原子，光标进入的槽位 */
function structure(name: string): { atom: Atom; slot: number } {
  if (name === "sqrt") return { atom: { t: "sqrt", body: [] }, slot: 0 };
  if (name === "root") return { atom: { t: "root", index: [], body: [] }, slot: 0 };
  const n = FUNCTIONS[name] === 1 ? 1 : 2;
  return { atom: { t: "fn", name, args: Array.from({ length: n }, () => []) }, slot: 0 };
}

/** 刚打完的字母组成已知函数名 / pi 时，替换成对应的结构 */
function recognize(st: MathState): MathState {
  const { path, index } = st.cursor;
  const row = rowAt(st.root, path);
  for (const name of NAMES) {
    let text = "";
    let k = index;
    while (k > 0 && text.length < name.length) {
      const l = letters(row[k - 1]);
      if (l === null) break;
      text = l + text;
      k--;
    }
    if (text !== name) continue;
    if (name === "pi") return put(st, [...row.slice(0, k), { t: "sym", v: "pi" }, ...row.slice(index)], at(path, k + 1));
    const { atom, slot } = structure(name);
    return put(st, [...row.slice(0, k), atom, ...row.slice(index)], into(st, k, slot, 0));
  }
  return st;
}

function insertChar(st: MathState, c: string): MathState {
  const { path, index } = st.cursor;
  const row = rowAt(st.root, path);
  let atom: Atom;
  if (c === "×" || c === "·") c = "*";
  if (c === "−") c = "-";
  if (c === "π") atom = { t: "sym", v: "pi" };
  else if (c === "E" || c === "ᴇ") atom = ch("E");
  else if (isLetterCh(c)) {
    const l = c.toLowerCase();
    atom = l === "x" || l === "e" ? { t: "sym", v: l } : ch(l);
  } else if (isDigitCh(c) || OPS.includes(c)) atom = ch(c);
  else return st;
  const next = put(st, [...row.slice(0, index), atom, ...row.slice(index)], at(path, index + 1));
  return atom.t === "ch" && atom.v === "E" ? next : recognize(next);
}

function insertStructure(st: MathState, atom: Atom, slot: number, slotIndex = 0): MathState {
  const { path, index } = st.cursor;
  const row = rowAt(st.root, path);
  return put(st, [...row.slice(0, index), atom, ...row.slice(index)], into(st, index, slot, slotIndex));
}

/** “/”：光标前一直到运算符为止的内容做分子；没有就建空分式 */
function makeFrac(st: MathState): MathState {
  const { path, index } = st.cursor;
  const row = rowAt(st.root, path);
  let start = index;
  while (start > 0 && !isOp(row[start - 1])) start--;
  let num = row.slice(start, index);
  // 单独一个括号做分子时去掉括号：(x+1)/ → 分子 x+1
  if (num.length === 1 && num[0].t === "paren") num = num[0].body;
  const frac: Atom = { t: "frac", num, den: [] };
  const next = [...row.slice(0, start), frac, ...row.slice(index)];
  return put(st, next, at([...path, { i: start, s: num.length ? 1 : 0 }], 0));
}

/** “^”：紧跟在指数后面时继续写进那个指数（x^2^3 即 x^(2^3)），否则新建指数 */
function makePow(st: MathState, exp: Row = []): MathState {
  const { path, index } = st.cursor;
  const row = rowAt(st.root, path);
  const prev = row[index - 1];
  if (prev?.t === "pow") {
    const inner: MathState = { ...st, cursor: into(st, index - 1, 0, prev.exp.length) };
    if (!exp.length) return inner;
    const after = makePow(inner, exp);
    // x² 这类直接给出指数的键：写完回到整个结构之后
    return { ...after, cursor: at(path, index) };
  }
  if (exp.length) return put(st, [...row.slice(0, index), { t: "pow", exp }, ...row.slice(index)], at(path, index + 1));
  return insertStructure(st, { t: "pow", exp: [] }, 0);
}

/** “)”：离开所在的括号（括号里光标后的内容移到括号后面）或函数 */
function closeParen(st: MathState): MathState {
  const { path, index } = st.cursor;
  if (path.length) {
    const parent = path.slice(0, -1);
    const last = path[path.length - 1];
    const prow = rowAt(st.root, parent);
    const atom = prow[last.i];
    if (atom.t === "paren") {
      const before = atom.body.slice(0, index);
      const after = atom.body.slice(index);
      const next = [...prow.slice(0, last.i), { ...atom, body: before }, ...after, ...prow.slice(last.i + 1)];
      return { root: withRow(st.root, parent, next), cursor: at(parent, last.i + 1) };
    }
    // 更外层有括号或函数：直接跳到它后面
    for (let k = path.length - 1; k >= 0; k--) {
      const a = rowAt(st.root, path.slice(0, k))[path[k].i];
      if (a.t === "paren" || a.t === "fn") return { ...st, cursor: at(path.slice(0, k), path[k].i + 1) };
    }
  }
  // 没有可配对的左括号：把光标前的内容包成括号
  if (index === 0) return st;
  const row = rowAt(st.root, path);
  return put(st, [{ t: "paren", body: row.slice(0, index) }, ...row.slice(index)], at(path, 1));
}

/** “,”：在 max / min 的参数里拆出下一个参数，别处照原样插入逗号 */
function comma(st: MathState): MathState {
  const { path, index } = st.cursor;
  if (path.length) {
    const parent = path.slice(0, -1);
    const last = path[path.length - 1];
    const prow = rowAt(st.root, parent);
    const atom = prow[last.i];
    if (atom.t === "fn" && FUNCTIONS[atom.name] === "2+") {
      const arg = atom.args[last.s];
      // 新建的 max / min 自带两个空参数：在第一个参数末尾按逗号就进入下一个
      const nextArg = atom.args[last.s + 1];
      if (index === arg.length && nextArg && !nextArg.length) {
        return { ...st, cursor: at([...parent, { i: last.i, s: last.s + 1 }], 0) };
      }
      const args = [...atom.args.slice(0, last.s), arg.slice(0, index), arg.slice(index), ...atom.args.slice(last.s + 1)];
      const next = prow.map((a, i) => (i === last.i ? { ...atom, args } : a));
      return { root: withRow(st.root, parent, next), cursor: at([...parent, { i: last.i, s: last.s + 1 }], 0) };
    }
  }
  return insertChar(st, ",");
}

// —— 删除 ——

function backspace(st: MathState): MathState {
  const { path, index } = st.cursor;
  const row = rowAt(st.root, path);
  if (index > 0) {
    const prev = row[index - 1];
    const sl = slots(prev);
    // 结构里还有内容时先进去（与 Desmos 相同），全空才整个删掉
    if (sl.some((r) => r.length)) return { ...st, cursor: into(st, index - 1, sl.length - 1, sl[sl.length - 1].length) };
    return put(st, [...row.slice(0, index - 1), ...row.slice(index)], at(path, index - 1));
  }
  if (!path.length) return st;
  const parent = path.slice(0, -1);
  const last = path[path.length - 1];
  const prow = rowAt(st.root, parent);
  const atom = prow[last.i];
  // 函数的第 2 个及以后的参数开头：与前一个参数合并（去掉逗号）
  if (atom.t === "fn" && last.s > 0) {
    const prevArg = atom.args[last.s - 1];
    const args = [...atom.args.slice(0, last.s - 1), [...prevArg, ...atom.args[last.s]], ...atom.args.slice(last.s + 1)];
    const next = prow.map((a, i) => (i === last.i ? { ...atom, args } : a));
    return { root: withRow(st.root, parent, next), cursor: at([...parent, { i: last.i, s: last.s - 1 }], prevArg.length) };
  }
  // 其余：拆掉结构，各槽位内容按顺序留在原处，光标停在本槽位内容的开头
  const parts = slots(atom);
  const flat: Row = [];
  let offset = 0;
  parts.forEach((r, k) => {
    if (k > 0 && atom.t === "fn") flat.push(ch(","));
    if (k === last.s) offset = flat.length;
    flat.push(...r);
  });
  const next = [...prow.slice(0, last.i), ...flat, ...prow.slice(last.i + 1)];
  return { root: withRow(st.root, parent, next), cursor: at(parent, last.i + offset) };
}

function del(st: MathState): MathState {
  const { path, index } = st.cursor;
  const row = rowAt(st.root, path);
  if (index >= row.length) return st;
  const sl = slots(row[index]);
  if (sl.some((r) => r.length)) return { ...st, cursor: into(st, index, 0, 0) };
  return put(st, [...row.slice(0, index), ...row.slice(index + 1)], st.cursor);
}

// —— 粘贴 ——

function paste(st: MathState, text: string): MathState {
  const parsed = fromSource(text);
  if (parsed.ok && parsed.row.length) {
    const { path, index } = st.cursor;
    const row = rowAt(st.root, path);
    return put(st, [...row.slice(0, index), ...parsed.row, ...row.slice(index)], at(path, index + parsed.row.length));
  }
  // 不是完整的公式：逐字符当成键入
  let s = st;
  for (const c of text) s = applyKey(s, c);
  return s;
}

/** 物理键盘上的一个字符对应的动作 */
export function keyAction(c: string): MathAction | null {
  if (c === "/" || c === "÷") return { type: "frac" };
  if (c === "^") return { type: "pow" };
  if (c === "(" || c === "[") return { type: "open" };
  if (c === ")" || c === "]") return { type: "close" };
  if (c === ",") return { type: "comma" };
  if (c === "|") return { type: "fn", name: "abs" };
  if (c === "√") return { type: "sqrt" };
  if (c === "²") return { type: "square" };
  if (/^[\p{L}0-9.+\-*×·−π]$/u.test(c)) return { type: "insert", text: c };
  return null;
}

function applyKey(st: MathState, c: string): MathState {
  const a = keyAction(c);
  return a ? apply(st, a) : st;
}

export function apply(st: MathState, action: MathAction): MathState {
  switch (action.type) {
    case "insert": {
      let s = st;
      for (const c of action.text) s = insertChar(s, c);
      return s;
    }
    case "frac":
      return makeFrac(st);
    case "pow":
      return makePow(st);
    case "square":
      return makePow(st, [ch("2")]);
    case "sqrt":
      return insertStructure(st, { t: "sqrt", body: [] }, 0);
    case "root":
      return insertStructure(st, { t: "root", index: [], body: [] }, 0);
    case "fn": {
      const { atom, slot } = structure(action.name);
      return insertStructure(st, atom, slot);
    }
    case "open": {
      // 刚认出的函数名后紧接着打“(”：函数自带括号，不再嵌一层
      const { path, index } = st.cursor;
      const last = path[path.length - 1];
      if (last && last.s === 0 && index === 0 && !rowAt(st.root, path).length) {
        const host = rowAt(st.root, path.slice(0, -1))[last.i];
        if (host.t === "fn" || host.t === "sqrt") return st;
      }
      return insertStructure(st, { t: "paren", body: [] }, 0);
    }
    case "close":
      return closeParen(st);
    case "comma":
      return comma(st);
    case "left":
      return moveLeft(st);
    case "right":
      return moveRight(st);
    case "up":
      return moveVertical(st, false);
    case "down":
      return moveVertical(st, true);
    case "home":
      return { ...st, cursor: at([], 0) };
    case "end":
      return { ...st, cursor: at([], st.root.length) };
    case "backspace":
      return backspace(st);
    case "delete":
      return del(st);
    case "clear":
      return st.root.length ? emptyState() : st;
    case "paste":
      return paste(st, action.text);
    case "set":
      return validCursor(st.root, action.cursor) ? { ...st, cursor: action.cursor } : st;
  }
}

function validCursor(root: Row, c: Cursor): boolean {
  let r = root;
  for (const st of c.path) {
    const a = r[st.i];
    if (!a) return false;
    const sl = slots(a);
    if (st.s < 0 || st.s >= sl.length) return false;
    r = sl[st.s];
  }
  return c.index >= 0 && c.index <= r.length;
}

// —— 树 → 源码 ——

/** 前一个原子是“操作数”（不是运算符、不在行首），据此区分二元与一元的 + − */
function operandBefore(row: Row, i: number): boolean {
  return i > 0 && !isOp(row[i - 1]) && !(row[i - 1].t === "ch" && (row[i - 1] as { v: string }).v === "E");
}

/** 能直接当作 ^ 的指数或 / 的分母、不必加括号：可带一个前导负号的单个数 / 量 / 结构，后面最多跟一个指数 */
function isSimple(row: Row): boolean {
  let r = row;
  if (r[0]?.t === "ch" && (r[0].v === "-" || r[0].v === "+")) r = r.slice(1);
  if (r.length && r[r.length - 1].t === "pow") r = r.slice(0, -1);
  if (!r.length) return false;
  if (r.every((a) => a.t === "ch" && (isDigitCh(a.v) || a.v === "E"))) return r[0].t === "ch" && isDigitCh(r[0].v);
  return r.length === 1 && ["sym", "sqrt", "root", "fn", "paren"].includes(r[0].t);
}

/** 两段相邻时会被解析器读成一个词（2 与 3、x 与 e、2 与 e）就补一个 * */
function joinPiece(out: string, piece: string): string {
  const last = out.trimEnd().slice(-1);
  const first = piece[0] ?? "";
  if (!last || !first) return out + piece;
  const digitLast = /[0-9.]/.test(last);
  if ((digitLast && /[0-9.eE]/.test(first)) || (isLetterCh(last) && isLetterCh(first))) return out + "*" + piece;
  return out + piece;
}

function genFrac(a: Extract<Atom, { t: "frac" }>, prevOperand: boolean): string {
  const num = a.num;
  const signed = num[0]?.t === "ch" && (num[0].v === "-" || num[0].v === "+");
  const pmLater = num.some((x, k) => k > 0 && x.t === "ch" && (x.v === "+" || x.v === "-" || x.v === ","));
  const n = toSource(num);
  const d = toSource(a.den);
  const numText = !num.length || pmLater || (signed && prevOperand) ? `(${n})` : n;
  const denText = isSimple(a.den) ? d : `(${d})`;
  return `${numText}/${denText}`;
}

/** 生成规范的源码：二元 + − 两侧空格、逗号后空格，其余紧凑 */
export function toSource(row: Row): string {
  let out = "";
  row.forEach((a, i) => {
    const prev = row[i - 1];
    switch (a.t) {
      case "ch": {
        const v = a.v;
        if (v === "+" || v === "-") {
          out += operandBefore(row, i) ? ` ${v} ` : v;
        } else if (v === "*") out += "*";
        else if (v === ",") out += ", ";
        else if (isDigitCh(v) || v === "E") {
          // 同一个数字字面量里的字符直接相连；接在结构或字母后面才检查是否要补 *
          out = isNumCh(prev) || (prev?.t === "ch" && (prev.v === "+" || prev.v === "-")) ? out + v : joinPiece(out, v);
        } else {
          // 还没认出的字母：连续的保持相连，便于报出“不支持的函数”
          out = prev?.t === "ch" && isLetterCh(prev.v) && prev.v !== "E" ? out + v : joinPiece(out, v);
        }
        break;
      }
      case "sym":
        out = joinPiece(out, a.v);
        break;
      case "frac": {
        const text = genFrac(a, operandBefore(row, i));
        out = joinPiece(out, row[i + 1]?.t === "pow" ? `(${text})` : text);
        break;
      }
      case "pow":
        out += "^" + (isSimple(a.exp) ? toSource(a.exp) : `(${toSource(a.exp)})`);
        break;
      case "sqrt":
        out = joinPiece(out, `sqrt(${toSource(a.body)})`);
        break;
      case "root":
        out = joinPiece(out, `root(${toSource(a.body)}, ${toSource(a.index)})`);
        break;
      case "fn":
        out = joinPiece(out, `${a.name}(${a.args.map(toSource).join(", ")})`);
        break;
      case "paren":
        out = joinPiece(out, `(${toSource(a.body)})`);
        break;
    }
  });
  return out;
}

// —— 源码 → 树 ——

function astRow(t: Ast): Row {
  switch (t.k) {
    case "num":
      return [...t.text].map((c) => ch(c === "e" || c === "E" ? "E" : c));
    case "x":
      return [{ t: "sym", v: "x" }];
    case "const":
      return [{ t: "sym", v: t.name }];
    case "unary":
      return [ch(t.op), ...astRow(t.a)];
    case "paren":
      return [{ t: "paren", body: astRow(t.a) }];
    case "bin":
      switch (t.op) {
        case "/":
          return [{ t: "frac", num: stripped(t.a), den: stripped(t.b) }];
        case "^":
          return [...astRow(t.a), { t: "pow", exp: stripped(t.b) }];
        case "":
          return [...astRow(t.a), ...astRow(t.b)];
        default:
          return [...astRow(t.a), ch(t.op), ...astRow(t.b)];
      }
    case "call":
      if (t.name === "sqrt") return [{ t: "sqrt", body: astRow(t.args[0]) }];
      if (t.name === "root") return [{ t: "root", index: astRow(t.args[1]), body: astRow(t.args[0]) }];
      return [{ t: "fn", name: t.name, args: t.args.map(astRow) }];
  }
}

/** 分子、分母、指数外层的括号由排版本身表达，去掉一层 */
const stripped = (t: Ast): Row => (t.k === "paren" ? astRow(t.a) : astRow(t));

export type FromSource = { ok: true; row: Row } | { ok: false; error: string };

/** 解析源码；空串得到空公式（仍算有效的“内容”，求值处会另外报“不能为空”） */
export function fromSource(source: string): FromSource {
  if (!normalizeSource(source)) return { ok: true, row: [] };
  try {
    return { ok: true, row: astRow(parseAst(source)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 源码对应的编辑状态，光标在末尾；解析失败返回 null */
export function stateFromSource(source: string): MathState | null {
  const r = fromSource(source);
  return r.ok ? { root: r.row, cursor: at([], r.row.length) } : null;
}
