import { describe, expect, it } from "vitest";
import { docToDraft, draftToDoc } from "./draft";
import { applyDraftEdits, outline } from "./draftEdit";
import { type DialogDoc, OP_BRANCH, OP_END, OP_JUMP, OP_NEXT } from "./types";

const IDS = { dialog: "11", node: "22", branch: "33" };

/** 0 分支（→1、→3），1 顺序，2 跳转 0，3 结束 */
function base(): DialogDoc {
  const r = draftToDoc(
    {
      nodes: [
        { id: "a", title: "甲", content: "问", choices: [{ text: "下" }, { text: "尾", goto: "d" }] },
        { content: "一" },
        { content: "二", goto: "a" },
        { id: "d", title: "乙", content: "完", leave: "出" },
      ],
    },
    IDS,
  );
  expect(r.errors).toEqual([]);
  return r.doc!;
}

function edit(doc: DialogDoc, ops: unknown) {
  const edited = applyDraftEdits(docToDraft(doc, { explicit: true }), ops);
  if (!edited.draft) return { doc: null, errors: edited.errors };
  const r = draftToDoc(edited.draft);
  return { doc: r.doc, errors: r.errors };
}

describe("docToDraft 显式模式", () => {
  it("每个节点有 id，分支写 goto，结束写 end，转回不变", () => {
    const doc = base();
    const d = docToDraft(doc, { explicit: true });
    expect(d.nodes.map((n) => n.id)).toEqual(["n0", "n1", "n2", "n3"]);
    expect(d.start).toBe("n0");
    expect(d.nodes[0].choices).toEqual([
      { text: "下", goto: "n1" },
      { text: "尾", goto: "n3" },
    ]);
    expect(d.nodes[3].end).toBe(true);
    const back = draftToDoc(d);
    expect(back.errors).toEqual([]);
    expect(back.doc!.nodes.map(({ uid, ...n }) => n)).toEqual(doc.nodes.map(({ uid, ...n }) => n));
    expect(back.doc!.ids).toEqual(IDS);
  });
});

describe("applyDraftEdits", () => {
  it("set：只改写出的字段，null 删除字段", () => {
    const { doc } = edit(base(), [
      { op: "set", node: "n1", fields: { content: "改", title: "丙", mode: "fade" } },
      { op: "set", node: "n3", fields: { leave: null } },
    ]);
    expect(doc!.nodes[1]).toMatchObject({ content: "改", title: "丙", inheritTitle: false, textMode: 2, op: OP_NEXT });
    expect(doc!.nodes[3].leaveEvent).toBe("");
  });

  it("set：换流程时自动去掉原来的流程字段", () => {
    const { doc } = edit(base(), [
      { op: "set", node: "n0", fields: { goto: "n3" } },
      { op: "set", node: "n3", fields: { choices: [{ text: "回", goto: "n0" }] } },
      { op: "set", node: "n2", fields: { end: true } },
    ]);
    expect(doc!.nodes[0]).toMatchObject({ op: OP_JUMP, jump: 3, branches: [] });
    expect(doc!.nodes[3]).toMatchObject({ op: OP_BRANCH, branches: [{ title: "回", jump: 0 }] });
    expect(doc!.nodes[2].op).toBe(OP_END);
  });

  it("insert：后面的引用跟着移动，新节点可用自带 id 互相引用", () => {
    const { doc } = edit(base(), [
      {
        op: "insert",
        after: "n0",
        nodes: [
          { id: "x", content: "新一", goto: "y" },
          { id: "y", content: "新二" },
        ],
      },
      { op: "set", node: "n0", fields: { choices: [{ text: "新", goto: "x" }, { text: "尾", goto: "n3" }] } },
    ]);
    expect(doc!.nodes.map((n) => n.content)).toEqual(["问", "新一", "新二", "一", "二", "完"]);
    expect(doc!.nodes[0].branches).toEqual([
      { title: "新", jump: 1 },
      { title: "尾", jump: 5 },
    ]);
    expect(doc!.nodes[1]).toMatchObject({ op: OP_JUMP, jump: 2 });
    expect(doc!.nodes[2].op).toBe(OP_NEXT);
    expect(doc!.nodes[4]).toMatchObject({ op: OP_JUMP, jump: 0 });
  });

  it("insert 到末尾：原来的结束节点仍然结束，除非把 end 去掉", () => {
    const kept = edit(base(), [{ op: "insert", nodes: [{ content: "附" }] }]);
    expect(kept.doc!.nodes.map((n) => n.op)).toEqual([OP_BRANCH, OP_NEXT, OP_JUMP, OP_END, OP_END]);
    const chained = edit(base(), [
      { op: "insert", nodes: [{ content: "附" }] },
      { op: "set", node: "n3", fields: { end: null } },
    ]);
    expect(chained.doc!.nodes.map((n) => n.op)).toEqual([OP_BRANCH, OP_NEXT, OP_JUMP, OP_NEXT, OP_END]);
  });

  it("remove：仍被引用时报错；先改掉引用就可以", () => {
    const bad = edit(base(), [{ op: "remove", node: "n3" }]);
    expect(bad.doc).toBeNull();
    expect(bad.errors.join()).toContain('找不到 id 为 "n3" 的节点');
    const good = edit(base(), [
      { op: "set", node: "n0", fields: { choices: [{ text: "下", goto: "n1" }] } },
      { op: "remove", node: "n3" },
    ]);
    expect(good.doc!.nodes).toHaveLength(3);
    expect(good.doc!.nodes[2]).toMatchObject({ op: OP_JUMP, jump: 0 });
  });

  it("move 与 start：引用跟着节点走", () => {
    const { doc } = edit(base(), [
      { op: "move", node: "n3", before: "n0" },
      { op: "start", node: "n0" },
    ]);
    expect(doc!.nodes.map((n) => n.content)).toEqual(["完", "问", "一", "二"]);
    expect(doc!.startNode).toBe(1);
    expect(doc!.nodes[1].branches).toEqual([
      { title: "下", jump: 2 },
      { title: "尾", jump: 0 },
    ]);
    expect(doc!.nodes[3]).toMatchObject({ op: OP_JUMP, jump: 1 });
  });

  it("操作本身有误时报错，不返回草稿", () => {
    const r = applyDraftEdits(docToDraft(base(), { explicit: true }), [
      { op: "set", node: 1, fields: {} },
      { op: "set", node: "没有", fields: {} },
      { op: "set", node: "n0" },
      { op: "insert", nodes: [] },
      { op: "insert", nodes: [{ content: "x" }], after: "n0", before: "n1" },
      { op: "move", node: "n0" },
      { op: "move", node: "n0", after: "n0" },
      { op: "fly" },
      "不是对象",
    ]);
    expect(r.draft).toBeNull();
    const all = r.errors.join("\n");
    for (const part of [
      "应写节点的 id",
      '找不到 id 为 "没有" 的节点',
      "fields 应是对象",
      "nodes 应是非空的节点数组",
      "after 和 before 只能写一个",
      "要写 after 或 before",
      "不能相对自己移动",
      "op 应是 set / insert / remove / move / start",
      "操作 8：应是对象",
    ]) {
      expect(all).toContain(part);
    }
    expect(applyDraftEdits(docToDraft(base()), []).errors).toEqual(["ops 应是非空数组"]);
  });

  it("不改动传入的草稿", () => {
    const d = docToDraft(base(), { explicit: true });
    const before = JSON.stringify(d);
    applyDraftEdits(d, [
      { op: "set", node: "n0", fields: { content: "改" } },
      { op: "remove", node: "n1" },
    ]);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe("outline", () => {
  it("每个节点一行", () => {
    expect(outline(base()).split("\n")).toEqual([
      "n0（开始） 甲：问 ⇒ 分支 下→n1，尾→n3",
      "n1 （沿用标题）：一 ⇒ 下一个",
      "n2 （沿用标题）：二 ⇒ 跳转 n0",
      "n3 乙：完 ⇒ 结束",
    ]);
  });
});
