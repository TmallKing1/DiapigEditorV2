// 全局的提示条与选择对话框。任何模块都可以直接调用，由 App.svelte 统一渲染。

export type ToastKind = "success" | "info" | "error";
export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

/** 提示条显示 5 秒后自动退出，不提供手动关闭 */
const TOAST_MS = 5000;
let toastId = 0;

export interface AskAction {
  label: string;
  /** accent = 蓝色，danger = 红色，不传 = 黑色 */
  style?: "accent" | "danger";
  /** 不传 = 只关闭对话框（取消） */
  run?: () => void;
  /** 打开时聚焦这个按钮；都不设时聚焦第一个没有 run 的按钮 */
  focus?: boolean;
}
export interface Ask {
  title: string;
  message: string;
  /** danger：标题、分隔线为红色，遮罩为半透明深红 */
  tone?: "info" | "danger";
  width?: number;
  /** 按钮从左到右的顺序 */
  actions: AskAction[];
}

export const ui = $state<{ toasts: Toast[]; ask: Ask | null }>({ toasts: [], ask: null });

export function toast(text: string, kind: ToastKind = "success") {
  const id = ++toastId;
  // 提示统一以半角感叹号结尾；末尾已有标点（含右括号、引号）的保持不变
  if (!/[\p{P}]$/u.test(text)) text += "!";
  ui.toasts.push({ id, text, kind });
  setTimeout(() => (ui.toasts = ui.toasts.filter((t) => t.id !== id)), TOAST_MS);
}

/** 弹出选择对话框；Esc 等同取消 */
export function ask(next: Ask) {
  ui.ask = next;
}

/** 常用的「取消 / 确认」两个按钮 */
export function confirm(opt: { title: string; message: string; action: string; danger?: boolean; run: () => void }) {
  ask({
    title: opt.title,
    message: opt.message,
    tone: opt.danger ? "danger" : "info",
    actions: [{ label: "取消" }, { label: opt.action, style: opt.danger ? "danger" : "accent", run: opt.run }],
  });
}

export function closeAsk() {
  ui.ask = null;
}

export function runAsk(action: AskAction) {
  ui.ask = null;
  action.run?.();
}
