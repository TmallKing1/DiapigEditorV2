import example from "./fixtures/example_task_chain.json?raw";
import { describe, expect, it } from "vitest";
import { stringifyDialog } from "./codec";
import {
  MARKER_POINT,
  type TaskEditState,
  type TaskItem,
  addTaskAfter,
  duplicateTask,
  moveTask,
  newTask,
  newTaskDoc,
  pasteTaskOver,
  removeTask,
  taskIdsReady,
} from "./task";
import { detectKind, parseTaskChain, readTaskChain, stringifyTaskChain, writeTaskChain } from "./taskCodec";
import { newDoc } from "./types";


const strip = (tasks: TaskItem[]) => tasks.map(({ uid: _uid, ...rest }) => rest);

describe("任务链读写", () => {
  it("兼容读出旧版游戏导出（自动剥离旧任务编号与缺失事件字段）", () => {
    const doc = parseTaskChain(example);
    expect(doc.ids).toEqual({ chain: "1077936137", task: "1077936136" });
    expect(doc.name).toBe("抓老鼠");
    expect(strip(doc.tasks)).toEqual([
      {
        name: "抓住出生点的老鼠",
        hint: "移动到出生点，即可抓老鼠",
        point: 1073741825,
        marker: MARKER_POINT,
        markerRange: 0,
        detect: 0,
        auto: 3,
        optional: "吃一个面包，补充能量",
        enterEvent: "",
      },
    ]);
    // 示例是 2026-11-19 之前导出的，没有两个事件字段：读成空串
    expect(doc.completeEvent).toBe("");
  });

  it("事件字段写出再读回，位置在结构体末尾（新版 9 字段）", () => {
    const doc = parseTaskChain(example);
    doc.completeEvent = "链完成:抓老鼠";
    doc.tasks[0].enterEvent = "进入:抓老鼠";
    const json = writeTaskChain(doc) as any;
    expect(json.value.map((f: any) => f.param_type)).toEqual(["String", "StructList", "String"]);
    expect(json.value[2].value).toBe("链完成:抓老鼠");
    expect(json.value[1].value.value[0].value.value[8]).toEqual({ param_type: "String", value: "进入:抓老鼠" });
    const again = parseTaskChain(JSON.stringify(json));
    expect(again.completeEvent).toBe("链完成:抓老鼠");
    expect(again.tasks[0].enterEvent).toBe("进入:抓老鼠");
  });

  it("写出再读回不变，字段类型为新版 9 字段", () => {
    const doc = parseTaskChain(example);
    const json = writeTaskChain(doc) as any;
    const again = parseTaskChain(JSON.stringify(json));
    expect(again.ids).toEqual(doc.ids);
    expect(again.name).toBe(doc.name);
    expect(strip(again.tasks)).toEqual(strip(doc.tasks));
    const types = (j: any) => j.value[1].value.value[0].value.value.map((f: any) => f.param_type);
    expect(types(json)).toEqual(["String", "String", "Int32", "Int32", "Int32", "Float", "Float", "String", "String"]);
    expect(json.value[1].value.value[0].value.structId).toBe("1077936136");
  });

  it("不是任务链时报错", () => {
    expect(() => parseTaskChain("{")).toThrow("不是有效的 JSON");
    expect(() => parseTaskChain(stringifyDialog(newDoc({ dialog: "1", node: "2", branch: "3" })))).toThrow("不是任务链");
    expect(() => readTaskChain({ type: "Struct", value: [] })).toThrow();
  });
});

describe("文件种类识别", () => {
  it("对话 / 任务 / 其他", () => {
    expect(detectKind(example)).toBe("task");
    expect(detectKind(stringifyDialog(newDoc()))).toBe("dialog");
    expect(detectKind("not json")).toBeNull();
    expect(detectKind('{"type":"Struct","value":[{"param_type":"Int32","value":"1"}]}')).toBeNull();
    expect(detectKind("﻿" + example)).toBe("task");
  });
});

describe("任务列表", () => {
  const state = (names: string[]): TaskEditState => ({
    doc: { ...newTaskDoc(), tasks: names.map((name) => ({ ...newTask(), name })) },
    clipboard: null,
  });

  it("添加、复制；删除保留最后一个；移动；粘贴保留 uid", () => {
    let s = addTaskAfter(state(["A", "B"]), 0);
    expect(s.doc.tasks.map((t) => t.name)).toEqual(["A", "新任务", "B"]);
    s = duplicateTask(s, 2);
    expect(s.doc.tasks.map((t) => t.name)).toEqual(["A", "新任务", "B", "B"]);
    expect(s.doc.tasks[3].uid).not.toBe(s.doc.tasks[2].uid);
    expect(moveTask(s, 3, 0).doc.tasks.map((t) => t.name)).toEqual(["B", "A", "新任务", "B"]);
    expect(moveTask(s, 0, 9)).toBe(s);
    const one = state(["唯一"]);
    expect(removeTask(one, 0)).toBe(one);
    expect(removeTask(s, 1).doc.tasks.map((t) => t.name)).toEqual(["A", "B", "B"]);
    const clip = { ...s, clipboard: { ...s.doc.tasks[0], name: "复制的" } };
    const pasted = pasteTaskOver(clip, 2);
    expect(pasted.doc.tasks[2].name).toBe("复制的");
    expect(pasted.doc.tasks[2].uid).toBe(s.doc.tasks[2].uid);
  });

  it("结构体 ID 都填了才能保存", () => {
    expect(taskIdsReady({ chain: "0", task: "1" })).toBe(false);
    expect(taskIdsReady({ chain: "1077936137", task: "1077936136" })).toBe(true);
  });
});
