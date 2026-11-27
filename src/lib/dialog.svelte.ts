// 对话编辑会话：当前打开的对话与对话特有的操作。文件读写、撤销 / 重做、自动保存的通用流程在 fileSession.svelte.ts。
// 界面组件只读这里的状态并调用这里的函数，不各自保存一份。
import { parseDialog, stringifyDialog } from "../model/codec";
import { inheritConflicts, inheritWarning } from "../model/inheritTitles";
import {
  type EditState,
  addNodeAfter,
  cleanDoc,
  duplicateNode,
  moveNode,
  pasteOver,
  referencesTo,
  removeNode,
  replaceNode,
  withAutoEnd,
} from "../model/ops";
import {
  type BeginEnd,
  type DialogDoc,
  type DialogNode,
  type StructIds,
  cloneNode,
  docReady,
  newBeginEnd,
  newDoc,
  newNode,
} from "../model/types";
import { FileSession, importFileFor, openPathAs, registerSession } from "./fileSession.svelte";
import { defaultIds, settings } from "./settings.svelte";
import { newDialogIds } from "../model/defaultIds";
import { confirm, toast } from "./ui.svelte";

export { MAX_STEPS } from "./fileSession.svelte";

export type RowAction = "add" | "duplicate" | "copy" | "paste" | "up" | "down" | "remove";

/** 正在解析的文件是否从 v1 转换而来 / 是否缺起止设置（旧结构）；载入后交给 dlg.v1Notice / dlg.shapeNotice */
let parsedFromV1 = false;
let parsedOldShape = false;

const sameIds = (a: StructIds, b: StructIds) =>
  a.dialog === b.dialog && a.node === b.node && a.branch === b.branch && a.beginEnd === b.beginEnd;

class DialogSession extends FileSession<DialogDoc, EditState> {
  v1Notice = $state(false);
  /** 载入的文件是旧结构（没有起止设置）：已补上，提示换成新结构的 ID */
  shapeNotice = $state(false);
  idsTouched = $state(false);

  constructor() {
    super({
      kind: "dialog",
      noun: "对话",
      lastKey: "diapig-editor.lastFile",
      saveTitle: "对话另存为",
      filterName: "对话文件",
      defaultName: "dialog.json",
      readyHint: "保存前请先填写结构体 ID",
      focusId: "id-dialog",
      parse(text) {
        const result = parseDialog(text);
        if (result.doc.nodes.length === 0) result.doc.nodes.push(makeNode(true));
        parsedFromV1 = result.convertedFromV1;
        // 游戏内导入只接受新版完整结构：旧结构的文件一律补上起止设置，按新结构编辑和保存
        parsedOldShape = result.doc.beginEnd === undefined;
        if (parsedOldShape) {
          result.doc.beginEnd = newBeginEnd();
          result.doc.ids = { ...result.doc.ids, beginEnd: result.doc.ids.beginEnd ?? "0" };
        }
        return { doc: result.doc, clipboard: null };
      },
      stringify: (doc) => stringifyDialog(outputDoc(doc)),
      saveWarning: (doc) => {
        const list = inheritConflicts(outputDoc(doc));
        return list.length ? inheritWarning(list[0]) + (list.length > 1 ? `（另有 ${list.length - 1} 处）` : "") : null;
      },
      ready: docReady,
      loadedToast: (name, state) =>
        dlg.v1Notice
          ? { text: `已导入 ${name}，并从旧版格式转换为 v2`, kind: "info" }
          : { text: `已导入 ${name}（${state.doc.nodes.length} 个节点）` },
      onLoad() {
        dlg.idsTouched = false;
        dlg.v1Notice = parsedFromV1;
        dlg.shapeNotice = parsedOldShape && !parsedFromV1;
        parsedFromV1 = parsedOldShape = false;
      },
      // 撤销 / 重做只还原节点与开始节点：结构体 ID 保持当前值，剪贴板保留（引用序号收回到有效范围）
      restore(snap, cur) {
        const doc = sameIds(snap.ids, cur.doc.ids) ? snap : { ...snap, ids: cur.doc.ids };
        const last = doc.nodes.length - 1;
        const clamp = (i: number) => Math.min(Math.max(i, 0), last);
        const clip = cur.clipboard;
        if (!doc.nodes.some((n) => n.uid === dlg.selectedUid)) dlg.selectedUid = 0;
        return {
          doc,
          clipboard: clip && { ...clip, jump: clamp(clip.jump), branches: clip.branches.map((b) => ({ ...b, jump: clamp(b.jump) })) },
        };
      },
    });
  }
}

export const dlg = new DialogSession();
registerSession(dlg);

/** 新对话的开始节点没有上一段标题可继承 */
function makeNode(isStart = false): DialogNode {
  const node = newNode();
  const inheritTitle = !isStart && settings.newNodeInheritTitle;
  const defaultTitle = isStart && settings.newNodeInheritTitle
    ? settings.newNodeTitle || node.title
    : settings.newNodeTitle;
  return {
    ...node,
    inheritTitle,
    title: inheritTitle ? "" : defaultTitle,
    subtitle: inheritTitle ? "" : settings.newNodeSubtitle,
    content: settings.newNodeContent,
    op: settings.newNodeOp,
  };
}

/** 导出、预览用的对话：按设置处理末尾的「跳转下个节点」 */
export function outputDoc(doc: DialogDoc): DialogDoc {
  return settings.autoEnd ? withAutoEnd(doc) : doc;
}

export const playStagger = () => dlg.playStagger();
export const commit = (next: EditState, opt: { step?: boolean } = {}) => dlg.commit(next, opt);
export const undo = () => dlg.undo();
export const redo = () => dlg.redo();
export const guard = (run: () => void) => dlg.guard(run);
export const saveFile = (asNew = false) => dlg.saveFile(asNew);
export const autoSave = () => dlg.autoSave();
export const detachFile = (path: string) => dlg.detachFile(path);

export function createNew(historyTab: string) {
  // 设置里填了默认结构体 ID 的项用设置的值；没填的沿用当前对话，省得重填。总是新结构（带起止设置）
  const cur = dlg.doc;
  const { ids } = newDialogIds(defaultIds(), cur ? { ids: cur.ids, withBeginEnd: true } : undefined);
  dlg.load({ doc: { ...newDoc(ids, true), nodes: [makeNode(true)] }, clipboard: null }, "", "", historyTab);
}

/** 导入文件：弹出系统的打开对话框；选中的是任务链时打开到任务页签 */
export const importFile = () => importFileFor("dialog");

/** 按路径打开一个之前打开过的文件。silent：成功和失败都不提示 */
export const openPath = (path: string, opt: { silent?: boolean } = {}) => openPathAs("dialog", path, opt);

export function clean() {
  const state = dlg.edit;
  if (!state) return;
  confirm({
    title: "清理未使用的数据？",
    message: "会清空各节点用不到的字段：继承标题节点的标题与副标题（导出时会按沿用来源重新补上）、非跳转节点的跳转序号、非分支节点的分支列表。",
    action: "清理",
    run: () => {
      commit({ ...state, doc: cleanDoc(state.doc) });
      toast("已清理未使用的数据");
    },
  });
}

export function setIds(patch: Partial<StructIds>) {
  const state = dlg.edit;
  if (!state) return;
  dlg.idsTouched = true;
  commit({ ...state, doc: { ...state.doc, ids: { ...state.doc.ids, ...patch } } }, { step: false });
}

export function setBeginEnd(patch: Partial<BeginEnd>) {
  const state = dlg.edit;
  const cur = state?.doc.beginEnd;
  if (!state || !cur) return;
  const next = { ...cur, ...patch };
  if ((Object.keys(patch) as (keyof BeginEnd)[]).every((k) => next[k] === cur[k])) return;
  commit({ ...state, doc: { ...state.doc, beginEnd: next } });
}

export function setStart(index: number) {
  if (dlg.edit) commit({ ...dlg.edit, doc: { ...dlg.edit.doc, startNode: index } });
}

export function rowAction(index: number, action: RowAction) {
  const state = dlg.edit;
  if (!state) return;
  const node = state.doc.nodes[index];
  dlg.selectedUid = node.uid;
  switch (action) {
    case "add": {
      const added = makeNode();
      commit(addNodeAfter(state, index, added));
      dlg.selectedUid = added.uid;
      break;
    }
    case "duplicate": {
      const next = duplicateNode(state, index);
      commit(next);
      dlg.selectedUid = next.doc.nodes[index + 1].uid;
      break;
    }
    case "copy":
      dlg.edit = { ...state, clipboard: cloneNode(node) };
      toast(`已复制节点 ${index}`, "info");
      break;
    case "paste":
      commit(pasteOver(state, index));
      break;
    case "up":
      commit(moveNode(state, index, index - 1));
      break;
    case "down":
      commit(moveNode(state, index, index + 1));
      break;
    case "remove": {
      const refs = referencesTo(state, index);
      if (refs.length === 0) {
        commit(removeNode(state, index));
      } else {
        confirm({
          title: `删除节点 ${index}？`,
          message: `该节点正被引用，删除后这些位置的跳转或开始节点会指向别的节点。\n引用来源：${refs.map((r) => (/^\d+$/.test(r) ? `节点 ${r}` : r)).join("、")}`,
          action: "仍然删除",
          danger: true,
          run: () => commit(removeNode(state, index)),
        });
      }
      break;
    }
  }
}

/** 拖动排序：把 from 处的节点移到最终位置 to */
export function moveTo(from: number, to: number) {
  const state = dlg.edit;
  if (!state || from === to) return;
  const moved = state.doc.nodes[from];
  commit(moveNode(state, from, to));
  dlg.selectedUid = moved.uid;
}

/** 节点编辑框提交 */
export function saveNode(node: DialogNode) {
  if (dlg.edit && dlg.editingIndex >= 0) commit(replaceNode(dlg.edit, dlg.editingIndex, node));
  dlg.editingIndex = -1;
  if (settings.autoSaveWhen === "commit") void autoSave();
}
