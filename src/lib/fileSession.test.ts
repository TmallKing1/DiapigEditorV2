import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNSORTED } from "../model/history";
import type { FileKind } from "../model/taskCodec";

const { renameJsonAt, saveJson, settings, writeText } = vi.hoisted(() => ({
  renameJsonAt: vi.fn(),
  saveJson: vi.fn(),
  settings: { autoSave: false, autoSaveWhen: "step" },
  writeText: vi.fn(),
}));
vi.mock("./files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./files")>()),
  isTauri: true,
  renameJsonAt,
  saveJson,
  writeText,
}));
vi.mock("./settings.svelte", () => ({ settings }));
vi.mock("./ui.svelte", () => ({ toast: vi.fn() }));

const storage = new Map<string, string>();
beforeEach(() => {
  vi.resetModules();
  storage.clear();
  renameJsonAt.mockReset();
  saveJson.mockReset();
  settings.autoSave = false;
  settings.autoSaveWhen = "step";
  writeText.mockReset();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

async function createSession(kind: FileKind) {
  const { FileSession, registerSession } = await import("./fileSession.svelte");
  const session = new FileSession<string, { doc: string }>({
    kind,
    noun: kind,
    lastKey: "last-" + kind,
    saveTitle: "Save As",
    filterName: "JSON",
    defaultName: kind + ".json",
    readyHint: "",
    focusId: "",
    parse: (text) => ({ doc: text }),
    stringify: (doc) => doc,
    ready: () => true,
    loadedToast: (name) => ({ text: name }),
  });
  registerSession(session);
  return session;
}

describe("新建文档的另存为页签", () => {
  it("各自保留对话和任务的页签，取消另存为后重试仍生效", async () => {
    const { createTab, hist } = await import("./history.svelte");
    const dialogTab = createTab("剧情", false);
    const taskTab = createTab("任务", false);
    const dialog = await createSession("dialog");
    const task = await createSession("task");
    dialog.load({ doc: "dialog" }, "", "", dialogTab);
    task.load({ doc: "task" }, "", "", taskTab);
    saveJson.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ path: "C:/task.json", name: "task.json" })
      .mockResolvedValueOnce({ path: "C:/dialog.json", name: "dialog.json" });
    expect(await dialog.saveFile()).toBe(false);
    expect(hist.data.entries).toHaveLength(0);
    expect(await task.saveFile()).toBe(true);
    expect(await dialog.saveFile()).toBe(true);
    expect(hist.data.entries.map(({ kind, tab }) => ({ kind, tab }))).toEqual([
      { kind: "task", tab: taskTab },
      { kind: "dialog", tab: dialogTab },
    ]);
  });

  it("直接保存保留手动归类，载入另一文件后清除新建时的选择", async () => {
    const { createTab, hist, moveFile } = await import("./history.svelte");
    const chosen = createTab("新建时选择");
    const moved = createTab("手动移动");
    const session = await createSession("dialog");
    session.load({ doc: "new" }, "", "", chosen);
    const first = { path: "C:/first.json", name: "first.json" };
    saveJson.mockResolvedValueOnce(first);
    await session.saveFile();
    moveFile(first.path, moved);
    writeText.mockResolvedValueOnce(first);
    expect(await session.saveFile()).toBe(true);
    expect(hist.data.entries[0].tab).toBe(moved);

    session.loadText("other", "other.json", "C:/other.json");
    saveJson.mockResolvedValueOnce({ path: "C:/copy.json", name: "copy.json" });
    expect(await session.saveFile(true)).toBe(true);
    expect(hist.data.entries.find((entry) => entry.path === "C:/copy.json")?.tab).toBe(UNSORTED);
  });
});

it("重新载入历史时恢复上次浏览的页签", async () => {
  const { createTab, selectHistoryTab } = await import("./history.svelte");
  const visited = createTab("浏览过的页签");
  selectHistoryTab(visited);
  createTab("新文档的页签", false);
  vi.resetModules();
  const { currentTab } = await import("./history.svelte");
  expect(currentTab()).toBe(visited);
});

describe("文件重命名", () => {
  it("改名后保留历史归类，更新编辑会话及下次启动时的路径", async () => {
    const { createTab, hist, moveFile, recordFile } = await import("./history.svelte");
    const { renameFile } = await import("./fileSession.svelte");
    const path = "C:/旧文件.JSON";
    const renamed = "C:/新文件.JSON";
    const tab = createTab("剧情");
    const active = await createSession("dialog");
    const pending = await createSession("task");
    active.load({ doc: "story" }, "旧文件.JSON", path);
    pending.pendingOpen = path;
    pending.rememberLast(path);
    moveFile(path, tab);
    recordFile(renamed, "task");
    renameJsonAt.mockResolvedValueOnce(renamed);

    expect(await renameFile(path, "新文件")).toBe(renamed);
    expect(active.fileName).toBe("新文件.JSON");
    expect(active.filePath).toBe(renamed);
    expect(active.lastPath()).toBe(renamed);
    expect(pending.pendingOpen).toBe(renamed);
    expect(pending.lastPath()).toBe(renamed);
    expect(hist.data.entries).toEqual([
      expect.objectContaining({ path: renamed, kind: "dialog", tab }),
    ]);
    writeText.mockResolvedValueOnce({ path: renamed, name: "新文件.JSON" });
    expect(await active.saveFile()).toBe(true);
    expect(writeText).toHaveBeenCalledWith(renamed, "story");
  });

  it("文件有未保存修改时不改名，系统失败时保留原路径", async () => {
    const { renameFile } = await import("./fileSession.svelte");
    const path = "C:/old.json";
    const active = await createSession("dialog");
    active.load({ doc: "saved" }, "old.json", path);
    active.commit({ doc: "dirty" });
    await expect(renameFile(path, "new")).rejects.toThrow("请先保存");
    expect(renameJsonAt).not.toHaveBeenCalled();

    active.undo();
    renameJsonAt.mockRejectedValueOnce("同目录下已有同名文件");
    await expect(renameFile(path, "new")).rejects.toBe("同目录下已有同名文件");
    expect(active.filePath).toBe(path);
    expect(active.busy).toBe(false);
  });
});

describe("改动后自动保存", () => {
  it.each(["step", "commit"])("%s：连续提交时维持稳定的显示状态，并写入最新改动", async (mode) => {
    const session = await createSession("task");
    session.load({ doc: "before" }, "task.json", "C:/task.json");
    settings.autoSave = true;
    settings.autoSaveWhen = mode;
    const change = (doc: string) => {
      session.commit({ doc });
      if (mode === "commit") void session.autoSave();
    };
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    writeText
      .mockReturnValueOnce(new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockReturnValueOnce(new Promise<void>((resolve) => { finishSecond = resolve; }));

    change("first");
    expect(session.dirty).toBe(true);
    expect(session.showUnsaved).toBe(false);
    change("second");
    finishFirst();
    await vi.waitFor(() => expect(writeText).toHaveBeenLastCalledWith("C:/task.json", "second"));
    expect(session.dirty).toBe(true);
    expect(session.showUnsaved).toBe(false);
    finishSecond();
    await vi.waitFor(() => expect(session.dirty).toBe(false));
    expect(session.showUnsaved).toBe(false);
  });

  it("写入失败后恢复未保存提示，尚无文件的文档立即显示提示", async () => {
    const session = await createSession("dialog");
    settings.autoSave = true;
    settings.autoSaveWhen = "commit";
    session.load({ doc: "new" }, "");
    session.commit({ doc: "unsaved" });
    await session.autoSave();
    expect(session.showUnsaved).toBe(true);
    expect(writeText).not.toHaveBeenCalled();

    session.load({ doc: "before" }, "dialog.json", "C:/dialog.json");
    writeText.mockRejectedValueOnce(new Error("无法写入"));
    session.commit({ doc: "changed" });
    void session.autoSave();
    expect(session.showUnsaved).toBe(false);
    await vi.waitFor(() => expect(session.showUnsaved).toBe(true));
    expect(session.dirty).toBe(true);
  });
});
