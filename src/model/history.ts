// 历史文件（对话与任务链）的数据模型（纯函数，不碰 localStorage 和文件系统）。
// 每个函数都返回新对象，不改传入的数据：界面状态直接整体替换，撤销不了的误改也不会半途生效。

/** 未分类页签的固定 id：新打开的文件默认放这里；不能删除，没有文件时不显示 */
import type { FileKind } from "./taskCodec";

export const UNSORTED = "unsorted";
export const UNSORTED_NAME = "未分类";

export interface HistoryTab {
  id: string;
  name: string;
}

export interface HistoryEntry {
  /** 原样保存的路径（显示和打开用这个） */
  path: string;
  /** 所属页签 id */
  tab: string;
  /** 最近一次打开（或导入）的时间，毫秒 */
  time: number;
  /** 文件种类；旧版记录没有这一项，按对话处理 */
  kind: FileKind;
}

export interface HistoryData {
  /** 用户自定义的页签，按创建顺序；不含未分类页签 */
  tabs: HistoryTab[];
  entries: HistoryEntry[];
}

export const emptyHistory = (): HistoryData => ({ tabs: [], entries: [] });

/** 比较用的路径键：统一分隔符、去掉末尾分隔符，且不区分大小写（Windows 的路径不分大小写） */
export function pathKey(path: string): string {
  return path.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

const samePath = (a: string, b: string) => pathKey(a) === pathKey(b);

/** 记一次打开或保存；指定目标页签时也更新归类 */
export function recordOpen(data: HistoryData, path: string, now: number, kind: FileKind = "dialog", targetTab?: string): HistoryData {
  if (!path.trim()) return data;
  const i = data.entries.findIndex((e) => samePath(e.path, path));
  const tab = targetTab === undefined
    ? (data.entries[i]?.tab ?? UNSORTED)
    : hasTab(data, targetTab) ? targetTab : UNSORTED;
  if (i < 0) return { ...data, entries: [...data.entries, { path, tab, time: now, kind }] };
  const entries = data.entries.slice();
  entries[i] = { ...entries[i], tab, time: now, kind };
  return { ...data, entries };
}

/** 把一批文件放进某个页签（导入文件夹）。已在历史里的移过去并保留原时间，新的按给定顺序排在前面 */
export function addEntries(
  data: HistoryData,
  paths: string[],
  tab: string,
  now: number,
  kindOf: (path: string) => FileKind = () => "dialog",
): HistoryData {
  const entries = data.entries.slice();
  const seen = new Set<string>();
  paths.forEach((path, n) => {
    const key = pathKey(path);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const i = entries.findIndex((e) => pathKey(e.path) === key);
    // 同一批的时间依次减 1 毫秒，按时间倒序时保持传入的顺序
    if (i < 0) entries.push({ path, tab, time: now - n, kind: kindOf(path) });
    else entries[i] = { ...entries[i], tab, kind: kindOf(path) };
  });
  return { ...data, entries };
}

export function removeEntry(data: HistoryData, path: string): HistoryData {
  return { ...data, entries: data.entries.filter((e) => !samePath(e.path, path)) };
}

/** 改写旧引用并保留所属页签、时间与种类。目标路径若有过期引用，归并到这条记录。 */
export function renameEntry(data: HistoryData, from: string, to: string): HistoryData {
  const source = data.entries.find((e) => samePath(e.path, from));
  if (!source || source.path === to) return data;
  const entries = data.entries
    .filter((e) => e === source || !samePath(e.path, to))
    .map((e) => e === source ? { ...e, path: to } : e);
  return { ...data, entries };
}

export function moveEntry(data: HistoryData, path: string, tab: string): HistoryData {
  if (!hasTab(data, tab)) return data;
  return { ...data, entries: data.entries.map((e) => (samePath(e.path, path) ? { ...e, tab } : e)) };
}

export function hasTab(data: HistoryData, id: string): boolean {
  return id === UNSORTED || data.tabs.some((t) => t.id === id);
}

export function tabName(data: HistoryData, id: string): string {
  return id === UNSORTED ? UNSORTED_NAME : (data.tabs.find((t) => t.id === id)?.name ?? "");
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** 新页签名称的问题；没问题返回空串。重名不区分大小写，也不能和未分类页签同名 */
export function checkTabName(data: HistoryData, name: string): string {
  const key = nameKey(name);
  if (!key) return "名称不能为空";
  if (key === nameKey(UNSORTED_NAME) || data.tabs.some((t) => nameKey(t.name) === key)) return "已有同名页签";
  return "";
}

/** 不重名的页签名：重名时依次加「 (2)」「 (3)」… */
export function uniqueTabName(data: HistoryData, base: string): string {
  const name = base.trim() || "导入的文件";
  if (!checkTabName(data, name)) return name;
  for (let n = 2; ; n++) {
    const next = `${name} (${n})`;
    if (!checkTabName(data, next)) return next;
  }
}

/** 新建页签；名称不合法时原样返回 */
export function addTab(data: HistoryData, name: string, id: string): HistoryData {
  if (checkTabName(data, name) || hasTab(data, id)) return data;
  return { ...data, tabs: [...data.tabs, { id, name: name.trim() }] };
}

/** 删除页签及其中的文件引用（不删本地文件）；未分类页签不能删 */
export function removeTab(data: HistoryData, id: string): HistoryData {
  if (id === UNSORTED) return data;
  return { tabs: data.tabs.filter((t) => t.id !== id), entries: data.entries.filter((e) => e.tab !== id) };
}

/** 解散页签：删除页签，其中的文件引用移到「未分类」（不删本地文件）；未分类页签不能解散 */
export function dissolveTabEntries(data: HistoryData, id: string): HistoryData {
  if (id === UNSORTED) return data;
  return {
    tabs: data.tabs.filter((t) => t.id !== id),
    entries: data.entries.map((e) => (e.tab === id ? { ...e, tab: UNSORTED } : e)),
  };
}

export function countIn(data: HistoryData, tab: string): number {
  return data.entries.reduce((n, e) => n + (e.tab === tab ? 1 : 0), 0);
}

/** 左侧栏显示的页签：未分类页签有文件时排在最前，其后是用户页签 */
export function visibleTabs(data: HistoryData): HistoryTab[] {
  const list = data.tabs.slice();
  if (countIn(data, UNSORTED) > 0) list.unshift({ id: UNSORTED, name: UNSORTED_NAME });
  return list;
}

/** 某页签下的文件，按最近打开时间倒序 */
export function entriesOf(data: HistoryData, tab: string): HistoryEntry[] {
  return data.entries.filter((e) => e.tab === tab).sort((a, b) => b.time - a.time);
}

/** 从存储读出的任意值整理成合法数据：结构不对退回空；去重（保留时间较新的一条）；页签不存在的文件归入未分类 */
export function normalizeHistory(raw: unknown): HistoryData {
  if (!raw || typeof raw !== "object") return emptyHistory();
  const r = raw as { tabs?: unknown; entries?: unknown };
  if (!Array.isArray(r.tabs) || !Array.isArray(r.entries)) return emptyHistory();
  let data = emptyHistory();
  for (const t of r.tabs) {
    if (!t || typeof t.id !== "string" || typeof t.name !== "string" || !t.id) continue;
    data = addTab(data, t.name, t.id);
  }
  const byKey = new Map<string, HistoryEntry>();
  for (const e of r.entries) {
    if (!e || typeof e.path !== "string" || !pathKey(e.path)) continue;
    const time = typeof e.time === "number" && Number.isFinite(e.time) ? e.time : 0;
    const tab = typeof e.tab === "string" && hasTab(data, e.tab) ? e.tab : UNSORTED;
    const kind: FileKind = e.kind === "task" ? "task" : "dialog";
    const key = pathKey(e.path);
    const old = byKey.get(key);
    if (!old || old.time < time) byKey.set(key, { path: e.path, tab, time, kind });
  }
  return { ...data, entries: [...byKey.values()] };
}

/** 路径里的目录部分（显示在文件名下方）；没有目录时为空串 */
export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : "";
}
