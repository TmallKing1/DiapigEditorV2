// 任务链数据模型。字段含义见 docs/任务迁移方案.md 3.1（结构体「任务」「任务链」）。
// 列表操作都是纯函数，返回新对象；任务之间没有互相引用，增删移动不用修正序号。
import { newUid } from "./types";

export const MARKER_NONE = 0;
export const MARKER_POINT = 1;
export const MARKER_RANGE = 2;
export const MARKER_LABELS = ["无标点", "单点并追踪", "范围圈"] as const;
/** 范围圈可选的半径（米）：小地图标识 2–11 对应 2、4 … 20 m */
export const MARKER_RANGES = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] as const;

export interface TaskItem {
  /** 仅用于界面列表的稳定标识，不写入文件 */
  uid: number;
  /** 任务编号：玩法调用「推进任务」时用来匹配 */
  id: number;
  name: string;
  /** 无标点或尚无距离时显示 */
  hint: string;
  /** 预设点序号 */
  point: number;
  /** 0 无 / 1 单点并追踪 / 2 范围圈 */
  marker: number;
  /** 范围圈半径（米），2–20 的偶数 */
  markerRange: number;
  /** 检测范围（米）：进入后提示「已到达任务区域」 */
  detect: number;
  /** 自动推进范围（米）：≤ 0 表示只能由玩法推进 */
  auto: number;
  optional: string;
  /** 进入任务事件：成为当前任务时派发给玩家（E·玩家任务事件触发时），留空不派发 */
  enterEvent: string;
}

export interface TaskIds {
  chain: string;
  task: string;
}

export interface TaskDoc {
  ids: TaskIds;
  /** 任务链名称：完成提示的标题 */
  name: string;
  tasks: TaskItem[];
  /** 任务完成事件：整条链做完时派发给玩家，留空不派发 */
  completeEvent: string;
}

export interface TaskEditState {
  doc: TaskDoc;
  /** 内部剪贴板里的任务 */
  clipboard: TaskItem | null;
}

export function newTask(id = 0): TaskItem {
  return {
    uid: newUid(),
    id,
    name: "新任务",
    hint: "",
    point: 0,
    marker: MARKER_NONE,
    markerRange: 8,
    detect: 0,
    auto: 0,
    optional: "",
    enterEvent: "",
  };
}

export function cloneTask(t: TaskItem): TaskItem {
  return { ...t, uid: newUid() };
}

/** 新任务的默认编号：当前最大编号 + 1；没有任务时为 0 */
export function nextTaskId(tasks: TaskItem[]): number {
  return tasks.length ? Math.max(...tasks.map((t) => t.id)) + 1 : 0;
}

/** 出现不止一次的编号 */
export function duplicateIds(tasks: TaskItem[]): Set<number> {
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const t of tasks) (seen.has(t.id) ? dup : seen).add(t.id);
  return dup;
}

export const DEFAULT_TASK_NAME = "新任务链";

export function newTaskDoc(ids?: TaskIds, name = DEFAULT_TASK_NAME): TaskDoc {
  return {
    ids: ids ? { ...ids } : { chain: "0", task: "0" },
    name: name.trim() || DEFAULT_TASK_NAME,
    tasks: [newTask(0)],
    completeEvent: "",
  };
}

export function taskIdsReady(ids: TaskIds): boolean {
  return [ids.chain, ids.task].every((id) => id.trim() !== "" && id.trim() !== "0");
}

// —— 列表操作 ——

function withTasks(state: TaskEditState, tasks: TaskItem[]): TaskEditState {
  return { ...state, doc: { ...state.doc, tasks } };
}

export function insertTask(state: TaskEditState, index: number, task: TaskItem): TaskEditState {
  const tasks = state.doc.tasks.slice();
  tasks.splice(index, 0, task);
  return withTasks(state, tasks);
}

/** 在 index 之后添加一个新任务，编号取最大编号 + 1 */
export function addTaskAfter(state: TaskEditState, index: number, task?: TaskItem): TaskEditState {
  return insertTask(state, index + 1, task ?? newTask(nextTaskId(state.doc.tasks)));
}

/** 复制一份放在后面；副本的编号取最大编号 + 1，避免重复 */
export function duplicateTask(state: TaskEditState, index: number): TaskEditState {
  const copy = { ...cloneTask(state.doc.tasks[index]), id: nextTaskId(state.doc.tasks) };
  return insertTask(state, index + 1, copy);
}

export function removeTask(state: TaskEditState, index: number): TaskEditState {
  if (state.doc.tasks.length <= 1) return state;
  const tasks = state.doc.tasks.slice();
  tasks.splice(index, 1);
  return withTasks(state, tasks);
}

export function moveTask(state: TaskEditState, from: number, to: number): TaskEditState {
  const n = state.doc.tasks.length;
  if (from === to || to < 0 || to >= n) return state;
  const tasks = state.doc.tasks.slice();
  const [t] = tasks.splice(from, 1);
  tasks.splice(to, 0, t);
  return withTasks(state, tasks);
}

/** 用剪贴板里的任务覆盖 index 处（保留原任务的 uid，列表不跳动） */
export function pasteTaskOver(state: TaskEditState, index: number): TaskEditState {
  if (!state.clipboard) return state;
  const tasks = state.doc.tasks.slice();
  tasks[index] = { ...state.clipboard, uid: tasks[index].uid };
  return withTasks(state, tasks);
}

export function replaceTask(state: TaskEditState, index: number, task: TaskItem): TaskEditState {
  const tasks = state.doc.tasks.slice();
  tasks[index] = task;
  return withTasks(state, tasks);
}

export function markerText(t: TaskItem): string {
  if (t.marker === MARKER_POINT) return "单点追踪";
  if (t.marker === MARKER_RANGE) return `范围 ${t.markerRange} m`;
  return "无标点";
}
