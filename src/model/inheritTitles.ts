// 继承标题的导出补全（2026-11-20）：断线重连后 Lua 只拿到当前节点，没有上一节点可沿用，
// 所以导出时把「继承标题」节点实际沿用的标题 / 副标题写进节点本身。正常游玩时 Lua 仍沿用上一节点的
// 标题（不读这两个字段），只在重连后第一次显示继承节点时用到。
// 沿用来源按流程推算：从开始节点出发，沿「跳转下个节点」「跳转指定节点」和各分支传播说话人；
// 开始节点之前的说话人是空标题。一个继承节点能从不同说话人走到时不补（保持为空）并给出警告。
import { type DialogDoc, type DialogNode, OP_BRANCH, OP_JUMP, OP_NEXT } from "./types";

export type Speaker = { title: string; subtitle: string };
export type InheritConflict = { index: number; speakers: Speaker[] };

const keyOf = (s: Speaker) => JSON.stringify([s.title, s.subtitle]);
const fromKey = (k: string): Speaker => {
  const [title, subtitle] = JSON.parse(k) as [string, string];
  return { title, subtitle };
};

function successors(nodes: DialogNode[], i: number): number[] {
  const n = nodes[i];
  if (n.op === OP_NEXT) return [i + 1];
  if (n.op === OP_JUMP) return [n.jump];
  if (n.op === OP_BRANCH) return n.branches.map((b) => b.jump);
  return [];
}

/** 每个继承节点能走到它的说话人。走不到的节点没有条目 */
export function inheritedSpeakers(doc: DialogDoc): Map<number, Speaker[]> {
  const { nodes, startNode } = doc;
  const count = nodes.length;
  const incoming: Set<string>[] = nodes.map(() => new Set());
  const out = (i: number) =>
    nodes[i].inheritTitle ? incoming[i] : new Set([keyOf({ title: nodes[i].title, subtitle: nodes[i].subtitle })]);
  const work: number[] = [];
  if (startNode >= 0 && startNode < count) {
    incoming[startNode].add(keyOf({ title: "", subtitle: "" }));
    work.push(startNode);
  }
  while (work.length) {
    const i = work.pop()!;
    const keys = out(i);
    for (const j of successors(nodes, i)) {
      if (j < 0 || j >= count) continue;
      let changed = false;
      for (const k of keys) {
        if (!incoming[j].has(k)) {
          incoming[j].add(k);
          changed = true;
        }
      }
      if (changed) work.push(j);
    }
  }
  const result = new Map<number, Speaker[]>();
  nodes.forEach((n, i) => {
    if (n.inheritTitle && incoming[i].size > 0) result.set(i, [...incoming[i]].map(fromKey));
  });
  return result;
}

/** 能从多个不同说话人走到的继承节点 */
export function inheritConflicts(doc: DialogDoc): InheritConflict[] {
  const out: InheritConflict[] = [];
  for (const [index, speakers] of inheritedSpeakers(doc)) if (speakers.length > 1) out.push({ index, speakers });
  return out.sort((a, b) => a.index - b.index);
}

/** 导出用：继承节点只有一个沿用来源时写入该标题 / 副标题；其余继承节点清空这两个字段 */
export function withInheritedTitles(doc: DialogDoc): DialogDoc {
  const found = inheritedSpeakers(doc);
  let touched = false;
  const nodes = doc.nodes.map((n, i) => {
    if (!n.inheritTitle) return n;
    const list = found.get(i);
    const s = list && list.length === 1 ? list[0] : { title: "", subtitle: "" };
    if (n.title === s.title && n.subtitle === s.subtitle) return n;
    touched = true;
    return { ...n, title: s.title, subtitle: s.subtitle };
  });
  return touched ? { ...doc, nodes } : doc;
}

/** 警告文字（草稿校验、编辑器保存提示共用） */
export function inheritWarning(c: InheritConflict): string {
  const names = c.speakers.map((s) => (s.title === "" ? "（空标题）" : s.subtitle ? `${s.title}·${s.subtitle}` : s.title));
  return `节点 ${c.index} 继承标题，但能从不同说话人走到（${names.join("、")}）：断线重连到这个节点时名字会显示为空，建议改为直接填写标题`;
}
