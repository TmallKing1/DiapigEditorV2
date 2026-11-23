import { describe, expect, it } from "vitest";
import { applyStroke, autoMask, coverage, createMask, dab, isEmptyMask, strokeLine } from "./weightMask";

const W = 64;
const H = 48;

describe("笔刷印记", () => {
  it("半径以内为 1、羽化带内递减、半径以外为 0", () => {
    const stroke = new Float32Array(W * H);
    const rect = dab(stroke, W, H, 32, 24, 10, 0.5);
    expect(rect).toEqual({ x0: 22, y0: 14, x1: 42, y1: 34 });
    const at = (x: number, y: number) => stroke[y * W + x];
    // 像素中心到 (32, 24) 的距离：(32, 24) 处 0.71，内圈半径 5
    expect(at(32, 24)).toBe(1);
    expect(at(35, 24)).toBe(1); // 距离 3.5
    const mid = at(39, 24); // 距离 7.5，在羽化带中间
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(at(41, 24)).toBeLessThan(mid); // 距离 9.5
    expect(at(42, 24)).toBe(0); // 距离 10.5
    expect(at(32, 34)).toBe(0);
  });

  it("羽化为 0 时是硬边圆", () => {
    const stroke = new Float32Array(W * H);
    dab(stroke, W, H, 20, 20, 6, 0);
    const values = new Set(stroke);
    expect([...values].sort()).toEqual([0, 1]);
    expect(stroke[20 * W + 25]).toBe(1); // 距离 5.5
    expect(stroke[20 * W + 26]).toBe(0); // 距离 6.5
  });

  it("画面外的印记不写任何像素", () => {
    const stroke = new Float32Array(W * H);
    expect(dab(stroke, W, H, -40, -40, 10, 0.3)).toBeNull();
    expect(isEmptyMask(stroke)).toBe(true);
  });

  it("连线是连续的", () => {
    const stroke = new Float32Array(W * H);
    strokeLine(stroke, W, H, 5, 10, 58, 10, 3, 0);
    for (let x = 5; x <= 58; x++) expect(stroke[10 * W + x]).toBe(1);
  });
});

describe("合并一笔", () => {
  it("一笔之内来回涂抹不超过不透明度", () => {
    const base = createMask(W, H).data;
    const stroke = new Float32Array(W * H);
    for (let i = 0; i < 20; i++) strokeLine(stroke, W, H, 10, 10, 50, 30, 8, 0.4);
    const out = applyStroke(base, stroke, 0.4, false, W);
    const max = Math.max(...out);
    expect(max).toBe(102);
    expect(out[0]).toBe(0);
  });

  it("涂抹把已有权重推向不透明度，也能压低", () => {
    const base = new Uint8ClampedArray(W * H).fill(200);
    const stroke = new Float32Array(W * H);
    dab(stroke, W, H, 32, 24, 6, 0);
    const out = applyStroke(base, stroke, 0.2, false, W);
    expect(out[24 * W + 32]).toBe(51);
    expect(out[0]).toBe(200);
  });

  it("擦除按不透明度按比例减小", () => {
    const base = new Uint8ClampedArray(W * H).fill(200);
    const stroke = new Float32Array(W * H);
    dab(stroke, W, H, 32, 24, 6, 0);
    expect(applyStroke(base, stroke, 1, true, W)[24 * W + 32]).toBe(0);
    expect(applyStroke(base, stroke, 0.5, true, W)[24 * W + 32]).toBe(100);
    // 只处理给定矩形
    const out = new Uint8ClampedArray(W * H);
    applyStroke(base, stroke, 1, true, W, out, { x0: 30, y0: 22, x1: 34, y1: 26 });
    expect(out[24 * W + 32]).toBe(0);
    expect(out[0]).toBe(0); // 矩形外不写
  });
});

/** 左半边平坦、右半边棋盘格的合成图 */
function halfChecker(alpha = 255) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const v = x < W / 2 ? 128 : ((x >> 2) + (y >> 2)) % 2 ? 230 : 20;
      data.set([v, v, v, alpha], o);
    }
  }
  return { width: W, height: H, data };
}

function mean(mask: Uint8ClampedArray, x0: number, x1: number) {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++, n++) sum += mask[y * W + x];
  return sum / n;
}

describe("自动生成", () => {
  it("细节：棋盘格一侧的权重高于平坦一侧", () => {
    const mask = autoMask(halfChecker(), "detail");
    const flat = mean(mask, 0, W / 4);
    const busy = mean(mask, (W * 3) / 4, W);
    expect(busy).toBeGreaterThan(200);
    expect(flat).toBeLessThan(20);
    expect(Math.max(...mask)).toBe(255);
  });

  it("中心：中心最高、四角最低、左右对称", () => {
    const mask = autoMask(halfChecker(), "center");
    const center = mask[(H / 2) * W + W / 2];
    expect(center).toBeGreaterThan(245);
    expect(mask[0]).toBeLessThan(10);
    expect(mask[0]).toBe(mask[W - 1]);
    expect(mask[(H - 1) * W]).toBe(mask[H * W - 1]);
  });

  it("透明处不加权", () => {
    expect(isEmptyMask(autoMask(halfChecker(0), "detail"))).toBe(true);
    expect(isEmptyMask(autoMask(halfChecker(0), "center"))).toBe(true);
    const half = autoMask(halfChecker(128), "center");
    const full = autoMask(halfChecker(), "center");
    expect(Math.abs(half[(H / 2) * W + W / 2] - full[(H / 2) * W + W / 2] / 2)).toBeLessThanOrEqual(1);
  });

  it("纯色图片的细节蒙版为空", () => {
    const flat = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(90) };
    expect(isEmptyMask(autoMask(flat, "detail"))).toBe(true);
  });
});

describe("覆盖率", () => {
  it("按加权面积计算", () => {
    expect(coverage(new Uint8ClampedArray(100))).toBe(0);
    expect(coverage(new Uint8ClampedArray(100).fill(255))).toBe(1);
    const half = new Uint8ClampedArray(100);
    half.fill(255, 0, 50);
    expect(coverage(half)).toBe(0.5);
    expect(coverage(new Uint8ClampedArray(4).fill(51))).toBeCloseTo(0.2);
  });
});
