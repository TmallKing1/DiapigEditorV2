// 新建文件时的结构体 ID：设置里填了的项用设置的值，没填的沿用当前打开的文件（都没有时为 "0"）。
import { fail, parseDialog } from "./codec";
import { taskIdsReady, type TaskIds } from "./task";
import { detectKind, parseTaskChain, type FileKind } from "./taskCodec";
import { idsReady, type StructIds } from "./types";

/** 设置里的默认结构体 ID；空串 = 没填 */
export interface DefaultIds {
  dialog: string;
  node: string;
  branch: string;
  beginEnd: string;
  chain: string;
  task: string;
}

const pick = (preset: string, cur: string | undefined) => preset.trim() || cur || "0";

/**
 * 新对话的结构体 ID 与结构。cur = 当前打开的对话（没有为 undefined）。
 * 有没有起止设置：设置里填了起止设置 ID 时用新结构；否则沿用当前对话的结构，没有打开的对话时用新结构。
 */
export function newDialogIds(
  preset: DefaultIds,
  cur?: { ids: StructIds; withBeginEnd: boolean },
): { ids: StructIds; withBeginEnd: boolean } {
  const withBeginEnd = preset.beginEnd.trim() !== "" || (cur ? cur.withBeginEnd : true);
  const ids: StructIds = {
    dialog: pick(preset.dialog, cur?.ids.dialog),
    node: pick(preset.node, cur?.ids.node),
    branch: pick(preset.branch, cur?.ids.branch),
  };
  if (withBeginEnd) ids.beginEnd = pick(preset.beginEnd, cur?.ids.beginEnd);
  return { ids, withBeginEnd };
}

export function newTaskIds(preset: DefaultIds, cur?: TaskIds): TaskIds {
  return { chain: pick(preset.chain, cur?.chain), task: pick(preset.task, cur?.task) };
}

/** 「从文件导入」：从对话或任务文件的结构体 ID 里取出要填入设置的项（"0" 和空的不填） */
export function idsFromFile(kind: "dialog", ids: StructIds): Partial<StructIds>;
export function idsFromFile(kind: "task", ids: TaskIds): Partial<TaskIds>;
export function idsFromFile(kind: FileKind, ids: Partial<DefaultIds>): Partial<DefaultIds> {
  const keys = kind === "dialog" ? (["dialog", "node", "branch", "beginEnd"] as const) : (["chain", "task"] as const);
  const out: Partial<DefaultIds> = {};
  for (const key of keys) {
    const id = ids[key]?.trim();
    if (id && id !== "0") out[key] = id;
  }
  return out;
}

/** 全局设置可导入部分 ID；覆盖当前文件时须同类型且提供完整的 ID。 */
export function readStructIds(file: { name: string; text: string }, expected?: FileKind): Partial<DefaultIds> {
  const kind = detectKind(file.text);
  if (!kind) fail(`${file.name} 不是对话或任务文件`);
  if (expected && kind !== expected) {
    fail(`${file.name} 不是${expected === "dialog" ? "对话" : "任务链"}文件`);
  }
  if (kind === "dialog") {
    const { doc, convertedFromV1 } = parseDialog(file.text);
    if (expected && (!idsReady(doc.ids, true) || convertedFromV1)) {
      fail(`${file.name} 未提供完整的新版对话结构体 ID`);
    }
    return idsFromFile("dialog", doc.ids);
  }
  const { ids } = parseTaskChain(file.text);
  if (expected && !taskIdsReady(ids)) fail(`${file.name} 的任务链结构体 ID 未填全`);
  return idsFromFile("task", ids);
}
