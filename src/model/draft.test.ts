import { describe, expect, it } from "vitest";
import { parseDialog, stringifyDialog } from "./codec";
import { docToDraft, draftToDoc, eventNames } from "./draft";
import { type DialogDoc, OP_BRANCH, OP_END, OP_JUMP, OP_NEXT } from "./types";

const IDS = { dialog: "11", node: "22", branch: "33" };

function ok(draft: unknown, ids = IDS): DialogDoc {
  const r = draftToDoc(draft, ids);
  expect(r.errors).toEqual([]);
  return r.doc!;
}

function strip(d: DialogDoc) {
  return { ...d, nodes: d.nodes.map(({ uid, ...rest }) => rest) };
}

describe("draftToDoc", () => {
  it("默认流程：顺序往下，最后一个节点结束", () => {
    const doc = ok({ nodes: [{ title: "甲", content: "一" }, { content: "二" }, { content: "三" }] });
    expect(doc.nodes.map((n) => n.op)).toEqual([OP_NEXT, OP_NEXT, OP_END]);
    expect(doc.startNode).toBe(0);
    expect(doc.ids).toEqual(IDS);
  });

  it("省略 title 即沿用上一节点标题", () => {
    const doc = ok({ nodes: [{ title: "甲", subtitle: "乙", content: "一" }, { content: "二" }] });
    expect(doc.nodes[0]).toMatchObject({ inheritTitle: false, title: "甲", subtitle: "乙" });
    expect(doc.nodes[1]).toMatchObject({ inheritTitle: true, title: "", subtitle: "" });
  });

  it("goto / choices / start 用 id 或序号引用，可指向后面的节点", () => {
    const doc = ok({
      start: "问",
      nodes: [
        { id: "尾", title: "甲", content: "完", end: true },
        {
          id: "问",
          title: "甲",
          content: "选",
          choices: [{ text: "去尾", goto: "尾" }, { text: "往下" }, { text: "序号", goto: 3 }],
          default: 1,
        },
        { content: "中", goto: "尾" },
        { content: "末" },
      ],
    });
    expect(doc.startNode).toBe(1);
    expect(doc.nodes[0].op).toBe(OP_END);
    expect(doc.nodes[1].op).toBe(OP_BRANCH);
    expect(doc.nodes[1].branches).toEqual([
      { title: "去尾", jump: 0 },
      { title: "往下", jump: 2 },
      { title: "序号", jump: 3 },
    ]);
    expect(doc.nodes[1].defaultBranch).toBe(1);
    expect(doc.nodes[2]).toMatchObject({ op: OP_JUMP, jump: 0 });
  });

  it("内容：真实换行与数组都换成字面量 \\n，已写成字面量的保持不变", () => {
    const doc = ok({
      nodes: [
        { title: "甲", content: "一\n二\r\n三" },
        { content: ["一", "二"] },
        { content: "一\\n二" },
      ],
    });
    expect(doc.nodes.map((n) => n.content)).toEqual(["一\\n二\\n三", "一\\n二", "一\\n二"]);
  });

  it("显示模式、事件、时长", () => {
    const doc = ok({
      nodes: [
        { title: "甲", content: "一", mode: "fade", enter: "进", leave: "出", duration: 2.5 },
        { content: "二", mode: 3, leave: "出" },
      ],
    });
    expect(doc.nodes[0]).toMatchObject({ textMode: 2, enterEvent: "进", leaveEvent: "出", duration: 2.5 });
    expect(doc.nodes[1].textMode).toBe(3);
    expect(eventNames(doc)).toEqual(["进", "出"]);
  });

  it("草稿里的 ids 优先于外部带入的", () => {
    const doc = ok({ ids: { dialog: 7 }, nodes: [{ title: "甲", content: "一" }] });
    expect(doc.ids).toEqual({ dialog: "7", node: "22", branch: "33" });
  });

  it("报错：未知字段、重复 id、找不到的引用、越界序号、流程冲突", () => {
    const r = draftToDoc({
      extra: 1,
      nodes: [
        { id: "a", title: "甲", content: "一", text: "错字段" },
        { id: "a", content: "二", goto: "不存在" },
        { content: "三", goto: 99 },
        { content: "四", goto: 0, end: true },
        { content: "五", choices: [] },
        { content: "六", choices: [{ text: "x" }], default: 2 },
        { content: "七", default: 0 },
        { content: 8 },
        { content: "九", mode: "slow", duration: -1 },
        { content: "十", subtitle: "只有副标题" },
        { content: "末", choices: [{ text: "没有 goto" }] },
      ],
    });
    expect(r.doc).toBeNull();
    const all = r.errors.join("\n");
    for (const part of [
      '顶层有未知字段 "extra"',
      '未知字段 "text"',
      'id "a" 与节点 0 重复',
      '找不到 id 为 "不存在" 的节点',
      "节点序号 99 超出范围",
      "goto、end 只能写一个",
      "choices 应是非空数组",
      "default 应是分支下标",
      "default 只能和 choices 一起用",
      "content 应是字符串或字符串数组",
      "mode 应是",
      "duration 应是不小于 0 的秒数",
      "不能再单独写 subtitle",
      "最后一个节点的分支必须写 goto",
    ]) {
      expect(all).toContain(part);
    }
  });

  it("警告：分支超过 4 个、富文本标签、走不到的节点、ID 未填", () => {
    const r = draftToDoc({
      nodes: [
        {
          title: "甲",
          content: "<color=#FFF>没闭合",
          choices: ["1", "2", "3", "4", "5"].map((text) => ({ text, goto: 0 })),
          default: 4,
        },
        { content: "孤立" },
      ],
    });
    expect(r.errors).toEqual([]);
    const all = r.warnings.join("\n");
    for (const part of ["只显示前 4 个", "默认分支 4 不在", "未闭合的 <color>", "走不到的节点：1", "结构体 ID 未填全"]) {
      expect(all).toContain(part);
    }
  });

  it("根不是对象、nodes 为空", () => {
    expect(draftToDoc([]).errors).toHaveLength(1);
    expect(draftToDoc({ nodes: [] }).errors).toEqual(["nodes 应是非空数组"]);
  });
});

describe("docToDraft", () => {
  const draft = {
    ids: IDS,
    start: "n1",
    nodes: [
      { id: "n0", title: "甲", subtitle: "乙", content: ["一", "二"], end: true },
      {
        id: "n1",
        title: "<PLAYER_NAME>",
        content: "选",
        choices: [{ text: "回", goto: "n0" }, { text: "下" }],
        default: 1,
        mode: "typewriter",
        enter: "进",
        duration: 3,
      },
      { content: "三", goto: "n1" },
      { content: "四", leave: "出" },
    ],
  };

  it("草稿 → 对话 → 草稿不变", () => {
    expect(docToDraft(ok(draft))).toEqual(draft);
  });

  it("草稿 → 游戏 JSON → 读回 → 草稿不变", () => {
    const text = stringifyDialog(ok(draft));
    expect(docToDraft(parseDialog(text).doc)).toEqual(draft);
  });

  it("对话 → 草稿 → 对话不变（已清理的对话）", () => {
    const doc = ok(draft);
    expect(strip(ok(docToDraft(doc)))).toEqual(strip(doc));
  });

  it("越界引用保留序号，转回时报错", () => {
    const doc = ok({ nodes: [{ title: "甲", content: "一" }, { content: "二" }] });
    doc.nodes[1] = { ...doc.nodes[1], op: OP_JUMP, jump: 5 };
    const d = docToDraft(doc);
    expect(d.nodes[1].goto).toBe(5);
    expect(draftToDoc(d).errors.join()).toContain("节点序号 5 超出范围");
  });
});
