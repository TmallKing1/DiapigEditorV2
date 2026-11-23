// 游戏结构体 JSON 的读写。外层包装沿用旧编辑器（GIVariableUtils）：
//   结构体   {structId, type:"Struct", value:[字段...]}
//   字段     {param_type, value}，Int32 / Float / Bool 的 value 是字符串
//   结构体列表 {param_type:"StructList", value:{structId, value:[{param_type:"Struct", value:结构体}]}}
// 对话节点 v1：#6 副标题? Bool，#7 副标题，#8 内容 StringList
// 对话节点 v2：#6 副标题，#7 内容 String，#8 显示模式 Int32
// 对话结构体：#0 节点列表、#1 开始节点；新结构多一个 #2 起止设置（结构体「对话起止设置」，2026-11-16），
//   嵌套结构体字段 {param_type:"Struct", value:{structId, type:"Struct", value:[字段...]}}
import { withInheritedTitles } from "./inheritTitles";
import { beginEndForExport, type BeginEnd, type DialogBranch, type DialogDoc, type DialogNode, newUid } from "./types";

export type Json = Record<string, any>;

export class FormatError extends Error {}

export function fail(msg: string): never {
  throw new FormatError(msg);
}

export function field(arr: unknown, i: number): Json {
  if (!Array.isArray(arr) || arr[i] === null || typeof arr[i] !== "object") {
    fail(`缺少第 ${i} 个字段`);
  }
  return arr[i];
}

// 与旧编辑器一致：类型不符时取默认值，不报错
export function rInt(arr: unknown, i: number): number {
  const f = field(arr, i);
  const n = f.param_type === "Int32" ? parseInt(String(f.value), 10) : 0;
  return Number.isFinite(n) ? n : 0;
}
export function rFloat(arr: unknown, i: number): number {
  const f = field(arr, i);
  const ok = f.param_type === "Float" || f.param_type === "Int32";
  const n = ok ? parseFloat(String(f.value)) : 0;
  return Number.isFinite(n) ? n : 0;
}
export function rString(arr: unknown, i: number): string {
  const f = field(arr, i);
  return f.param_type === "String" ? String(f.value ?? "") : "";
}
function rBool(arr: unknown, i: number): boolean {
  const f = field(arr, i);
  return f.param_type === "Bool" && String(f.value) === "True";
}
function rStringList(arr: unknown, i: number): string[] {
  const f = field(arr, i);
  return f.param_type === "StringList" && Array.isArray(f.value) ? f.value.map(String) : [];
}
export function rStructList(f: Json): { structId: string; items: unknown[][] } {
  if (f.param_type !== "StructList" || !f.value || !Array.isArray(f.value.value)) {
    fail("结构体列表格式错误");
  }
  const items = (f.value.value as Json[]).map((item) => {
    const inner = item?.value;
    if (item?.param_type !== "Struct" || inner?.type !== "Struct" || !Array.isArray(inner.value)) {
      fail("结构体列表元素格式错误");
    }
    return inner.value as unknown[];
  });
  return { structId: String(f.value.structId ?? "0"), items };
}

/** 嵌套的结构体字段 → {structId, 字段数组} */
export function rStruct(f: Json): { structId: string; fields: unknown[] } {
  const inner = f.value;
  if (f.param_type !== "Struct" || inner?.type !== "Struct" || !Array.isArray(inner.value)) {
    fail("结构体字段格式错误");
  }
  return { structId: String(inner.structId ?? "0"), fields: inner.value as unknown[] };
}

export const wInt = (v: number) => ({ param_type: "Int32", value: String(Math.trunc(v)) });
export const wFloat = (v: number) => ({ param_type: "Float", value: formatFloat(v) });
export const wString = (v: string) => ({ param_type: "String", value: v });
const wBool = (v: boolean) => ({ param_type: "Bool", value: v ? "True" : "False" });
export function wStruct(structId: string, value: unknown[]) {
  return { param_type: "Struct", value: { structId, type: "Struct", value } };
}
export function wStructList(structId: string, items: unknown[][]) {
  return {
    param_type: "StructList",
    value: {
      structId,
      value: items.map((value) => ({
        param_type: "Struct",
        value: { structId, type: "Struct", value },
      })),
    },
  };
}

/** 与 Java 的 String.valueOf(float) 一致：整数带 “.0” */
export function formatFloat(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Number.isInteger(r) ? r.toFixed(1) : String(r);
}

function readBranch(arr: unknown[]): DialogBranch {
  return { title: rString(arr, 0), jump: rInt(arr, 1) };
}

function readNode(arr: unknown[]): { node: DialogNode; branchId: string; v1: boolean } {
  const branches = rStructList(field(arr, 2));
  const v1 = field(arr, 6).param_type === "Bool";
  let subtitle: string;
  let content: string;
  let textMode: number;
  if (v1) {
    subtitle = rBool(arr, 6) ? rString(arr, 7) : "";
    const list = rStringList(arr, 8);
    content = list.join("");
    textMode = list.length > 1 ? 1 : 0;
  } else {
    subtitle = rString(arr, 6);
    content = rString(arr, 7);
    textMode = rInt(arr, 8);
    if (textMode < 0 || textMode > 3) textMode = 0;
  }
  let op = rInt(arr, 0);
  if (op < 0 || op > 3) op = 0;
  const node: DialogNode = {
    uid: newUid(),
    op,
    jump: rInt(arr, 1),
    branches: branches.items.map(readBranch),
    defaultBranch: rInt(arr, 3),
    inheritTitle: rBool(arr, 4),
    title: rString(arr, 5),
    subtitle,
    content,
    textMode,
    enterEvent: rString(arr, 9),
    leaveEvent: rString(arr, 10),
    duration: rFloat(arr, 11),
  };
  return { node, branchId: branches.structId, v1 };
}

export interface ReadResult {
  doc: DialogDoc;
  /** 文件里是否含旧版（v1）节点，已在读取时转换 */
  convertedFromV1: boolean;
}

export function readDialog(json: unknown): ReadResult {
  const root = json as Json;
  if (!root || typeof root !== "object" || root.type !== "Struct" || !Array.isArray(root.value)) {
    fail("不是对话结构体文件");
  }
  const list = rStructList(field(root.value, 0));
  let branchId = "0";
  let convertedFromV1 = false;
  const nodes = list.items.map((arr, i) => {
    const r = readNode(arr);
    if (i === 0) branchId = r.branchId;
    convertedFromV1 = convertedFromV1 || r.v1;
    return r.node;
  });
  const doc: DialogDoc = {
    ids: { dialog: String(root.structId ?? "0"), node: list.structId, branch: branchId },
    nodes,
    startNode: rInt(root.value, 1),
  };
  // 新结构：第 2 个字段是「对话起止设置」；没有这个字段就是旧结构，写出时也保持旧结构
  if (root.value.length > 2) {
    const s = rStruct(field(root.value, 2));
    doc.ids.beginEnd = s.structId;
    doc.beginEnd = readBeginEnd(s.fields);
  }
  return { doc, convertedFromV1 };
}

function readBeginEnd(arr: unknown[]): BeginEnd {
  return {
    enterTime: Math.max(rFloat(arr, 0), 0),
    enterEvent: rString(arr, 1),
    leaveTime: Math.max(rFloat(arr, 2), 0),
    leaveEvent: rString(arr, 3),
  };
}

export function parseDialog(text: string): ReadResult {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    fail("不是有效的 JSON");
  }
  return readDialog(json);
}

function writeNode(node: DialogNode, branchId: string): unknown[] {
  return [
    wInt(node.op),
    wInt(node.jump),
    wStructList(
      branchId,
      node.branches.map((b) => [wString(b.title), wInt(b.jump)]),
    ),
    wInt(node.defaultBranch),
    wBool(node.inheritTitle),
    wString(node.title),
    wString(node.subtitle),
    wString(node.content),
    wInt(node.textMode),
    wString(node.enterEvent),
    wString(node.leaveEvent),
    wFloat(node.duration),
  ];
}

/** 写出时补全继承标题节点的标题 / 副标题（供断线重连后显示，见 inheritTitles.ts） */
export function writeDialog(input: DialogDoc): Json {
  const doc = withInheritedTitles(input);
  const value: unknown[] = [
    wStructList(
      doc.ids.node,
      doc.nodes.map((n) => writeNode(n, doc.ids.branch)),
    ),
    wInt(doc.startNode),
  ];
  if (doc.beginEnd) {
    const be = beginEndForExport(doc.beginEnd);
    value.push(
      wStruct(doc.ids.beginEnd ?? "0", [wFloat(be.enterTime), wString(be.enterEvent), wFloat(be.leaveTime), wString(be.leaveEvent)]),
    );
  }
  return { structId: doc.ids.dialog, type: "Struct", value };
}

export function stringifyDialog(doc: DialogDoc): string {
  return JSON.stringify(writeDialog(doc), null, 2);
}
