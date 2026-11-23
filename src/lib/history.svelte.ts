// 历史文件：记录打开过的对话与任务链文件，按用户自定义的页签归类。保存在本机 localStorage。
// 页签和系统目录没有直接关系；新打开的文件放进「未分类页签」。
import { parseDialog } from "../model/codec";
import { type FileKind, detectKind, parseTaskChain } from "../model/taskCodec";
import {
  type HistoryData,
  addEntries,
  addTab,
  dissolveTabEntries,
  emptyHistory,
  hasTab,
  moveEntry,
  normalizeHistory,
  recordOpen,
  renameEntry,
  removeEntry,
  removeTab,
  uniqueTabName,
  visibleTabs,
} from "../model/history";
import { baseName, isTauri, listJsonFiles, pickFolder, readTextAt } from "./files";
import { toast } from "./ui.svelte";

const KEY = "diapig-editor.history.v1";
const CURRENT_KEY = "diapig-editor.history.currentTab";

function readCurrent(): string {
  try {
    return localStorage.getItem(CURRENT_KEY) ?? "";
  } catch {
    return "";
  }
}

function read(): HistoryData {
  try {
    const text = localStorage.getItem(KEY);
    return text ? normalizeHistory(JSON.parse(text)) : emptyHistory();
  } catch {
    // 损坏或读不到：当作没有历史
    return emptyHistory();
  }
}

function write(data: HistoryData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 存不下：本次运行内仍可用，只是下次启动不在
  }
}

// 模块载入时就读一次：对话会话启动时就会导入本模块，读一次 localStorage 的代价很小；
// 推迟到首次使用反而可能落在 $derived 里写状态（Svelte 不允许）
export const hist = $state<{
  data: HistoryData;
  /** 左侧栏选中的页签 id；空 = 还没选（取第一个可见页签） */
  current: string;
  /** 导入文件夹进行中：已处理 / 总数；null = 没在导入 */
  importing: { done: number; total: number } | null;
}>({ data: read(), current: readCurrent(), importing: null });

function commit(next: HistoryData) {
  if (next === hist.data) return;
  hist.data = next;
  write(next);
  if (hist.current) selectHistoryTab(currentTab());
}

/** 当前应显示的页签：选中的页签已不可见（被删、未分类清空）时退回第一个可见页签 */
export function currentTab(): string {
  const tabs = visibleTabs(hist.data);
  return tabs.some((t) => t.id === hist.current) ? hist.current : (tabs[0]?.id ?? "");
}

export function selectHistoryTab(id: string) {
  if (hist.current === id) return;
  hist.current = id;
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // 仍可在本次运行内记住选择。
  }
}

/** 打开或保存本地文件后记入历史；新建文档另存为时可指定页签 */
export function recordFile(path: string, kind: FileKind = "dialog", targetTab?: string): void {
  commit(recordOpen(hist.data, path, Date.now(), kind, targetTab));
}

let idSeq = 0;
const newId = () => `t${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/** 新建页签；名称由调用方先用 checkTabName 校验 */
export function createTab(name: string, select = true): string {
  const id = newId();
  commit(addTab(hist.data, name, id));
  if (select && hasTab(hist.data, id)) selectHistoryTab(id);
  return id;
}

export function deleteTab(id: string) {
  commit(removeTab(hist.data, id));
}

/** 解散页签：页签删除，其中的文件引用移到「未分类」 */
export function dissolveTab(id: string) {
  commit(dissolveTabEntries(hist.data, id));
}

export function forgetFile(path: string) {
  commit(removeEntry(hist.data, path));
}

export function renameHistoryFile(from: string, to: string) {
  commit(renameEntry(hist.data, from, to));
}

export function moveFile(path: string, tab: string) {
  commit(moveEntry(hist.data, path, tab));
}

/** 每处理这么多个文件让出一次主线程，文件很多时界面不卡死 */
const YIELD_EVERY = 8;
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

/** 导入文件夹：选一个文件夹，把其下能解析为对话或任务链的 .json 放进一个新页签 */
export async function importFolder(): Promise<void> {
  if (!isTauri || hist.importing) return;
  let dir: string | null;
  try {
    dir = await pickFolder("选择要导入的文件夹");
  } catch (e) {
    toast(`无法打开文件夹选择：${String(e)}`, "error");
    return;
  }
  if (!dir) return;
  hist.importing = { done: 0, total: 0 };
  try {
    const files = await listJsonFiles(dir);
    hist.importing = { done: 0, total: files.length };
    const ok: string[] = [];
    const kinds = new Map<string, FileKind>();
    for (let i = 0; i < files.length; i++) {
      try {
        const text = (await readTextAt(files[i].path)).text;
        const kind = detectKind(text);
        if (kind === "task") parseTaskChain(text);
        else parseDialog(text);
        ok.push(files[i].path);
        kinds.set(files[i].path, kind ?? "dialog");
      } catch {
        // 读不到或不是对话 / 任务链文件：跳过，只计数
      }
      hist.importing = { done: i + 1, total: files.length };
      if ((i + 1) % YIELD_EVERY === 0) await yieldFrame();
    }
    const skipped = files.length - ok.length;
    if (!ok.length) {
      toast(files.length ? `没有可导入的文件（跳过 ${skipped} 个）` : "这个文件夹里没有 .json 文件", "info");
      return;
    }
    // 按文件名排序后放入，列表里的顺序与资源管理器里大致一致
    ok.sort((a, b) => baseName(a).localeCompare(baseName(b), "zh-CN", { numeric: true }));
    const name = uniqueTabName(hist.data, baseName(dir.replace(/[\\/]+$/, "")));
    const id = newId();
    commit(addEntries(addTab(hist.data, name, id), ok, id, Date.now(), (p) => kinds.get(p) ?? "dialog"));
    selectHistoryTab(id);
    toast(skipped ? `已导入 ${ok.length} 个文件到「${name}」，跳过 ${skipped} 个` : `已导入 ${ok.length} 个文件到「${name}」`);
  } catch (e) {
    toast(`导入失败：${String(e)}`, "error");
  } finally {
    hist.importing = null;
  }
}
