// 主页（对话 + 任务）两个文件会话的共同部分：启动时打开上次的文件、定时自动保存、关闭应用前的确认。
import { createNew, dlg } from "./dialog.svelte";
import { type FileSession, reopenLast } from "./fileSession.svelte";
import { closeWindow, isTauri, onCloseRequested } from "./files";
import { type HomeTab, nav } from "./nav.svelte";
import { settings } from "./settings.svelte";
import { createNewTask, tsk } from "./task.svelte";
import { ask } from "./ui.svelte";

const KEY_TAB = "diapig-editor.lastHomeTab";

type AnySession = FileSession<any, any>;
const sessions: AnySession[] = [dlg, tsk];
export const sessionFor = (tab: HomeTab): AnySession => (tab === "dialog" ? dlg : tsk);

export const newDocument = $state<{ kind: HomeTab | null }>({ kind: null });

export function requestNew(kind: HomeTab) {
  if (!sessionFor(kind).busy) newDocument.kind = kind;
}

export function finishNew(historyTab: string, taskName: string) {
  const kind = newDocument.kind;
  if (!kind) return;
  newDocument.kind = null;
  if (kind === "dialog") createNew(historyTab);
  else createNewTask(historyTab, taskName);
}

function readLastTab(): HomeTab {
  try {
    return localStorage.getItem(KEY_TAB) === "task" ? "task" : "dialog";
  } catch {
    return "dialog";
  }
}

// —— 关闭应用 ——

/** 依次保存（对话 → 任务）。需要另存为的会话先切到它的页签，让用户知道在保存哪一份；任一个没保存成功就停下 */
async function saveAll(list: AnySession[]): Promise<boolean> {
  for (const s of list) {
    if (!s.dirty) continue;
    if (nav.tab === "home" && nav.homeTab !== s.spec.kind) nav.homeTab = s.spec.kind;
    if (!(await s.saveFile())) return false;
  }
  return true;
}

function askClose(dirty: AnySession[]) {
  const both = dirty.length > 1;
  const one = dirty[0];
  const hasFile = !both && one.filePath !== "";
  const close = (ok: boolean) => {
    if (ok) void closeWindow();
  };
  ask({
    title: "关闭 Diapig Editor？",
    message: both
      ? "对话和任务都有尚未保存的修改。可以全部保存再关闭，或放弃这些修改。"
      : hasFile
        ? `当前${one.spec.noun}有尚未保存的修改。可以先保存再关闭，或放弃这些修改。`
        : `当前${one.spec.noun}还没有保存到文件。可以先另存为再关闭，或放弃这些修改。`,
    width: 480,
    actions: [
      {
        label: both ? "全部保存" : hasFile ? "保存" : "另存为",
        style: "accent",
        focus: true,
        run: () => void saveAll(dirty).then(close),
      },
      { label: both ? "全部放弃" : "放弃更改并关闭", style: "danger", run: () => void closeWindow() },
      { label: "取消" },
    ],
  });
}

async function closeRequested() {
  // 「关闭应用时自动保存」：有本地文件且结构体 ID 填齐的先直接保存；都保存好了就关闭，否则对剩下的询问
  if (settings.saveOnClose) {
    for (const s of sessions) if (s.dirty && s.filePath && s.ready) await s.saveFile();
  }
  const dirty = sessions.filter((s) => s.dirty);
  if (!dirty.length) return void closeWindow();
  askClose(dirty);
}

/** 应用启动时调用一次：接管关闭确认、定时自动保存，并按设置重新打开上次的页签和文件。返回清理函数 */
export function initHomeSession(): () => void {
  let off: (() => void) | undefined;
  let cancelled = false;
  onCloseRequested(
    () => sessions.some((s) => s.dirty),
    () => void closeRequested(),
  ).then((fn) => (cancelled ? fn() : (off = fn)));

  // 启动：勾选「自动打开上次关闭时的文件」时回到上次的页签并打开它的文件，另一个页签的文件等第一次切过去再打开；
  // 不勾选时停在对话页签，不打开文件
  const reopen = settings.reopenLast && isTauri;
  nav.homeTab = reopen ? readLastTab() : "dialog";
  if (reopen) {
    for (const s of sessions) if (!s.edit) s.pendingOpen = s.lastPath();
  }

  const stop = $effect.root(() => {
    // 记住当前页签；切到有待打开文件的页签时静默打开（找不到或读不了就什么也不做）
    $effect(() => {
      const tab = nav.homeTab;
      try {
        localStorage.setItem(KEY_TAB, tab);
      } catch {
        // 存不下：只影响下次启动回到哪个页签
      }
      const s = sessionFor(tab);
      if (s.pendingOpen && !s.edit && !cancelled) {
        s.pendingOpen = "";
        void reopenLast(s);
      }
    });

    // 固定间隔自动保存
    $effect(() => {
      if (!settings.autoSave || settings.autoSaveWhen !== "interval") return;
      const seconds = Math.max(1, Number(settings.autoSaveInterval) || 20);
      const timer = setInterval(() => sessions.forEach((s) => void s.autoSave()), seconds * 1000);
      return () => clearInterval(timer);
    });
  });

  return () => {
    cancelled = true;
    off?.();
    stop();
  };
}
