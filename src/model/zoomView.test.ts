import { describe, expect, it } from "vitest";
import { FIT_VIEW, MAX_ZOOM, clampView, fitSize, panBy, placement, wheelFactor, zoomAt } from "./zoomView";

const stage = { w: 800, h: 600 };
const wide = { w: 400, h: 200 }; // 适应后 800×400，上下留空
const tall = { w: 100, h: 300 }; // 适应后 200×600，左右留空

describe("放大预览的缩放与平移", () => {
  it("适应窗口：等比放进舞台并居中", () => {
    expect(fitSize(stage, wide)).toEqual({ w: 800, h: 400 });
    expect(fitSize(stage, tall)).toEqual({ w: 200, h: 600 });
    expect(placement(FIT_VIEW, stage, wide)).toEqual({ x: 0, y: 100, w: 800, h: 400 });
    expect(fitSize({ w: 0, h: 600 }, wide)).toEqual({ w: 0, h: 0 });
  });

  it("以指针为中心缩放：指针下的图片位置不动", () => {
    const view = zoomAt(FIT_VIEW, 2, 600, 300, stage, wide);
    expect(view.zoom).toBe(2);
    const before = placement(FIT_VIEW, stage, wide);
    const after = placement(view, stage, wide);
    const u0 = (600 - before.x) / before.w;
    const u1 = (600 - after.x) / after.w;
    expect(u1).toBeCloseTo(u0);
    // 竖直方向 2 倍后 800 高，比舞台高，也以指针为中心
    expect((300 - after.y) / after.h).toBeCloseTo((300 - before.y) / before.h);
  });

  it("缩放倍数夹在 1× 到 16×，缩回 1× 时归位居中", () => {
    let view = zoomAt(FIT_VIEW, 100, 100, 100, stage, wide);
    expect(view.zoom).toBe(MAX_ZOOM);
    view = zoomAt(view, 0.01, 700, 500, stage, wide);
    expect(view).toEqual({ zoom: 1, cx: 0.5, cy: 0.5 });
  });

  it("在角上放大时图片边缘不会离开舞台边缘", () => {
    const view = zoomAt(FIT_VIEW, 4, 0, 0, stage, wide);
    const at = placement(view, stage, wide);
    expect(at.x).toBeCloseTo(0);
    expect(at.y).toBeCloseTo(0);
    expect(at.x + at.w).toBeGreaterThanOrEqual(stage.w);
    expect(at.y + at.h).toBeGreaterThanOrEqual(stage.h);
  });

  it("拖动平移跟随指针，并夹在边界内", () => {
    const zoomed = { zoom: 4, cx: 0.5, cy: 0.5 };
    const moved = panBy(zoomed, 100, -50, stage, wide);
    const a = placement(zoomed, stage, wide);
    const b = placement(moved, stage, wide);
    expect(b.x - a.x).toBeCloseTo(100);
    expect(b.y - a.y).toBeCloseTo(-50);
    const far = placement(panBy(zoomed, 1e6, 1e6, stage, wide), stage, wide);
    expect(far.x).toBeCloseTo(0);
    expect(far.y).toBeCloseTo(0);
    const other = placement(panBy(zoomed, -1e6, -1e6, stage, wide), stage, wide);
    expect(other.x + other.w).toBeCloseTo(stage.w);
    expect(other.y + other.h).toBeCloseTo(stage.h);
  });

  it("比舞台窄的方向不能平移，始终居中", () => {
    const view = panBy({ zoom: 2, cx: 0.5, cy: 0.5 }, 300, 0, stage, tall); // 宽 400 < 800
    expect(view.cx).toBe(0.5);
    expect(placement(view, stage, tall).x).toBe(200);
  });

  it("归一化视图让尺寸不同但比例相同的两张图停在同一位置", () => {
    const view = zoomAt(FIT_VIEW, 3, 650, 220, stage, { w: 512, h: 256 });
    const a = placement(view, stage, { w: 512, h: 256 });
    const b = placement(clampView(view, stage, { w: 200, h: 100 }), stage, { w: 200, h: 100 });
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
    expect(b.w).toBeCloseTo(a.w);
  });

  it("非法倍数回到 1×", () => {
    expect(clampView({ zoom: Number.NaN, cx: 0.9, cy: 0.1 }, stage, wide)).toEqual(FIT_VIEW);
  });

  it("滚轮向上放大、向下缩小，按行滚动折算成像素，单次不超过 2 倍", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100) * wheelFactor(100)).toBeCloseTo(1);
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48));
    expect(wheelFactor(-10000)).toBe(2);
    expect(wheelFactor(10000)).toBe(0.5);
  });
});
