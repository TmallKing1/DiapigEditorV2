// 任务链结构体 JSON 的读写，外层包装与对话相同（见 codec.ts）。
//   任务链 {structId, type:"Struct", value:[String 名称, StructList 任务列表, String 任务完成事件]}
//   任务   [Int32 任务编号, String 名称, String 提示, Int32 任务点位, Int32 标点类型, Int32 标点范围m,
//           Float 检测范围m, Float 自动推进范围m, String 可选任务, String 进入任务事件]
// 两个事件字段是 2026-11-19 新增的：旧文件没有它们时读成空串，写出时总是带上。
import {
  type Json,
  fail,
  field,
  rFloat,
  rInt,
  rString,
  rStructList,
  wFloat,
  wInt,
  wString,
  wStructList,
} from "./codec";
import { MARKER_NONE, MARKER_RANGE, type TaskDoc, type TaskItem } from "./task";
import { newUid } from "./types";

export type FileKind = "dialog" | "task";

/** 可能不存在的字符串字段（旧版结构体没有）：缺少时为空串 */
function rStringOpt(arr: unknown[], i: number): string {
  return arr[i] == null ? "" : rString(arr, i);
}

function readTask(arr: unknown[]): TaskItem {
  let marker = rInt(arr, 4);
  if (marker < MARKER_NONE || marker > MARKER_RANGE) marker = MARKER_NONE;
  return {
    uid: newUid(),
    id: rInt(arr, 0),
    name: rString(arr, 1),
    hint: rString(arr, 2),
    point: rInt(arr, 3),
    marker,
    markerRange: rInt(arr, 5),
    detect: rFloat(arr, 6),
    auto: rFloat(arr, 7),
    optional: rString(arr, 8),
    enterEvent: rStringOpt(arr, 9),
  };
}

export function readTaskChain(json: unknown): TaskDoc {
  const root = json as Json;
  if (!root || typeof root !== "object" || root.type !== "Struct" || !Array.isArray(root.value)) {
    fail("不是任务链结构体文件");
  }
  if (field(root.value, 0).param_type !== "String") fail("不是任务链结构体文件");
  const list = rStructList(field(root.value, 1));
  return {
    ids: { chain: String(root.structId ?? "0"), task: list.structId },
    name: rString(root.value, 0),
    tasks: list.items.map(readTask),
    completeEvent: rStringOpt(root.value, 2),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return fail("不是有效的 JSON");
  }
}

export function parseTaskChain(text: string): TaskDoc {
  return readTaskChain(parseJson(text));
}

function writeTask(t: TaskItem): unknown[] {
  return [
    wInt(t.id),
    wString(t.name),
    wString(t.hint),
    wInt(t.point),
    wInt(t.marker),
    wInt(t.markerRange),
    wFloat(t.detect),
    wFloat(t.auto),
    wString(t.optional),
    wString(t.enterEvent),
  ];
}

export function writeTaskChain(doc: TaskDoc): Json {
  return {
    structId: doc.ids.chain,
    type: "Struct",
    value: [wString(doc.name), wStructList(doc.ids.task, doc.tasks.map(writeTask)), wString(doc.completeEvent)],
  };
}

export function stringifyTaskChain(doc: TaskDoc): string {
  return JSON.stringify(writeTaskChain(doc), null, 2);
}

/** 按根结构体的形状识别文件种类：第 0 个字段是结构体列表 → 对话；是字符串且第 1 个是结构体列表 → 任务链 */
export function detectKind(text: string): FileKind | null {
  let root: Json;
  try {
    root = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return null;
  }
  if (!root || typeof root !== "object" || root.type !== "Struct" || !Array.isArray(root.value)) return null;
  const a = root.value[0]?.param_type;
  const b = root.value[1]?.param_type;
  if (a === "StructList") return "dialog";
  if (a === "String" && b === "StructList") return "task";
  return null;
}
