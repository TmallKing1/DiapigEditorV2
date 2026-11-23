import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Art, type Shape, ART_FORMAT, ASSET_OF_KIND, IMAGE_TYPE_OF_KIND, KIND, KIND_LABELS,
  artFormat, artFromTable, beginArt, colorHex, drawShape, gradientKernel, gradientStops, isModuleName, parseArtLua, serializeArtLua, takeShapes,
} from "./primfit";

const { invoke, open } = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class { onmessage?: (event: unknown) => void } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

const art: Art = {
  width: 200,
  height: 150,
  bg: 0x0a98b2,
  shapes: [
    { k: 2, x: 137, y: 61, w: 73, h: 192, r: 86, a: 0x71, c: 0x373820 },
    { k: 1, x: 0, y: 150, w: 1, h: 400, r: 0, a: 255, c: 0xffffff },
    { k: 3, x: 200, y: 0, w: 12, h: 9, r: 359, a: 24, c: 0x000001 },
  ],
};

describe("图元拟合 Lua 模块", () => {
  it("颜色写成 0xAARRGGBB，高位补零", () => {
    expect(colorHex(art.shapes[0])).toBe("0x71373820");
    expect(colorHex(art.shapes[2])).toBe("0x18000001");
    expect(colorHex({ ...art.shapes[2], a: 1 })).toBe("0x01000001");
  });

  it("序列化后能原样解析回来", () => {
    const text = serializeArtLua(art, { module: "PrimArt", source: "图 片.png", similarity: 0.95234 });
    expect(parseArtLua(text)).toEqual(art);
    expect(parseArtLua(text)).not.toHaveProperty("bgAlpha");
    expect(text).not.toContain("bgAlpha");
    expect(text).toContain("format=1,w=200,h=150,bg=0x0A98B2,");
    expect(text).toContain("\n2,137,61,73,192,86,0x71373820,\n");
    expect(text).toContain("相似度 95.2%");
    expect(text.endsWith("},\n}\n")).toBe(true);
  });

  it("源图文件名里的换行不会破坏注释", () => {
    const text = serializeArtLua(art, { module: "A", source: "a\nreturn nil --.png" });
    expect(parseArtLua(text)).toEqual(art);
    expect(text.split("\n").filter((l) => !l.startsWith("--") && l.includes("nil"))).toEqual([]);
  });

  it("取前缀只保留前 k 个图元", () => {
    expect(takeShapes(art, 2).shapes).toEqual(art.shapes.slice(0, 2));
    expect(takeShapes(art, 0).shapes).toEqual([]);
    expect(takeShapes(art, 99).shapes.length).toBe(3);
    expect(parseArtLua(serializeArtLua(takeShapes(art, 1), { module: "A" })).shapes.length).toBe(1);
  });

  it("拒绝格式不对的表", () => {
    expect(() => artFromTable({ format: 3, w: 1, h: 1, bg: 0, shapes: [] })).toThrow();
    expect(() => artFromTable({ format: 1, w: 1, h: 1, bg: 0, shapes: [1, 2, 3] })).toThrow();
    expect(() => artFromTable({ format: 1, w: 1, h: 1, bg: 0, shapes: [4, 0, 0, 1, 1, 0, 0] })).toThrow();
    expect(() => parseArtLua("return {}")).toThrow();
  });

  it("模块名只允许字母、数字、下划线，不以数字开头", () => {
    for (const ok of ["PrimArt", "_a", "Cover_01", "x"]) expect(isModuleName(ok)).toBe(true);
    for (const bad of ["", "1a", "a-b", "a.b", "图片", "a b", "a.lua"]) expect(isModuleName(bad)).toBe(false);
  });
});

describe("渐变格式与兼容性", () => {
  it("声明三种渐变的素材与绘制模式", () => {
    expect(ART_FORMAT).toBe(3);
    expect([KIND.radial, KIND.linear, KIND.band]).toEqual([4, 5, 6]);
    expect([4, 5, 6].map((k) => ASSET_OF_KIND[k])).toEqual([106057, 106093, 106091]);
    expect([4, 5, 6].map((k) => IMAGE_TYPE_OF_KIND[k])).toEqual(["Basic", "Stretch", "Stretch"]);
    expect([4, 5, 6].map((k) => KIND_LABELS[k])).toEqual(["柔边椭圆", "单向渐变", "对称光带"]);
  });

  it.each([4, 5, 6])("类型 %i 单独出现时也升级为格式 2，并保留全部字段", (k) => {
    const mixed = { ...art, shapes: [...art.shapes, { ...art.shapes[0], k, x: -12, r: -39 }] };
    const text = serializeArtLua(mixed, { module: "GradientArt" });
    expect(text).toContain("\nformat=2,");
    expect(text).toContain("新版读取器");
    expect(parseArtLua(text)).toEqual(mixed);
    expect(artFormat(takeShapes(mixed, 3))).toBe(1);
    expect(serializeArtLua(takeShapes(mixed, 3), { module: "HardArt" })).toContain("\nformat=1,");
  });

  it("空结果和纯硬图元保持格式 1，格式 2 也允许硬图元", () => {
    expect(artFormat({ shapes: [] })).toBe(1);
    expect(parseArtLua(serializeArtLua(art, { module: "A" }).replace("\nformat=1,", "\nformat=2,"))).toEqual(art);
  });

  it.each([4, 5, 6])("拒绝旧格式夹带渐变类型 %i", (k) => {
    const text = serializeArtLua({ ...art, shapes: [{ ...art.shapes[0], k }] }, { module: "A" });
    expect(() => parseArtLua(text.replace("\nformat=2,", "\nformat=1,"))).toThrow("第 1 个图元无效");
  });

  it.each([0, 7, -1, 4.5, NaN])("所有格式及导出均拒绝未知类型 %s", (k) => {
    for (const format of [1, 2, 3]) {
      expect(() => artFromTable({ format, w: 1, h: 1, bg: 0, bgAlpha: 0, shapes: [k, 0, 0, 1, 1, 0, 0xffffffff] })).toThrow();
    }
    expect(() => serializeArtLua({ ...art, shapes: [{ ...art.shapes[0], k }] }, { module: "A" })).toThrow("未知图元类型");
  });
});

describe("透明背景格式 3", () => {
  it("旧格式的有效附加透明度不改变不透明背景语义", () => {
    for (const format of [1, 2]) {
      const art = parseArtLua(`return {format=${format},w=1,h=1,bg=0,bgAlpha=0,shapes={}}`);
      expect(art.bgAlpha).toBe(255);
      expect(artFormat(art)).toBe(1);
    }
  });

  it.each([0, 1, 128, 254])("背景透明度 %i 在空图、硬图元和渐变中原样往返", (bgAlpha) => {
    for (const shapes of [[], art.shapes, [1, 2, 3, 4, 5, 6].map((k) => ({ ...art.shapes[0], k }))]) {
      const transparent: Art = { ...art, bgAlpha, shapes };
      const text = serializeArtLua(transparent, { module: "AlphaArt" });
      expect(artFormat(transparent)).toBe(3);
      expect(text).toContain(`format=3,w=200,h=150,bg=0x0A98B2,bgAlpha=${bgAlpha},`);
      expect(parseArtLua(text)).toEqual(transparent);
      expect(artFormat(takeShapes(transparent, 0))).toBe(3);
    }
  });

  it("显式不透明背景仍使用旧格式，不添加 alpha 字段", () => {
    for (const k of [1, 4]) {
      const opaque = { ...art, bgAlpha: 255, shapes: [{ ...art.shapes[0], k }] };
      const text = serializeArtLua(opaque, { module: "Opaque" });
      expect(artFormat(opaque)).toBe(k === 1 ? 1 : 2);
      expect(text).not.toContain("bgAlpha");
      const { bgAlpha: _alpha, ...legacy } = opaque;
      expect(parseArtLua(text)).toEqual(legacy);
    }
  });

  it("可读取旧版本头中的可选 bgAlpha，未知版本不可读取", () => {
    for (const format of [1, 2]) {
      expect(parseArtLua(`return {format=${format},w=1,h=1,bg=0,bgAlpha=255,shapes={}}`))
        .toEqual({ width: 1, height: 1, bg: 0, bgAlpha: 255, shapes: [] });
    }
    expect(() => parseArtLua("return {format=4,w=1,h=1,bg=0,bgAlpha=0,shapes={}}")).toThrow();
  });

  it.each([undefined, -1, 256, 0.5, NaN, null, "0"])("拒绝格式 3 的缺失或非法背景透明度 %s", (bgAlpha) => {
    expect(() => artFromTable({ format: 3, w: 1, h: 1, bg: 0, bgAlpha, shapes: [] })).toThrow("bgAlpha");
  });

  it.each(["", "bgAlpha=,", "bgAlpha=-1,", "bgAlpha=256,", "bgAlpha=0.5,", "bgAlpha=0oops,", "bgAlpha=nil,"])("拒绝缺失或损坏的 alpha 头 %s", (field) => {
    expect(() => parseArtLua(`return {format=3,w=1,h=1,bg=0,${field}shapes={}}`)).toThrow();
  });

  it.each([-1, 256, 0.5, NaN])("导出拒绝非法透明度 %s", (bgAlpha) => {
    expect(() => serializeArtLua({ ...art, bgAlpha }, { module: "A" })).toThrow("bgAlpha");
  });
});

function canvasSpy() {
  const stops: [number, string][] = [];
  const gradient = { addColorStop: vi.fn((offset: number, color: string) => stops.push([offset, color])) };
  const context = {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    fill: vi.fn(), fillRect: vi.fn(), clearRect: vi.fn(), clip: vi.fn(), fillStyle: "" as string | typeof gradient,
    createRadialGradient: vi.fn(() => gradient), createLinearGradient: vi.fn(() => gradient),
  };
  return { context, g: context as unknown as CanvasRenderingContext2D, gradient, stops };
}

const stopAlpha = (stop: [number, string]) => Number(stop[1].slice(stop[1].lastIndexOf(",") + 1, -1));
const alphaAt = (stops: [number, string][], u: number) => {
  const stop = stops.find(([offset]) => Math.abs(offset - u) < 1e-12);
  if (!stop) throw new Error(`没有位于 ${u} 的停止点`);
  return stopAlpha(stop);
};

describe("Canvas 渐变预览", () => {
  it.each([undefined, 255, 0, 128])("背景透明度 %s 先清空区域再填充，不留下上一幅图", (bgAlpha) => {
    const { context, g } = canvasSpy();
    expect(beginArt(g, { ...art, bgAlpha }, 3, 5, 400)).toBe(2);
    expect(context.rect).toHaveBeenCalledWith(3, 5, 400, 300);
    expect(context.clip).toHaveBeenCalledOnce();
    expect(context.clearRect).toHaveBeenCalledWith(3, 5, 400, 300);
    expect(context.fillRect).toHaveBeenCalledWith(3, 5, 400, 300);
    expect(context.clearRect.mock.invocationCallOrder[0]).toBeLessThan(context.fillRect.mock.invocationCallOrder[0]);
    expect(context.fillStyle).toBe(bgAlpha === undefined || bgAlpha === 255 ? "#0A98B2" : `rgba(10,152,178,${bgAlpha / 255})`);
  });

  it("核在范围外夹紧，内部符合给定曲线且单调递减", () => {
    expect([-3, 0, 0.25, 0.5, 0.75, 1, 3].map(gradientKernel)).toEqual([1, 1, 0.796875, 0.5, 0.203125, 0, 0]);
    const values = Array.from({ length: 257 }, (_, i) => gradientKernel(i / 256));
    expect(values.every((v, i) => v >= 0 && v <= 1 && (i === 0 || v <= values[i - 1]))).toBe(true);
  });

  it("停止点与逐点精确计算的核线性插值后误差不到 1/255", () => {
    for (const k of [4, 5, 6]) {
      const stops = gradientStops(k);
      const exact = (u: number) =>
        gradientKernel(k === 4 ? u : k === 5 ? (u - 0.120) / 0.860 : (Math.abs(2 * u - 1) - 0.145) / 0.830);
      for (const [u, v] of stops) expect(v).toBeCloseTo(exact(u), 12);
      for (let i = 0; i <= 4096; i++) {
        const u = i / 4096;
        const j = Math.max(1, stops.findIndex(([p]) => p >= u));
        const [u0, v0] = stops[j - 1];
        const [u1, v1] = stops[j];
        const lerp = u1 === u0 ? v0 : v0 + ((v1 - v0) * (u - u0)) / (u1 - u0);
        expect(Math.abs(lerp - exact(u))).toBeLessThan(1 / 255);
      }
    }
  });

  it("径向渐变用归一化半径，旋转后按两轴拉伸为椭圆，停止点乘上图元透明度", () => {
    const { context, g, gradient, stops } = canvasSpy();
    const shape: Shape = { k: 4, x: 12, y: 21, w: 80, h: 30, r: 45, a: 128, c: 0x123456 };
    drawShape(g, shape, 3, 5, 2, 100);
    expect(context.translate).toHaveBeenCalledWith(27, 163);
    expect(context.rotate).toHaveBeenCalledWith(-Math.PI / 4);
    expect(context.scale).toHaveBeenCalledWith(160, 60);
    expect(context.rotate.mock.invocationCallOrder[0]).toBeLessThan(context.scale.mock.invocationCallOrder[0]);
    expect(context.scale.mock.invocationCallOrder[0]).toBeLessThan(context.createRadialGradient.mock.invocationCallOrder[0]);
    expect(context.createRadialGradient).toHaveBeenCalledWith(0, 0, 0, 0, 0, 0.5);
    expect(context.createLinearGradient).not.toHaveBeenCalled();
    expect(stops).toHaveLength(65);
    expect(stops.map(([offset]) => offset)).toEqual(Array.from({ length: 65 }, (_, i) => i / 64));
    expect(stops[0][1]).toBe(`rgba(18,52,86,${128 / 255})`);
    expect(alphaAt(stops, 0.25)).toBeCloseTo(0.796875 * 128 / 255, 12);
    expect(alphaAt(stops, 0.5)).toBeCloseTo(0.5 * 128 / 255, 12);
    expect(alphaAt(stops, 1)).toBe(0);
    expect(context.fillStyle).toBe(gradient);
    expect(context.fillRect).toHaveBeenCalledWith(-0.5, -0.5, 1, 1);
    expect(context.fill).not.toHaveBeenCalled();
    expect(context.save).toHaveBeenCalledTimes(1);
    expect(context.restore).toHaveBeenCalledTimes(1);
  });

  it("线性渐变沿局部 X 从左至右衰减，使用校准后的起点与跨度", () => {
    const { context, g, stops } = canvasSpy();
    drawShape(g, { ...art.shapes[0], k: 5, a: 255 }, 0, 0, 1, art.height);
    expect(context.createLinearGradient).toHaveBeenCalledWith(-0.5, 0, 0.5, 0);
    expect(context.createRadialGradient).not.toHaveBeenCalled();
    expect(stops).toHaveLength(67);
    expect(alphaAt(stops, 0)).toBe(1);
    expect(alphaAt(stops, 0.120)).toBe(1); // u ≤ 0.120 的平台，转折点本身也是停止点
    expect(alphaAt(stops, 0.5)).toBeCloseTo(gradientKernel((0.5 - 0.120) / 0.860), 12);
    expect(alphaAt(stops, 0.980)).toBe(0); // u ≥ 0.980
    expect(alphaAt(stops, 1)).toBe(0);
    expect(stops.every((stop, i) => i === 0 || (stop[0] > stops[i - 1][0] && stopAlpha(stop) <= stopAlpha(stops[i - 1])))).toBe(true);
  });

  it("带状渐变中心平台与双侧衰减对称，并使用校准跨度", () => {
    const { context, g, stops } = canvasSpy();
    drawShape(g, { ...art.shapes[0], k: 6, a: 255 }, 0, 0, 1, art.height);
    expect(context.createLinearGradient).toHaveBeenCalledWith(-0.5, 0, 0.5, 0);
    expect(stops).toHaveLength(69);
    expect(alphaAt(stops, 0)).toBe(0);
    expect(alphaAt(stops, 1)).toBe(0);
    expect(alphaAt(stops, 0.5)).toBe(1);
    expect(alphaAt(stops, 0.4375)).toBe(1); // |2u-1| < 0.145
    expect(alphaAt(stops, 0.25)).toBeCloseTo(gradientKernel((0.5 - 0.145) / 0.830), 12);
    for (let i = 0; i < stops.length; i++) {
      const mirror = stops[stops.length - 1 - i];
      expect(stops[i][0]).toBeCloseTo(1 - mirror[0], 12);
      expect(stopAlpha(stops[i])).toBeCloseTo(stopAlpha(mirror), 12);
    }
  });

  it.each([1, 2, 3])("保留硬图元 %i 的路径、颜色、坐标与旋转", (k) => {
    const { context, g } = canvasSpy();
    drawShape(g, { ...art.shapes[0], k }, 10, 20, 2, art.height);
    expect(context.translate).toHaveBeenCalledWith(284, 198);
    expect(context.rotate).toHaveBeenCalledWith(-86 * Math.PI / 180);
    expect(context.fillStyle).toBe(`rgba(55,56,32,${0x71 / 255})`);
    expect(context.scale).not.toHaveBeenCalled();
    expect(context.createLinearGradient).not.toHaveBeenCalled();
    expect(context.createRadialGradient).not.toHaveBeenCalled();
    expect(context.beginPath).toHaveBeenCalledOnce();
    expect(context.fill).toHaveBeenCalledOnce();
    expect(context.restore).toHaveBeenCalledOnce();
    if (k === 1) expect(context.rect).toHaveBeenCalledWith(-73, -192, 146, 384);
    if (k === 2) expect(context.ellipse).toHaveBeenCalledWith(0, 0, 73, 192, 0, 0, Math.PI * 2);
    if (k === 3) {
      expect(context.moveTo).toHaveBeenCalledWith(0, -192);
      expect(context.lineTo.mock.calls).toEqual([[73, 192], [-73, 192]]);
      expect(context.closePath).toHaveBeenCalledOnce();
    }
  });

  it("未知类型在改动画布前报错，不再误画成三角形", () => {
    const { context, g } = canvasSpy();
    expect(() => drawShape(g, { ...art.shapes[0], k: 7 }, 0, 0, 1, art.height)).toThrow("未知图元类型");
    expect(context.save).not.toHaveBeenCalled();
    expect(context.fill).not.toHaveBeenCalled();
  });

  it("渐变创建失败时仍恢复画布变换", () => {
    const { context, g } = canvasSpy();
    context.createLinearGradient.mockImplementation(() => { throw new Error("canvas failed"); });
    expect(() => drawShape(g, { ...art.shapes[0], k: 5 }, 0, 0, 1, art.height)).toThrow("canvas failed");
    expect(context.restore).toHaveBeenCalledOnce();
  });
});

describe("拟合参数持久化与命令", () => {
  let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    open.mockReset();
    storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("首次使用以及旧设置均补上径向开启、线性和带状关闭的默认值", async () => {
    const first = await import("../lib/primfit.svelte");
    expect(first.fit.params).toMatchObject({ radial: true, linear: false, band: false, preserveAlpha: false });
    vi.resetModules();
    storage.getItem.mockReturnValue(JSON.stringify({ rect: false, count: 321 }));
    const old = await import("../lib/primfit.svelte");
    expect(old.fit.params).toMatchObject({ rect: false, count: 321, radial: true, linear: false, band: false, preserveAlpha: false });
  });

  it("保存并重新载入显式设置，不把关闭的径向渐变恢复为开启", async () => {
    const session = await import("../lib/primfit.svelte");
    Object.assign(session.fit.params, { radial: false, linear: true, band: true, preserveAlpha: true });
    session.saveParams();
    expect(storage.setItem).toHaveBeenCalledWith("diapig.primfit", expect.any(String));
    storage.getItem.mockReturnValue(storage.setItem.mock.calls[0][1]);
    vi.resetModules();
    const restored = await import("../lib/primfit.svelte");
    expect(restored.fit.params).toMatchObject({ radial: false, linear: true, band: true, preserveAlpha: true });
  });

  it("已保存的渐变开关类型错误时使用各自默认值", async () => {
    storage.getItem.mockReturnValue(JSON.stringify({ radial: "false", linear: 1, band: null, preserveAlpha: "true" }));
    const { fit } = await import("../lib/primfit.svelte");
    expect(fit.params).toMatchObject({ radial: true, linear: false, band: false, preserveAlpha: false });
  });

  it.each([
    { flags: { rect: true, ellipse: true, triangle: true, radial: true, linear: true, band: true }, kinds: [2, 1, 3, 4, 5, 6] },
    { flags: { rect: false, ellipse: false, triangle: false, radial: true, linear: false, band: false }, kinds: [4] },
    { flags: { rect: false, ellipse: false, triangle: false, radial: false, linear: true, band: false }, kinds: [5] },
    { flags: { rect: false, ellipse: false, triangle: false, radial: false, linear: false, band: true }, kinds: [6] },
  ])("发送选中的图元数组 $kinds，支持只选渐变", async ({ flags, kinds }) => {
    const { fit, startFit } = await import("../lib/primfit.svelte");
    Object.assign(fit.params, flags);
    fit.source = { path: "image.png", name: "image.png", width: 100, height: 100, preview: {} as ImageData };
    invoke.mockResolvedValue({ jobId: 42, width: 100, height: 100, bg: 0, threads: 1, similarity: 0 });
    await startFit(vi.fn());
    expect(invoke).toHaveBeenCalledWith("primfit_start", expect.objectContaining({
      path: "image.png", options: expect.objectContaining({ kinds, preserveAlpha: false }),
    }));
    expect(fit.canvas).not.toHaveProperty("bgAlpha");
  });

  it.each([0, 97, 255, undefined])("拟合与精修采用后端 alpha %s，参数后续变化不影响结果", async (bgAlpha) => {
    const { fit, startFit, currentArt } = await import("../lib/primfit.svelte");
    fit.source = { path: "image.png", name: "image.png", width: 100, height: 100, preview: {} as ImageData };
    fit.params.preserveAlpha = true;
    invoke.mockImplementation(async () => {
      fit.params.preserveAlpha = false;
      return { jobId: 42, width: 100, height: 100, bg: 0, bgAlpha, threads: 1, similarity: 0 };
    });
    await startFit(vi.fn());
    expect(invoke).toHaveBeenCalledWith("primfit_start", expect.objectContaining({ options: expect.objectContaining({ preserveAlpha: true }) }));
    expect(currentArt()?.bgAlpha).toBe(bgAlpha);
    const channel = invoke.mock.calls[0][1].channel;
    for (const alpha of [128, 0, undefined]) {
      channel.onmessage({ event: "refined", bg: 0x123456, bgAlpha: alpha, shapes: [], similarities: [], elapsedMs: 10 });
      expect(fit.canvas?.bgAlpha).toBe(alpha);
      expect(currentArt()?.bgAlpha).toBe(alpha);
      expect(currentArt()?.bg).toBe(0x123456);
      expect(artFormat(currentArt()!)).toBe(alpha === undefined ? 1 : 3);
    }
    expect(currentArt()).not.toHaveProperty("bgAlpha");
  });

  it.each([false, true])("预览传递 preserveAlpha=%s 和底色，直接保留 RGBA 字节", async (preserveAlpha) => {
    stubImageData();
    const { fit, reloadPreview } = await import("../lib/primfit.svelte");
    fit.source = sourceImage("image.png");
    Object.assign(fit.params, { preserveAlpha, matte: "#123456" });
    invoke.mockResolvedValue(previewBuffer(73));
    await reloadPreview();
    expect(invoke).toHaveBeenCalledWith("primfit_load", { path: "image.png", preserveAlpha, matte: 0x123456 });
    expect(fit.source).toMatchObject({ width: 200, height: 150 });
    expect(Array.from(fit.source!.preview.data)).toEqual([10, 20, 30, 73]);
  });

  it("快速切换透明设置时只采用最新的预览响应", async () => {
    stubImageData();
    const { fit, reloadPreview } = await import("../lib/primfit.svelte");
    fit.source = sourceImage("image.png");
    const older = deferred<ArrayBuffer>();
    const newer = deferred<ArrayBuffer>();
    invoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = reloadPreview();
    fit.params.preserveAlpha = true;
    const second = reloadPreview();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls.map(([, args]) => args.preserveAlpha)).toEqual([false, true]);
    newer.resolve(previewBuffer(0));
    await second;
    older.resolve(previewBuffer(255));
    await first;
    expect(fit.source!.preview.data[3]).toBe(0);
  });

  it("重新选图及载入期间切换参数时，旧响应不能替换新图片", async () => {
    stubImageData();
    const { fit, reloadPreview, pickImage } = await import("../lib/primfit.svelte");
    fit.source = sourceImage("old.png");
    const oldLoad = deferred<ArrayBuffer>();
    const pickedLoad = deferred<ArrayBuffer>();
    const latestLoad = deferred<ArrayBuffer>();
    invoke.mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(pickedLoad.promise).mockReturnValueOnce(latestLoad.promise);
    const oldReload = reloadPreview();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    open.mockResolvedValue("new.png");
    const picked = pickImage();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    fit.params.preserveAlpha = true;
    const latest = reloadPreview();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    expect(invoke.mock.calls.map(([, args]) => args.path)).toEqual(["old.png", "new.png", "new.png"]);
    latestLoad.resolve(previewBuffer(64));
    await latest;
    oldLoad.resolve(previewBuffer(255));
    pickedLoad.resolve(previewBuffer(128));
    await Promise.all([oldReload, picked]);
    expect(fit.source!.path).toBe("new.png");
    expect(fit.source!.preview.data[3]).toBe(64);
  });

  it("文件选择器打开时更新预览，不会丢弃随后选中的新图片", async () => {
    stubImageData();
    const { fit, reloadPreview, pickImage } = await import("../lib/primfit.svelte");
    fit.source = sourceImage("old.png");
    const selection = deferred<string>();
    open.mockReturnValue(selection.promise);
    invoke.mockResolvedValue(previewBuffer(0));
    const picked = pickImage();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    fit.params.preserveAlpha = true;
    await reloadPreview();
    selection.resolve("new.png");
    expect(await picked).toBe(true);
    expect(fit.source!.path).toBe("new.png");
    expect(invoke).toHaveBeenLastCalledWith("primfit_load", { path: "new.png", preserveAlpha: true, matte: 0 });
  });

  it("有重点区域时随拟合请求发送蒙版，全为 0 视为未设置", async () => {
    stubImageData();
    const { fit, startFit, setMask, getMask } = await import("../lib/primfit.svelte");
    fit.source = { path: "image.png", name: "image.png", width: 4, height: 2, preview: { width: 2, height: 1 } as ImageData };
    setMask({ width: 2, height: 1, data: new Uint8ClampedArray([255, 51]) });
    expect(fit.maskCoverage).toBeCloseTo(0.6);
    invoke.mockResolvedValue({ jobId: 7, width: 2, height: 1, bg: 0, threads: 1, similarity: 0 });
    await startFit(vi.fn());
    expect(invoke.mock.calls[0][1].options.mask).toEqual({ width: 2, height: 1, data: [255, 51] });

    fit.running = false;
    setMask({ width: 2, height: 1, data: new Uint8ClampedArray(2) });
    expect(getMask()).toBeNull();
    expect(fit.maskCoverage).toBe(0);
    await startFit(vi.fn());
    expect(invoke.mock.calls[1][1].options).not.toHaveProperty("mask");
  });

  it("只改底色或透明度时保留重点区域，换图片时清除", async () => {
    stubImageData();
    const { fit, reloadPreview, pickImage, setMask, getMask } = await import("../lib/primfit.svelte");
    fit.source = { ...sourceImage("old.png"), preview: { width: 1, height: 1 } as ImageData };
    setMask({ width: 1, height: 1, data: new Uint8ClampedArray([200]) });
    invoke.mockResolvedValue(previewBuffer(255));
    fit.params.matte = "#ff0000";
    await reloadPreview();
    expect(getMask()?.data[0]).toBe(200);
    open.mockResolvedValue("new.png");
    await pickImage();
    expect(fit.source!.path).toBe("new.png");
    expect(getMask()).toBeNull();
    expect(fit.maskCoverage).toBe(0);
  });
});

function sourceImage(path: string) {
  return { path, name: path, width: 200, height: 150, preview: {} as ImageData };
}

function stubImageData() {
  vi.stubGlobal("ImageData", class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
}

function previewBuffer(alpha: number): ArrayBuffer {
  const buffer = new ArrayBuffer(20);
  const view = new DataView(buffer);
  [200, 150, 1, 1].forEach((v, i) => view.setUint32(i * 4, v, true));
  new Uint8Array(buffer, 16).set([10, 20, 30, alpha]);
  return buffer;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
