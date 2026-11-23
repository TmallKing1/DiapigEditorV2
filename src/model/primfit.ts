// 图元拟合结果的数据模型：Lua 数据模块的序列化 / 解析、模块名校验、Canvas 预览。
// 硬图元兼容 In Falsus 曲封（format = 1）；渐变用 format = 2，透明背景用 format = 3。

/** 当前支持的最高格式版本；导出版本由实际图元决定。 */
export const ART_FORMAT = 3;
/** 每个图元在 shapes 里占 7 个整数 */
export const STRIDE = 7;
export const KIND = { rect: 1, ellipse: 2, triangle: 3, radial: 4, linear: 5, band: 6 } as const;
export const KIND_LABELS: Record<number, string> = { 1: "矩形", 2: "椭圆", 3: "三角形", 4: "柔边椭圆", 5: "单向渐变", 6: "对称光带" };
/** 图元类型 → 素材库图片 ID */
export const ASSET_OF_KIND: Record<number, number> = { 1: 100001, 2: 100002, 3: 100003, 4: 106057, 5: 106093, 6: 106091 };
export const IMAGE_TYPE_OF_KIND: Record<number, "Basic" | "Stretch"> = { 1: "Stretch", 2: "Stretch", 3: "Stretch", 4: "Basic", 5: "Stretch", 6: "Stretch" };

const validKinds = new Set<number>(Object.values(KIND));
function checkKind(k: number): void {
  if (!validKinds.has(k)) throw new Error(`未知图元类型：${k}`);
}

export interface Shape {
  /** 1 矩形 / 2 椭圆 / 3 等腰三角形（尖顶朝局部 +Y）/ 4 径向 / 5 线性 / 6 带状渐变 */
  k: number;
  /** 中心，原点在左下角，Y 向上 */
  x: number;
  y: number;
  /** sizeDelta：椭圆为两轴直径，三角形为底边宽与高 */
  w: number;
  h: number;
  /** 旋转（度，逆时针为正） */
  r: number;
  /** 不透明度 1–255 */
  a: number;
  /** 颜色 0xRRGGBB */
  c: number;
}

export interface Art {
  width: number;
  height: number;
  /** 背景色 0xRRGGBB，也是外层遮罩的颜色 */
  bg: number;
  /** 背景不透明度 0–255；旧数据省略时为 255 */
  bgAlpha?: number;
  shapes: Shape[];
}

/** 模块名同时是文件名和脚本映射名：只用字母、数字、下划线，不以数字开头 */
export function isModuleName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

const hex = (v: number, digits: number) => v.toString(16).toUpperCase().padStart(digits, "0");

/** 0xAARRGGBB */
export function colorHex(s: Shape): string {
  return "0x" + hex(s.a * 0x1000000 + s.c, 8);
}

export interface LuaInfo {
  module: string;
  /** 源图文件名，只写进注释 */
  source?: string;
  /** 相似度 0–1，只写进注释 */
  similarity?: number | null;
  /** 像素画以半像素为坐标单位，这里记录成品的实际像素尺寸。 */
  pixelGrid?: { width: number; height: number };
}

/** 只取前 count 个图元（贪心拟合的前缀本身就是 count 个图元时的结果）。 */
export function takeShapes(art: Art, count: number): Art {
  return { ...art, shapes: art.shapes.slice(0, Math.max(0, count)) };
}

/** 不透明背景沿用旧格式；透明背景（包括空图与硬图元前缀）使用格式 3。 */
export function artFormat(art: Pick<Art, "shapes" | "bgAlpha">): 1 | 2 | 3 {
  if (art.bgAlpha !== undefined && (!Number.isInteger(art.bgAlpha) || art.bgAlpha < 0 || art.bgAlpha > 255)) {
    throw new Error("bgAlpha 无效");
  }
  let format: 1 | 2 = 1;
  for (const s of art.shapes) {
    checkKind(s.k);
    if (s.k >= KIND.radial) format = 2;
  }
  return (art.bgAlpha ?? 255) === 255 ? format : 3;
}

/** 序列化为 Lua 数据模块：每个图元一行 7 个整数，不留空格。 */
export function serializeArtLua(art: Art, info: LuaInfo): string {
  const format = artFormat(art);
  const label = info.pixelGrid ? "「像素画生成」" : "图元拟合";
  const lines = [`-- ${info.module}.lua：${info.pixelGrid ? "像素画" : "图元拟合图片"}（由 Diapig Editor ${label}生成，请勿手动修改格式）`];
  const facts = [info.pixelGrid ? `${info.pixelGrid.width}×${info.pixelGrid.height} px` : `${art.width}×${art.height}`, `${art.shapes.length} 个图元`];
  if (info.source) facts.unshift(`源图 ${info.source.replace(/[\r\n]+/g, " ")}`);
  if (info.similarity != null) facts.push(`相似度 ${(info.similarity * 100).toFixed(1)}%`);
  lines.push(`-- ${facts.join("，")}`);
  lines.push("-- 遮罩：w × h 的纯色矩形（颜色 bg = 0xRRGGBB），裁切全部图元。每 7 个整数一个图元：类型（1 矩形 100001 /");
  lines.push("-- 2 椭圆 100002 / 3 等腰三角形 100003，尖顶朝局部 +Y）、中心 x、中心 y、宽、高、旋转（度，逆时针为正）、");
  lines.push("-- 颜色 0xAARRGGBB。原点在遮罩左下角，X 向右、Y 向上，单位与 w、h 相同，显示时按「显示宽度 / w」等比缩放。");
  if (format >= 2) {
    lines.push("-- 渐变图元需要新版读取器支持：4 径向渐变 106057（Basic）/ 5 线性渐变 106093（Stretch）/ 6 带状渐变 106091（Stretch）。");
  }
  if (format === 3) lines.push("-- format=3 支持透明背景：bgAlpha 为背景不透明度（0–255），图元类型为 1–6。");
  lines.push("-- 引用与绘制方法见 docs/图元拟合图片约定.md。");
  lines.push("return {");
  lines.push(`format=${format},w=${art.width},h=${art.height},bg=0x${hex(art.bg, 6)},${format === 3 ? `bgAlpha=${art.bgAlpha},` : ""}`);
  lines.push("shapes={");
  for (const s of art.shapes) lines.push(`${s.k},${s.x},${s.y},${s.w},${s.h},${s.r},${colorHex(s)},`);
  lines.push("},", "}");
  return lines.join("\n") + "\n";
}

/** Lua 表（已是 JS 对象）→ Art；格式不对时抛错。 */
export function artFromTable(table: { format?: unknown; w?: unknown; h?: unknown; bg?: unknown; bgAlpha?: unknown; shapes?: unknown }): Art {
  if (!table || (table.format !== 1 && table.format !== 2 && table.format !== ART_FORMAT)) throw new Error("不是图元拟合结果（format 不符）");
  const { w, h, bg, bgAlpha, shapes } = table;
  const int = (v: unknown): v is number => Number.isInteger(v);
  if (!(int(w) && w > 0 && int(h) && h > 0 && int(bg) && bg >= 0 && bg <= 0xffffff)) throw new Error("w / h / bg 无效");
  if ((table.format === 3 || bgAlpha !== undefined) && !(int(bgAlpha) && bgAlpha >= 0 && bgAlpha <= 255)) throw new Error("bgAlpha 无效");
  if (!Array.isArray(shapes) || shapes.length % STRIDE !== 0) throw new Error(`shapes 长度必须是 ${STRIDE} 的倍数`);
  const list: Shape[] = [];
  for (let i = 0; i < shapes.length; i += STRIDE) {
    const [k, x, y, sw, sh, r, color] = shapes.slice(i, i + STRIDE) as number[];
    if (!validKinds.has(k) || (table.format === 1 && k > KIND.triangle) || ![x, y, sw, sh, r, color].every(int)) throw new Error(`第 ${i / STRIDE + 1} 个图元无效`);
    list.push({ k, x, y, w: sw, h: sh, r, a: Math.floor(color / 0x1000000) % 256, c: color % 0x1000000 });
  }
  return { width: w, height: h, bg, ...(bgAlpha === undefined ? {} : { bgAlpha: table.format === 3 ? bgAlpha as number : 255 }), shapes: list };
}

/** 解析本工具（或 In Falsus 制谱器）导出的 Lua 数据模块。只认这一种固定写法，不是通用 Lua 解析器。 */
export function parseArtLua(text: string): Art {
  const body = text.replace(/--[^\n]*/g, "");
  const head = /^\s*return\s*\{\s*format\s*=\s*(\d+)\s*,\s*w\s*=\s*(\d+)\s*,\s*h\s*=\s*(\d+)\s*,\s*bg\s*=\s*(0x[0-9A-Fa-f]+|\d+)\s*,\s*(?:bgAlpha\s*=\s*([^,{}]+)\s*,\s*)?shapes\s*=\s*\{([^}]*)\}\s*,?\s*\}\s*;?\s*$/.exec(body);
  if (!head) throw new Error("不是图元拟合结果（format / w / h / bg / bgAlpha / shapes 无效）");
  const shapes = head[6]
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .map((t) => (/^(0x[0-9A-Fa-f]+|-?\d+)$/.test(t) ? Number(t) : NaN));
  const alpha = head[5]?.trim();
  const bgAlpha = alpha === undefined ? undefined : /^(0x[0-9A-Fa-f]+|\d+)$/.test(alpha) ? Number(alpha) : NaN;
  return artFromTable({ format: Number(head[1]), w: Number(head[2]), h: Number(head[3]), bg: Number(head[4]), bgAlpha, shapes });
}

const css = (s: Shape, coverage = 1) => `rgba(${(s.c >> 16) & 255},${(s.c >> 8) & 255},${s.c & 255},${(s.a / 255) * coverage})`;

/** 渐变素材的覆盖率核：先把距离夹到 [0, 1]，避免多项式在范围外回升。 */
export function gradientKernel(s: number): number {
  s = Math.max(0, Math.min(1, s));
  return 1 - 0.5 * s - 1.5 * s * s + s * s * s;
}

/** 渐变停止点的均分段数。停止点越多 Canvas 填充越慢（257 个约是 65 个的 3.5 倍），
 *  核是平滑的三次曲线，64 段线性插值的误差不到 1/255；平台与衰减的转折点另外精确加上。 */
export const GRADIENT_SEGMENTS = 64;

/** 渐变停止点在单位方形上的距离映射（径向为归一化半径，线性 / 带状为校准后的起点与跨度） */
function gradientDistance(kind: number, u: number): number {
  return kind === KIND.radial ? u : kind === KIND.linear ? (u - 0.120) / 0.860 : (Math.abs(2 * u - 1) - 0.145) / 0.830;
}

const stopCache = new Map<number, [number, number][]>();

/** 某类渐变的停止点：[位置 0–1, 覆盖率 0–1]，按位置升序。每类只算一次。 */
export function gradientStops(kind: number): [number, number][] {
  let stops = stopCache.get(kind);
  if (stops) return stops;
  const at = new Set<number>();
  for (let i = 0; i <= GRADIENT_SEGMENTS; i++) at.add(i / GRADIENT_SEGMENTS);
  // 转折点：覆盖率在这里由平台转入衰减或衰减到 0，不在均分点上时线性插值会削掉拐角
  if (kind === KIND.linear) [0.120, 0.980].forEach((u) => at.add(u));
  if (kind === KIND.band) [0.0125, 0.4275, 0.5725, 0.9875].forEach((u) => at.add(u));
  stops = [...at].sort((a, b) => a - b).map((u) => [u, gradientKernel(gradientDistance(kind, u))]);
  stopCache.set(kind, stops);
  return stops;
}

/** 画一个图元。(x, y) 是整幅图的左上角，k 是放大倍数。引擎 Y 向上、逆时针为正；画布 Y 向下，所以都取反。 */
export function drawShape(g: CanvasRenderingContext2D, s: Shape, x: number, y: number, k: number, artHeight: number): void {
  checkKind(s.k);
  g.save();
  g.translate(x + s.x * k, y + (artHeight - s.y) * k);
  g.rotate((-s.r * Math.PI) / 180);
  g.fillStyle = css(s);
  const w = s.w * k;
  const h = s.h * k;
  if (s.k >= KIND.radial) {
    // 在单位方形里建渐变，再随控件拉伸；径向的归一化半径由此变成椭圆。
    try {
      g.scale(w, h);
      const gradient = s.k === KIND.radial
        ? g.createRadialGradient(0, 0, 0, 0, 0, 0.5)
        : g.createLinearGradient(-0.5, 0, 0.5, 0);
      const rgb = `rgba(${(s.c >> 16) & 255},${(s.c >> 8) & 255},${s.c & 255},`;
      const alpha = s.a / 255;
      for (const [u, coverage] of gradientStops(s.k)) gradient.addColorStop(u, `${rgb}${alpha * coverage})`);
      g.fillStyle = gradient;
      g.fillRect(-0.5, -0.5, 1, 1);
    } finally {
      g.restore();
    }
    return;
  }
  g.beginPath();
  if (s.k === KIND.rect) g.rect(-w / 2, -h / 2, w, h);
  else if (s.k === KIND.ellipse) g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (s.k === KIND.triangle) {
    g.moveTo(0, -h / 2);
    g.lineTo(w / 2, h / 2);
    g.lineTo(-w / 2, h / 2);
    g.closePath();
  }
  g.fill();
  g.restore();
}

/** 背景 + 裁切区域；之后可以逐个 drawShape。返回放大倍数。 */
export function beginArt(g: CanvasRenderingContext2D, art: Pick<Art, "width" | "height" | "bg" | "bgAlpha">, x: number, y: number, size: number): number {
  const k = size / art.width;
  g.beginPath();
  g.rect(x, y, size, art.height * k);
  g.clip();
  g.clearRect(x, y, size, art.height * k);
  g.fillStyle = (art.bgAlpha ?? 255) === 255 ? `#${hex(art.bg, 6)}`
    : `rgba(${(art.bg >> 16) & 255},${(art.bg >> 8) & 255},${art.bg & 255},${(art.bgAlpha ?? 255) / 255})`;
  g.fillRect(x, y, size, art.height * k);
  return k;
}

/** 画整幅图的前 count 个图元：左上角 (x, y)，宽 size，高按比例。带抗锯齿，接近引擎里拉伸素材的效果。 */
export function drawArt(g: CanvasRenderingContext2D, art: Art, x: number, y: number, size: number, count = art.shapes.length): void {
  g.save();
  const k = beginArt(g, art, x, y, size);
  for (let i = 0; i < count && i < art.shapes.length; i++) drawShape(g, art.shapes[i], x, y, k, art.height);
  g.restore();
}

/** 每轮精修相对于「建控件」阶段的计算权重：refine=0 时建控件占 100%，refine=2（默认）时建控件占 66.7%、精修占 33.3% */
export const REFINE_PASS_WEIGHT = 0.25;

export interface PrimFitProgressInput {
  done: number;
  goal: number;
  refineGoal: number;
  stopping?: boolean;
  refining: { pass: number; passes: number; index: number; total: number } | null;
}

export interface PrimFitProgressInfo {
  /** 总进度 0–1 */
  progress: number;
  /** 整数百分比 0–100 */
  percent: number;
  stage: "build" | "refine";
  /** 供右下角按钮悬停显示的详情 */
  detail: string;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** 将「建控件 + 精修」两个顺序阶段量化为单调递增的 0–100% 总进度与详情文本 */
export function primfitProgress(s: PrimFitProgressInput): PrimFitProgressInfo {
  let progress: number;
  let stage: "build" | "refine";
  let stageLine: string;

  if (s.refining) {
    stage = "refine";
    const passes = Math.max(1, s.refining.passes);
    const buildShare = 1 / (1 + passes * REFINE_PASS_WEIGHT);
    const refineFrac =
      s.refining.total > 0 ? clamp01(((s.refining.pass - 1) * s.refining.total + s.refining.index) / (passes * s.refining.total)) : 0;
    progress = clamp01(buildShare + (1 - buildShare) * refineFrac);
    stageLine = `精修：第 ${s.refining.pass} / ${passes} 轮（${s.refining.index} / ${s.refining.total}）`;
  } else {
    stage = "build";
    const passes = Math.max(0, s.refineGoal);
    const buildShare = 1 / (1 + passes * REFINE_PASS_WEIGHT);
    const buildFrac = s.goal > 0 ? clamp01(s.done / s.goal) : 0;
    progress = clamp01(buildShare * buildFrac);
    stageLine = s.goal > 0 ? `建控件：${s.done} / ${s.goal}` : "正在准备…";
  }

  const percent = Math.round(progress * 100);
  const head = s.stopping ? `正在停止图元拟合 · ${percent}%` : `图元拟合中 · ${percent}%`;
  const detail = `${head}\n${stageLine}\n点击跳转到图元拟合页面`;
  return { progress, percent, stage, detail };
}
