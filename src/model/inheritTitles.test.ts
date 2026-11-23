import { describe, expect, it } from "vitest";
import { parseDialog, stringifyDialog } from "./codec";
import { draftToDoc } from "./draft";
import { inheritConflicts, withInheritedTitles } from "./inheritTitles";
import { type DialogDoc, type DialogNode, OP_BRANCH, OP_END, OP_JUMP, OP_NEXT, newNode } from "./types";

const node = (patch: Partial<DialogNode> = {}): DialogNode => ({ ...newNode(), title: "", ...patch });
const doc = (nodes: DialogNode[], startNode = 0): DialogDoc => ({ ids: { dialog: "1", node: "2", branch: "3" }, nodes, startNode });
const titles = (d: DialogDoc) => d.nodes.map((n) => [n.title, n.subtitle]);

describe("继承标题导出补全", () => {
  it("顺序沿用：多个连续继承节点都补上最近的说话人", () => {
    const d = doc([
      node({ op: OP_NEXT, title: "派蒙", subtitle: "向导" }),
      node({ op: OP_NEXT, inheritTitle: true }),
      node({ op: OP_NEXT, inheritTitle: true }),
      node({ op: OP_NEXT, title: "<PLAYER_NAME>" }),
      node({ op: OP_END, inheritTitle: true }),
    ]);
    expect(titles(withInheritedTitles(d))).toEqual([
      ["派蒙", "向导"],
      ["派蒙", "向导"],
      ["派蒙", "向导"],
      ["<PLAYER_NAME>", ""],
      ["<PLAYER_NAME>", ""],
    ]);
    expect(inheritConflicts(d)).toEqual([]);
  });

  it("跳转与分支：同一说话人的多条来源不算冲突", () => {
    const d = doc([
      node({ op: OP_BRANCH, title: "派蒙", branches: [{ title: "a", jump: 1 }, { title: "b", jump: 2 }] }),
      node({ op: OP_JUMP, jump: 3, inheritTitle: true }),
      node({ op: OP_NEXT, inheritTitle: true }),
      node({ op: OP_END, inheritTitle: true }),
    ]);
    expect(titles(withInheritedTitles(d)).map((t) => t[0])).toEqual(["派蒙", "派蒙", "派蒙", "派蒙"]);
    expect(inheritConflicts(d)).toEqual([]);
  });

  it("不同说话人汇合：不补（清空）并报冲突", () => {
    const d = doc([
      node({ op: OP_BRANCH, title: "甲", branches: [{ title: "a", jump: 1 }, { title: "b", jump: 2 }] }),
      node({ op: OP_JUMP, jump: 3, title: "乙" }),
      node({ op: OP_NEXT, inheritTitle: true }),
      node({ op: OP_END, inheritTitle: true, title: "旧值" }),
    ]);
    const out = withInheritedTitles(d);
    expect(out.nodes[2].title).toBe("甲");
    expect(out.nodes[3].title).toBe("");
    const c = inheritConflicts(d);
    expect(c.map((x) => x.index)).toEqual([3]);
    expect(c[0].speakers.map((s) => s.title).sort()).toEqual(["乙", "甲"]);
  });

  it("循环回到继承节点：来源稳定后结束", () => {
    const d = doc([
      node({ op: OP_NEXT, title: "甲" }),
      node({ op: OP_JUMP, jump: 1, inheritTitle: true }),
    ]);
    expect(withInheritedTitles(d).nodes[1].title).toBe("甲");
  });

  it("开始节点继承：沿用空标题；走不到的继承节点清空", () => {
    const d = doc([node({ op: OP_END, inheritTitle: true, title: "x" }), node({ op: OP_END, inheritTitle: true, title: "y" })]);
    expect(titles(withInheritedTitles(d))).toEqual([["", ""], ["", ""]]);
  });

  it("写出的文件带补全的标题；读回后继承标记不变，没有继承节点时原样返回", () => {
    const d = doc([node({ op: OP_NEXT, title: "甲", subtitle: "称号" }), node({ op: OP_END, inheritTitle: true })]);
    const back = parseDialog(stringifyDialog(d)).doc;
    expect(back.nodes[1].inheritTitle).toBe(true);
    expect([back.nodes[1].title, back.nodes[1].subtitle]).toEqual(["甲", "称号"]);
    const plain = doc([node({ title: "甲" })]);
    expect(withInheritedTitles(plain)).toBe(plain);
  });

  it("草稿校验给出冲突警告", () => {
    const r = draftToDoc({
      ids: { dialog: "1", node: "2", branch: "3" },
      nodes: [
        { title: "甲", content: "?", choices: [{ text: "a", goto: "x" }, { text: "b", goto: "y" }] },
        { id: "x", title: "乙", content: "1", goto: "z" },
        { id: "y", content: "2" },
        { id: "z", content: "3", end: true },
      ],
    });
    expect(r.doc).not.toBeNull();
    expect(r.warnings.some((w) => w.includes("节点 3 继承标题"))).toBe(true);
  });
});
