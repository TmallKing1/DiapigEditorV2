// 编辑器偏好设置：保存在本机 WebView 的 localStorage（只影响这台电脑），读写失败时退回默认值。
import type { DefaultIds } from "../model/defaultIds";
import { fontNameFromPath, fontStack, migrateUiFont, parseFontFamily, uniqueFamily } from "../model/prefs";
import { fileExists, isTauri, pickFile, readBinaryAt } from "./files";

export interface FontFamily {
  /** CSS font-family 用的家族名（英文） */
  name: string;
  /** 中文本地化名称 */
  local?: string | null;
}

/** 产品名：标题栏选「默认」时显示 */
export const PRODUCT_NAME = "Diapig Editor";

export type TitleBarMode = "none" | "default" | "custom";
/** 界面字体：系统默认字体栈 / 自定义回退列表 */
export type UiFontMode = "default" | "custom";

/** 对话预览的设备预设；custom = 下面几项不构成任何一种设备 */
export type PreviewDevice = "pc" | "touch" | "console" | "mobilePad" | "custom";
export type PreviewKeyHint = "none" | "kbm" | "pad";
/** 逻辑画布大小："宽x高" 或 custom（取 previewCanvasW / H） */
export type PreviewCanvas = "1280x720" | "1600x900" | "1920x1080" | "custom";
export type PreviewWindow = "canvas" | "fullscreen" | "custom";
/** 预览的对话类型；ask = 每次询问 */
export type PreviewKind = "ask" | "locked" | "nonlocked" | "black";
export type AutoSaveWhen = "step" | "commit" | "interval";

/** 注册的自定义字体：family 是注册到页面里的 CSS 家族名，path 是字体文件路径 */
export interface CustomFont {
  family: string;
  path: string;
}

export interface Settings {
  // —— 个性化 ——
  /** 界面字体：default 用系统默认字体栈，custom 用 uiFonts */
  uiFontMode: UiFontMode;
  /** 自定义界面字体的回退列表（家族名，按顺序生效；system-ui = 系统界面字体）。切回 default 时保留 */
  uiFonts: string[];
  /** 顶部栏左侧的标题：不显示 / 产品名 / 自定文本 */
  titleBar: TitleBarMode;
  /** titleBar 为 custom 时显示的文本 */
  titleText: string;
  /** 主题色编号，见 THEMES */
  themeColor: string;
  customFonts: CustomFont[];

  // —— 常规：启动 ——
  /** 启动时自动打开上次关闭时的对话 */
  reopenLast: boolean;

  // —— 对话：新节点 ——
  newNodeInheritTitle: boolean;
  newNodeTitle: string;
  newNodeSubtitle: string;
  newNodeContent: string;
  /** 新节点默认操作类型（OP_*） */
  newNodeOp: number;

  // —— 对话：显示与修正 ——
  /** 对话内容预览字体；空串 = 跟随界面字体 */
  contentFont: string;
  /** 末尾节点为「跳转下个节点」时按「结束对话」显示和导出 */
  autoEnd: boolean;

  // —— 对话：预览 ——
  previewDevice: PreviewDevice;
  previewKeyHint: PreviewKeyHint;
  previewCanvas: PreviewCanvas;
  previewCanvasW: number;
  previewCanvasH: number;
  /** 预览窗口里的字体；空串 = 跟随界面字体 */
  previewFont: string;
  previewWindow: PreviewWindow;
  previewWindowW: number;
  previewWindowH: number;
  previewKind: PreviewKind;

  // —— 常规：自动保存 ——
  saveOnClose: boolean;
  autoSave: boolean;
  autoSaveWhen: AutoSaveWhen;
  /** 固定间隔自动保存的秒数 */
  autoSaveInterval: number;

  // —— 常规：默认结构体 ID（新建文件时采用；空串 = 沿用当前打开的文件的 ID） ——
  idDialog: string;
  idNode: string;
  idBranch: string;
  idBeginEnd: string;
  idChain: string;
  idTask: string;

  // —— 设置「更多」：调试选项 ——
  /** 打开 / 保存文件时不弹系统的文件选择器，改为手动输入路径 */
  manualPaths: boolean;

  // —— 更多 ——
  /** 富文本编辑预览用的字体；空串 = 跟随界面字体 */
  richPreviewFont: string;
}

/** 默认结构体 ID 各项：设置键与名称（设置页卡片与「从文件导入」共用） */
export const DEFAULT_ID_KEYS = ["idDialog", "idNode", "idBranch", "idBeginEnd", "idChain", "idTask"] as const;
export type DefaultIdKey = (typeof DEFAULT_ID_KEYS)[number];

export const THEMES: { id: string; label: string; color: string }[] = [
  { id: "classic", label: "经典蓝", color: "#127AE1" },
  { id: "freedom", label: "自由青", color: "#19C78E" },
  { id: "contract", label: "契约黄", color: "#E09800" },
  { id: "eternity", label: "永恒紫", color: "#B863EE" },
  { id: "wisdom", label: "智慧绿", color: "#7BB100" },
  { id: "justice", label: "正义蓝", color: "#0075DE" },
  { id: "war", label: "战争红", color: "#EF5534" },
  { id: "love", label: "慈爱蓝", color: "#2BB7D5" },
];

const KEY = "diapig-editor.settings.v1";
export const DEFAULTS: Settings = {
  uiFontMode: "default",
  uiFonts: [],
  titleBar: "default",
  titleText: "",
  themeColor: "classic",
  customFonts: [],
  reopenLast: false,
  newNodeInheritTitle: false,
  newNodeTitle: "标题",
  newNodeSubtitle: "",
  newNodeContent: "内容",
  newNodeOp: 1,
  contentFont: "",
  autoEnd: true,
  previewDevice: "pc",
  previewKeyHint: "kbm",
  previewCanvas: "1600x900",
  previewCanvasW: 1600,
  previewCanvasH: 900,
  previewFont: "",
  previewWindow: "canvas",
  previewWindowW: 1280,
  previewWindowH: 720,
  previewKind: "ask",
  saveOnClose: false,
  autoSave: false,
  autoSaveWhen: "commit",
  autoSaveInterval: 20,
  idDialog: "",
  idNode: "",
  idBranch: "",
  idBeginEnd: "",
  idChain: "",
  idTask: "",
  manualPaths: false,
  richPreviewFont: "",
};

/** 设置页各页签管的设置项：页签右侧的「重置」按此恢复默认值 */
export const SETTING_GROUPS: Record<string, (keyof Settings)[]> = {
  general: ["reopenLast", ...DEFAULT_ID_KEYS, "saveOnClose", "autoSave", "autoSaveWhen", "autoSaveInterval"],
  dialog: [
    "newNodeInheritTitle",
    "newNodeTitle",
    "newNodeSubtitle",
    "newNodeContent",
    "newNodeOp",
    "contentFont",
    "autoEnd",
    "previewDevice",
    "previewKeyHint",
    "previewCanvas",
    "previewCanvasW",
    "previewCanvasH",
    "previewFont",
    "previewWindow",
    "previewWindowW",
    "previewWindowH",
    "previewKind",
  ],
  personal: ["uiFontMode", "uiFonts", "titleBar", "titleText", "themeColor", "customFonts"],
  advanced: ["manualPaths"],
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...structuredClone(DEFAULTS), ...migrateUiFont(JSON.parse(raw)) };
  } catch {
    // 存储不可用或内容损坏：用默认值
  }
  return structuredClone(DEFAULTS);
}

export const settings = $state<Settings>(load());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify($state.snapshot(settings)));
  } catch {
    // 忽略：设置只在本次运行中生效
  }
}

/** 设置里的默认结构体 ID（新建文件时用） */
export function defaultIds(): DefaultIds {
  return {
    dialog: settings.idDialog,
    node: settings.idNode,
    branch: settings.idBranch,
    beginEnd: settings.idBeginEnd,
    chain: settings.idChain,
    task: settings.idTask,
  };
}

/** 改一项设置并保存。有副作用的设置（界面字体、主题色）用各自的函数 */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  settings[key] = value;
  save();
}

/** 把一个设置页签下的设置项恢复默认值，并立即套用有副作用的设置（字体、主题色） */
export function resetSettings(group: string) {
  const defaults = structuredClone(DEFAULTS);
  const before = settings.customFonts.map((f) => f.family);
  for (const key of SETTING_GROUPS[group] ?? []) (settings as unknown as Record<string, unknown>)[key] = defaults[key];
  // 自定义字体列表被清空时，页面里注册的字体和其他页签对它们的引用也一并去掉
  const kept = new Set(settings.customFonts.map((f) => f.family));
  for (const family of before) if (!kept.has(family)) dropFontRefs(family);
  save();
  applyUiFont();
  applyContentFont();
  applyTheme();
}

/** 一项字体设置对应的 CSS font-family；空串 = 跟随界面字体 */
export function fontCss(name: string): string {
  return name ? `"${name.replaceAll('"', '\\"')}", var(--font-ui, var(--font-default))` : "var(--font-ui, var(--font-default))";
}

/** 主题色编号对应的色值；未知编号（旧版本或手改的存储）退回经典蓝 */
export function themeColorOf(id: string): string {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0]).color;
}

/**
 * 把主题色（settings.themeColor）写到根元素的 CSS 变量上。主窗口和预览窗口启动时各调用一次。
 * 只写基色 --theme；浅底、悬停底、阴影等由 app.css 的 :root 用 color-mix 从它推导。
 * --theme 保持为普通的 #rrggbb，画布绘制时会直接读它（PrimFitPage、WeightMaskDialog）。
 */
export function applyTheme(id = settings.themeColor) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--theme", themeColorOf(id).toLowerCase());
}

export function setThemeColor(id: string) {
  settings.themeColor = id;
  save();
  applyTheme();
}

/** 把对话内容预览字体写到根元素的 --font-content；空串（跟随界面字体）时移除，内容区退回继承的界面字体 */
export function applyContentFont() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (settings.contentFont) root.style.setProperty("--font-content", fontCss(settings.contentFont));
  else root.style.removeProperty("--font-content");
}

export function setContentFont(name: string) {
  settings.contentFont = name;
  save();
  applyContentFont();
}

// —— 自定义字体 ——

/** 每个自定义字体在本页面里的加载状态（按家族名）；error 时 message 说明原因，界面据此显示失效标记 */
export const customFontState = $state<Record<string, { status: "loading" | "ok" | "error"; message?: string }>>({});

/** 已注册到 document.fonts 的字体，删除时据此移除 */
const faces = new Map<string, { face: FontFace; path: string }>();

/** 引用字体家族名的设置项：删除自定义字体时改回默认值 */
const FONT_KEYS = ["contentFont", "previewFont", "richPreviewFont"] as const;

/** 读字体文件的全部字节；失败时抛出（区分文件丢失与读不了） */
async function readFont(path: string): Promise<ArrayBuffer> {
  try {
    // Rust 端返回原始字节（ipc Response → ArrayBuffer）；兜底兼容按数字数组序列化的情况
    const raw: ArrayBuffer | number[] = await readBinaryAt(path);
    return raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).buffer;
  } catch {
    throw new Error((await fileExists(path).catch(() => true)) ? "无法读取字体文件" : "找不到字体文件");
  }
}

/** 用字节构造 FontFace 并注册到当前页面（不需要 CSP 的 font-src）；解析失败时抛出 */
async function addFace(font: CustomFont, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(font.family, data);
  try {
    await face.load();
  } catch {
    throw new Error("无法解析字体文件");
  }
  const old = faces.get(font.family);
  if (old) document.fonts.delete(old.face);
  document.fonts.add(face);
  faces.set(font.family, { face, path: font.path });
}

async function loadOne(font: CustomFont) {
  customFontState[font.family] = { status: "loading" };
  try {
    await addFace(font, await readFont(font.path));
    customFontState[font.family] = { status: "ok" };
  } catch (e) {
    // 同名字体换了文件而新文件已失效时，按当前配置回退到备用字体。
    const old = faces.get(font.family);
    if (old && old.path !== font.path) {
      document.fonts.delete(old.face);
      faces.delete(font.family);
    }
    customFontState[font.family] = { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** 把自定义字体加载进当前页面；预览窗口只传入当前字体栈里用到的字体 */
export async function loadCustomFonts(fonts: readonly CustomFont[] = settings.customFonts): Promise<void> {
  if (!isTauri || typeof document === "undefined") return;
  await Promise.all(fonts.filter((f) => faces.get(f.family)?.path !== f.path).map(loadOne));
}

/**
 * 选择字体文件并注册为自定义字体。返回新字体；用户取消或该文件已注册时返回 null（后者带 existing）。
 * 读取或解析失败时抛出，调用方提示用户，设置不变。
 */
export async function registerCustomFont(): Promise<{ font: CustomFont | null; existing?: CustomFont }> {
  const path = await pickFile("选择字体文件", "字体文件", ["ttf", "otf", "woff", "woff2", "ttc"]);
  if (!path) return { font: null };
  const existing = settings.customFonts.find((f) => f.path.toLowerCase() === path.toLowerCase());
  if (existing) return { font: null, existing };
  const data = await readFont(path);
  // 能从字体的 name 表读出家族名就用它，读不出（WOFF2 等）用文件名
  const name = parseFontFamily(data) ?? fontNameFromPath(path);
  // 与系统字体、已注册的字体都不重名：同名的 FontFace 会盖住系统字体
  const system = await listFonts().catch(() => [] as FontFamily[]);
  const taken = [...settings.customFonts.map((f) => f.family), ...system.flatMap((f) => [f.name, f.local ?? ""])];
  const font: CustomFont = { family: uniqueFamily(name, taken), path };
  // 先确认字体能加载，再写进设置：解析失败的文件不留下条目
  await addFace(font, data);
  customFontState[font.family] = { status: "ok" };
  settings.customFonts = [...settings.customFonts, font];
  save();
  return { font };
}

/** 从页面移除一个字体，并把引用它的设置改回默认值（不保存，由调用方保存） */
function dropFontRefs(family: string) {
  const face = faces.get(family);
  if (face) document.fonts.delete(face.face);
  faces.delete(family);
  delete customFontState[family];
  for (const key of FONT_KEYS) if (settings[key] === family) settings[key] = DEFAULTS[key];
  if (settings.uiFonts.includes(family)) settings.uiFonts = settings.uiFonts.filter((f) => f !== family);
}

/** 删除一个自定义字体：所有引用改回默认值，立即生效 */
export function removeCustomFont(family: string) {
  settings.customFonts = settings.customFonts.filter((f) => f.family !== family);
  dropFontRefs(family);
  save();
  applyUiFont();
  applyContentFont();
}

/** 把界面字体写到根元素的 CSS 变量上；默认字体栈在 app.css 的 --font-default */
export function applyUiFont(fonts = activeUiFonts()) {
  const root = document.documentElement;
  const stack = fontStack(fonts);
  if (stack) root.style.setProperty("--font-ui", stack);
  else root.style.removeProperty("--font-ui");
}

/** 当前生效的界面字体列表：系统默认模式为空 */
export function activeUiFonts(): string[] {
  return settings.uiFontMode === "custom" ? [...settings.uiFonts] : [];
}

export function setTitleBar(mode: TitleBarMode) {
  settings.titleBar = mode;
  save();
}

export function setTitleText(text: string) {
  settings.titleText = text;
  save();
}

/** 顶部栏实际显示的标题；空串表示不显示 */
export function titleBarText(): string {
  if (settings.titleBar === "none") return "";
  if (settings.titleBar === "custom") return settings.titleText;
  return PRODUCT_NAME;
}

export function setUiFontMode(mode: UiFontMode) {
  settings.uiFontMode = mode;
  save();
  applyUiFont();
}

export function setUiFonts(list: string[]) {
  settings.uiFonts = list;
  save();
  applyUiFont();
}

/** 浏览器预览时没有系统字体列表：给出几种常见字体 */
const FALLBACK_FONTS: FontFamily[] = [
  { name: "Microsoft YaHei UI", local: "微软雅黑 UI" },
  { name: "Microsoft YaHei", local: "微软雅黑" },
  { name: "SimHei", local: "黑体" },
  { name: "SimSun", local: "宋体" },
  { name: "DengXian", local: "等线" },
  { name: "Segoe UI" },
  { name: "Arial" },
];

let cache: Promise<FontFamily[]> | null = null;

/** 列出系统已安装的字体家族，结果在本次运行中缓存 */
export function listFonts(): Promise<FontFamily[]> {
  if (!cache) {
    cache = (async () => {
      if (!isTauri) return FALLBACK_FONTS;
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<FontFamily[]>("list_fonts");
    })();
    cache.catch(() => (cache = null));
  }
  return cache;
}

/** 字体在列表中的显示名：有中文名时为“中文名（英文名）” */
export function fontLabel(f: FontFamily): string {
  return f.local ? `${f.local}（${f.name}）` : f.name;
}
