// 节点增、删、移与引用序号修正（纯函数，返回新对象）。
// 对应旧编辑器 DialogEditorPage.onAddNode / onRemoveNode / moveNodeChecker。
// 与旧版的差别：删除后越界的引用收回到最后一个节点。
import {
  type DialogDoc,
  type DialogNode,
  OP_BRANCH,
  OP_END,
  OP_JUMP,
  OP_NEXT,
  cloneNode,
} from "./types";

export interface EditState {
  doc: DialogDoc;
  /** 内部剪贴板里的节点；它的引用序号跟着一起修正 */
  clipboard: DialogNode | null;
}

function remapNode(node: DialogNode, f: (i: number) => number): DialogNode {
  // 与旧版一致：只修正当前操作码实际用到的引用，未使用的字段保持原值
  if (node.op === OP_JUMP) return { ...node, jump: f(node.jump) };
  if (node.op === OP_BRANCH) {
    return { ...node, branches: node.branches.map((b) => ({ ...b, jump: f(b.jump) })) };
  }
  return node;
}

function remap(state: EditState, nodes: DialogNode[], f: (i: number) => number): EditState {
  return {
    doc: { ...state.doc, nodes: nodes.map((n) => remapNode(n, f)), startNode: f(state.doc.startNode) },
    clipboard: state.clipboard ? remapNode(state.clipboard, f) : null,
  };
}

/** 在 index 处插入节点 */
export function insertNode(state: EditState, index: number, node: DialogNode): EditState {
  const nodes = state.doc.nodes.slice();
  nodes.splice(index, 0, node);
  const last = nodes.length - 1;
  // 指向 index 及之后的引用后移一位（新节点若是副本，它的引用也一样要跟着后移）
  return remap(state, nodes, (i) => (i >= index && i < last ? i + 1 : i));
}

export function addNodeAfter(state: EditState, index: number, node: DialogNode): EditState {
  return insertNode(state, index + 1, node);
}

export function duplicateNode(state: EditState, index: number): EditState {
  return insertNode(state, index + 1, cloneNode(state.doc.nodes[index]));
}

export function removeNode(state: EditState, index: number): EditState {
  if (state.doc.nodes.length <= 1) return state;
  const nodes = state.doc.nodes.slice();
  nodes.splice(index, 1);
  const last = nodes.length - 1;
  return remap(state, nodes, (i) => Math.min(i > index ? i - 1 : i, last));
}

/** 把 from 处的节点移到最终位置 to */
export function moveNode(state: EditState, from: number, to: number): EditState {
  const count = state.doc.nodes.length;
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return state;
  const nodes = state.doc.nodes.slice();
  const [moved] = nodes.splice(from, 1);
  nodes.splice(to, 0, moved);
  return remap(state, nodes, (i) => {
    if (i === from) return to;
    if (from < to && i > from && i <= to) return i - 1;
    if (from > to && i >= to && i < from) return i + 1;
    return i;
  });
}

/** 用剪贴板内容覆盖 index 处的节点 */
export function pasteOver(state: EditState, index: number): EditState {
  if (!state.clipboard) return state;
  const nodes = state.doc.nodes.slice();
  nodes[index] = { ...cloneNode(state.clipboard), uid: nodes[index].uid };
  return { ...state, doc: { ...state.doc, nodes } };
}

export function replaceNode(state: EditState, index: number, node: DialogNode): EditState {
  const nodes = state.doc.nodes.slice();
  nodes[index] = node;
  return { ...state, doc: { ...state.doc, nodes } };
}

/** 谁引用了 index：返回“开始节点”、节点编号、“剪贴板节点” */
export function referencesTo(state: EditState, index: number): string[] {
  const uses = (n: DialogNode) =>
    (n.op === OP_JUMP && n.jump === index) ||
    (n.op === OP_BRANCH && n.branches.some((b) => b.jump === index));
  const out: string[] = [];
  if (state.doc.startNode === index) out.push("开始节点");
  state.doc.nodes.forEach((n, i) => {
    if (i !== index && uses(n)) out.push(String(i));
  });
  if (state.clipboard && uses(state.clipboard)) out.push("剪贴板节点");
  return out;
}

/** 清掉各节点用不到的字段，减少存储量 */
export function cleanDoc(doc: DialogDoc): DialogDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => ({
      ...n,
      title: n.inheritTitle ? "" : n.title,
      subtitle: n.inheritTitle ? "" : n.subtitle,
      jump: n.op === OP_JUMP ? n.jump : 0,
      branches: n.op === OP_BRANCH ? n.branches : [],
      defaultBranch: n.op === OP_BRANCH ? n.defaultBranch : 0,
    })),
  };
}

/** 「自动处理末尾结束」：最后一个节点是「跳转下个节点」时没有下一个可跳，按「结束对话」处理 */
export function isAutoEnd(nodes: DialogNode[], index: number): boolean {
  return index === nodes.length - 1 && nodes[index]?.op === OP_NEXT;
}

/** 导出 / 预览用：把 isAutoEnd 的节点改成「结束对话」；没有这种节点时原样返回 */
export function withAutoEnd(doc: DialogDoc): DialogDoc {
  const last = doc.nodes.length - 1;
  if (!isAutoEnd(doc.nodes, last)) return doc;
  const nodes = doc.nodes.slice();
  nodes[last] = { ...nodes[last], op: OP_END };
  return { ...doc, nodes };
}
