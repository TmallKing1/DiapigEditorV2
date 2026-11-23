// 页面导航状态：顶栏页签、各页的子页签，以及「子页面」栈。
// 子页面盖在当前页签之上：顶栏换成「返回按钮 + 子页面标题」，返回或按 Esc 回到上一层。
// 切换动效（旧内容退出 → 左侧栏变宽 → 新内容进入）由 App.svelte 监听这里的状态统一播放。

export type Page = "home" | "more" | "settings";
export type HomeTab = "dialog" | "task";

export interface SubPage {
  id: string;
  /** 顶栏上显示的子页面标题；文件设置页在 App.svelte 里后接「 - <文件名>」 */
  title: string;
  /** 左侧栏宽度；0 = 没有左侧栏（收起，且不画侧栏阴影） */
  sideWidth: number;
}

/** 已登记的子页面。新增子页面：在这里登记，并在 App.svelte 的侧栏 / 主区分支里渲染对应组件 */
export const SUB_PAGES: Record<string, SubPage> = {
  history: { id: "history", title: "历史文件", sideWidth: 200 },
  dialogMeta: { id: "dialogMeta", title: "对话设置", sideWidth: 0 },
  taskMeta: { id: "taskMeta", title: "任务设置", sideWidth: 0 },
};

export const nav = $state<{
  tab: Page;
  /** 主页当前的页签：对话 / 任务 */
  homeTab: HomeTab;
  /** 子页面栈，最后一个是当前显示的；空 = 在主界面 */
  subs: SubPage[];
  /** 「更多」页当前的子页签 */
  moreTab: string;
  /** 「设置」页当前的子页签 */
  settingsTab: string;
}>({ tab: "home", homeTab: "dialog", subs: [], moreTab: "richtext", settingsTab: "general" });

/** 进入子页面（可以在子页面里再进入另一个子页面） */
export function openSub(id: string) {
  const page = SUB_PAGES[id];
  if (!page || nav.subs.at(-1)?.id === id) return;
  nav.subs = [...nav.subs, page];
}

/** 返回上一层 */
export function closeSub() {
  if (nav.subs.length) nav.subs = nav.subs.slice(0, -1);
}

/** 回到主界面 */
export function closeAllSubs() {
  if (nav.subs.length) nav.subs = [];
}
