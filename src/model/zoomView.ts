// 放大预览的缩放 / 平移换算（纯函数）。
// 视图状态不用像素偏移，而用「舞台中心对着图片上的哪一点」（归一化坐标 0–1）加放大倍数：
// 原图和拟合图的像素尺寸不同（预览长边 ≤ 512、拟合按工作分辨率），用归一化坐标切换图片时能停在同一位置。

export interface Size {
  w: number;
  h: number;
}

export interface ZoomView {
  /** 相对「适应窗口」的放大倍数，1 为整张图刚好放进舞台 */
  zoom: number;
  /** 舞台中心对应的图片位置（0–1，左上为原点） */
  cx: number;
  cy: number;
}

/** 图片在舞台里的位置与显示尺寸（CSS 像素，舞台左上为原点） */
export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 16;

export const FIT_VIEW: ZoomView = { zoom: 1, cx: 0.5, cy: 0.5 };

/** 适应窗口时图片的显示尺寸（等比放进舞台，可放大也可缩小） */
export function fitSize(stage: Size, image: Size): Size {
  if (stage.w <= 0 || stage.h <= 0 || image.w <= 0 || image.h <= 0) return { w: 0, h: 0 };
  const k = Math.min(stage.w / image.w, stage.h / image.h);
  return { w: image.w * k, h: image.h * k };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 一个方向上的中心夹取：图片比舞台窄就居中，否则不让图片边缘离开舞台边缘（不露出空白） */
function clampCenter(c: number, shown: number, stage: number): number {
  if (shown <= stage) return 0.5;
  const half = stage / 2 / shown;
  return clamp(c, half, 1 - half);
}

/** 把倍数夹到范围内，并让图片不被拖出舞台；缩回 1× 时自然归位到居中 */
export function clampView(view: ZoomView, stage: Size, image: Size): ZoomView {
  const zoom = clamp(Number.isFinite(view.zoom) ? view.zoom : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);
  const base = fitSize(stage, image);
  return {
    zoom,
    cx: clampCenter(view.cx, base.w * zoom, stage.w),
    cy: clampCenter(view.cy, base.h * zoom, stage.h),
  };
}

/** 视图 → 图片在舞台里的位置 */
export function placement(view: ZoomView, stage: Size, image: Size): Placement {
  const base = fitSize(stage, image);
  const w = base.w * view.zoom;
  const h = base.h * view.zoom;
  return { x: stage.w / 2 - view.cx * w, y: stage.h / 2 - view.cy * h, w, h };
}

/** 以舞台上的点 (px, py) 为中心缩放 factor 倍：该点下的图片位置保持不动（夹取后可能略有偏移） */
export function zoomAt(view: ZoomView, factor: number, px: number, py: number, stage: Size, image: Size): ZoomView {
  const from = placement(view, stage, image);
  if (from.w <= 0 || from.h <= 0) return view;
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  // 指针下的图片位置（归一化），缩放后仍要落在指针下
  const u = (px - from.x) / from.w;
  const v = (py - from.y) / from.h;
  const w = (from.w / view.zoom) * zoom;
  const h = (from.h / view.zoom) * zoom;
  const x = px - u * w;
  const y = py - v * h;
  return clampView({ zoom, cx: (stage.w / 2 - x) / w, cy: (stage.h / 2 - y) / h }, stage, image);
}

/** 拖动平移：指针移动 (dx, dy) 个 CSS 像素，图片跟着移动 */
export function panBy(view: ZoomView, dx: number, dy: number, stage: Size, image: Size): ZoomView {
  const at = placement(view, stage, image);
  if (at.w <= 0 || at.h <= 0) return view;
  return clampView({ zoom: view.zoom, cx: view.cx - dx / at.w, cy: view.cy - dy / at.h }, stage, image);
}

/** 滚轮一次的缩放倍数：向上（deltaY < 0）放大。按行滚动的设备把行折算成像素 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  // 一格普通滚轮（100 像素）约 1.2 倍；单次最多 2 倍，避免触控板惯性一下跳到头
  return clamp(Math.exp(-px * 0.0018), 0.5, 2);
}
