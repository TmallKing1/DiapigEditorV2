// 富文本编辑器的文档模型：纯文本 + 逐字符（UTF-16 码元）样式。
// 源码中的字面量 \n（反斜杠 + n）在模型里是真实换行 "\n"，预览里显示为换行。
// 源码 → 模型用 parseRichText（与对话预览同一套规则）；模型 → 源码按 color ⊃ b ⊃ i 的固定嵌套顺序生成最少的标签。

// 玩家名 <PLAYER_NAME> 在模型里是一个占位字符 PLAYER_CHAR，整块增删、整块套样式；
// 被标签切开的字面 "<PLAYER_NAME>" 仍是普通字符，生成源码时保证它不会合并成玩家名。

import { PLAYER_TAG, parseRichText } from "./richtext";

/** 模型里代表一个玩家名的字符（Unicode 私用区，正常文本不会出现） */
export const PLAYER_CHAR = "";
/** 生成源码时用来切开字面 "<PLAYER_NAME>" 的空标签，避免被游戏当成玩家名 */
const PLAYER_SPLIT = "<PLAYER_<b></b>NAME>";

export interface Style {
  b: boolean;
  i: boolean;
  /** #RRGGBB 或 #RRGGBBAA；无颜色为 undefined */
  c?: string;
}

export interface RichDoc {
  text: string;
  styles: Style[];
}

export const PLAIN: Style = Object.freeze({ b: false, i: false });

export const sameStyle = (a: Style, b: Style) => a.b === b.b && a.i === b.i && (a.c ?? "") === (b.c ?? "");

export function fromSource(source: string): RichDoc {
  let text = "";
  const styles: Style[] = [];
  // 被标签切开的 "\<b>n" 不算换行，与游戏端逐段处理的结果一致
  for (const seg of parseRichText(source).segments) {
    const t = seg.player ? PLAYER_CHAR : seg.text.replaceAll(PLAYER_CHAR, "").replaceAll("\\n", "\n");
    const st: Style = { b: !!seg.bold, i: !!seg.italic, c: seg.color };
    text += t;
    for (let k = 0; k < t.length; k++) styles.push(st);
  }
  return { text, styles };
}

type Tag = { kind: "color"; value: string } | { kind: "b" } | { kind: "i" };
const tagOpen = (t: Tag) => (t.kind === "color" ? `<color=${t.value}>` : `<${t.kind}>`);
const tagClose = (t: Tag) => (t.kind === "color" ? "</color>" : `</${t.kind}>`);
const tagEq = (a: Tag, b: Tag) => a.kind === b.kind && (a.kind !== "color" || a.value === (b as typeof a).value);

function wanted(st: Style): Tag[] {
  const out: Tag[] = [];
  if (st.c) out.push({ kind: "color", value: st.c });
  if (st.b) out.push({ kind: "b" });
  if (st.i) out.push({ kind: "i" });
  return out;
}

export function toSource(doc: RichDoc): string {
  let out = "";
  const stack: Tag[] = [];
  let k = 0;
  while (k < doc.text.length) {
    const st = doc.styles[k];
    let end = k + 1;
    while (end < doc.text.length && sameStyle(doc.styles[end], st)) end++;
    const want = wanted(st);
    let keep = 0;
    while (keep < stack.length && keep < want.length && tagEq(stack[keep], want[keep])) keep++;
    while (stack.length > keep) out += tagClose(stack.pop()!);
    for (let w = keep; w < want.length; w++) {
      out += tagOpen(want[w]);
      stack.push(want[w]);
    }
    // 先切开字面的 "<PLAYER_NAME>"，再把占位字符写回 <PLAYER_NAME>
    out += doc.text
      .slice(k, end)
      .replaceAll(PLAYER_TAG, PLAYER_SPLIT)
      .replaceAll(PLAYER_CHAR, PLAYER_TAG)
      .replaceAll("\n", "\\n");
    k = end;
  }
  while (stack.length) out += tagClose(stack.pop()!);
  return out;
}

export function sliceDoc(doc: RichDoc, start: number, end: number): RichDoc {
  return { text: doc.text.slice(start, end), styles: doc.styles.slice(start, end) };
}

/** 用 insert 替换 [start, end)，返回新文档 */
export function replaceRange(doc: RichDoc, start: number, end: number, insert: RichDoc): RichDoc {
  return {
    text: doc.text.slice(0, start) + insert.text + doc.text.slice(end),
    styles: [...doc.styles.slice(0, start), ...insert.styles, ...doc.styles.slice(end)],
  };
}

/** 一段统一样式的纯文本 */
export function plainDoc(text: string, style: Style = PLAIN): RichDoc {
  return { text, styles: Array.from({ length: text.length }, () => style) };
}

/** 在 pos 处输入时沿用的样式：取前一个字符（与 Word 一致），开头取第一个字符 */
export function styleAt(doc: RichDoc, pos: number): Style {
  return doc.styles[pos - 1] ?? doc.styles[pos] ?? PLAIN;
}

export function mapStyles(doc: RichDoc, start: number, end: number, fn: (s: Style) => Style): RichDoc {
  const styles = doc.styles.slice();
  for (let k = start; k < end; k++) styles[k] = fn(styles[k]);
  return { text: doc.text, styles };
}

/** 区间内是否所有字符都满足 */
export function every(doc: RichDoc, start: number, end: number, test: (s: Style) => boolean): boolean {
  if (start >= end) return false;
  for (let k = start; k < end; k++) if (!test(doc.styles[k])) return false;
  return true;
}

/**
 * 预览被浏览器直接修改后，按新旧纯文本的差异推算出新文档：
 * 未改动的前后缀保留原样式，新插入的文字用 insertStyle（默认沿用插入点前一个字符的样式）。
 * caret 为修改后光标位置，用来消除重复字符造成的歧义（光标之后的内容一定没被改动）。
 */
export function diffApply(
  doc: RichDoc,
  nextText: string,
  caret: number,
  insertStyle?: Style,
): { doc: RichDoc; start: number; inserted: number } {
  const a = doc.text;
  const b = nextText;
  let suffix = 0;
  const maxSuffix = Math.min(a.length, b.length - Math.min(caret, b.length));
  while (suffix < maxSuffix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  let prefix = 0;
  const maxPrefix = Math.min(a.length, b.length) - suffix;
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  const insertedText = b.slice(prefix, b.length - suffix);
  const style = insertStyle ?? styleAt(doc, prefix);
  return {
    doc: replaceRange(doc, prefix, a.length - suffix, plainDoc(insertedText, style)),
    start: prefix,
    inserted: insertedText.length,
  };
}

/** 颜色写法规范化：去掉 #、3/4 位展开，返回 #RRGGBB(AA)（大写）；非法返回 null */
export function normalizeColor(input: string): string | null {
  let h = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  return "#" + h.toUpperCase();
}
