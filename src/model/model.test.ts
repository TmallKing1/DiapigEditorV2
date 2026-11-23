import { describe, expect, it } from "vitest";
import { withInheritedTitles } from "./inheritTitles";
import { formatFloat, parseDialog, readDialog, stringifyDialog, writeDialog } from "./codec";
import {
  type EditState,
  addNodeAfter,
  cleanDoc,
  duplicateNode,
  moveNode,
  pasteOver,
  referencesTo,
  removeNode,
} from "./ops";
import { parseColorText, parseRichText, plainText, visibleLength } from "./richtext";
import { type DialogDoc, type DialogNode, OP_BRANCH, OP_JUMP, OP_NEXT, newNode } from "./types";

function node(patch: Partial<DialogNode> = {}): DialogNode {
  return { ...newNode(), ...patch };
}

function doc(nodes: DialogNode[], startNode = 0): DialogDoc {
  return { ids: { dialog: "11", node: "22", branch: "33" }, nodes, startNode };
}

/** 去掉 uid 后比较 */
function strip(d: DialogDoc) {
  return { ...d, nodes: d.nodes.map(({ uid, ...rest }) => rest) };
}

// —— 旧版（v1）文件：按旧编辑器 DialogNode.write 的输出手写 ——
const p = (param_type: string, value: unknown) => ({ param_type, value });
function v1Node(o: {
  hasSub: boolean;
  sub: string;
  content: string[];
  op?: number;
  branches?: [string, number][];
}) {
  return [
    p("Int32", String(o.op ?? 0)),
    p("Int32", "2"),
    p("StructList", {
      structId: "303",
      value: (o.branches ?? []).map(([t, j]) =>
        p("Struct", { structId: "303", type: "Struct", value: [p("String", t), p("Int32", String(j))] }),
      ),
    }),
    p("Int32", "1"),
    p("Bool", "False"),
    p("String", "派蒙"),
    p("Bool", o.hasSub ? "True" : "False"),
    p("String", o.sub),
    p("StringList", o.content),
    p("String", "进入"),
    p("String", ""),
    p("Float", "1.5"),
  ];
}
function v1File(nodes: unknown[][]) {
  return {
    structId: "101",
    type: "Struct",
    value: [
      p("StructList", {
        structId: "202",
        value: nodes.map((value) => p("Struct", { structId: "202", type: "Struct", value })),
      }),
      p("Int32", "1"),
    ],
  };
}

describe("codec", () => {
  it("v2 读写往返一致", () => {
    const d = doc(
      [
        node({ op: OP_NEXT, title: "<PLAYER_NAME>", subtitle: "旅行者", content: "你好<color=#FF0000>红</color>\\n第二行", textMode: 1, duration: 2.5 }),
        node({ op: OP_BRANCH, branches: [{ title: "好", jump: 0 }, { title: "不", jump: 2 }], defaultBranch: 1, inheritTitle: true }),
        node({ op: OP_JUMP, jump: 0, enterEvent: "a", leaveEvent: "b", textMode: 3 }),
      ],
      1,
    );
    const back = parseDialog(stringifyDialog(d));
    expect(back.convertedFromV1).toBe(false);
    // 继承标题节点按沿用来源补写（这里能从开始和节点 0 两个说话人走到：清空）
    expect(strip(back.doc)).toEqual(strip(withInheritedTitles(d)));
    expect(back.doc.nodes[1].title).toBe("");
  });

  it("v2 字段顺序与类型", () => {
    const out = writeDialog(doc([node({ subtitle: "副", content: "内容", textMode: 2, duration: 3 })]));
    expect(out.structId).toBe("11");
    const list = out.value[0];
    expect(list.param_type).toBe("StructList");
    expect(list.value.structId).toBe("22");
    const f = list.value.value[0].value.value;
    expect(f.map((x: any) => x.param_type)).toEqual([
      "Int32", "Int32", "StructList", "Int32", "Bool", "String",
      "String", "String", "Int32", "String", "String", "Float",
    ]);
    expect(f[2].value.structId).toBe("33");
    expect(f[4].value).toBe("False");
    expect(f[6].value).toBe("副");
    expect(f[7].value).toBe("内容");
    expect(f[8].value).toBe("2");
    expect(f[11].value).toBe("3.0");
    expect(out.value[1]).toEqual({ param_type: "Int32", value: "0" });
  });

  it("浮点格式与 Java 一致", () => {
    expect(formatFloat(0)).toBe("0.0");
    expect(formatFloat(2)).toBe("2.0");
    expect(formatFloat(0.1 + 0.2)).toBe("0.3");
    expect(formatFloat(1.5)).toBe("1.5");
  });

  it("v1 导入：三种内容形态与副标题开关", () => {
    const r = readDialog(
      v1File([
        v1Node({ hasSub: true, sub: "向导", content: ["整段内容"] }),
        v1Node({ hasSub: false, sub: "副标题", content: ["你", "好", "呀"], op: 3, branches: [["去", 0]] }),
        v1Node({ hasSub: false, sub: "", content: ["你好", "，旅", "行者"] }),
        v1Node({ hasSub: false, sub: "", content: [] }),
      ]),
    );
    expect(r.convertedFromV1).toBe(true);
    expect(r.doc.ids).toEqual({ dialog: "101", node: "202", branch: "303" });
    expect(r.doc.startNode).toBe(1);
    const [a, b, c, e] = r.doc.nodes;
    expect([a.subtitle, a.content, a.textMode]).toEqual(["向导", "整段内容", 0]);
    expect([b.subtitle, b.content, b.textMode]).toEqual(["", "你好呀", 1]);
    expect(b.branches).toEqual([{ title: "去", jump: 0 }]);
    expect([c.content, c.textMode]).toEqual(["你好，旅行者", 1]);
    expect([e.content, e.textMode]).toEqual(["", 0]);
    expect([a.title, a.jump, a.defaultBranch, a.enterEvent, a.duration]).toEqual(["派蒙", 2, 1, "进入", 1.5]);
  });

  it("拒绝无关文件", () => {
    expect(() => parseDialog("{")).toThrow("不是有效的 JSON");
    expect(() => parseDialog('{"a":1}')).toThrow("不是对话结构体文件");
  });
});

describe("ops", () => {
  // 0:跳到 2   1:分支 → 0 / 3   2:普通   3:跳到 1；开始节点 2；剪贴板跳到 3
  function base(): EditState {
    return {
      doc: doc(
        [
          node({ op: OP_JUMP, jump: 2 }),
          node({ op: OP_BRANCH, branches: [{ title: "a", jump: 0 }, { title: "b", jump: 3 }] }),
          node(),
          node({ op: OP_JUMP, jump: 1 }),
        ],
        2,
      ),
      clipboard: node({ op: OP_JUMP, jump: 3 }),
    };
  }
  const refs = (s: EditState) => ({
    start: s.doc.startNode,
    jumps: s.doc.nodes.map((n) => n.jump),
    branches: s.doc.nodes.map((n) => n.branches.map((b) => b.jump)),
    clip: s.clipboard?.jump,
  });

  it("新增后，指向其后节点的引用后移", () => {
    const s = addNodeAfter(base(), 1, node());
    expect(s.doc.nodes.length).toBe(5);
    expect(refs(s)).toEqual({
      start: 3,
      jumps: [3, 0, 0, 0, 1],
      branches: [[], [0, 4], [], [], []],
      clip: 4,
    });
  });

  it("复制一份插在其后", () => {
    const s0 = base();
    const s = duplicateNode(s0, 0);
    expect(s.doc.nodes[1].uid).not.toBe(s.doc.nodes[0].uid);
    expect(s.doc.nodes[1].op).toBe(OP_JUMP);
    // 原目标 2 后移到 3，原节点与副本都跟着指向 3
    expect(s.doc.nodes[0].jump).toBe(3);
    expect(s.doc.nodes[1].jump).toBe(3);
    expect(s.doc.startNode).toBe(3);
  });

  it("删除后，其后的引用前移，越界收回", () => {
    const s = removeNode(base(), 1);
    expect(refs(s)).toEqual({ start: 1, jumps: [1, 0, 1], branches: [[], [], []], clip: 2 });
    const t = removeNode(base(), 3);
    expect(t.clipboard?.jump).toBe(2);
    expect(t.doc.nodes[1].branches.map((b) => b.jump)).toEqual([0, 2]);
  });

  it("只剩一个节点时不删除", () => {
    const s: EditState = { doc: doc([node()]), clipboard: null };
    expect(removeNode(s, 0)).toBe(s);
  });

  it("向后移动", () => {
    const s = moveNode(base(), 0, 2);
    expect(s.doc.nodes.map((n) => n.op)).toEqual([OP_BRANCH, 0, OP_JUMP, OP_JUMP]);
    expect(refs(s)).toEqual({
      start: 1,
      jumps: [0, 0, 1, 0],
      branches: [[2, 3], [], [], []],
      clip: 3,
    });
  });

  it("向前移动", () => {
    const s = moveNode(base(), 3, 0);
    expect(refs(s)).toEqual({
      start: 3,
      jumps: [2, 3, 0, 0],
      branches: [[], [], [1, 0], []],
      clip: 0,
    });
  });

  it("粘贴覆盖目标并保留其标识", () => {
    const s0 = base();
    const s = pasteOver(s0, 2);
    expect(s.doc.nodes[2].uid).toBe(s0.doc.nodes[2].uid);
    expect([s.doc.nodes[2].op, s.doc.nodes[2].jump]).toEqual([OP_JUMP, 3]);
  });

  it("引用检查", () => {
    const s = base();
    expect(referencesTo(s, 2)).toEqual(["开始节点", "0"]);
    expect(referencesTo(s, 3)).toEqual(["1", "剪贴板节点"]);
    expect(referencesTo(s, 0)).toEqual(["1"]);
  });

  it("清理", () => {
    const d = cleanDoc(
      doc([
        node({ inheritTitle: true, title: "x", subtitle: "y", jump: 5, branches: [{ title: "a", jump: 1 }], defaultBranch: 2 }),
        node({ op: OP_JUMP, jump: 1, title: "保留" }),
        node({ op: OP_BRANCH, branches: [{ title: "a", jump: 1 }], defaultBranch: 0, jump: 3 }),
      ]),
    );
    expect([d.nodes[0].title, d.nodes[0].subtitle, d.nodes[0].jump, d.nodes[0].branches.length, d.nodes[0].defaultBranch]).toEqual(["", "", 0, 0, 0]);
    expect([d.nodes[1].title, d.nodes[1].jump]).toEqual(["保留", 1]);
    expect([d.nodes[2].branches.length, d.nodes[2].jump]).toEqual([1, 0]);
  });
});

describe("richtext", () => {
  it("无标记 / 空串", () => {
    expect(parseColorText("你好").segments).toEqual([{ text: "你好", color: undefined }]);
    expect(parseColorText("").segments).toEqual([]);
  });
  it("句中标记与相邻段", () => {
    expect(parseColorText("a<color=#FF0000>b</color><color=#00FF00>c</color>d").segments).toEqual([
      { text: "a", color: undefined },
      { text: "b", color: "#FF0000" },
      { text: "c", color: "#00FF00" },
      { text: "d", color: undefined },
    ]);
  });
  it("3 / 4 / 8 位", () => {
    expect(parseColorText("<color=#FFF>a</color>").segments[0].color).toBe("#FFFFFF");
    expect(parseColorText("<color=#0000>a</color>").segments[0].color).toBe("#00000000");
    expect(parseColorText("<color=#FFFFFF44>a</color>").segments[0].color).toBe("#FFFFFF44");
  });
  it("未闭合、多余闭合、其他标签", () => {
    const a = parseColorText("x<color=#F00>y");
    expect(a.segments[1]).toEqual({ text: "y", color: "#FF0000" });
    expect(a.warnings).toEqual(["有未闭合的 <color> 标签"]);
    const b = parseColorText("x</color>y");
    expect(plainText("x</color>y")).toBe("xy");
    expect(b.warnings).toEqual(["有多余的 </color>"]);
    expect(plainText("<b>x</b><PLAYER_NAME><u>y</u>")).toBe("x<PLAYER_NAME><u>y</u>");
    const c = parseColorText("<color=#12345>x");
    expect(c.segments).toEqual([{ text: "<color=#12345>x", color: undefined }]);
    expect(c.warnings).toEqual(["有格式不正确的颜色标签"]);
  });
  it("粗体 / 斜体与颜色嵌套", () => {
    expect(parseRichText("a<b>b<i>c<color=#F00>d</color></i></b>e").segments).toEqual([
      { text: "a", color: undefined },
      { text: "b", color: undefined, bold: true },
      { text: "c", color: undefined, bold: true, italic: true },
      { text: "d", color: "#FF0000", bold: true, italic: true },
      { text: "e", color: undefined },
    ]);
    const r = parseRichText("<b>x</i>y");
    expect(r.segments).toEqual([{ text: "xy", color: undefined, bold: true }]);
    expect(r.warnings).toEqual(["有多余的 </i>", "有未闭合的 <b> 标签"]);
    expect(visibleLength("<b>粗</b><i>斜</i>")).toBe(2);
  });
  it("可见字数", () => {
    expect(visibleLength("你好<color=#F00>，A</color>\\n😀")).toBe(6);
  });
});
