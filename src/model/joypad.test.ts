import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("原神离线输入设备切换", () => {
  let saved: Map<string, string>;
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    saved = new Map([["diapig-editor.joypad-disclaimer.v1", "accepted"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
  });

  it("拒绝提交账号列表之外的 UID，不调用后端", async () => {
    const lib = await import("../lib/joypad.svelte");
    const { ui } = await import("../lib/ui.svelte");
    lib.joypad.prompting = true;
    lib.joypad.uids = ["123456780"];
    lib.joypad.uid = "123456780\n";
    await lib.submitJoypadUid();
    expect(invoke).not.toHaveBeenCalled();
    expect(lib.joypad.prompting).toBe(true);
    expect(ui.toasts.at(-1)?.kind).toBe("error");
  });

  it("首次免责声明完整显示 5 秒才可继续，取消不保存并清理计时器", async () => {
    saved.clear();
    const lib = await import("../lib/joypad.svelte");
    await lib.startJoypadToggle();
    expect(lib.JOYPAD_DISCLAIMER).toContain("需要使用手柄进行测试的场合");
    expect(lib.joypad.disclaimer).toBe(true);
    expect(lib.joypad.seconds).toBe(5);
    await lib.acceptJoypadDisclaimer();
    expect(invoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4999);
    expect(lib.joypad.seconds).toBe(1);
    await lib.acceptJoypadDisclaimer();
    expect(saved.size).toBe(0);
    lib.cancelJoypadDisclaimer();
    expect(vi.getTimerCount()).toBe(0);
    await lib.startJoypadToggle();
    expect(lib.joypad.seconds).toBe(5);
    lib.cancelJoypadDisclaimer();
  });

  it("确认免责声明后持久保存，重新加载也直接读取 UID 列表", async () => {
    saved.clear();
    let lib = await import("../lib/joypad.svelte");
    await lib.startJoypadToggle();
    vi.advanceTimersByTime(5000);
    expect(lib.joypad.seconds).toBe(0);
    invoke.mockResolvedValue({ uids: ["123456789", "123456780"] });
    await lib.acceptJoypadDisclaimer();
    expect(lib.joypad.disclaimer).toBe(false);
    expect(lib.joypad.uids).toEqual(["123456789", "123456780"]);
    expect(lib.joypad.prompting).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.resetModules();
    lib = await import("../lib/joypad.svelte");
    await lib.startJoypadToggle();
    expect(lib.joypad.disclaimer).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith("joypad_list_uids");
  });

  it("读取账号失败显示错误 toast，不打开空选择框", async () => {
    const lib = await import("../lib/joypad.svelte");
    const { ui } = await import("../lib/ui.svelte");
    invoke.mockRejectedValueOnce("未找到账号");
    await lib.startJoypadToggle();
    expect(lib.joypad.prompting).toBe(false);
    expect(lib.joypad.busy).toBe(false);
    expect(ui.toasts.at(-1)?.kind).toBe("error");
  });

  it.each([true, false])("读取状态 %s，取消不会写入，确认才提交原始快照", async (usingJoypad) => {
    const lib = await import("../lib/joypad.svelte");
    const ui = await import("../lib/ui.svelte");
    invoke.mockResolvedValueOnce({ uids: ["123456780"] });
    invoke.mockResolvedValueOnce({ usingJoypad, snapshot: "original", target: "USD_123456780_h1" });
    await lib.startJoypadToggle();
    lib.joypad.uid = "123456780";
    await lib.submitJoypadUid();
    expect(invoke.mock.calls).toEqual([["joypad_list_uids"], ["joypad_inspect", { uid: "123456780" }]]);
    const dialog = ui.ui.ask!;
    expect(dialog.title).toBe("确认切换输入设备");
    expect(dialog.message).toBe(`当前该账号为${usingJoypad ? "手柄" : "键鼠"}输入。\n是否切换为${usingJoypad ? "键鼠" : "手柄"}输入？`);
    ui.runAsk(dialog.actions[0]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(ui.ui.ask).toBeNull();

    invoke.mockResolvedValueOnce({ usingJoypad: !usingJoypad });
    ui.runAsk(dialog.actions[1]);
    await vi.waitFor(() => expect(lib.joypad.busy).toBe(false));
    expect(invoke).toHaveBeenLastCalledWith("joypad_commit", expect.objectContaining({ uid: "123456780", snapshot: "original", target: "USD_123456780_h1" }));
    expect(ui.ui.toasts.at(-1)?.kind).toBe("success");
  });

  it("检查失败显示错误 toast 且不进入确认", async () => {
    const lib = await import("../lib/joypad.svelte");
    const { ui } = await import("../lib/ui.svelte");
    invoke.mockRejectedValueOnce("游戏正在运行");
    lib.joypad.uids = ["123456780"];
    lib.joypad.uid = "123456780";
    await lib.submitJoypadUid();
    expect(ui.ask).toBeNull();
    expect(ui.toasts.at(-1)).toMatchObject({ kind: "error", text: "游戏正在运行!" });
    expect(lib.joypad.busy).toBe(false);
  });

  it("写入失败显示错误并解锁按钮", async () => {
    const lib = await import("../lib/joypad.svelte");
    const ui = await import("../lib/ui.svelte");
    invoke.mockResolvedValueOnce({ usingJoypad: true, snapshot: "original", target: "USD_123456780_h1" });
    lib.joypad.uids = ["123456780"];
    lib.joypad.uid = "123456780";
    await lib.submitJoypadUid();
    invoke.mockRejectedValueOnce("配置已变化");
    ui.runAsk(ui.ui.ask!.actions[1]);
    await vi.waitFor(() => expect(lib.joypad.busy).toBe(false));
    expect(ui.ui.toasts.at(-1)?.kind).toBe("error");
  });
});
