import { describe, expect, it } from "vitest";
import { stringifyDialog } from "./codec";
import { type DefaultIds, idsFromFile, newDialogIds, newTaskIds, readStructIds } from "./defaultIds";
import { newTaskDoc } from "./task";
import { stringifyTaskChain } from "./taskCodec";
import { newDoc } from "./types";

const empty: DefaultIds = { dialog: "", node: "", branch: "", beginEnd: "", chain: "", task: "" };

describe("默认结构体 ID", () => {
  it("没有设置也没有打开的文件：全为 0，新结构", () => {
    expect(newDialogIds(empty)).toEqual({ ids: { dialog: "0", node: "0", branch: "0", beginEnd: "0" }, withBeginEnd: true });
    expect(newTaskIds(empty)).toEqual({ chain: "0", task: "0" });
  });

  it("没有设置：沿用当前文件的 ID 和结构", () => {
    const cur = { ids: { dialog: "1", node: "2", branch: "3" }, withBeginEnd: false };
    expect(newDialogIds(empty, cur)).toEqual({ ids: { dialog: "1", node: "2", branch: "3" }, withBeginEnd: false });
    expect(newTaskIds(empty, { chain: "7", task: "8" })).toEqual({ chain: "7", task: "8" });
  });

  it("填了的项用设置的值，其余沿用当前文件", () => {
    const cur = { ids: { dialog: "1", node: "2", branch: "3", beginEnd: "4" }, withBeginEnd: true };
    const preset = { ...empty, dialog: " 11 ", beginEnd: "44", task: "88" };
    expect(newDialogIds(preset, cur)).toEqual({ ids: { dialog: "11", node: "2", branch: "3", beginEnd: "44" }, withBeginEnd: true });
    expect(newTaskIds(preset, { chain: "7", task: "8" })).toEqual({ chain: "7", task: "88" });
  });

  it("填了起止设置 ID 时，即使当前对话是旧结构也用新结构", () => {
    const cur = { ids: { dialog: "1", node: "2", branch: "3" }, withBeginEnd: false };
    expect(newDialogIds({ ...empty, beginEnd: "44" }, cur).withBeginEnd).toBe(true);
  });

  it("从文件取 ID：跳过空的和 0", () => {
    expect(idsFromFile("dialog", { dialog: "1", node: "0", branch: "3" })).toEqual({ dialog: "1", branch: "3" });
    expect(idsFromFile("task", { chain: "7", task: "" })).toEqual({ chain: "7" });
  });

  it("覆盖当前文件时只接受同类型文件，并读出完整的 ID", () => {
    const dialog = { dialog: "11", node: "22", branch: "33", beginEnd: "44" };
    const task = { chain: "55", task: "66" };
    const dialogFile = { name: "dialog.json", text: stringifyDialog(newDoc(dialog)) };
    const taskFile = { name: "task.json", text: stringifyTaskChain(newTaskDoc(task)) };
    expect(readStructIds(dialogFile, "dialog")).toEqual(dialog);
    expect(readStructIds(taskFile, "task")).toEqual(task);
    expect(() => readStructIds(dialogFile, "task")).toThrow("不是任务链文件");
    expect(() => readStructIds(taskFile, "dialog")).toThrow("不是对话文件");
  });

  it("覆盖拒绝格式错误和缺少 ID 的文件，全局设置仍能读入部分 ID", () => {
    const legacy = { dialog: "11", node: "22", branch: "33" };
    const oldDialog = { name: "old.json", text: stringifyDialog(newDoc(legacy, false)) };
    const incompleteTask = { name: "task.json", text: stringifyTaskChain(newTaskDoc({ chain: "55", task: "0" })) };
    expect(() => readStructIds(oldDialog, "dialog")).toThrow("未提供完整");
    expect(() => readStructIds(incompleteTask, "task")).toThrow("ID 未填全");
    expect(() => readStructIds({ name: "bad.json", text: "{" }, "dialog")).toThrow("不是对话或任务文件");
    expect(readStructIds(oldDialog)).toEqual(legacy);
    expect(readStructIds(incompleteTask)).toEqual({ chain: "55" });
  });
});
