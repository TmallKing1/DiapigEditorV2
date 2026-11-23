import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, open } = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function sourceData(): ArrayBuffer {
  const data = new ArrayBuffer(16);
  const view = new DataView(data);
  view.setUint32(0, 200, true);
  view.setUint32(4, 100, true);
  return data;
}

describe("像素画页面会话", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    open.mockReset().mockResolvedValue("C:\\test\\sample.png");
    invoke.mockReset().mockImplementation((name: string) => Promise.resolve(name === "pixelart_load" ? sourceData() : undefined));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("按独立宽高生成，修改参数后收起旧结果和保存名称", async () => {
    const { pixelArt, pickPixelSource, generatePixelArt, recordPixelExport, setPixelParams } = await import("../lib/pixelArt.svelte");
    await pickPixelSource();
    expect(pixelArt.params).toMatchObject({ width: 64, height: 32 });
    setPixelParams({ width: 9, height: 14, merge: true });
    invoke.mockResolvedValueOnce(new ArrayBuffer(12));
    expect(await generatePixelArt()).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith("pixelart_generate", { sourceId: 1, width: 9, height: 14, merge: true });
    expect(pixelArt.result?.art).toMatchObject({ width: 18, height: 28 });
    recordPixelExport(pixelArt.result!, "PixelArt", "Artwork.lua");
    expect(pixelArt.lastExport?.filename).toBe("Artwork.lua");
    setPixelParams({ width: 3 });
    expect(pixelArt.result).toBeNull();
    expect(pixelArt.lastExport).toBeNull();
  });

  it("忽略参数变化或重置前发出的生成和选图请求", async () => {
    const { pixelArt, pickPixelSource, generatePixelArt, resetPixelArt, setPixelParams } = await import("../lib/pixelArt.svelte");
    await pickPixelSource();
    const backend = deferred<ArrayBuffer>();
    invoke.mockReturnValueOnce(backend.promise);
    const generating = generatePixelArt();
    await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith("pixelart_generate", expect.anything()));
    setPixelParams({ width: 12 });
    backend.resolve(new ArrayBuffer(12));
    expect(await generating).toBe(false);
    expect(pixelArt.result).toBeNull();
    expect(pixelArt.busy).toBeNull();

    const dialog = deferred<string>();
    open.mockReturnValueOnce(dialog.promise);
    const picking = pickPixelSource();
    resetPixelArt();
    dialog.resolve("C:\\test\\another.png");
    await picking;
    expect(pixelArt.source).toBeNull();
    expect(pixelArt.params).toMatchObject({ width: 64, height: 64, merge: false });
    await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith("pixelart_clear", { revision: 5 }));
  });
});
