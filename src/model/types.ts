// 对话数据模型（v2）。字段含义见 docs/迁移方案.md 4.5 与 docs/对话规格.md。

export const OP_END = 0;
export const OP_NEXT = 1;
export const OP_JUMP = 2;
export const OP_BRANCH = 3;

export const OP_LABELS = ["结束对话", "跳转下个节点", "跳转指定节点", "打开分支选择"] as const;

export const TEXT_MODE_LABELS = [
  "默认（按对话类型）",
  "打字机",
  "整段渐显",
  "直接显示",
] as const;

/** 非锁定对话每个选项要占一个快捷键（键盘 1–4，手柄十字键），游戏中只显示前 4 个分支；锁定对话不限 */
export const NONLOCKED_MAX_BRANCHES = 4;
export const PLAYER_NAME = "<PLAYER_NAME>";

export interface DialogBranch {
  title: string;
  jump: number;
}

export interface DialogNode {
  /** 仅用于界面列表的稳定标识，不写入文件 */
  uid: number;
  op: number;
  jump: number;
  branches: DialogBranch[];
  defaultBranch: number;
  inheritTitle: boolean;
  title: string;
  /** 空串 = 无副标题 */
  subtitle: string;
  /** 单个字符串；换行写作字面量 \n */
  content: string;
  /** 0 默认 / 1 打字机 / 2 整段渐显 / 3 直出 */
  textMode: number;
  enterEvent: string;
  leaveEvent: string;
  /** 秒 */
  duration: number;
}

export interface StructIds {
  dialog: string;
  node: string;
  branch: string;
  /** 「对话起止设置」结构体 ID；只有新结构（DialogDoc.beginEnd 有值）才用到 */
  beginEnd?: string;
}

/**
 * 对话起止设置（对话结构体第 2 个字段，2026-11-16 新增）：锁定对话开始前、结束后各加一段黑场。
 * 时间 = 全黑后停留的秒数，0 = 不加这段黑场；事件在全黑时派发，空串不派发。
 */
export interface BeginEnd {
  /** 仅供编辑器使用，导入时从秒数和事件名推断。 */
  enterEnabled?: boolean;
  leaveEnabled?: boolean;
  enterTime: number;
  enterEvent: string;
  leaveTime: number;
  leaveEvent: string;
}

export function blackoutEnabled(be: BeginEnd | undefined, side: "enter" | "leave"): boolean {
  return be?.[`${side}Enabled`] ?? Boolean(be?.[`${side}Time`] || be?.[`${side}Event`]);
}

export function beginEndForExport(be: BeginEnd): BeginEnd {
  const enter = blackoutEnabled(be, "enter");
  const leave = blackoutEnabled(be, "leave");
  return {
    enterTime: enter ? be.enterTime : 0,
    enterEvent: enter ? be.enterEvent : "",
    leaveTime: leave ? be.leaveTime : 0,
    leaveEvent: leave ? be.leaveEvent : "",
  };
}

export interface DialogDoc {
  ids: StructIds;
  nodes: DialogNode[];
  startNode: number;
  /**
   * 有值 = 新结构（节点列表、开始节点、起止设置三个字段）；undefined = 旧结构（只有前两个字段）。
   * 千星奇域编辑器的结构体缓存可能还没更新，导出的仍是旧结构，所以读写都保持文件原来的结构。
   */
  beginEnd?: BeginEnd;
}

export function newBeginEnd(): BeginEnd {
  return { enterTime: 0, enterEvent: "", leaveTime: 0, leaveEvent: "" };
}

let uidCounter = 0;
export function newUid(): number {
  uidCounter += 1;
  return uidCounter;
}

export function newNode(): DialogNode {
  return {
    uid: newUid(),
    op: OP_END,
    jump: 0,
    branches: [],
    defaultBranch: 0,
    inheritTitle: false,
    title: "标题",
    subtitle: "",
    content: "内容",
    textMode: 0,
    enterEvent: "",
    leaveEvent: "",
    duration: 0,
  };
}

export function cloneNode(node: DialogNode): DialogNode {
  return { ...node, uid: newUid(), branches: node.branches.map((b) => ({ ...b })) };
}

/** 新建对话：沿用给出的结构体 ID；withBeginEnd 决定用新结构还是旧结构 */
export function newDoc(ids?: StructIds, withBeginEnd = true): DialogDoc {
  const doc: DialogDoc = {
    ids: ids ? { ...ids } : { dialog: "0", node: "0", branch: "0" },
    nodes: [newNode()],
    startNode: 0,
  };
  if (withBeginEnd) {
    doc.beginEnd = newBeginEnd();
    doc.ids.beginEnd ??= "0";
  }
  return doc;
}

const filled = (id: string | undefined) => id !== undefined && id.trim() !== "" && id.trim() !== "0";

/** 结构体 ID 是否填齐；新结构（withBeginEnd）还要填「对话起止设置」的 ID */
export function idsReady(ids: StructIds, withBeginEnd = false): boolean {
  return [ids.dialog, ids.node, ids.branch].every(filled) && (!withBeginEnd || filled(ids.beginEnd));
}

/** 对话的结构体 ID 是否填齐（按对话自己的结构） */
export const docReady = (doc: DialogDoc) => idsReady(doc.ids, doc.beginEnd !== undefined);
