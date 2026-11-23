// 页面进出场过渡。
// 各过渡按线性进度 p 自行计算位移与透明度，便于让同一元素上的两条轨道用不同时长。
import type { TransitionConfig } from "svelte/transition";

const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 快速缓出 */
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
/** 缓入 */
const easeIn = (p: number) => p * p * p;
/** 轻回弹：越过目标约 10% 后回到静止位置 */
const backOut = (p: number) => {
  const s = 1.7;
  const q = p - 1;
  return q * q * ((s + 1) * q + s) + 1;
};
/** 某条轨道在总时长 total 内只占前 part 毫秒 */
const track = (p: number, part: number, total: number) => Math.min(1, (p * total) / part);

/** 减少动态效果：只留短暂淡入淡出（第 10 节） */
function fadeOnly(duration = 100): TransitionConfig {
  return { duration, css: (t) => `opacity:${t}` };
}

/** 退场一开始就不再接收操作，避免重复提交（7.4） */
function lock(node: Element) {
  (node as HTMLElement).inert = true;
}

/** 遮罩：进入 / 退出 180 ms */
export function scrim(_node: Element): TransitionConfig {
  if (reduced()) return fadeOnly();
  return { duration: 180, easing: easeOut, css: (t) => `opacity:${t}` };
}

/** 对话框打开（克制型）：Y +16 → 0，220 ms 缓出；淡入 150 ms */
export function dialogIn(_node: Element): TransitionConfig {
  if (reduced()) return fadeOnly();
  const total = 220;
  return {
    duration: total,
    css: (p) =>
      `opacity:${easeOut(track(p, 150, total))};transform:translateY(${16 * (1 - easeOut(p))}px)`,
  };
}

/** 对话框关闭：Y 0 → +12，淡出，150 ms，无旋转 */
export function dialogOut(node: Element): TransitionConfig {
  lock(node);
  if (reduced()) return fadeOnly(80);
  return {
    duration: 150,
    // 退场时 t 由 1 走向 0
    css: (t) => `opacity:${easeOut(t)};transform:translateY(${12 * easeIn(1 - t)}px)`,
  };
}

/** 浮动提示进入（6.4）：Y +8 → 0，淡入，180 ms */
export function tipIn(_node: Element): TransitionConfig {
  if (reduced()) return fadeOnly(100);
  return {
    duration: 180,
    css: (p) => `opacity:${easeOut(p)};transform:translateY(${8 * (1 - easeOut(p))}px)`,
  };
}

/** 浮动提示退出：淡出 100 ms */
export function tipOut(_node: Element): TransitionConfig {
  return { duration: reduced() ? 80 : 100, css: (t) => `opacity:${t}` };
}

/** 下拉菜单进入（6.4）：从触发框一侧出现，Y ∓6 → 0，160 ms；up 为向上展开 */
export function menuIn(_node: Element, { up = false }: { up?: boolean } = {}): TransitionConfig {
  if (reduced()) return fadeOnly(100);
  const d = up ? 6 : -6;
  return {
    duration: 160,
    css: (p) => `opacity:${easeOut(p)};transform:translateY(${d * (1 - easeOut(p))}px)`,
  };
}

/** 下拉菜单退出：淡出并略向触发框收回，100 ms */
export function menuOut(node: Element, { up = false }: { up?: boolean } = {}): TransitionConfig {
  lock(node);
  if (reduced()) return fadeOnly(80);
  const d = up ? 3 : -3;
  return {
    duration: 100,
    css: (t) => `opacity:${t};transform:translateY(${d * easeIn(1 - t)}px)`,
  };
}

/** 提示条进入：从左侧淡入，位置带轻回弹；位移 300 ms，淡入 150 ms */
export function toastIn(_node: Element): TransitionConfig {
  if (reduced()) return fadeOnly(120);
  const total = 300;
  return {
    duration: total,
    css: (p) =>
      `opacity:${easeOut(track(p, 150, total))};transform:translateX(${-32 * (1 - backOut(p))}px)`,
  };
}

/** 提示条退出：向左整条移出窗口并淡出，缓入，无回弹 */
export function toastOut(node: Element): TransitionConfig {
  lock(node);
  if (reduced()) return fadeOnly(100);
  return {
    duration: 200,
    css: (t) => {
      const p = easeIn(1 - t);
      return `opacity:${1 - p};transform:translateX(${-100 * p}%)`;
    },
  };
}
