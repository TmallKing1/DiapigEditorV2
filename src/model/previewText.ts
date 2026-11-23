// 对话预览的富文本：逐条移植 dialog/DiapigTypewriter.lua（游戏内打字机与宽度估算），保证分段、
// 打字机进度和换行估算与游戏一致。编辑器里另有 richtext.ts（编辑时的预览与警告），规则相近但
// 不完全相同（交叉嵌套的修复、多余闭合标签），预览以 Lua 为准，所以单独移植一份。

export type Token = { k: "ch"; ch: string } | { k: "open"; tag: "b" | "i" | "color"; raw: string } | { k: "close"; tag: "b" | "i" | "color" };

export interface Parsed {
  toks: Token[];
  /** 可见字符数（按码点；换行也算一个） */
  n: number;
}

const KNOWN = new Set(["b", "i", "color"]);

/** T.parse：识别 <color=#HEX>（3/4/6/8 位）、<b>、<i> 及其闭合；未闭合的在末尾补上，多余的闭合丢掉，交叉嵌套修复 */
export function parse(input: string): Parsed {
  const s = String(input ?? "");
  const toks: Token[] = [];
  const stack: { tag: "b" | "i" | "color"; raw: string }[] = [];
  let n = 0;
  const open = (tag: "b" | "i" | "color", raw: string) => {
    toks.push({ k: "open", tag, raw });
    stack.push({ tag, raw });
  };
  const close = (tag: "b" | "i" | "color") => toks.push({ k: "close", tag });
  let i = 0;
  while (i < s.length) {
    let used = false;
    if (s[i] === "<") {
      const j = s.indexOf(">", i + 1);
      if (j >= 0) {
        const body = s.slice(i + 1, j);
        const hex = /^color=#([0-9a-fA-F]+)$/.exec(body)?.[1];
        if (hex && [3, 4, 6, 8].includes(hex.length)) {
          open("color", s.slice(i, j + 1));
          used = true;
        } else if (body === "b" || body === "i") {
          open(body, `<${body}>`);
          used = true;
        } else {
          const ct = /^\/([A-Za-z]+)$/.exec(body)?.[1];
          if (ct && KNOWN.has(ct)) {
            let at = -1;
            for (let x = stack.length - 1; x >= 0; x--) {
              if (stack[x].tag === ct) {
                at = x;
                break;
              }
            }
            if (at >= 0) {
              // 先关掉压在上面的标签，关掉目标后再按原顺序重新打开
              const reopen: { tag: "b" | "i" | "color"; raw: string }[] = [];
              while (stack.length - 1 > at) {
                const top = stack.pop()!;
                close(top.tag);
                reopen.push(top);
              }
              close(ct as "b" | "i" | "color");
              stack.pop();
              for (let x = reopen.length - 1; x >= 0; x--) open(reopen[x].tag, reopen[x].raw);
            }
            used = true; // 找不到对应的开标签：丢掉
          }
        }
        if (used) i = j + 1;
      }
    }
    if (!used) {
      const ch = String.fromCodePoint(s.codePointAt(i)!);
      toks.push({ k: "ch", ch });
      n += 1;
      i += ch.length;
    }
  }
  for (let x = stack.length - 1; x >= 0; x--) close(stack[x].tag);
  return { toks, n };
}

/** 一段同样式的文字 */
export interface Run {
  text: string;
  /** CSS 颜色（Unity 的 #RGB / #RGBA / #RRGGBB / #RRGGBBAA 与 CSS 写法相同）；undefined = 文本框本身的颜色 */
  color?: string;
  bold: boolean;
  italic: boolean;
  /** 打字机还没打到的部分：透明但占位，换行从第一帧起与完整文本一致（T.render） */
  hidden: boolean;
}

/**
 * T.render 的显示结果：前 k 个可见字符照常显示（保留颜色）；其余透明，去掉颜色但保留粗斜体，
 * 宽度不变。k 省略或 ≥ n 时为完整文本（T.full）。
 */
export function runs(p: Parsed, k = Infinity): Run[] {
  const out: Run[] = [];
  const stack: { tag: string; raw: string }[] = [];
  let count = 0;
  for (const t of p.toks) {
    if (t.k === "open") stack.push({ tag: t.tag, raw: t.raw });
    else if (t.k === "close") {
      // 解析结果总是成对嵌套，栈顶就是要关的标签
      for (let x = stack.length - 1; x >= 0; x--) {
        if (stack[x].tag === t.tag) {
          stack.splice(x, 1);
          break;
        }
      }
    } else {
      const hidden = count >= k;
      count += 1;
      let color: string | undefined;
      if (!hidden) {
        for (let x = stack.length - 1; x >= 0; x--) {
          if (stack[x].tag === "color") {
            color = stack[x].raw.slice("<color=".length, -1);
            break;
          }
        }
      }
      const bold = stack.some((e) => e.tag === "b");
      const italic = stack.some((e) => e.tag === "i");
      const prev = out[out.length - 1];
      if (prev && prev.color === color && prev.bold === bold && prev.italic === italic && prev.hidden === hidden) prev.text += t.ch;
      else out.push({ text: t.ch, color, bold, italic, hidden });
    }
  }
  return out;
}

// 单个字符的估计宽度（em）：T.measure 用的同一张表（游戏里没有字体度量接口，只能估算）
const NARROW: Record<string, number> = {
  i: 0.3, l: 0.3, j: 0.3, ".": 0.3, ",": 0.3, ":": 0.3, ";": 0.3, "!": 0.3, "|": 0.3, "'": 0.25, " ": 0.3,
  f: 0.35, t: 0.38, r: 0.4, I: 0.32, "(": 0.35, ")": 0.35, "[": 0.35, "]": 0.35,
};
const WIDE: Record<string, number> = { M: 0.85, W: 0.95, m: 0.85, w: 0.78, "@": 0.9, "%": 0.85 };

export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 128) {
    if (ch in NARROW) return NARROW[ch];
    if (ch in WIDE) return WIDE[ch];
    if (/[A-Z0-9]/.test(ch)) return 0.62;
    return 0.54;
  }
  // Lua 按 UTF-8 首字节判断：两字节字符（拉丁扩展、西里尔等）0.6，三字节以上（中日韩、全角标点）1
  if (cp < 0x800) return 0.6;
  return 1;
}

/** T.measure：最宽一行的像素宽度与在 maxW 内需要的行数（换行符计入）；粗体加宽 5% */
export function measure(src: string | Parsed, fontSize: number, maxW?: number, bold = false): { width: number; lines: number } {
  const p = typeof src === "string" ? parse(src) : src;
  const f = fontSize * (bold ? 1.05 : 1);
  let widest = 0;
  let lines = 0;
  let cur = 0;
  const flush = () => {
    widest = Math.max(widest, cur);
    lines += maxW ? Math.max(1, Math.ceil(cur / maxW - 1e-6)) : 1;
    cur = 0;
  };
  for (const t of p.toks) {
    if (t.k !== "ch") continue;
    if (t.ch === "\n") flush();
    else cur += charWidth(t.ch) * f;
  }
  flush();
  return { width: widest, lines };
}

/**
 * DialogView 的 prepare：字面量 \n 换成换行，<PLAYER_NAME> 换成玩家名（在打字机解析之前，
 * 所以按玩家名的实际字数逐字出现）。
 */
export function prepare(s: string | null | undefined, playerName: string): string {
  const text = String(s ?? "").replaceAll("\\n", "\n");
  return text.includes("<PLAYER_NAME>") ? text.replaceAll("<PLAYER_NAME>", playerName) : text;
}
