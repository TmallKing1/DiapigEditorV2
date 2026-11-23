// 跨整个 Editor 的「右下角操作按钮」列表状态。
// 与页签、子页面解耦：任意模块都可以通过 upsertCornerAction / removeCornerAction 随时增删改。
// 排序约定：slot = 0 在最底部；新按钮默认放在当前所有按钮的上方（maxSlot + 1）。
// 离开约定：removeCornerAction 先标记 exiting = true 播放原地缩小动效（上方按钮暂不动），
// 动画结束后再从列表移除并紧缩 slot，上方按钮随即统一下落占位。

export interface CornerActionSpec {
  id: string;
  icon: string;
  /** 按钮的无障碍名称 */
  label: string;
  /** 悬停时显示在按钮左侧的详情文本（支持多行） */
  detail: string;
  /** 可选进度 0–1；传入时从下到上填充主题亮色 */
  progress?: number;
  onclick: () => void;
}

export interface CornerActionEntry extends CornerActionSpec {
  /** 从底部往上数的槽位序号（0 = 最底部） */
  slot: number;
  /** 正在播放原地缩小退出动效 */
  exiting: boolean;
  /** 入场动效键值：只有首次进入或退出中途重新进入时递增，普通属性更新不重播入场 */
  enterKey: number;
}

/** 原地缩小退出的时长（与 CornerActionsHost.svelte 的 fab-out 动画一致） */
export const CORNER_EXIT_MS = 130;

export const cornerActions = $state<CornerActionEntry[]>([]);

const exitTimers = new Map<string, ReturnType<typeof setTimeout>>();

function reduceMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clampProgress(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(1, v));
}

function compactSlots() {
  cornerActions.sort((a, b) => a.slot - b.slot);
  for (let i = 0; i < cornerActions.length; i++) {
    cornerActions[i].slot = i;
  }
}

/** 新增或更新一个右下角操作按钮；新按钮放在当前所有按钮的上方（空列表时放在底部） */
export function upsertCornerAction(spec: CornerActionSpec): void {
  const progress = clampProgress(spec.progress);
  const existing = cornerActions.find((item) => item.id === spec.id);
  if (existing) {
    const pending = exitTimers.get(spec.id);
    if (pending !== undefined) {
      clearTimeout(pending);
      exitTimers.delete(spec.id);
    }
    const wasExiting = existing.exiting;
    existing.icon = spec.icon;
    existing.label = spec.label;
    existing.detail = spec.detail;
    existing.progress = progress;
    existing.onclick = spec.onclick;
    if (wasExiting) {
      existing.exiting = false;
      existing.enterKey++;
    }
    return;
  }
  const maxSlot = cornerActions.reduce((m, item) => Math.max(m, item.slot), -1);
  cornerActions.push({
    ...spec,
    progress,
    slot: maxSlot + 1,
    exiting: false,
    enterKey: 1,
  });
}

/** 移除一个右下角操作按钮：先原地缩小退出，动画结束后移除并让上方按钮统一下落占位 */
export function removeCornerAction(id: string): void {
  const entry = cornerActions.find((item) => item.id === id);
  if (!entry || entry.exiting) return;
  entry.exiting = true;

  const finalize = () => {
    exitTimers.delete(id);
    const idx = cornerActions.findIndex((item) => item.id === id);
    if (idx >= 0 && cornerActions[idx].exiting) {
      cornerActions.splice(idx, 1);
      compactSlots();
    }
  };

  if (reduceMotion()) {
    finalize();
    return;
  }
  const timer = setTimeout(finalize, CORNER_EXIT_MS);
  exitTimers.set(id, timer);
}

/** 立即清空所有右下角操作按钮与挂起定时器（测试或重置用） */
export function clearCornerActions(): void {
  for (const timer of exitTimers.values()) clearTimeout(timer);
  exitTimers.clear();
  cornerActions.length = 0;
}
