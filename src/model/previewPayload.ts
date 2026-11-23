// 主窗口交给预览窗口的数据：对话、对话类型与预览设置。经 localStorage（窗口打开前写好，预览页启动时读）
// 和 Tauri 事件 / storage 事件（窗口已开着时刷新）传递，seq 递增用来去重。
import type { DialogDoc } from "./types";
import type { DialogType, SimNode } from "./previewSim";
import type { SimDevice } from "./previewConfig";

export const PAYLOAD_KEY = "diapig-editor.preview.payload";
export const PAYLOAD_EVENT = "preview:load";
export const PREVIEW_LABEL = "preview";

export type PreviewKindId = "locked" | "nonlocked" | "black";

export const KIND_TYPE: Record<PreviewKindId, DialogType> = { locked: 1, nonlocked: 2, black: 3 };
export const KIND_LABEL: Record<PreviewKindId, string> = { locked: "锁定对话", nonlocked: "非锁定对话", black: "黑屏文字" };

export interface PreviewPayload {
  seq: number;
  kind: PreviewKindId;
  nodes: SimNode[];
  startNode: number;
  canvas: { w: number; h: number };
  /** 按键提示：kbm 键鼠、pad 手柄、none 不显示 */
  keyHint: string;
  /** 模拟的设备（决定工具栏、选项卡尺寸与可点性）；旧数据没有时按 keyHint 推断 */
  device?: SimDevice;
  /** 预览字体（CSS font-family 家族名）；空串 = 跟随界面字体 */
  font: string;
  /** 主窗口当前生效的界面字体回退列表（系统默认时为空），预览字体跟随界面或缺字时用；旧数据没有 */
  uiFonts?: string[];
}

/** 编辑器对话 → 预览节点：去掉界面用的 uid 与预览不执行的进入 / 离开事件，数值字段兜底 */
export function toSimNodes(doc: DialogDoc): SimNode[] {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
  return doc.nodes.map((n) => ({
    op: num(n.op),
    jump: num(n.jump),
    branches: (n.branches ?? []).map((b) => ({ title: String(b.title ?? ""), jump: num(b.jump) })),
    defaultBranch: num(n.defaultBranch),
    inheritTitle: n.inheritTitle === true,
    title: String(n.title ?? ""),
    subtitle: String(n.subtitle ?? ""),
    content: String(n.content ?? ""),
    textMode: num(n.textMode),
    duration: num(n.duration),
  }));
}

/**
 * 预览模拟的设备：设置里选了具体设备就用它；「自定义」按按键提示推断（键鼠 → PC、手柄 → 宽 1920 及以上为主机、
 * 否则移动端手柄；无 → 触屏）
 */
export function simDevice(device: string | undefined, keyHint: string, canvasW: number): SimDevice {
  if (device === "pc" || device === "touch" || device === "console" || device === "mobilePad") return device;
  if (keyHint === "pad") return canvasW >= 1920 ? "console" : "mobilePad";
  if (keyHint === "none") return "touch";
  return "pc";
}

/** 读到的 JSON 是否像一份预览数据（坏数据不渲染） */
export function isPayload(x: unknown): x is PreviewPayload {
  if (!x || typeof x !== "object") return false;
  const p = x as Partial<PreviewPayload>;
  return (
    typeof p.seq === "number" &&
    (p.kind === "locked" || p.kind === "nonlocked" || p.kind === "black") &&
    Array.isArray(p.nodes) &&
    typeof p.startNode === "number" &&
    !!p.canvas &&
    p.canvas.w > 0 &&
    p.canvas.h > 0
  );
}
