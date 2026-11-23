// 图元拟合的「重点区域」蒙版：与原图预览同尺寸的灰度图（0–255，行自上而下），值越大误差权重越高。
// 这里只有纯函数（笔刷、自动生成、覆盖率），界面状态在 lib/primfit.svelte.ts 与 ui/WeightMaskDialog.svelte。
// 后端把它按面积平均缩放到工作分辨率，换算成 ω = 1 + gain × m / 255（见 src-tauri/src/fit.rs）。

export interface WeightMask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 闭区间像素矩形；用来只重画、只合并一笔碰到的范围 */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function createMask(width: number, height: number): WeightMask {
  return { width, height, data: new Uint8ClampedArray(width * height) };
}

export function cloneMask(mask: WeightMask): WeightMask {
  return { width: mask.width, height: mask.height, data: mask.data.slice() };
}

export function isEmptyMask(data: ArrayLike<number>): boolean {
  for (let i = 0; i < data.length; i++) if (data[i] !== 0) return false;
  return true;
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * 把一个笔刷印记写进「本笔覆盖」缓冲 stroke（0–1，与蒙版同尺寸，逐像素取最大值）。
 * 以像素中心计距离：半径 ×(1 − 羽化) 以内为 1，再到半径处用 smoothstep 平滑降到 0。
 * 返回碰到的像素范围；完全在画面外时返回 null。
 */
export function dab(
  stroke: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  feather: number,
): Rect | null {
  const r = Math.max(0.5, radius);
  const inner = r * (1 - Math.min(1, Math.max(0, feather)));
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  if (x0 > x1 || y0 > y1) return null;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= r) continue;
      const v = d <= inner ? 1 : 1 - smoothstep((d - inner) / (r - inner));
      const i = y * width + x;
      if (v > stroke[i]) stroke[i] = v;
    }
  }
  return { x0, y0, x1, y1 };
}

/** 从 (x0, y0) 到 (x1, y1) 每隔 max(1, 半径 / 4) 像素印一次，两端都印，画出连续的笔迹。 */
export function strokeLine(
  stroke: Float32Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  feather: number,
): Rect | null {
  const spacing = Math.max(1, radius / 4);
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / spacing));
  let rect: Rect | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    rect = unionRect(rect, dab(stroke, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, feather));
  }
  return rect;
}

/**
 * 把一笔合进蒙版：base 是这一笔开始前的蒙版，结果写入 out（可以与 base 是同一个数组之外的任何缓冲）。
 * 一笔之内覆盖缓冲取最大值，所以来回涂抹不会越涂越浓：
 * - 涂抹：base + (opacity − base) × s，把权重推向所设不透明度（较低的不透明度也能把已有区域压低）；
 * - 擦除：base × (1 − opacity × s)。
 * opacity 为 0–1；rect 省略时处理整幅。
 */
export function applyStroke(
  base: Uint8ClampedArray,
  stroke: Float32Array,
  opacity: number,
  erase: boolean,
  width: number,
  out: Uint8ClampedArray = new Uint8ClampedArray(base.length),
  rect?: Rect | null,
): Uint8ClampedArray {
  const o = Math.min(1, Math.max(0, opacity));
  const height = base.length / width;
  const { x0, y0, x1, y1 } = rect ?? { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  const goal = o * 255;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0, i = y * width + x0; x <= x1; x++, i++) {
      const s = stroke[i];
      const b = base[i];
      out[i] = s <= 0 ? b : erase ? b * (1 - o * s) : b + (goal - b) * s;
    }
  }
  return out;
}

/** 至少有 RGBA 数据的图片（ImageData 或测试里的普通对象） */
export interface RgbaImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** 可分离的盒式模糊，连做三遍近似高斯；边缘按可用像素数归一 */
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  // 每一遍：横向 a → b，纵向 b → a，结果总在 a
  const a = src.slice();
  const b = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  for (let pass = 0; pass < 3; pass++) {
    // 横向
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      let n = 0;
      for (let x = 0; x < Math.min(width, r + 1); x++) {
        sum += a[row + x];
        n++;
      }
      for (let x = 0; x < width; x++) {
        b[row + x] = sum / n;
        const add = x + r + 1;
        const drop = x - r;
        if (add < width) {
          sum += a[row + add];
          n++;
        }
        if (drop >= 0) {
          sum -= a[row + drop];
          n--;
        }
      }
    }
    // 纵向
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let y = 0; y < Math.min(height, r + 1); y++) {
        sum += b[y * width + x];
        n++;
      }
      for (let y = 0; y < height; y++) {
        a[y * width + x] = sum / n;
        const add = y + r + 1;
        const drop = y - r;
        if (add < height) {
          sum += b[add * width + x];
          n++;
        }
        if (drop >= 0) {
          sum -= b[drop * width + x];
          n--;
        }
      }
    }
  }
  return a;
}

function quantile(values: Float32Array, q: number): number {
  const sorted = values.slice().sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

/**
 * 自动生成蒙版：
 * - detail（细节）：亮度的 Sobel 梯度幅值 → 大半径模糊 → 按分位数归一化到 0–255，边缘和纹理密集处权重高；
 * - center（中心）：以画面中心为峰的椭圆高斯。
 * 两种都再乘上图片的 Alpha（不保留透明度时预览的 Alpha 全为 255，不受影响），透明处不加权。
 */
export function autoMask(image: RgbaImage, method: "detail" | "center"): Uint8ClampedArray {
  const { width, height, data } = image;
  const n = width * height;
  const out = new Uint8ClampedArray(n);
  if (method === "center") {
    // σ 取半宽 / 半高的 0.5：边缘中点约为峰值的 14%，四角约 2%
    const hx = width / 2;
    const hy = height / 2;
    const sigma = 0.5;
    for (let y = 0; y < height; y++) {
      const dy = (y + 0.5 - hy) / hy;
      for (let x = 0; x < width; x++) {
        const dx = (x + 0.5 - hx) / hx;
        const v = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        out[y * width + x] = Math.round(v * 255 * (data[(y * width + x) * 4 + 3] / 255));
      }
    }
    return out;
  }
  const lum = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    lum[p] = 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2];
  }
  const at = (x: number, y: number) => lum[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const grad = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      grad[y * width + x] = Math.hypot(gx, gy);
    }
  }
  // 模糊半径约为长边的 1/32：把零散的边缘连成区域
  const blurred = boxBlur(grad, width, height, Math.max(2, Math.max(width, height) / 32));
  // 低于 20% 分位的算 0、高于 95% 分位的算满，避免少数强边缘把其余区域压得太淡
  const lo = quantile(blurred, 0.2);
  const hi = quantile(blurred, 0.95);
  const span = hi - lo;
  for (let p = 0; p < n; p++) {
    const v = span > 1e-6 ? Math.min(1, Math.max(0, (blurred[p] - lo) / span)) : 0;
    out[p] = Math.round(v * 255 * (data[p * 4 + 3] / 255));
  }
  return out;
}

/** 加权面积占比（0–1）：全为 255 时为 1 */
export function coverage(data: ArrayLike<number>): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum / (255 * data.length);
}
