// 通用的文件编辑会话：当前打开的文档、对应文件、撤销 / 重做、保存与自动保存。
// 对话（dialog.svelte.ts）和任务链（task.svelte.ts）各有一个会话，共用这里的流程；
// 文档种类相关的部分（解析、写出、结构体 ID 是否填齐、载入提示）由各自的 SessionSpec 提供。
// 导入文件或从历史打开时先识别种类，种类不符就交给另一个会话打开并切换主页页签。
import { FormatError } from "../model/codec";
import { pathKey } from "../model/history";
import { type FileKind, detectKind } from "../model/taskCodec";
import { baseName, fileExists, isTauri, openJson, readTextAt, renameJsonAt, saveJson, writeText } from "./files";
import { recordFile, renameHistoryFile } from "./history.svelte";
import { nav } from "./nav.svelte";
import { settings } from "./settings.svelte";
import { confirm, toast } from "./ui.svelte";

/** 撤销 / 重做各自最多保留的步数 */
export const MAX_STEPS = 50;

export interface SessionSpec<D, S extends { doc: D }> {
  kind: FileKind;
  /** 用在提示文字里的名称：「对话」「任务链」 */
  noun: string;
  lastKey: string;
  saveTitle: string;
  filterName: string;
  defaultName: string;
  /** 结构体 ID 没填齐时的保存提示 */
  readyHint: string;
  /** 结构体 ID 没填齐时聚焦的元素 id（侧栏会把它转到元数据视图） */
  focusId: string;
  parse(text: string): S;
  stringify(doc: D): string;
  ready(doc: D): boolean;
  /** 保存成功后的附加警告（有则用警告提示代替“已保存”） */
  saveWarning?(doc: D): string | null;
  /** 载入成功的提示 */
  loadedToast(name: string, state: S): { text: string; kind?: "success" | "info" };
  /** 载入后重置种类相关的状态 */
  onLoad?(state: S): void;
  /** 撤销 / 重做时把快照还原成编辑状态（保留当前的元数据、剪贴板等） */
  restore?(snap: D, cur: S): S;
}

export class FileSession<D, S extends { doc: D }> {
  edit = $state.raw<S | null>(null);
  fileName = $state("");
  /** 对应的本地文件路径；新建的文档、浏览器预览里为空，此时「保存」即「另存为」 */
  filePath = $state("");
  /** 上次保存（或载入）时的文档；与当前不是同一个对象即有未保存的修改 */
  saved = $state.raw<D | null>(null);
  selectedUid = $state(0);
  editingIndex = $state(-1);
  /** 正在读写文件 */
  busy = $state(false);
  /** 刚载入：列表错峰入场 */
  stagger = $state(false);
  undoStack = $state.raw<D[]>([]);
  redoStack = $state.raw<D[]>([]);
  /** 启动时记下、切到本页签时再打开的上次文件 */
  pendingOpen = "";
  /** 新建文档在本次编辑会话里选定的另存为页签 */
  private historyTab: string | undefined;
  private autoSaveFailed = false;
  private savingChanges = $state(false);
  private autoSaveAgain = false;

  constructor(readonly spec: SessionSpec<D, S>) {}

  get doc(): D | null {
    return this.edit?.doc ?? null;
  }
  get ready(): boolean {
    return this.edit ? this.spec.ready(this.edit.doc) : false;
  }
  get dirty(): boolean {
    return this.edit != null && this.edit.doc !== this.saved;
  }
  /** 提交改动或每步操作触发的写入完成前，暂缓显示「未保存」。 */
  get showUnsaved(): boolean {
    return this.dirty && !this.savingChanges;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  playStagger() {
    this.stagger = true;
    setTimeout(() => (this.stagger = false), 500);
  }

  /** 写入一次修改。step 为 false 时不记入撤销（结构体 ID 等元数据、复制到剪贴板） */
  commit(next: S, opt: { step?: boolean } = {}) {
    const prev = this.edit;
    if (next === prev) return;
    if (prev && opt.step !== false && next.doc !== prev.doc) {
      this.undoStack = [...this.undoStack, prev.doc].slice(-MAX_STEPS);
      this.redoStack = [];
    }
    this.edit = next;
    if (opt.step !== false && settings.autoSaveWhen === "step") void this.autoSave();
  }

  private restoreSnap(snap: D) {
    const cur = this.edit!;
    this.edit = this.spec.restore ? this.spec.restore(snap, cur) : ({ ...cur, doc: snap } as S);
    if (settings.autoSaveWhen === "step") void this.autoSave();
  }

  undo() {
    if (!this.edit || !this.canUndo || this.editingIndex >= 0) return;
    const snap = this.undoStack.at(-1)!;
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [...this.redoStack, this.edit.doc].slice(-MAX_STEPS);
    this.restoreSnap(snap);
  }

  redo() {
    if (!this.edit || !this.canRedo || this.editingIndex >= 0) return;
    const snap = this.redoStack.at(-1)!;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [...this.undoStack, this.edit.doc].slice(-MAX_STEPS);
    this.restoreSnap(snap);
  }

  rememberLast(path: string) {
    try {
      if (path) localStorage.setItem(this.spec.lastKey, path);
      else localStorage.removeItem(this.spec.lastKey);
    } catch {
      // 存不下：只影响下次启动时是否重新打开
    }
  }

  lastPath(): string {
    try {
      return localStorage.getItem(this.spec.lastKey) ?? "";
    } catch {
      return "";
    }
  }

  load(next: S, name: string, path = "", historyTab?: string) {
    this.edit = next;
    this.saved = next.doc;
    this.fileName = name;
    this.filePath = path;
    this.historyTab = historyTab;
    this.selectedUid = 0;
    this.editingIndex = -1;
    this.undoStack = [];
    this.redoStack = [];
    this.pendingOpen = "";
    this.spec.onLoad?.(next);
    this.rememberLast(path);
    if (path) recordFile(path, this.spec.kind);
    this.playStagger();
  }

  /** 有未保存的修改时先确认 */
  guard(run: () => void) {
    if (!this.dirty) return run();
    confirm({
      title: "放弃未保存的修改？",
      message: `当前${this.spec.noun}有尚未保存的修改，继续后这些修改会丢失。`,
      action: "放弃修改",
      danger: true,
      run,
    });
  }

  /** 解析并载入一份文本；格式不对时抛出 FormatError */
  loadText(text: string, name: string, path: string): S {
    const state = this.spec.parse(text);
    this.load(state, name, path);
    return state;
  }

  /** 保存：有本地文件时直接写回；asNew 或没有本地文件时弹出另存为对话框。返回是否已保存 */
  async saveFile(asNew = false): Promise<boolean> {
    const doc = this.doc;
    if (!doc || this.busy) return false;
    if (!this.ready) {
      toast(this.spec.readyHint, "error");
      document.getElementById(this.spec.focusId)?.focus();
      return false;
    }
    this.busy = true;
    try {
      const text = this.spec.stringify(doc);
      const { filePath, historyTab } = this;
      const saveAs = asNew || !filePath;
      const saved = saveAs
        ? await saveJson(text, filePath || this.fileName || this.spec.defaultName, {
            title: this.spec.saveTitle,
            filterName: this.spec.filterName,
          })
        : await writeText(filePath, text);
      if (!saved) return false;
      this.fileName = saved.name;
      this.filePath = saved.path ?? "";
      this.saved = doc;
      this.rememberLast(this.filePath);
      if (this.filePath) recordFile(this.filePath, this.spec.kind, saveAs ? historyTab : undefined);
      const warn = this.spec.saveWarning?.(doc);
      if (warn) toast(`已保存 ${saved.name}。${warn}`, "info");
      else toast(`已保存 ${saved.name}`);
      return true;
    } catch (e) {
      toast(`保存失败：${String(e)}`, "error");
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** 本地文件被彻底删除后调用：当前文档若正对应这个文件，就与它脱钩并视为未保存 */
  detachFile(path: string) {
    if (!this.filePath || pathKey(this.filePath) !== pathKey(path)) return;
    this.filePath = "";
    this.saved = null;
    this.rememberLast("");
  }

  updateRenamedPath(from: string, to: string) {
    const key = pathKey(from);
    if (pathKey(this.filePath) === key) {
      this.filePath = to;
      this.fileName = baseName(to);
    }
    if (pathKey(this.pendingOpen) === key) this.pendingOpen = to;
    if (pathKey(this.lastPath()) === key) this.rememberLast(to);
  }

  /** 自动保存：写回原文件，不创建副本、不提示。没有对应文件或结构体 ID 没填时不做 */
  async autoSave(): Promise<boolean> {
    if (this.busy) {
      if (this.savingChanges) this.autoSaveAgain = true;
      return false;
    }
    const doc = this.doc;
    const path = this.filePath;
    if (!settings.autoSave || !doc || !path || !this.dirty || !this.ready || !isTauri) return false;
    this.busy = true;
    this.savingChanges = settings.autoSaveWhen !== "interval";
    try {
      let snapshot = doc;
      for (;;) {
        this.autoSaveAgain = false;
        await writeText(path, this.spec.stringify(snapshot));
        if (this.filePath !== path) return false;
        this.saved = snapshot;
        this.autoSaveFailed = false;
        const latest = this.doc;
        if (!this.autoSaveAgain || !settings.autoSave || settings.autoSaveWhen === "interval" ||
            !latest || !this.dirty || !this.ready) return true;
        snapshot = latest;
      }
    } catch (e) {
      // 连续失败只提示一次
      if (!this.autoSaveFailed) toast(`自动保存失败：${String(e)}`, "error");
      this.autoSaveFailed = true;
      return false;
    } finally {
      this.savingChanges = false;
      this.busy = false;
    }
  }
}

// —— 两个会话之间的分流 ——

type AnySession = FileSession<any, any>;
const sessions: Partial<Record<FileKind, AnySession>> = {};

export function registerSession(s: AnySession) {
  sessions[s.spec.kind] = s;
}

export function sessionOf(kind: FileKind): AnySession {
  return sessions[kind]!;
}

function sessionsAt(path: string): AnySession[] {
  const key = pathKey(path);
  return Object.values(sessions).filter((s) => s.filePath && pathKey(s.filePath) === key);
}

export function renameBlockReason(path: string): string {
  if (!isTauri) return "仅桌面版可重命名文件";
  if (!/\.json$/i.test(path)) return "只能重命名 JSON 文件";
  const open = sessionsAt(path);
  if (open.some((s) => s.busy)) return "文件正在读写";
  if (open.some((s) => s.dirty)) return "请先保存未保存的修改";
  return "";
}

export async function renameFile(path: string, stem: string): Promise<string> {
  const blocked = renameBlockReason(path);
  if (blocked) throw new Error(blocked);
  const open = sessionsAt(path);
  for (const s of open) s.busy = true;
  try {
    const renamed = await renameJsonAt(path, stem);
    renameHistoryFile(path, renamed);
    for (const s of Object.values(sessions)) s.updateRenamedPath(path, renamed);
    return renamed;
  } finally {
    for (const s of open) s.busy = false;
  }
}

const loadError = (e: unknown) => (e instanceof FormatError ? `导入失败：${e.message}` : `导入失败：${String(e)}`);

/** 一份已读到的文本：按种类交给对应会话（必要时先确认放弃该会话的修改），并切到对应页签 */
function openText(
  text: string,
  name: string,
  path: string,
  fallback: FileKind,
  opt: { silent?: boolean },
): Promise<boolean> {
  const kind = detectKind(text) ?? fallback;
  const target = sessionOf(kind);
  if (target.busy) return Promise.resolve(false);
  return new Promise((resolve) => {
    const run = () => {
      try {
        const state = target.loadText(text, name, path);
        if (nav.homeTab !== kind) nav.homeTab = kind;
        if (!opt.silent) {
          const t = target.spec.loadedToast(name, state);
          toast(t.text, t.kind);
        }
        resolve(true);
      } catch (e) {
        if (!opt.silent) toast(loadError(e), "error");
        resolve(false);
      }
    };
    if (!target.dirty) return run();
    confirm({
      title: "放弃未保存的修改？",
      message: `当前${target.spec.noun}有尚未保存的修改，继续后这些修改会丢失。`,
      action: "放弃修改",
      danger: true,
      run,
    });
  });
}

/** 导入文件：弹出系统的打开对话框；按文件种类打开到对应页签 */
export async function importFileFor(from: FileKind): Promise<void> {
  const self = sessionOf(from);
  if (self.busy) return;
  self.busy = true;
  let file: Awaited<ReturnType<typeof openJson>>;
  try {
    file = await openJson();
  } catch (e) {
    toast(loadError(e), "error");
    return;
  } finally {
    self.busy = false;
  }
  if (file) await openText(file.text, file.name, file.path ?? "", from, {});
}

/** 按路径打开一个之前打开过的文件（历史文件、启动时重新打开）。kind 为记录里的种类，读到后以实际内容为准 */
export async function openPathAs(kind: FileKind, path: string, opt: { silent?: boolean } = {}): Promise<boolean> {
  let file: { text: string; name: string };
  try {
    file = await readTextAt(path);
  } catch (e) {
    if (!opt.silent) toast(loadError(e), "error");
    return false;
  }
  return openText(file.text, file.name, path, kind, opt);
}

/** 启动时：上次的文件还在就静默打开 */
export async function reopenLast(s: AnySession): Promise<boolean> {
  const last = s.lastPath();
  if (!last || s.edit) return false;
  try {
    if (!(await fileExists(last))) return false;
  } catch {
    return false;
  }
  return s.edit ? false : openPathAs(s.spec.kind, last, { silent: true });
}
