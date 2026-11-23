// 左侧栏页签右侧的「重置」：把该页面填的参数全部恢复成默认值。
// 页面状态各自保存在模块或 localStorage 里；这里按页签 id 调用各自的重置函数。
// App.svelte 在重置后会重新挂载该页面，组件内的局部状态随之回到初始值。
import { resetSettings } from "./settings.svelte";
import { resetGrowth } from "../model/growth";
import { resetPrimFit } from "./primfit.svelte";
import { resetPixelArt } from "./pixelArt.svelte";
import { resetRichText } from "../pages/RichTextPage.svelte";
import { resetComment } from "../pages/CommentPage.svelte";

type Resetter = () => void;

const RESETTERS: Record<string, Resetter> = {
  // 设置页
  general: () => resetSettings("general"),
  dialog: () => resetSettings("dialog"),
  personal: () => resetSettings("personal"),
  advanced: () => resetSettings("advanced"),
  // 更多页（两者都不 import 本文件，不会循环依赖）
  richtext: resetRichText,
  primfit: resetPrimFit,
  pixelart: resetPixelArt,
  // 成长曲线：只清掉 localStorage 里的参数，页面重新挂载时取默认值
  growth: resetGrowth,
  // 评论抓取：清掉保存的参数与已抓取的结果
  comment: resetComment,
};

/** 页面模块登记自己的重置函数（id 为左侧栏页签的 id，如 richtext / growth / primfit） */
export function registerReset(id: string, fn: Resetter) {
  RESETTERS[id] = fn;
}

export function resetPage(id: string) {
  RESETTERS[id]?.();
}
