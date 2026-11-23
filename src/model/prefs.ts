// 设置页里不依赖界面的规则：对话预览的设备预设推导、尺寸 / 秒数输入的解析与校验、自定义字体的命名。
import type { PreviewCanvas, PreviewDevice, PreviewKeyHint } from "../lib/settings.svelte";

/** 逻辑画布的下拉选项（不含「自定义」） */
export const CANVAS_PRESETS: Exclude<PreviewCanvas, "custom">[] = ["1280x720", "1600x900", "1920x1080"];

/** 每种设备的按键提示与逻辑画布。逻辑画布与设备的对应来自千星奇域对话模板项目的 AGENTS.md 5.1（分端逻辑画布） */
export const DEVICE_PRESETS: Record<Exclude<PreviewDevice, "custom">, { keyHint: PreviewKeyHint; canvas: Exclude<PreviewCanvas, "custom"> }> = {
  pc: { keyHint: "kbm", canvas: "1600x900" },
  touch: { keyHint: "none", canvas: "1280x720" },
  console: { keyHint: "pad", canvas: "1920x1080" },
  mobilePad: { keyHint: "pad", canvas: "1280x720" },
};

export const ALL_DEVICES = Object.keys(DEVICE_PRESETS) as Exclude<PreviewDevice, "custom">[];

/** 尺寸输入的范围：逻辑画布与自定窗口共用 */
export const SIZE_W = { min: 320, max: 7680 };
export const SIZE_H = { min: 180, max: 4320 };
/** 固定间隔自动保存的秒数范围 */
export const INTERVAL_RANGE = { min: 5, max: 3600 };

/** 画布选项对应的宽高；custom 时取传入的自定尺寸 */
export function canvasSize(canvas: PreviewCanvas, customW: number, customH: number): { w: number; h: number } {
  if (canvas === "custom") return { w: customW, h: customH };
  const [w, h] = canvas.split("x").map(Number);
  return { w, h };
}

/**
 * 按键提示与画布组合对应的设备：正好是某个设备的预设值就返回该设备，否则 custom。
 * 比较的是实际宽高，所以「自定义 1600×900 + 键鼠」也算 PC 键鼠。
 * available：界面上当前可选的设备；推导出不可选的设备时也按 custom 处理，避免选中一个虚化的选项。
 */
export function deviceFor(
  keyHint: PreviewKeyHint,
  canvas: PreviewCanvas,
  customW: number,
  customH: number,
  available: readonly PreviewDevice[] = ALL_DEVICES,
): PreviewDevice {
  const { w, h } = canvasSize(canvas, customW, customH);
  for (const d of ALL_DEVICES) {
    const p = DEVICE_PRESETS[d];
    const size = canvasSize(p.canvas, 0, 0);
    if (p.keyHint === keyHint && size.w === w && size.h === h) return available.includes(d) ? d : "custom";
  }
  return "custom";
}

/** 解析整数输入：只接受范围内的正整数（允许首尾空白），其余返回 null，调用方不写入设置 */
export function parseIntIn(text: string, range: { min: number; max: number }): number | null {
  const s = text.trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= range.min && n <= range.max ? n : null;
}

/** 界面字体列表里代表「系统界面字体」的项：CSS 通用家族 system-ui，写进 font-family 时不加引号 */
export const SYSTEM_UI = "system-ui";

/**
 * 界面字体列表 → CSS font-family 回退链：按顺序排列，最后接默认字体栈；空列表返回空串（用默认字体）。
 * 每个字符按顺序使用第一个包含它的字体。
 */
export function fontStack(names: readonly string[]): string {
  if (!names.length) return "";
  const parts = names.map((n) => (n === SYSTEM_UI ? n : `"${n.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`));
  return [...parts, "var(--font-default)"].join(", ");
}

/**
 * 旧版设置只有单个界面字体 uiFont：读到时改为「自定义」模式下只有这一项的列表，空串为系统默认。
 * 已有 uiFonts 的新数据只去掉残留的 uiFont。原地修改并返回同一个对象。
 */
export function migrateUiFont<T extends Record<string, unknown>>(raw: T): T {
  const r = raw as Record<string, unknown>;
  if (!("uiFont" in r)) return raw;
  const old = r.uiFont;
  delete r.uiFont;
  if (!Array.isArray(r.uiFonts)) {
    const name = typeof old === "string" ? old : "";
    r.uiFonts = name ? [name] : [];
    r.uiFontMode = name ? "custom" : "default";
  }
  return raw;
}

/** 字体文件名去掉扩展名，作为解析不到内部名称时的家族名 */
export function fontNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const name = base.replace(/\.(ttf|otf|woff2?|ttc)$/i, "").trim();
  return name || "自定义字体";
}

/** 与已有名称重名时加序号：「名称 2」「名称 3」…；比较不分大小写（CSS 字体家族名不分大小写） */
export function uniqueFamily(base: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((s) => s.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`;
    if (!set.has(name.toLowerCase())) return name;
  }
}

/**
 * 从 TrueType / OpenType（含 .ttc 的第一款字体、未压缩表的 WOFF）读字体家族名。
 * 依次取 Windows 平台的简体中文、英文名，再取 Mac Roman 英文名；优先「印刷家族名」(ID 16)，其次「家族名」(ID 1)。
 * WOFF2 与压缩过的 WOFF 表读不了，返回 null，由调用方退回文件名。
 */
export function parseFontFamily(data: ArrayBuffer): string | null {
  try {
    const v = new DataView(data);
    let base = 0;
    const tag = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
    let nameOffset = -1;
    let nameLength = 0;
    const head = tag(0);
    if (head === "wOFF") {
      const numTables = v.getUint16(12);
      for (let i = 0; i < numTables; i++) {
        const e = 44 + i * 20;
        if (tag(e) !== "name") continue;
        const off = v.getUint32(e + 4);
        const comp = v.getUint32(e + 8);
        const orig = v.getUint32(e + 12);
        if (comp !== orig) return null; // zlib 压缩过
        nameOffset = off;
        nameLength = orig;
      }
    } else {
      if (head === "ttcf") base = v.getUint32(12);
      const numTables = v.getUint16(base + 4);
      for (let i = 0; i < numTables; i++) {
        const e = base + 12 + i * 16;
        if (tag(e) !== "name") continue;
        nameOffset = v.getUint32(e + 8);
        nameLength = v.getUint32(e + 12);
      }
    }
    if (nameOffset < 0 || nameOffset + 6 > data.byteLength) return null;
    const count = v.getUint16(nameOffset + 2);
    const strings = nameOffset + v.getUint16(nameOffset + 4);
    const end = Math.min(data.byteLength, nameOffset + nameLength);
    // 候选：[优先级（越小越好）, 文本]
    let best: [number, string] | null = null;
    for (let i = 0; i < count; i++) {
      const r = nameOffset + 6 + i * 12;
      if (r + 12 > end) break;
      const platform = v.getUint16(r);
      const encoding = v.getUint16(r + 2);
      const lang = v.getUint16(r + 4);
      const id = v.getUint16(r + 6);
      const len = v.getUint16(r + 8);
      const off = strings + v.getUint16(r + 10);
      if ((id !== 16 && id !== 1) || off + len > data.byteLength) continue;
      let text = "";
      let rank: number;
      if (platform === 3 && (encoding === 1 || encoding === 10)) {
        for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(v.getUint16(off + k));
        rank = lang === 0x0804 ? 0 : lang === 0x0409 ? 2 : 4;
      } else if (platform === 1 && encoding === 0 && lang === 0) {
        for (let k = 0; k < len; k++) text += String.fromCharCode(v.getUint8(off + k));
        rank = 6;
      } else continue;
      if (id === 1) rank += 1;
      text = text.replace(/\0/g, "").trim();
      if (text && (!best || rank < best[0])) best = [rank, text];
    }
    return best ? best[1] : null;
  } catch {
    return null;
  }
}
