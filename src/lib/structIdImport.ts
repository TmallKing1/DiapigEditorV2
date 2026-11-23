import { readStructIds } from "../model/defaultIds";
import type { FileKind } from "../model/taskCodec";
import { openJson } from "./files";
import { toast } from "./ui.svelte";

export async function pickStructIds(expected?: FileKind) {
  try {
    const title = expected === "dialog" ? "选择对话 JSON 文件" : expected === "task" ? "选择任务链 JSON 文件" : undefined;
    const file = await openJson(title);
    if (!file) return null;
    return { name: file.name, ids: readStructIds(file, expected) };
  } catch (e) {
    toast(`读取失败：${e instanceof Error ? e.message : String(e)}`, "error");
    return null;
  }
}
