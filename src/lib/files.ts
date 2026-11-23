// 打开 / 保存文件（对话 JSON、成长曲线 CSV）。桌面端（Tauri）用原生对话框；在浏览器里预览时回退到文件选择与下载。

export interface OpenedFile {
  name: string;
  /** 桌面端的完整路径；浏览器里没有 */
  path?: string;
  text: string;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const FILTERS = [{ name: "对话 / 任务文件", extensions: ["json"] }];

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

// —— 手动输入路径（设置「更多」-「调试选项」）——
// 开启时，打开 / 保存文件和选文件夹都不弹系统的文件选择器，改为弹出输入框让用户填路径。
// 输入框由 App.svelte 渲染；开关与弹框函数由 lib/pathPrompt.svelte.ts 登记（本模块不依赖设置模块）。

export interface PathRequest {
  /** 打开文件 / 保存文件 / 选文件夹 */
  mode: "open" | "save" | "folder";
  /** 原本系统对话框的标题，如「对话另存为」 */
  title: string;
  /** 输入框的预设值 */
  preset?: string;
}
let manualEnabled: () => boolean = () => false;
let promptPath: ((req: PathRequest) => Promise<string | null>) | null = null;

export function registerPathPrompt(enabled: () => boolean, prompt: (req: PathRequest) => Promise<string | null>) {
  manualEnabled = enabled;
  promptPath = prompt;
}

/**
 * 手动输入路径开启时（仅桌面端）弹出输入框：返回填的路径，取消或留空返回 null；
 * 没开启返回 undefined，调用方照常弹系统对话框。路径两端的空白和引号会去掉。
 */
export async function manualPath(req: PathRequest): Promise<string | null | undefined> {
  if (!isTauri || !promptPath || !manualEnabled()) return undefined;
  const raw = await promptPath(req);
  const path = raw?.trim().replace(/^"(.*)"$/, "$1").trim();
  return path || null;
}

export async function openJson(title = "选择对话或任务 JSON 文件"): Promise<OpenedFile | null> {
  if (isTauri) {
    const manual = await manualPath({ mode: "open", title });
    if (manual !== undefined) return manual === null ? null : readTextAt(manual);
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ title, multiple: false, filters: FILTERS });
    if (typeof path !== "string") return null;
    return { name: baseName(path), path, text: await readTextFile(path) };
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((text) => resolve({ name: file.name, text }), reject);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export interface SaveOptions {
  title: string;
  filterName: string;
  extension: string;
  mime: string;
}

/** 保存文本文件；返回保存后的文件名，用户取消时返回 null */
export async function saveText(text: string, suggested: string, opt: SaveOptions): Promise<OpenedFile | null> {
  if (isTauri) {
    const manual = await manualPath({ mode: "save", title: opt.title, preset: suggested });
    if (manual !== undefined) return manual === null ? null : writeText(manual, text);
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      title: opt.title,
      defaultPath: suggested,
      filters: [{ name: opt.filterName, extensions: [opt.extension] }],
    });
    if (!path) return null;
    await writeTextFile(path, text);
    return { name: baseName(path), path, text };
  }
  const url = URL.createObjectURL(new Blob([text], { type: opt.mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = baseName(suggested);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name: a.download, text };
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

/** 直接写回已有路径（仅桌面端）。走自己的命令而不是 fs 插件：路径可能是之前的运行中选的，不在插件的放行范围里 */
export async function writeText(path: string, text: string): Promise<OpenedFile> {
  await invoke("file_write_text", { path, text });
  return { name: baseName(path), path, text };
}

/** 按保存下来的路径读取文本文件（仅桌面端）；读不到时抛出 */
export async function readTextAt(path: string): Promise<OpenedFile> {
  const text = await invoke<string>("file_read_text", { path });
  return { name: baseName(path), path, text };
}

/** 文件是否还在（仅桌面端；浏览器里恒为 false） */
export async function fileExists(path: string): Promise<boolean> {
  if (!isTauri) return false;
  return invoke<boolean>("file_exists", { path });
}

/** 读取二进制文件，如字体（仅桌面端） */
export async function readBinaryAt(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("file_read_binary", { path });
}

/** 永久删除本地文件，不进回收站（仅桌面端） */
export async function deleteFileAt(path: string): Promise<void> {
  await invoke("file_delete", { path });
}

/** 列出文件夹（含子文件夹）下的 .json 文件（仅桌面端） */
export async function listJsonFiles(dir: string): Promise<{ path: string; name: string }[]> {
  return invoke("file_list_json", { dir });
}

/** 选择一个文件夹；取消时返回 null（仅桌面端，会弹出系统对话框） */
export async function pickFolder(title: string): Promise<string | null> {
  if (!isTauri) return null;
  const manual = await manualPath({ mode: "folder", title });
  if (manual !== undefined) return manual;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ title, directory: true, multiple: false });
  return typeof path === "string" ? path : null;
}

/** 选择一个文件，只返回路径；取消时返回 null（仅桌面端，会弹出系统对话框） */
export async function pickFile(title: string, filterName: string, extensions: string[]): Promise<string | null> {
  if (!isTauri) return null;
  const manual = await manualPath({ mode: "open", title });
  if (manual !== undefined) return manual;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ title, multiple: false, filters: [{ name: filterName, extensions }] });
  return typeof path === "string" ? path : null;
}

export { baseName };

export const jsonFileStem = (path: string) => baseName(path).replace(/\.json$/i, "");

export function renameJsonAt(path: string, stem: string): Promise<string> {
  return invoke<string>("file_rename_json", { path, stem });
}

export function saveJson(
  text: string,
  suggested: string,
  opt: { title: string; filterName: string } = { title: "对话另存为", filterName: "对话文件" },
): Promise<OpenedFile | null> {
  return saveText(text, suggested, {
    ...opt,
    extension: "json",
    mime: "application/json",
  });
}

/** 复制到剪贴板；失败时抛出 */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** 关闭窗口前询问；返回取消监听的函数 */
export async function onCloseRequested(shouldBlock: () => boolean, ask: () => void): Promise<() => void> {
  if (isTauri) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().onCloseRequested((event) => {
      if (shouldBlock()) {
        event.preventDefault();
        ask();
      }
    });
  }
  const handler = (e: BeforeUnloadEvent) => {
    if (shouldBlock()) e.preventDefault();
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  if (!isTauri) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.toggleMaximize();
  return win.isMaximized();
}

export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().isMaximized();
}

export async function onWindowResized(cb: () => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onResized(cb);
}

/** 自绘关闭按钮：走与系统关闭相同的流程，会触发 onCloseRequested 的确认 */
export async function requestClose(): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export async function closeWindow(): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().destroy();
}
