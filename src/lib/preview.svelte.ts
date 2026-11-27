// 对话预览：在独立窗口里模拟游戏内的对话表现。这里是主窗口一侧：选类型、打包数据、打开或刷新预览窗口。
// 预览窗口自己的页面在 preview.html / src/preview/。
import { canvasSize, windowSize, type Size, type WindowMode } from "../model/previewLayout";
import { KIND_LABEL, PAYLOAD_EVENT, PAYLOAD_KEY, PREVIEW_LABEL, PREVIEW_READY_EVENT, toSimNodes, type PreviewKindId, type PreviewPayload } from "../model/previewPayload";
import { dlg, outputDoc } from "./dialog.svelte";
import { isTauri } from "./files";
import { activeUiFonts, settings, type PreviewKind } from "./settings.svelte";
import { ask, toast } from "./ui.svelte";

export type DialogKind = Exclude<PreviewKind, "ask">;

/** 预览类型在界面上的名字（侧栏按钮第二行等） */
export const PREVIEW_KIND_LABEL = KIND_LABEL;

let seq = 0;
let desktopQueue = Promise.resolve();
let desktopPayload: PreviewPayload | null = null;
let listeningForPreview = false;
/** 上次给窗口定尺寸用的设置；复用窗口时只有这些变了才重新设大小，保留用户手动拉的尺寸 */
let lastGeometry = "";
/** 浏览器开发预览：window.open 打开的预览页 */
let popup: Window | null = null;

/** 预览当前打开的对话。kind 不传时按设置决定：「每次询问」则先弹出选择对话框 */
export function startPreview(kind?: DialogKind): void {
  if (!dlg.doc) {
    toast("请先新建或打开一个对话", "info");
    return;
  }
  const chosen = kind ?? (settings.previewKind === "ask" ? null : settings.previewKind);
  if (chosen) {
    void openPreview(chosen);
    return;
  }
  const pick = (k: PreviewKindId) => ({ label: KIND_LABEL[k], style: "accent" as const, run: () => void openPreview(k) });
  ask({
    title: "预览对话",
    message: "以什么样式的对话进行预览？",
    actions: [pick("locked"), pick("nonlocked"), pick("black"), { label: "取消" }],
  });
}

function buildPayload(kind: PreviewKindId): PreviewPayload | null {
  const doc = dlg.doc;
  if (!doc) return null;
  const out = outputDoc(doc);
  const uiFonts = activeUiFonts();
  const font = settings.previewFont;
  seq = Math.max(seq + 1, Date.now());
  return {
    seq,
    kind,
    nodes: toSimNodes(out),
    startNode: out.startNode,
    canvas: canvasSize(settings.previewCanvas, settings.previewCanvasW, settings.previewCanvasH),
    keyHint: settings.previewKeyHint,
    device: settings.previewDevice === "custom" ? undefined : settings.previewDevice,
    font,
    uiFonts,
    customFonts: settings.customFonts.filter(({ family }) => family === font || uiFonts.includes(family)).map((entry) => ({ ...entry })),
    themeColor: settings.themeColor,
  };
}

/** 浏览器开发预览：新窗口启动时读取，已开着的窗口通过 storage 事件刷新 */
function store(p: PreviewPayload) {
  try {
    localStorage.setItem(PAYLOAD_KEY, JSON.stringify(p));
  } catch {
    // 浏览器禁用存储时，预览页会显示没有可预览的对话。
  }
}

function openPreview(kind: PreviewKindId) {
  const payload = buildPayload(kind);
  if (!payload) return;
  if (!isTauri) {
    store(payload);
    openPopup();
    return;
  }
  // 连续点击时等创建完成后再查找现有窗口。
  desktopQueue = desktopQueue.then(() => openDesktopPreview(payload)).catch(reportPreviewError);
}

function reportPreviewError(error: unknown) {
  console.error(error);
  toast("预览窗口打开失败", "error");
}

async function openDesktopPreview(payload: PreviewPayload) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emitTo, listen } = await import("@tauri-apps/api/event");
  if (!listeningForPreview) {
    await listen(PREVIEW_READY_EVENT, () => {
      if (desktopPayload) void emitTo(PREVIEW_LABEL, PAYLOAD_EVENT, desktopPayload).catch(reportPreviewError);
    });
    listeningForPreview = true;
  }
  const geometry = await geometryFor();
  const key = JSON.stringify(geometry);
  const existing = await WebviewWindow.getByLabel(PREVIEW_LABEL);
  if (existing) {
    if (key !== lastGeometry) await applyGeometry(existing, geometry);
    lastGeometry = key;
    desktopPayload = payload;
    await emitTo(PREVIEW_LABEL, PAYLOAD_EVENT, payload);
    return;
  }
  desktopPayload = payload;
  const win = new WebviewWindow(PREVIEW_LABEL, {
    url: "preview.html",
    title: "对话预览",
    decorations: false,
    resizable: true,
    center: true,
    visible: false,
    focus: false,
    backgroundColor: "#000000",
    width: geometry.size?.w ?? 1280,
    height: geometry.size?.h ?? 720,
    minWidth: 160,
    minHeight: 90,
    fullscreen: geometry.size == null,
  });
  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve()).catch(reject);
    void win.once("tauri://error", (e) => reject(e.payload)).catch(reject);
  });
  lastGeometry = key;
}

interface Geometry {
  /** null = 全屏 */
  size: Size | null;
}

/** 按「窗口模式」算窗口内容区大小；屏幕工作区取主窗口所在的显示器 */
async function geometryFor(): Promise<Geometry> {
  const canvas = canvasSize(settings.previewCanvas, settings.previewCanvasW, settings.previewCanvasH);
  const custom = { w: settings.previewWindowW, h: settings.previewWindowH };
  let work: Size | null = null;
  try {
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const m = await currentMonitor();
    if (m) work = { w: m.workArea.size.width / m.scaleFactor, h: m.workArea.size.height / m.scaleFactor };
  } catch {
    // 取不到显示器信息：不缩放
  }
  return { size: windowSize(settings.previewWindow as WindowMode, canvas, custom, work) };
}

async function applyGeometry(win: import("@tauri-apps/api/webviewWindow").WebviewWindow, g: Geometry) {
  if (!g.size) {
    await win.setFullscreen(true);
    return;
  }
  const { LogicalSize } = await import("@tauri-apps/api/dpi");
  if (await win.isFullscreen()) await win.setFullscreen(false);
  await win.setSize(new LogicalSize(g.size.w, g.size.h));
  await win.center();
}

/** 浏览器开发预览：另开一个页面；已开着时它会通过 storage 事件刷新 */
function openPopup() {
  if (popup && !popup.closed) {
    popup.focus();
    return;
  }
  const canvas = canvasSize(settings.previewCanvas, settings.previewCanvasW, settings.previewCanvasH);
  const size = windowSize("canvas", canvas, canvas, { w: screen.availWidth, h: screen.availHeight });
  popup = window.open("/preview.html", "diapig-preview", `popup,width=${size?.w ?? 1280},height=${size?.h ?? 720}`);
  if (!popup) toast("浏览器拦截了预览窗口", "error");
}

/** 主窗口卸载时关掉浏览器里的预览页（桌面端由 Rust 在主窗口销毁时关闭预览窗口） */
export function closePopup() {
  if (popup && !popup.closed) popup.close();
  popup = null;
}
