// 图元拟合的会话状态与桌面端命令封装。状态放在模块里，切到别的页签再回来，正在跑的拟合和结果都还在。

import { manualPath } from "./files";
import type { Art, Shape } from "../model/primfit";
import { coverage, isEmptyMask, type WeightMask } from "../model/weightMask";

export interface FitParams {
  /** 图元数上限 1–5000 */
  count: number;
  /** 工作分辨率（最长边）32–512，也是输出坐标的单位 */
  size: number;
  /** 硬图元与渐变图元是否可用 */
  rect: boolean;
  ellipse: boolean;
  triangle: boolean;
  radial: boolean;
  linear: boolean;
  band: boolean;
  /** 不透明度：0 自动，否则固定值 */
  alpha: number;
  quality: "fast" | "normal" | "fine";
  seed: number;
  /** 搜索线程数；0 自动（CPU 核数 − 1） */
  threads: number;
  /** 拟合结束后的精修轮数；0 不精修 */
  refine: number;
  /** 硬边图元按面积覆盖率评分（与预览、游戏的抗锯齿绘制一致，不会留下穿过底色的细线）；关闭时约快一倍 */
  antialias: boolean;
  /** 透明像素的合成底色，#RRGGBB */
  matte: string;
  /** 保留源图透明度；关闭时按 matte 合成 */
  preserveAlpha: boolean;
  /** 导出的模块名（= 文件名 = 脚本映射名） */
  module: string;
}

export const DEFAULT_PARAMS: FitParams = {
  count: 500,
  size: 200,
  rect: true,
  ellipse: true,
  triangle: true,
  radial: true,
  linear: false,
  band: false,
  alpha: 0,
  quality: "normal",
  seed: 1,
  threads: 0,
  refine: 2,
  antialias: true,
  matte: "#000000",
  preserveAlpha: false,
  module: "PrimArt",
};

const KEY = "diapig.primfit";

function loadParams(): FitParams {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object") {
      const out = { ...DEFAULT_PARAMS };
      for (const k of Object.keys(out) as (keyof FitParams)[]) {
        if (typeof v[k] === typeof out[k]) (out as Record<string, unknown>)[k] = v[k];
      }
      return out;
    }
  } catch {
    // 读不到就用默认值
  }
  return { ...DEFAULT_PARAMS };
}

export function saveParams(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(fit.params));
  } catch {
    // 忽略
  }
}

export interface SourceImage {
  path: string;
  name: string;
  width: number;
  height: number;
  /** RGBA 预览（最长边不超过 512，按 preserveAlpha 决定是否合成底色） */
  preview: ImageData;
}

/** 已拟合出的图元与每加一个之后的相似度。数量大，不放进响应式状态；界面跟踪 fit.done。 */
export const shapes: Shape[] = [];
export const similarities: number[] = [];

/** 页面拟合预览的离屏画布，跨页面保留：切回图元页、打开放大预览时直接贴图，不必把几千个图元重画一遍。
 *  job / revision 相同且图元只多不少时接着画（由图元页维护）。
 *  每画满 PREVIEW_MARK_STEP 个图元存一张快照（marks），拖动「使用前」滑条往回时从最近的快照接着画，
 *  不必从背景整幅重画。720 像素见方一张约 2 MB，5000 个图元共 20 张。 */
export const PREVIEW_MARK_STEP = 250;
export const previewCache = {
  canvas: null as HTMLCanvasElement | null,
  job: -1,
  revision: -1,
  count: 0,
  k: 1,
  marks: new Map<number, HTMLCanvasElement>(),
};

export const fit = $state({
  params: loadParams(),
  source: null as SourceImage | null,
  /** 当前结果的画面尺寸与背景色；还没拟合过时为 null */
  canvas: null as { width: number; height: number; bg: number; bgAlpha?: number } | null,
  /** 当前结果对应的源图文件名（写进导出注释） */
  resultSource: "",
  running: false,
  stopping: false,
  jobId: 0,
  /** 本次拟合请求的图元数 */
  goal: 0,
  /** 本次拟合请求的精修轮数（用于量化总进度） */
  refineGoal: 0,
  /** 已拟合出的图元数 */
  done: 0,
  /** 精修进度；不在精修时为 null */
  refining: null as { pass: number; passes: number; index: number; total: number } | null,
  /** 图元被整体替换（精修）的次数：变了就要整幅重画 */
  revision: 0,
  /** 还没有图元（只有背景色）时的相似度 */
  baseSimilarity: 0,
  elapsedMs: 0,
  threads: 0,
  /** 「使用前 k 个」 */
  use: 0,
  /** 滑条停在最右端时跟着新图元一起前进 */
  follow: true,
  /** 重点区域蒙版每变一次加一（蒙版数据本身不是响应式的） */
  maskRevision: 0,
  /** 重点区域的加权面积占比（0–1）；没有蒙版时为 0 */
  maskCoverage: 0,
});

/** 重点区域蒙版：与原图预览同尺寸，行自上而下。数据大，不放进响应式状态；只在本次运行期间保留。 */
let mask: WeightMask | null = null;

/** 当前的重点区域蒙版；没有时为 null。调用方不要直接改它的数据，改完用 setMask 写回。 */
export function getMask(): WeightMask | null {
  void fit.maskRevision;
  return mask;
}

/** 设置重点区域蒙版；全为 0 或 null 时清除。 */
export function setMask(next: WeightMask | null): void {
  mask = next && !isEmptyMask(next.data) ? next : null;
  fit.maskCoverage = mask ? coverage(mask.data) : 0;
  fit.maskRevision++;
}

export function clearMask(): void {
  if (mask) setMask(null);
}

/** 换上新的预览：换了图片或预览尺寸变了就清掉蒙版；只改底色 / 透明度（尺寸不变）时保留 */
function setSource(source: SourceImage): void {
  const old = fit.source;
  if (mask && (!old || old.path !== source.path || mask.width !== source.preview.width || mask.height !== source.preview.height)) {
    clearMask();
  }
  fit.source = source;
}

/** 前 k 个图元的相似度（0–1） */
export function similarityAt(k: number): number {
  // similarities 不是响应式的：读一下这两个计数，图元增加或被精修替换后界面会重新取值
  void fit.done;
  void fit.revision;
  return k <= 0 ? fit.baseSimilarity : (similarities[Math.min(k, similarities.length) - 1] ?? fit.baseSimilarity);
}

export function currentArt(count = fit.use): Art | null {
  if (!fit.canvas) return null;
  return { ...fit.canvas, shapes: shapes.slice(0, count) };
}

const matteValue = (hex: string) => (/^#[0-9a-fA-F]{6}$/.test(hex) ? parseInt(hex.slice(1), 16) : 0);

async function loadPreview(path: string): Promise<SourceImage> {
  const { preserveAlpha, matte } = fit.params;
  const { invoke } = await import("@tauri-apps/api/core");
  const buffer = await invoke<ArrayBuffer>("primfit_load", { path, preserveAlpha, matte: matteValue(matte) });
  const head = new DataView(buffer, 0, 16);
  const [width, height, pw, ph] = [0, 4, 8, 12].map((o) => head.getUint32(o, true));
  const preview = new ImageData(new Uint8ClampedArray(buffer.slice(16)), pw, ph);
  return { path, name: path.split(/[\\/]/).pop() ?? path, width, height, preview };
}

let previewGeneration = 0;
let pickGeneration = 0;
let selectedPath: string | null = null;
/** 每次重置加一：重置前发出、重置后才返回的请求（选图、开始拟合）据此作废 */
let resetGeneration = 0;

/** 选一张图片并载入预览；用户取消时返回 false。出错时抛出。 */
export async function pickImage(): Promise<boolean> {
  const selection = ++pickGeneration;
  ++previewGeneration;
  const manual = await manualPath({ mode: "open", title: "选择要拟合的图片" });
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = manual !== undefined ? manual : await open({
    title: "选择要拟合的图片",
    multiple: false,
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (typeof path !== "string" || selection !== pickGeneration) return false;
  const generation = ++previewGeneration;
  selectedPath = path;
  const source = await loadPreview(path);
  if (generation !== previewGeneration || selectedPath !== path) return false;
  setSource(source);
  return true;
}

/** 底色或透明度设置变了：重新生成当前所选图片的预览 */
export async function reloadPreview(): Promise<void> {
  const path = selectedPath ?? fit.source?.path;
  if (!path) return;
  selectedPath = path;
  const generation = ++previewGeneration;
  const source = await loadPreview(path);
  if (generation === previewGeneration && selectedPath === path) setSource(source);
}

interface Started {
  jobId: number;
  width: number;
  height: number;
  bg: number;
  bgAlpha?: number;
  threads: number;
  similarity: number;
}

type FitEvent =
  | { event: "shape"; index: number; shape: number[]; similarity: number; elapsedMs: number }
  | { event: "refining"; pass: number; passes: number; index: number; total: number; elapsedMs: number }
  | { event: "refined"; bg: number; bgAlpha?: number; shapes: number[][]; similarities: number[]; elapsedMs: number }
  | { event: "done"; stopped: boolean; count: number; similarity: number; elapsedMs: number };

/** 开始拟合，立即返回；onDone 在结束（完成、提前收敛或被停止）时调用一次。参数不合法时抛出后端的中文错误。 */
export async function startFit(onDone: (stopped: boolean) => void): Promise<void> {
  const source = fit.source;
  if (!source || fit.running) return;
  // 先占位再等待：连点两次不会开出两个任务
  fit.running = true;
  fit.stopping = false;
  const generation = resetGeneration;
  const p = { ...fit.params };
  const weightMask = mask && mask.width === source.preview.width && mask.height === source.preview.height ? mask : null;
  const kinds = [p.ellipse && 2, p.rect && 1, p.triangle && 3, p.radial && 4, p.linear && 5, p.band && 6]
    .filter((k): k is 1 | 2 | 3 | 4 | 5 | 6 => !!k);
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<FitEvent>();
  let jobId = 0;
  // 事件可能在 invoke 返回之前就到：先缓存，拿到任务号后再处理
  let pending: FitEvent[] | null = [];
  const handle = (e: FitEvent) => {
    if (fit.jobId !== jobId) return;
    if (e.event === "shape") {
      const [k, x, y, w, h, r, a, c] = e.shape;
      shapes.push({ k, x, y, w, h, r, a, c });
      similarities.push(e.similarity);
      fit.done = shapes.length;
      fit.elapsedMs = e.elapsedMs;
      if (fit.follow) fit.use = fit.done;
    } else if (e.event === "refining") {
      fit.refining = { pass: e.pass, passes: e.passes, index: e.index, total: e.total };
      fit.elapsedMs = e.elapsedMs;
    } else if (e.event === "refined") {
      // 精修整体替换图元和背景色；数量不变
      shapes.length = 0;
      for (const [k, x, y, w, h, r, a, c] of e.shapes) shapes.push({ k, x, y, w, h, r, a, c });
      similarities.length = 0;
      similarities.push(...e.similarities);
      if (fit.canvas) {
        const { bgAlpha: _previousAlpha, ...canvas } = fit.canvas;
        fit.canvas = { ...canvas, bg: e.bg, ...(e.bgAlpha === undefined ? {} : { bgAlpha: e.bgAlpha }) };
      }
      fit.elapsedMs = e.elapsedMs;
      fit.revision++;
    } else {
      fit.elapsedMs = e.elapsedMs;
      fit.running = false;
      fit.stopping = false;
      fit.refining = null;
      onDone(e.stopped);
    }
  };
  channel.onmessage = (e) => (pending ? pending.push(e) : handle(e));

  try {
    const started = await invoke<Started>("primfit_start", {
      path: source.path,
      options: {
        count: p.count,
        size: p.size,
        kinds,
        alpha: p.alpha,
        quality: p.quality,
        seed: p.seed,
        threads: p.threads,
        matte: matteValue(p.matte),
        preserveAlpha: p.preserveAlpha,
        refine: p.refine,
        antialias: p.antialias,
        // 重点区域：与预览同尺寸的蒙版，后端缩放到工作分辨率（最多约 26 万个数）
        ...(weightMask ? { mask: { width: weightMask.width, height: weightMask.height, data: Array.from(weightMask.data) } } : {}),
      },
      channel,
    });
    if (generation !== resetGeneration) {
      // 等待后端开任务期间页面被重置：任务已经开出来了，停掉它，不再写回任何结果
      void invoke("primfit_stop", { jobId: started.jobId }).catch(() => {});
      return;
    }
    shapes.length = 0;
    similarities.length = 0;
    jobId = started.jobId;
    fit.jobId = jobId;
    fit.canvas = { width: started.width, height: started.height, bg: started.bg,
      ...(started.bgAlpha === undefined ? {} : { bgAlpha: started.bgAlpha }) };
    fit.resultSource = source.name;
    fit.baseSimilarity = started.similarity;
    fit.threads = started.threads;
    fit.goal = p.count;
    fit.refineGoal = p.refine;
    fit.done = 0;
    fit.refining = null;
    fit.use = 0;
    fit.follow = true;
    fit.elapsedMs = 0;
    const queued = pending;
    pending = null;
    queued.forEach(handle);
  } catch (e) {
    if (generation !== resetGeneration) return;
    fit.running = false;
    fit.refining = null;
    throw e;
  }
}

/** 请求停止：当前这个图元搜索完后结束，已有的图元保留。 */
export async function stopFit(): Promise<void> {
  if (!fit.running || fit.stopping) return;
  fit.stopping = true;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("primfit_stop", { jobId: fit.jobId });
}

/**
 * 「重置」页面：停掉进行中的拟合，清空原图、结果、蒙版，参数回到默认值并删掉保存的参数。
 * 页面可能没挂载（在别的页签上点的重置），所以只动模块状态，不依赖组件实例。
 */
export function resetPrimFit(): void {
  resetGeneration++;
  // 正在选图 / 载入预览的请求返回后一律作废
  pickGeneration++;
  previewGeneration++;
  selectedPath = null;
  if (fit.running) {
    const jobId = fit.jobId;
    // 后端任务停下前还会发事件：下面把 jobId 改掉，旧任务的事件就都被丢弃
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("primfit_stop", { jobId })).catch(() => {});
  }
  shapes.length = 0;
  similarities.length = 0;
  mask = null;
  Object.assign(fit, {
    params: { ...DEFAULT_PARAMS },
    source: null,
    canvas: null,
    resultSource: "",
    running: false,
    stopping: false,
    // 不与任何后端任务号相同：旧任务迟到的事件全部丢弃
    jobId: -1,
    goal: 0,
    refineGoal: 0,
    done: 0,
    refining: null,
    revision: fit.revision + 1,
    baseSimilarity: 0,
    elapsedMs: 0,
    threads: 0,
    use: 0,
    follow: true,
    maskRevision: fit.maskRevision + 1,
    maskCoverage: 0,
  });
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 忽略：参数已在内存里回到默认值
  }
}
