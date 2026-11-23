// 对话预览的几何计算（纯函数）：窗口尺寸、等比框裁切、Lua 舞台，以及 DialogView / DialogOptions
// 里逐节点的布局。坐标与 Lua 相同：逻辑像素，Y 向上，x 从中线量起。
import { BOX, DIVIDER, MARK, NON_LOCKED, OPTIONS, TAB } from "./previewConfig";
import { measure, type Parsed } from "./previewText";

export type Size = { w: number; h: number };

/** 设置里的逻辑画布："宽x高"，custom 时用自定的宽高；数值不合法时退回 1600×900 */
export function canvasSize(preset: string, customW: number, customH: number): Size {
  const m = /^(\d+)x(\d+)$/.exec(preset);
  const w = m ? Number(m[1]) : customW;
  const h = m ? Number(m[2]) : customH;
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w: Math.round(w), h: Math.round(h) } : { w: 1600, h: 900 };
}

/** 等比缩小到放得进 limit；本来就放得下时不变 */
export function fitInside(size: Size, limit: Size): Size {
  const s = Math.min(1, limit.w / size.w, limit.h / size.h);
  return { w: Math.max(1, Math.floor(size.w * s)), h: Math.max(1, Math.floor(size.h * s)) };
}

export type WindowMode = "canvas" | "fullscreen" | "custom";

/**
 * 预览窗口的内容区大小（逻辑像素）。canvas：等于逻辑画布；custom：自定宽高；两者超出屏幕工作区时
 * 都等比缩进去。fullscreen 返回 null（窗口直接全屏）。
 */
export function windowSize(mode: WindowMode, canvas: Size, custom: Size, work: Size | null): Size | null {
  if (mode === "fullscreen") return null;
  const want = mode === "custom" && custom.w > 0 && custom.h > 0 ? custom : canvas;
  return work ? fitInside(want, work) : { w: Math.round(want.w), h: Math.round(want.h) };
}

/**
 * 窗口里居中的最大等比框（与逻辑画布同比例），k 为画布到框的缩放。框外画成全黑。
 * 框就是模拟的游戏画面：它与画布等比，所以 Lua 的舞台（luaStage）在框里恰好等于画布。
 */
export function fitBox(winW: number, winH: number, canvas: Size): { x: number; y: number; w: number; h: number; k: number } {
  const k = Math.max(0, Math.min(winW / canvas.w, winH / canvas.h));
  const w = canvas.w * k;
  const h = canvas.h * k;
  return { x: (winW - w) / 2, y: (winH - h) / 2, w, h, k };
}

/** DialogRuntime.buildStage：k = min(根宽 / 画布宽, 根高 / 画布高)，舞台 = 根 / k（四舍五入，不小于画布） */
export function luaStage(rootW: number, rootH: number, canvas: Size): Size & { k: number } {
  const k = Math.min(rootW / canvas.w, rootH / canvas.h);
  return {
    w: Math.max(canvas.w, Math.floor(rootW / k + 0.5)),
    h: Math.max(canvas.h, Math.floor(rootH / k + 0.5)),
    k,
  };
}

/** DialogView bodyMax()：正文框宽 = 画布宽 × bodyMaxRatio，向下取整 */
export function bodyMax(canvasW: number): number {
  return Math.floor(canvasW * BOX.bodyMaxRatio);
}

/** DialogView lineH()：正文行高（估算值） */
export function lineH(): number {
  return BOX.bodySize * BOX.lineHeight;
}

export interface NodeLayout {
  /** 本节点用的中心高度表：有称号 / 无称号 */
  P: { name: number; line: number; body: number };
  hasTitle: boolean;
  titleW: number;
  /** 分割线总跨度 */
  L: number;
  /** 正文估算行数 */
  lines: number;
  /** 正文超过 2 行（或非锁定对话贴近血条）时整体上抬的量；也传给选项 */
  raise: number;
  /** 对话框本体的纵向位置 */
  boxY: number;
}

/** DialogView layout()：一个节点的布局。type 2（非锁定）把分割线定在 dividerY，正文下沿不低于血条 HUD */
export function layoutNode(type: number, speaker: { name: string; title: string }, body: Parsed, canvasW: number, stageW: number): NodeLayout {
  const hasTitle = speaker.title !== "";
  const P = hasTitle ? BOX.withTitle : BOX.noTitle;
  const maxW = bodyMax(canvasW);
  let nameW = measure(speaker.name, BOX.nameSize, undefined, BOX.nameBold).width;
  const titleW = hasTitle ? measure(speaker.title, BOX.titleSize).width : 0;
  const m = measure(body, BOX.bodySize, maxW, BOX.bodyBold);
  if (speaker.name === "") nameW = 0;
  let L = Math.max(DIVIDER.minSpan, Math.max(nameW, Math.min(m.width, maxW)) + DIVIDER.textPad);
  if (hasTitle) L = Math.max(L, titleW + DIVIDER.titleSide * 2);
  L = Math.min(L, stageW - 2 * DIVIDER.edge);
  let raise = Math.max(0, m.lines - 2) * lineH();
  let base = 0;
  if (type === 2) {
    const lift = BOX.lift;
    base = NON_LOCKED.dividerY - (P.line + lift);
    const bottom = base + raise + P.body + lift + lineH() / 2 - (m.lines * lineH() + BOX.bodyPad);
    const floor = NON_LOCKED.hudTop + NON_LOCKED.hudGap;
    if (bottom < floor) raise += floor - bottom;
  }
  return { P, hasTitle, titleW, L, lines: m.lines, raise, boxY: base + raise };
}

/** 对话框本体内各元素的目标位置（DialogView applyLayout，box 内坐标） */
export function boxPositions(lay: NodeLayout) {
  const lift = BOX.lift;
  return {
    dividerY: lay.P.line + lift,
    nameY: lay.P.name + lift,
    titleY: lay.P.line + lift,
    /** 正文框上沿（轴心在顶边） */
    bodyTop: lay.P.body + lift + lineH() / 2,
    bodyH: lay.lines * lineH() + BOX.bodyPad,
    boxY: lay.boxY,
  };
}

export interface DividerHalf {
  /** 遮罩中心 x（相对分割线中心） */
  maskX: number;
  maskW: number;
  /** 遮罩里的 108005 图片宽度；左半贴遮罩左边，右半贴遮罩右边并左右镜像 */
  imgW: number;
  mirror: boolean;
}

/**
 * DialogView applyLayout 的分割线：两半各是一个遮罩，里面一张拉伸的 108005（左端尖角、右端卷曲）。
 * 有称号时中间留出称号宽 + 间距，卷曲贴着称号；无称号时图片比遮罩长 cut，靠中线的卷曲被裁掉。
 */
export function dividerHalves(lay: NodeLayout): DividerHalf[] {
  const gh = lay.hasTitle ? lay.titleW / 2 + DIVIDER.titleGap : 0;
  const mw = Math.max(1, lay.L / 2 - gh);
  const iw = lay.hasTitle ? mw : mw + DIVIDER.cut;
  return [
    { maskX: -(gh + mw / 2), maskW: mw, imgW: iw, mirror: false },
    { maskX: gh + mw / 2, maskW: mw, imgW: iw, mirror: true },
  ];
}

/** 锁定对话选项（DialogOptions Opt.show 的 locked 分支）：左边缘 x 与各项中心 y（i 从 0 起，0 在最上面） */
export function lockedOptions(n: number, stageW: number): { left: number; ys: number[] } {
  const half = stageW / 2;
  // 宽舞台（主机 1920、21:9）右端离边缘 right；PC 16:9 保持 left；手机不近于 edge
  const left = Math.max(Math.min(OPTIONS.left, half - OPTIONS.width - OPTIONS.edge), half - OPTIONS.width - OPTIONS.right);
  const ys = Array.from({ length: n }, (_, i) => OPTIONS.bottom + (n - 1 - i) * OPTIONS.step + OPTIONS.height / 2);
  return { left, ys };
}

/**
 * 非锁定选项卡（Opt.show 的非锁定分支）：根节点在舞台底边中点偏移 (rootX, rootY)、整体缩放 scale；
 * 卡片左边缘在根节点 x = 0，ys 为根节点内的中心高度；有时长时在最上面一项上方画倒计时条。
 */
export function tabOptions(n: number, stageW: number, raise: number, touch = false) {
  const half = stageW / 2;
  const size = touch ? TAB.touch : TAB;
  const rootX = half - size.width * size.scale - TAB.edge;
  const rootY = TAB.bottom + raise;
  const ys = Array.from({ length: n }, (_, i) => (n - 1 - i) * size.step + size.height / 2);
  const barY = (n - 1) * size.step + size.height + TAB.barGap;
  return { rootX, rootY, scale: size.scale, width: size.width, height: size.height, ys, barX: TAB.barInset, barY, barW: size.width - 2 * TAB.barInset };
}

/** 继续指示（DialogView showMark）：菱形中心高度、半对角线，以及箭头上下浮动的两个中心高度（相对菱形中心） */
export function markGeom() {
  const depth = MARK.side / Math.SQRT2;
  const h = MARK.tri / 2;
  return { y: MARK.bottomGap + depth, depth, arrowUp: -h / 2, arrowDown: -depth + h / 2 };
}
