// 在草稿上做增量修改（供 MCP 服务使用）。节点一律用 id 指定：id 不随位置变化，
// 所以一批操作里前面的增删不会让后面的引用错位。改完后由 draftToDoc 统一校验。
import type { Draft, DraftNode } from "./draft";
import { type DialogDoc, OP_BRANCH, OP_END, OP_JUMP } from "./types";

const FLOW_KEYS = ["goto", "choices", "end"];

export interface EditResult {
  /** 有错误时为 null */
  draft: Draft | null;
  errors: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * 操作（按顺序执行）：
 *   { op: "set", node, fields }            改节点字段；fields 里值为 null 的字段被删除；
 *                                           写了 goto / choices / end 之一时，原来的流程字段自动去掉
 *   { op: "insert", nodes, after | before } 插入新节点；不写位置时加到末尾
 *   { op: "remove", node }
 *   { op: "move", node, after | before }
 *   { op: "start", node }                   设置开始节点
 */
export function applyDraftEdits(source: Draft, ops: unknown): EditResult {
  const errors: string[] = [];
  const nodes: DraftNode[] = source.nodes.map((n) => ({ ...n }));
  let start = source.start;

  if (!Array.isArray(ops) || ops.length === 0) {
    return { draft: null, errors: ["ops 应是非空数组"] };
  }

  const find = (ref: unknown, where: string): number => {
    if (typeof ref !== "string" || ref === "") {
      errors.push(`${where}：应写节点的 id（字符串）`);
      return -1;
    }
    const i = nodes.findIndex((n) => n.id === ref);
    if (i < 0) errors.push(`${where}：找不到 id 为 "${ref}" 的节点`);
    return i;
  };
  /** 返回插入位置；出错时返回 -1 */
  const position = (op: Record<string, unknown>, where: string): number => {
    if (op.after !== undefined && op.before !== undefined) {
      errors.push(`${where}：after 和 before 只能写一个`);
      return -1;
    }
    if (op.after !== undefined) {
      const i = find(op.after, `${where} 的 after`);
      return i < 0 ? -1 : i + 1;
    }
    if (op.before !== undefined) return find(op.before, `${where} 的 before`);
    return nodes.length;
  };

  ops.forEach((op, k) => {
    const where = `操作 ${k}`;
    if (!isObject(op)) {
      errors.push(`${where}：应是对象`);
      return;
    }
    if (op.op === "set") {
      const i = find(op.node, `${where} 的 node`);
      if (!isObject(op.fields)) errors.push(`${where}：fields 应是对象`);
      const fields = op.fields;
      if (i < 0 || !isObject(fields)) return;
      const next = { ...nodes[i] } as Record<string, unknown>;
      // 换流程时自动去掉原来的流程字段，不必逐个写 null
      if (FLOW_KEYS.some((key) => fields[key] !== undefined && fields[key] !== null)) {
        for (const key of FLOW_KEYS) delete next[key];
        if (fields.choices === undefined) delete next.default;
      }
      for (const [key, value] of Object.entries(fields)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      nodes[i] = next as unknown as DraftNode;
    } else if (op.op === "insert") {
      if (!Array.isArray(op.nodes) || op.nodes.length === 0 || !op.nodes.every(isObject)) {
        errors.push(`${where}：nodes 应是非空的节点数组`);
        return;
      }
      const at = position(op, where);
      if (at >= 0) nodes.splice(at, 0, ...(op.nodes as unknown as DraftNode[]));
    } else if (op.op === "remove") {
      const i = find(op.node, `${where} 的 node`);
      if (i < 0) return;
      if (nodes.length <= 1) errors.push(`${where}：不能删除最后一个节点`);
      else nodes.splice(i, 1);
    } else if (op.op === "move") {
      const i = find(op.node, `${where} 的 node`);
      if (i < 0) return;
      if (op.after === undefined && op.before === undefined) {
        errors.push(`${where}：要写 after 或 before`);
        return;
      }
      if (op.after === op.node || op.before === op.node) {
        errors.push(`${where}：不能相对自己移动`);
        return;
      }
      const [moved] = nodes.splice(i, 1);
      const at = position(op, where);
      nodes.splice(at < 0 ? i : at, 0, moved);
    } else if (op.op === "start") {
      if (find(op.node, `${where} 的 node`) >= 0) start = op.node as string;
    } else {
      errors.push(`${where}：op 应是 set / insert / remove / move / start`);
    }
  });

  if (errors.length) return { draft: null, errors };
  const draft: Draft = { ...source, nodes };
  if (start !== undefined) draft.start = start;
  return { draft, errors };
}

/** 一行一个节点的概览：序号、id（n<序号>）、标题、内容开头、流程 */
export function outline(doc: DialogDoc): string {
  return doc.nodes
    .map((n, i) => {
      const title = n.inheritTitle ? "（沿用标题）" : n.title + (n.subtitle ? `·${n.subtitle}` : "");
      const text = [...n.content.replaceAll("\\n", " ")];
      const head = text.length > 24 ? text.slice(0, 24).join("") + "…" : text.join("");
      let flow = "下一个";
      if (n.op === OP_JUMP) flow = `跳转 n${n.jump}`;
      else if (n.op === OP_BRANCH) flow = `分支 ${n.branches.map((b) => `${b.title}→n${b.jump}`).join("，")}`;
      else if (n.op === OP_END) flow = "结束";
      const mark = i === doc.startNode ? "（开始）" : "";
      return `n${i}${mark} ${title}：${head} ⇒ ${flow}`;
    })
    .join("\n");
}
