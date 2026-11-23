// 预览用的最小富文本解析，规则与 Lua 端 Typewriter 的约定一致（docs/迁移方案.md 4.8）：
// 只认 <color=#HEX>（3/4/6/8 位）、</color>、<b>、</b>、<i>、</i>；其他 <…> 按字面显示；
// 未闭合的标签在末尾自动闭合，多余的闭合标签忽略。
// <PLAYER_NAME> 由游戏替换为玩家名：只有完整落在两个样式标签之间的才算，被标签切开的按字面显示。

/** 游戏端替换为玩家名的占位串 */
export const PLAYER_TAG = "<PLAYER_NAME>";

export interface Segment {
  text: string;
  /** CSS 颜色（#RRGGBB 或 #RRGGBBAA）；无标签时为 undefined */
  color?: string;
  bold?: true;
  italic?: true;
  /** 整段就是一个玩家名占位（text 为 PLAYER_TAG），不与相邻段合并 */
  player?: true;
}

export interface ParseResult {
  segments: Segment[];
  warnings: string[];
}

const TAG = /<color=#([0-9a-fA-F]+)>|<\/color>|<(\/?)([bi])>/g;

function normalizeHex(hex: string): string | null {
  if (hex.length === 3 || hex.length === 4) {
    return "#" + [...hex].map((c) => c + c).join("");
  }
  return hex.length === 6 || hex.length === 8 ? "#" + hex : null;
}

export function parseRichText(input: string): ParseResult {
  const segments: Segment[] = [];
  const warnings = new Set<string>();
  const colors: string[] = [];
  const depth = { b: 0, i: 0 };
  const pushSeg = (text: string, player: boolean) => {
    if (!text) return;
    const seg: Segment = { text, color: colors[colors.length - 1] };
    if (depth.b) seg.bold = true;
    if (depth.i) seg.italic = true;
    if (player) seg.player = true;
    const prev = segments[segments.length - 1];
    if (!player && prev && !prev.player && prev.color === seg.color && prev.bold === seg.bold && prev.italic === seg.italic) {
      prev.text += text;
    } else segments.push(seg);
  };
  // text 为两个标签之间的一整段：只在段内识别玩家名
  const push = (text: string) => {
    text.split(PLAYER_TAG).forEach((part, k) => {
      if (k > 0) pushSeg(PLAYER_TAG, true);
      pushSeg(part, false);
    });
  };
  let pos = 0;
  for (const m of input.matchAll(TAG)) {
    const at = m.index;
    if (m[1] !== undefined) {
      const color = normalizeHex(m[1]);
      if (!color) continue; // 位数不对：整个标签按字面文本留在原处
      push(input.slice(pos, at));
      colors.push(color);
    } else if (m[3] !== undefined) {
      const tag = m[3] as "b" | "i";
      push(input.slice(pos, at));
      if (!m[2]) depth[tag] += 1;
      else if (depth[tag]) depth[tag] -= 1;
      else warnings.add(`有多余的 </${tag}>`);
    } else {
      push(input.slice(pos, at));
      if (colors.length) colors.pop();
      else warnings.add("有多余的 </color>");
    }
    pos = at + m[0].length;
  }
  push(input.slice(pos));
  if (colors.length) warnings.add("有未闭合的 <color> 标签");
  if (depth.b) warnings.add("有未闭合的 <b> 标签");
  if (depth.i) warnings.add("有未闭合的 <i> 标签");
  if (/<color=(?!#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})>)/.test(input)) {
    warnings.add("有格式不正确的颜色标签");
  }
  return { segments, warnings: [...warnings] };
}

/** 旧名，保留兼容 */
export const parseColorText = parseRichText;

/** 去掉富文本标签后的可见文字 */
export function plainText(input: string): string {
  return parseRichText(input)
    .segments.map((s) => s.text)
    .join("");
}

/** 可见字符数（按码点，字面量 \n 记 1，玩家名记 1） */
export function visibleLength(input: string): number {
  const text = parseRichText(input)
    .segments.map((s) => (s.player ? "" : s.text))
    .join("");
  return [...text.replaceAll("\\n", "\n")].length;
}
