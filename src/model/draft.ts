// 对话草稿：给人和 AI 手写的精简 JSON，与 DialogDoc 互相转换。格式说明见 docs/对话草稿格式.md。
// 与游戏结构体 JSON 的差别：节点用名字（id）互相引用，流程用 next / goto / choices / end 表达，
// 内容里的换行写真实换行，由这里换成游戏用的字面量 \n。
import { inheritConflicts, inheritWarning } from "./inheritTitles";
import { parseRichText } from "./richtext";
import {
  type DialogBranch,
  type DialogDoc,
  type DialogNode,
  type StructIds,
  beginEndForExport,
  blackoutEnabled,
  newBeginEnd,
  NONLOCKED_MAX_BRANCHES,
  OP_BRANCH,
  OP_END,
  OP_JUMP,
  OP_NEXT,
  idsReady,
  newUid,
} from "./types";

/** 节点引用：节点的 id，或从 0 起的节点序号 */
export type DraftRef = string | number;

export interface DraftChoice {
  text: string;
  /** 省略 = 跳到下一个节点 */
  goto?: DraftRef;
}

export interface DraftNode {
  id?: string;
  /** 省略 = 沿用上一节点的标题与副标题 */
  title?: string;
  subtitle?: string;
  /** 字符串，或按行给出的字符串数组 */
  content: string | string[];
  goto?: DraftRef;
  choices?: DraftChoice[];
  /** 限时选择超时后选中的分支：choices 的下标 */
  default?: number;
  end?: boolean;
  mode?: string | number;
  enter?: string;
  leave?: string;
  duration?: number;
}

/** 对话起止设置（新结构才有）：enter / leave 是全黑后停留的秒数，0 = 不加；事件在全黑时派发 */
export interface DraftBlackout {
  enter?: number;
  enterEvent?: string;
  leave?: number;
  leaveEvent?: string;
}

export interface Draft {
  ids?: Partial<StructIds>;
  start?: DraftRef;
  /** 写了就按新结构（含起止设置）输出 */
  blackout?: DraftBlackout;
  nodes: DraftNode[];
}

export const MODE_NAMES = ["default", "typewriter", "fade", "instant"] as const;

export interface DraftResult {
  /** 有错误时为 null */
  doc: DialogDoc | null;
  errors: string[];
  warnings: string[];
}

const ROOT_KEYS = ["ids", "start", "blackout", "nodes"];
const ID_KEYS = ["dialog", "node", "branch", "beginEnd"] as const;
const BLACKOUT_KEYS = ["enter", "enterEvent", "leave", "leaveEvent"];
const NODE_KEYS = [
  "id",
  "title",
  "subtitle",
  "content",
  "goto",
  "choices",
  "default",
  "end",
  "mode",
  "enter",
  "leave",
  "duration",
];
const CHOICE_KEYS = ["text", "goto"];

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** 真实换行 → 游戏用的字面量 \n */
function encodeNewlines(text: string): string {
  return text.replace(/\r\n?|\n/g, "\\n");
}

export function draftToDoc(input: unknown, fallbackIds?: StructIds): DraftResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const done = (doc: DialogDoc | null): DraftResult => ({ doc: errors.length ? null : doc, errors, warnings });

  if (!isObject(input)) {
    errors.push("草稿应是一个对象：{ nodes: [...] }");
    return done(null);
  }
  for (const k of Object.keys(input)) {
    if (!ROOT_KEYS.includes(k)) errors.push(`顶层有未知字段 "${k}"`);
  }
  const rawNodes = input.nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    errors.push("nodes 应是非空数组");
    return done(null);
  }

  // 先收集 id，引用才能指向后面的节点
  const idIndex = new Map<string, number>();
  rawNodes.forEach((n, i) => {
    if (!isObject(n) || n.id === undefined) return;
    if (typeof n.id !== "string" || n.id === "") {
      errors.push(`节点 ${i}：id 应是非空字符串`);
    } else if (idIndex.has(n.id)) {
      errors.push(`节点 ${i}：id "${n.id}" 与节点 ${idIndex.get(n.id)} 重复`);
    } else {
      idIndex.set(n.id, i);
    }
  });

  const count = rawNodes.length;
  const resolve = (ref: unknown, where: string): number => {
    if (typeof ref === "string") {
      const i = idIndex.get(ref);
      if (i !== undefined) return i;
      errors.push(`${where}：找不到 id 为 "${ref}" 的节点`);
    } else if (typeof ref === "number" && Number.isInteger(ref)) {
      if (ref >= 0 && ref < count) return ref;
      errors.push(`${where}：节点序号 ${ref} 超出范围（0–${count - 1}）`);
    } else {
      errors.push(`${where}：应是节点 id 或节点序号`);
    }
    return 0;
  };
  const str = (v: unknown, where: string): string => {
    if (v === undefined) return "";
    if (typeof v === "string") return v;
    errors.push(`${where}：应是字符串`);
    return "";
  };

  const nodes: DialogNode[] = rawNodes.map((raw, i) => {
    const label = isObject(raw) && typeof raw.id === "string" && raw.id ? `节点 ${i}（${raw.id}）` : `节点 ${i}`;
    const node: DialogNode = {
      uid: newUid(),
      op: OP_END,
      jump: 0,
      branches: [],
      defaultBranch: 0,
      inheritTitle: false,
      title: "",
      subtitle: "",
      content: "",
      textMode: 0,
      enterEvent: "",
      leaveEvent: "",
      duration: 0,
    };
    if (!isObject(raw)) {
      errors.push(`${label}：应是对象`);
      return node;
    }
    for (const k of Object.keys(raw)) {
      if (!NODE_KEYS.includes(k)) errors.push(`${label}：未知字段 "${k}"`);
    }

    // 标题
    if (raw.title === undefined) {
      node.inheritTitle = true;
      if (raw.subtitle !== undefined) errors.push(`${label}：省略 title 表示沿用上一节点的标题，不能再单独写 subtitle`);
      if (i === 0) warnings.push(`${label}：第一个节点没有 title，将沿用空标题（黑屏文字不显示标题，可忽略）`);
    } else {
      node.title = str(raw.title, `${label} 的 title`);
      node.subtitle = str(raw.subtitle, `${label} 的 subtitle`);
    }

    // 内容
    const c = raw.content;
    if (typeof c === "string") {
      node.content = encodeNewlines(c);
    } else if (Array.isArray(c) && c.every((x) => typeof x === "string")) {
      node.content = encodeNewlines(c.join("\n"));
    } else {
      errors.push(`${label}：content 应是字符串或字符串数组`);
    }
    if (node.content === "") warnings.push(`${label}：内容为空`);
    for (const w of parseRichText(node.content).warnings) warnings.push(`${label}：内容${w}`);

    // 流程
    const flows = ["goto", "choices", "end"].filter((k) => raw[k] !== undefined && raw[k] !== false);
    if (flows.length > 1) errors.push(`${label}：${flows.join("、")} 只能写一个`);
    if (raw.end !== undefined && typeof raw.end !== "boolean") errors.push(`${label}：end 应是 true / false`);
    if (raw.choices !== undefined) {
      node.op = OP_BRANCH;
      if (!Array.isArray(raw.choices) || raw.choices.length === 0) {
        errors.push(`${label}：choices 应是非空数组`);
      } else {
        node.branches = raw.choices.map((ch, k): DialogBranch => {
          const where = `${label} 的分支 ${k}`;
          if (!isObject(ch)) {
            errors.push(`${where}：应是对象 { text, goto }`);
            return { title: "", jump: 0 };
          }
          for (const key of Object.keys(ch)) {
            if (!CHOICE_KEYS.includes(key)) errors.push(`${where}：未知字段 "${key}"`);
          }
          if (typeof ch.text !== "string" || ch.text === "") errors.push(`${where}：text 应是非空字符串`);
          let jump = i + 1;
          if (ch.goto !== undefined) jump = resolve(ch.goto, where);
          else if (i === count - 1) errors.push(`${where}：最后一个节点的分支必须写 goto`);
          return { title: typeof ch.text === "string" ? ch.text : "", jump };
        });
        if (node.branches.length > NONLOCKED_MAX_BRANCHES) {
          warnings.push(
            `${label}：共 ${node.branches.length} 个分支，用于非锁定对话时只显示前 ${NONLOCKED_MAX_BRANCHES} 个`,
          );
        }
      }
      if (raw.default !== undefined) {
        const d = raw.default;
        if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d >= node.branches.length) {
          errors.push(`${label}：default 应是分支下标（0–${Math.max(node.branches.length - 1, 0)}）`);
        } else {
          node.defaultBranch = d;
          if (d >= NONLOCKED_MAX_BRANCHES) {
            warnings.push(`${label}：默认分支 ${d} 不在非锁定对话显示的前 ${NONLOCKED_MAX_BRANCHES} 个之内`);
          }
        }
      }
    } else {
      if (raw.default !== undefined) errors.push(`${label}：default 只能和 choices 一起用`);
      if (raw.goto !== undefined) {
        node.op = OP_JUMP;
        node.jump = resolve(raw.goto, `${label} 的 goto`);
      } else if (raw.end === true || i === count - 1) {
        node.op = OP_END;
      } else {
        node.op = OP_NEXT;
      }
    }

    // 显示模式
    if (raw.mode !== undefined) {
      const m = typeof raw.mode === "string" ? MODE_NAMES.indexOf(raw.mode as (typeof MODE_NAMES)[number]) : raw.mode;
      if (typeof m === "number" && Number.isInteger(m) && m >= 0 && m < MODE_NAMES.length) node.textMode = m;
      else errors.push(`${label}：mode 应是 ${MODE_NAMES.join(" / ")}（或 0–3）`);
    }

    node.enterEvent = str(raw.enter, `${label} 的 enter`);
    node.leaveEvent = str(raw.leave, `${label} 的 leave`);
    if (raw.duration !== undefined) {
      if (typeof raw.duration === "number" && Number.isFinite(raw.duration) && raw.duration >= 0) {
        node.duration = raw.duration;
      } else {
        errors.push(`${label}：duration 应是不小于 0 的秒数`);
      }
    }
    return node;
  });

  const startNode = input.start === undefined ? 0 : resolve(input.start, "start");

  // 结构体 ID：草稿里写的优先，其次是外部给的
  const ids: StructIds = { dialog: "0", node: "0", branch: "0", ...fallbackIds };
  if (input.ids !== undefined) {
    if (!isObject(input.ids)) {
      errors.push("ids 应是对象 { dialog, node, branch[, beginEnd] }");
    } else {
      for (const [k, v] of Object.entries(input.ids)) {
        if (!(ID_KEYS as readonly string[]).includes(k)) errors.push(`ids 里有未知字段 "${k}"`);
        else if (typeof v !== "string" && typeof v !== "number") errors.push(`ids.${k} 应是字符串或数字`);
        else ids[k as (typeof ID_KEYS)[number]] = String(v).trim();
      }
    }
  }

  // 起止设置：草稿写了 blackout，或结构体 ID 里有 beginEnd（如覆盖新结构的文件）时按新结构输出
  let beginEnd: DialogDoc["beginEnd"];
  if (input.blackout !== undefined || ids.beginEnd !== undefined) {
    beginEnd = newBeginEnd();
    ids.beginEnd ??= "0";
    const b = input.blackout;
    if (b !== undefined && !isObject(b)) {
      errors.push("blackout 应是对象 { enter, enterEvent, leave, leaveEvent }");
    } else if (b) {
      for (const k of Object.keys(b)) if (!BLACKOUT_KEYS.includes(k)) errors.push(`blackout 里有未知字段 "${k}"`);
      const secs = (v: unknown, name: string) => {
        if (v === undefined) return 0;
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
        errors.push(`blackout.${name} 应是不小于 0 的秒数`);
        return 0;
      };
      beginEnd.enterTime = secs(b.enter, "enter");
      beginEnd.leaveTime = secs(b.leave, "leave");
      beginEnd.enterEvent = str(b.enterEvent, "blackout.enterEvent");
      beginEnd.leaveEvent = str(b.leaveEvent, "blackout.leaveEvent");
    }
  }
  if (!idsReady(ids, beginEnd !== undefined)) {
    warnings.push("结构体 ID 未填全：导入游戏前需在编辑器里填写，或用 --ids-from 从已有对话文件带入");
  }

  // 从开始节点走不到的节点
  if (errors.length === 0) {
    const seen = new Set<number>();
    const stack = [startNode];
    while (stack.length) {
      const i = stack.pop()!;
      if (seen.has(i) || i < 0 || i >= count) continue;
      seen.add(i);
      const n = nodes[i];
      if (n.op === OP_NEXT) stack.push(i + 1);
      else if (n.op === OP_JUMP) stack.push(n.jump);
      else if (n.op === OP_BRANCH) for (const b of n.branches) stack.push(b.jump);
    }
    const lost = nodes.map((_, i) => i).filter((i) => !seen.has(i));
    if (lost.length) warnings.push(`从开始节点走不到的节点：${lost.join("、")}`);
  }

  const doc: DialogDoc = { ids, nodes, startNode };
  if (beginEnd) doc.beginEnd = beginEnd;
  if (errors.length === 0) for (const c of inheritConflicts(doc)) warnings.push(inheritWarning(c));
  return done(doc);
}

export interface ToDraftOptions {
  /**
   * 显式模式，供增删节点前使用：每个节点都有 id，分支一律写 goto，结束一律写 end，
   * 这样节点换位置后引用与结束点不变；只有“顺序进入下一个节点”仍按位置决定。
   */
  explicit?: boolean;
}

/** DialogDoc → 草稿。被引用的节点会得到 id（n<序号>），引用一律写 id */
export function docToDraft(doc: DialogDoc, opt: ToDraftOptions = {}): Draft {
  const explicit = opt.explicit === true;
  const count = doc.nodes.length;
  const referenced = new Set<number>();
  const mark = (i: number) => {
    if (i >= 0 && i < count) referenced.add(i);
  };
  if (explicit) doc.nodes.forEach((_, i) => mark(i));
  if (doc.startNode !== 0) mark(doc.startNode);
  doc.nodes.forEach((n, i) => {
    if (n.op === OP_JUMP) mark(n.jump);
    if (n.op === OP_BRANCH) for (const b of n.branches) if (b.jump !== i + 1) mark(b.jump);
  });
  const idOf = (i: number) => `n${i}`;
  // 越界的引用无法用 id 表达，保留序号，转回时会报错提醒
  const ref = (i: number): DraftRef => (referenced.has(i) ? idOf(i) : i);

  const nodes = doc.nodes.map((n, i): DraftNode => {
    // 按阅读顺序加字段：id、标题、内容、流程、其他
    const out = {} as DraftNode;
    if (referenced.has(i)) out.id = idOf(i);
    if (!n.inheritTitle) {
      out.title = n.title;
      if (n.subtitle) out.subtitle = n.subtitle;
    }
    const text = n.content.replaceAll("\\n", "\n");
    out.content = text.includes("\n") ? text.split("\n") : text;
    if (n.op === OP_JUMP) {
      out.goto = ref(n.jump);
    } else if (n.op === OP_BRANCH) {
      out.choices = n.branches.map((b) => {
        const ch: DraftChoice = { text: b.title };
        if (explicit || b.jump !== i + 1 || i === count - 1) ch.goto = ref(b.jump);
        return ch;
      });
      if (n.defaultBranch !== 0) out.default = n.defaultBranch;
    } else if (n.op === OP_END && (explicit || i !== count - 1)) {
      out.end = true;
    } else if (n.op === OP_NEXT && i === count - 1) {
      // 最后一个节点“跳转下个节点”会越界：按序号写出，转回时报错
      out.goto = count;
    }
    if (n.textMode !== 0) out.mode = MODE_NAMES[n.textMode] ?? n.textMode;
    if (n.enterEvent) out.enter = n.enterEvent;
    if (n.leaveEvent) out.leave = n.leaveEvent;
    if (n.duration !== 0) out.duration = n.duration;
    return out;
  });

  const draft: Draft = { ids: { ...doc.ids }, nodes };
  if (!doc.beginEnd) delete draft.ids!.beginEnd;
  if (explicit || doc.startNode !== 0) draft.start = ref(doc.startNode);
  const be = doc.beginEnd && beginEndForExport(doc.beginEnd);
  if (be && (explicit || be.enterTime || be.leaveTime || be.enterEvent || be.leaveEvent)) {
    const out: DraftBlackout = {};
    if (explicit || be.enterTime) out.enter = be.enterTime;
    if (be.enterEvent) out.enterEvent = be.enterEvent;
    if (explicit || be.leaveTime) out.leave = be.leaveTime;
    if (be.leaveEvent) out.leaveEvent = be.leaveEvent;
    draft.blackout = out;
  }
  return draft;
}

/** 草稿里用到的事件名（去重，按出现顺序），供人工核对 */
export function eventNames(doc: DialogDoc): string[] {
  const names = new Set<string>();
  if (doc.beginEnd?.enterTime && doc.beginEnd.enterEvent && blackoutEnabled(doc.beginEnd, "enter")) names.add(doc.beginEnd.enterEvent);
  for (const n of doc.nodes) {
    if (n.enterEvent) names.add(n.enterEvent);
    if (n.leaveEvent) names.add(n.leaveEvent);
  }
  if (doc.beginEnd?.leaveTime && doc.beginEnd.leaveEvent && blackoutEnabled(doc.beginEnd, "leave")) names.add(doc.beginEnd.leaveEvent);
  return [...names];
}

/** 起止黑场的说明行（没有黑场时为空） */
export function blackoutLines(doc: DialogDoc): string[] {
  const be = doc.beginEnd && beginEndForExport(doc.beginEnd);
  if (!be) return [];
  const part = (secs: number, ev: string) => (secs > 0 ? `全黑停留 ${secs} 秒` + (ev ? `，事件「${ev}」` : "") : "无");
  if (!(be.enterTime > 0) && !(be.leaveTime > 0)) return ["起止黑场：无"];
  return [`起止黑场（只用于锁定对话）：开始前 ${part(be.enterTime, be.enterEvent)}；结束后 ${part(be.leaveTime, be.leaveEvent)}`];
}
