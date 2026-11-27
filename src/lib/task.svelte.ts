// 任务链编辑会话：当前打开的任务链与任务特有的操作。通用流程在 fileSession.svelte.ts。
import {
  type TaskDoc,
  type TaskEditState,
  type TaskIds,
  type TaskItem,
  addTaskAfter,
  cloneTask,
  duplicateTask,
  moveTask,
  newTaskDoc,
  pasteTaskOver,
  removeTask,
  replaceTask,
  taskIdsReady,
} from "../model/task";
import { parseTaskChain, stringifyTaskChain } from "../model/taskCodec";
import { FileSession, importFileFor, openPathAs, registerSession } from "./fileSession.svelte";
import type { RowAction } from "./dialog.svelte";
import { defaultIds, settings } from "./settings.svelte";
import { newTaskIds } from "../model/defaultIds";
import { toast } from "./ui.svelte";

const sameIds = (a: TaskIds, b: TaskIds) => a.chain === b.chain && a.task === b.task;

class TaskSession extends FileSession<TaskDoc, TaskEditState> {
  idsTouched = $state(false);

  constructor() {
    super({
      kind: "task",
      noun: "任务链",
      lastKey: "diapig-editor.lastTaskFile",
      saveTitle: "任务另存为",
      filterName: "任务文件",
      defaultName: "task_chain.json",
      readyHint: "保存前请先填写两个结构体 ID",
      focusId: "id-chain",
      parse(text) {
        const doc = parseTaskChain(text);
        if (doc.tasks.length === 0) doc.tasks = newTaskDoc().tasks;
        return { doc, clipboard: null };
      },
      stringify: stringifyTaskChain,
      ready: (doc) => taskIdsReady(doc.ids),
      loadedToast: (name, state) => ({ text: `已导入 ${name}（${state.doc.tasks.length} 个任务）` }),
      onLoad() {
        tsk.idsTouched = false;
      },
      // 撤销 / 重做不还原结构体 ID
      restore(snap, cur) {
        const doc = sameIds(snap.ids, cur.doc.ids) ? snap : { ...snap, ids: cur.doc.ids };
        if (!doc.tasks.some((t) => t.uid === tsk.selectedUid)) tsk.selectedUid = 0;
        return { ...cur, doc };
      },
    });
  }
}

export const tsk = new TaskSession();
registerSession(tsk);

export function createNewTask(historyTab: string, name: string) {
  const doc = newTaskDoc(newTaskIds(defaultIds(), tsk.doc?.ids), name);
  tsk.load({ doc, clipboard: null }, "", "", historyTab);
}

export const importTaskFile = () => importFileFor("task");
export const openTaskPath = (path: string, opt: { silent?: boolean } = {}) => openPathAs("task", path, opt);

export function setTaskIds(patch: Partial<TaskIds>) {
  const state = tsk.edit;
  if (!state) return;
  tsk.idsTouched = true;
  tsk.commit({ ...state, doc: { ...state.doc, ids: { ...state.doc.ids, ...patch } } }, { step: false });
}

/** 任务链名称（主区标题处编辑），可撤销 */
export function setChainName(name: string) {
  const state = tsk.edit;
  if (!state || state.doc.name === name) return;
  tsk.commit({ ...state, doc: { ...state.doc, name } });
}

/** 任务完成事件（在任务设置中编辑），可撤销 */
export function setChainCompleteEvent(completeEvent: string) {
  const state = tsk.edit;
  if (!state || state.doc.completeEvent === completeEvent) return;
  tsk.commit({ ...state, doc: { ...state.doc, completeEvent } });
}

export function taskRowAction(index: number, action: RowAction) {
  const state = tsk.edit;
  if (!state) return;
  const task = state.doc.tasks[index];
  tsk.selectedUid = task.uid;
  switch (action) {
    case "add": {
      const next = addTaskAfter(state, index);
      tsk.commit(next);
      tsk.selectedUid = next.doc.tasks[index + 1].uid;
      break;
    }
    case "duplicate": {
      const next = duplicateTask(state, index);
      tsk.commit(next);
      tsk.selectedUid = next.doc.tasks[index + 1].uid;
      break;
    }
    case "copy":
      tsk.edit = { ...state, clipboard: cloneTask(task) };
      toast(`已复制任务 ${index}`, "info");
      break;
    case "paste":
      tsk.commit(pasteTaskOver(state, index));
      break;
    case "up":
      tsk.commit(moveTask(state, index, index - 1));
      break;
    case "down":
      tsk.commit(moveTask(state, index, index + 1));
      break;
    case "remove":
      if (state.doc.tasks.length <= 1) {
        toast("任务链至少要有一个任务", "info");
        break;
      }
      tsk.commit(removeTask(state, index));
      break;
  }
}

/** 拖动排序：把 from 处的任务移到最终位置 to */
export function moveTaskTo(from: number, to: number) {
  const state = tsk.edit;
  if (!state || from === to) return;
  const moved = state.doc.tasks[from];
  tsk.commit(moveTask(state, from, to));
  tsk.selectedUid = moved.uid;
}

/** 任务编辑框提交 */
export function saveTask(task: TaskItem) {
  if (tsk.edit && tsk.editingIndex >= 0) tsk.commit(replaceTask(tsk.edit, tsk.editingIndex, task));
  tsk.editingIndex = -1;
  if (settings.autoSaveWhen === "commit") void tsk.autoSave();
}
