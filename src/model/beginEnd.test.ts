import { describe, expect, it } from "vitest";
import { parseDialog, stringifyDialog } from "./codec";
import { blackoutLines, docToDraft, draftToDoc } from "./draft";
import { blackoutEnabled, type DialogDoc, docReady, newDoc } from "./types";

// 与 Desktop\Diapig\dialog_struct_definition_v2_1.json 的实例格式一致（浮点写成 "0.00"）
const NEW_FILE = JSON.stringify({
  structId: "1077936135",
  type: "Struct",
  value: [
    { param_type: "StructList", value: { structId: "1077936133", value: [] } },
    { param_type: "Int32", value: "0" },
    {
      param_type: "Struct",
      value: {
        structId: "1077936139",
        type: "Struct",
        value: [
          { param_type: "Float", value: "1.50" },
          { param_type: "String", value: "调整镜头" },
          { param_type: "Float", value: "0.00" },
          { param_type: "String", value: "" },
        ],
      },
    },
  ],
});

function withIds(doc: DialogDoc): DialogDoc {
  return { ...doc, ids: { ...doc.ids, dialog: "1", node: "2", branch: "3" } };
}

describe("对话起止设置（新旧结构）", () => {
  it("读取新结构：起止设置与它的结构体 ID", () => {
    const { doc } = parseDialog(NEW_FILE);
    expect(doc.ids.beginEnd).toBe("1077936139");
    expect(doc.beginEnd).toEqual({ enterTime: 1.5, enterEvent: "调整镜头", leaveTime: 0, leaveEvent: "" });
  });

  it("新结构写出三个字段，读回不变", () => {
    const doc = withIds(newDoc());
    doc.ids.beginEnd = "4";
    doc.beginEnd = { enterTime: 2, enterEvent: "a", leaveTime: 0.5, leaveEvent: "b" };
    const json = JSON.parse(stringifyDialog(doc));
    expect(json.value).toHaveLength(3);
    expect(json.value[2]).toEqual({
      param_type: "Struct",
      value: {
        structId: "4",
        type: "Struct",
        value: [
          { param_type: "Float", value: "2.0" },
          { param_type: "String", value: "a" },
          { param_type: "Float", value: "0.5" },
          { param_type: "String", value: "b" },
        ],
      },
    });
    const back = parseDialog(JSON.stringify(json)).doc;
    expect(back.beginEnd).toEqual(doc.beginEnd);
    expect(back.ids.beginEnd).toBe("4");
  });

  it("旧结构保持两个字段", () => {
    const doc = withIds(newDoc(undefined, false));
    expect(doc.beginEnd).toBeUndefined();
    const json = JSON.parse(stringifyDialog(doc));
    expect(json.value).toHaveLength(2);
    const back = parseDialog(JSON.stringify(json)).doc;
    expect(back.beginEnd).toBeUndefined();
    expect(back.ids.beginEnd).toBeUndefined();
  });

  it("关闭的黑场在导出时清零，重新导入时从实际字段恢复开关", () => {
    const { doc } = parseDialog(NEW_FILE);
    expect(blackoutEnabled(doc.beginEnd, "enter")).toBe(true);
    expect(blackoutEnabled(doc.beginEnd, "leave")).toBe(false);
    doc.beginEnd = { ...doc.beginEnd!, enterEnabled: false, leaveEnabled: true, leaveTime: 0.5, leaveEvent: "离开" };
    const back = parseDialog(stringifyDialog(doc)).doc;
    expect(back.beginEnd).toEqual({ enterTime: 0, enterEvent: "", leaveTime: 0.5, leaveEvent: "离开" });
    expect(doc.beginEnd.enterEvent).toBe("调整镜头");
    expect(blackoutEnabled(back.beginEnd, "enter")).toBe(false);
    expect(blackoutEnabled(back.beginEnd, "leave")).toBe(true);
    expect(docToDraft(doc).blackout).toEqual({ leave: 0.5, leaveEvent: "离开" });
  });

  it("新结构还要填起止设置的 ID 才能保存", () => {
    const doc = withIds(newDoc());
    expect(docReady(doc)).toBe(false);
    doc.ids.beginEnd = "4";
    expect(docReady(doc)).toBe(true);
    expect(docReady(withIds(newDoc(undefined, false)))).toBe(true);
  });

  it("草稿：blackout 往返；ids 带 beginEnd 时即使没写 blackout 也按新结构", () => {
    const doc = withIds(newDoc());
    doc.ids.beginEnd = "4";
    doc.beginEnd = { enterTime: 1, enterEvent: "进", leaveTime: 0, leaveEvent: "" };
    const draft = docToDraft(doc);
    expect(draft.blackout).toEqual({ enter: 1, enterEvent: "进" });
    expect(draftToDoc(draft).doc?.beginEnd).toEqual(doc.beginEnd);

    const plain = draftToDoc({ nodes: [{ content: "x" }] }, { dialog: "1", node: "2", branch: "3", beginEnd: "4" });
    expect(plain.doc?.beginEnd).toEqual({ enterTime: 0, enterEvent: "", leaveTime: 0, leaveEvent: "" });
    expect(draftToDoc({ nodes: [{ content: "x" }] }).doc?.beginEnd).toBeUndefined();
  });

  it("草稿：显式模式保留起止设置，旧结构不写 beginEnd", () => {
    const doc = withIds(newDoc());
    doc.ids.beginEnd = "4";
    const d = docToDraft(doc, { explicit: true });
    expect(d.blackout).toEqual({ enter: 0, leave: 0 });
    expect(d.ids?.beginEnd).toBe("4");
    expect(docToDraft(withIds(newDoc(undefined, false))).ids).not.toHaveProperty("beginEnd");
  });

  it("草稿：blackout 的错误", () => {
    const r = draftToDoc({ blackout: { enter: -1, bogus: 1 }, nodes: [{ content: "x" }] });
    expect(r.doc).toBeNull();
    expect(r.errors.join("\n")).toMatch(/blackout\.enter/);
    expect(r.errors.join("\n")).toMatch(/bogus/);
  });

  it("概览行", () => {
    const doc = newDoc();
    expect(blackoutLines(doc)).toEqual(["起止黑场：无"]);
    doc.beginEnd = { enterTime: 1, enterEvent: "e", leaveTime: 0, leaveEvent: "x" };
    expect(blackoutLines(doc)[0]).toBe("起止黑场（只用于锁定对话）：开始前 全黑停留 1 秒，事件「e」；结束后 无");
    expect(blackoutLines(newDoc(undefined, false))).toEqual([]);
  });
});
