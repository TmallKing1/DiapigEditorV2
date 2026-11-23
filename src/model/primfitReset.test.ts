import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, open } = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class { onmessage?: (event: unknown) => void } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const source = () => ({ path: "image.png", name: "image.png", width: 100, height: 100, preview: { width: 4, height: 4 } as ImageData });
const started = { jobId: 42, width: 100, height: 100, bg: 0, threads: 1, similarity: 0.5 };

describe("图元拟合页面重置", () => {
  let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    open.mockReset();
    storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("停止进行中的拟合，清空原图、结果、蒙版并恢复默认参数", async () => {
    const lib = await import("../lib/primfit.svelte");
    const { fit, shapes, startFit, setMask, resetPrimFit, DEFAULT_PARAMS } = lib;
    fit.source = source();
    Object.assign(fit.params, { count: 9, module: "Other", preserveAlpha: true });
    setMask({ width: 4, height: 4, data: new Uint8ClampedArray(16).fill(255) });
    invoke.mockResolvedValue(started);
    const onDone = vi.fn();
    await startFit(onDone);
    const channel = invoke.mock.calls[0][1].channel;
    channel.onmessage({ event: "shape", index: 0, shape: [1, 1, 1, 1, 1, 0, 255, 0], similarity: 0.6, elapsedMs: 5 });
    expect(fit.done).toBe(1);

    resetPrimFit();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(invoke).toHaveBeenCalledWith("primfit_stop", { jobId: 42 });
    expect(storage.removeItem).toHaveBeenCalledWith("diapig.primfit");
    expect(fit.params).toEqual(DEFAULT_PARAMS);
    expect(fit).toMatchObject({ source: null, canvas: null, running: false, done: 0, use: 0, maskCoverage: 0 });
    expect(shapes).toHaveLength(0);
    expect(lib.getMask()).toBeNull();

    // 旧任务迟到的事件不再写回
    channel.onmessage({ event: "shape", index: 1, shape: [1, 1, 1, 1, 1, 0, 255, 0], similarity: 0.7, elapsedMs: 6 });
    channel.onmessage({ event: "done", stopped: true, count: 2, similarity: 0.7, elapsedMs: 7 });
    expect(shapes).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("开始拟合的请求在重置后才返回时，停掉新任务且不写回结果", async () => {
    const { fit, startFit, resetPrimFit } = await import("../lib/primfit.svelte");
    fit.source = source();
    const pending = deferred<typeof started>();
    invoke.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const run = startFit(vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    resetPrimFit();
    pending.resolve(started);
    await run;
    expect(invoke).toHaveBeenCalledWith("primfit_stop", { jobId: 42 });
    expect(fit.canvas).toBeNull();
    expect(fit.running).toBe(false);
  });

  it("选图对话框在重置后才返回时丢弃结果", async () => {
    const { fit, pickImage, resetPrimFit } = await import("../lib/primfit.svelte");
    const chosen = deferred<string>();
    open.mockReturnValue(chosen.promise);
    const picking = pickImage();
    await new Promise((r) => setTimeout(r, 0));
    resetPrimFit();
    chosen.resolve("image.png");
    await expect(picking).resolves.toBe(false);
    expect(fit.source).toBeNull();
  });
});
