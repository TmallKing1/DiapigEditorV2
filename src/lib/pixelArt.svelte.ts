import { isTauri, manualPath } from "./files";
import { initialPixelSize, MAX_PIXEL_SIDE, readPixelResult, serializePixelArtLua, type PixelLua, type PixelResult } from "../model/pixelArt";

export const DEFAULT_PIXEL_MODULE = "PixelArt";

interface Source {
  id: number;
  name: string;
  path: string;
  width: number;
  height: number;
  preview: Uint8Array<ArrayBuffer>;
}

interface Result extends PixelResult {
  lua: PixelLua;
}

let source = $state.raw<Source | null>(null);
let result = $state.raw<Result | null>(null);
let busy = $state<"loading" | "generating" | null>(null);
let lastExport = $state.raw<{ requested: string; filename: string } | null>(null);
const defaults = { width: 64, height: 64, merge: false, module: DEFAULT_PIXEL_MODULE };
const params = $state({ ...defaults });

export const pixelArt = {
  get source() { return source; },
  get result() { return result; },
  get busy() { return busy; },
  get lastExport() { return lastExport; },
  params,
};

let revision = 0;
let active = 0;

export async function pickPixelSource(): Promise<void> {
  if (busy) return;
  const request = ++revision;
  active = request;
  busy = "loading";
  try {
    const title = "选择要生成像素画的图片";
    const manual = await manualPath({ mode: "open", title });
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = manual !== undefined ? manual : await open({
      title,
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof path !== "string" || request !== revision) return;
    const { invoke } = await import("@tauri-apps/api/core");
    if (request !== revision) return;
    const data = await invoke<ArrayBuffer>("pixelart_load", { path, revision: request });
    if (request !== revision) return;
    const header = new DataView(data, 0, 8);
    const width = header.getUint32(0, true);
    const height = header.getUint32(4, true);
    source = { id: request, path, name: path.split(/[\\/]/).pop() ?? path, width, height, preview: new Uint8Array(data, 8) };
    result = null;
    lastExport = null;
    Object.assign(params, initialPixelSize(width, height));
  } catch (error) {
    if (request === revision) throw error;
  } finally {
    if (request === active) busy = null;
  }
}

export function setPixelParams(update: Partial<Pick<typeof defaults, "width" | "height" | "merge">>): void {
  if (busy === "loading") return;
  Object.assign(params, update);
  // 改尺寸或合色后，正在返回的生成结果与页面参数也已经不匹配。
  ++revision;
  result = null;
  lastExport = null;
}

export function setPixelModule(module: string): void {
  params.module = module;
  lastExport = null;
}

export function recordPixelExport(exported: PixelResult, requested: string, filename: string): void {
  if (result === exported && params.module === requested) lastExport = { requested, filename };
}

export async function generatePixelArt(): Promise<boolean> {
  if (!source || busy) return false;
  const { width, height, merge } = params;
  if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= MAX_PIXEL_SIDE)) return false;
  const { id, name } = source;
  const request = ++revision;
  active = request;
  busy = "generating";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    if (request !== revision) return false;
    const data = await invoke<ArrayBuffer>("pixelart_generate", { sourceId: id, width, height, merge });
    if (request !== revision) return false;
    const output = readPixelResult(data, width, height);
    result = { ...output, lua: serializePixelArtLua(output.art, DEFAULT_PIXEL_MODULE, name) };
    lastExport = null;
    return true;
  } catch (error) {
    if (request === revision) throw error;
    return false;
  } finally {
    if (request === active) busy = null;
  }
}

export function resetPixelArt(): void {
  const reset = ++revision;
  active = 0;
  source = null;
  result = null;
  lastExport = null;
  busy = null;
  Object.assign(params, defaults);
  if (isTauri) {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("pixelart_clear", { revision: reset }))
      .catch((error) => console.warn("[PixelArt] 无法清除原图缓存", error));
  }
}
