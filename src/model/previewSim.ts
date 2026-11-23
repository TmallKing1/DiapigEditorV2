// 对话预览的状态机（纯逻辑，按时钟推进，不碰 DOM）。逐段移植游戏内 Lua：
//   DiapigDialogView.lua    对话框本体、换人 / 继承标题的淡入淡出、正文三种显示模式、继续指示、黑屏文字
//   DiapigDialogOptions.lua 锁定对话的选项（W/S、悬停、F 选择）与非锁定选项卡（1–4、倒计时条）
//   DiapigDialogRuntime.lua 输入路由（每帧一个动作）、时钟
//   DiapigDialogToolbar.lua 锁定对话的「自动 / 对话回顾 / 隐藏 UI」与自动播放
//   DiapigDialogReview.lua  对话回顾页（历史记录、淡入淡出）
// 服务端（推进规则与自动推进计时）由 Driver 本地模拟，规则见 docs/迁移方案.md 4.6 与 DiapigDialogDemo.lua。
// 动画用「起点、终点、开始时间、时长、缓动」描述，渲染时按当前时钟求值；Lua 里 U.kill 掉的 Tween
// 在这里就是把值冻结在当前时刻（freeze）。
import { AUTO, BLACK, BOX, COLORS, isPad, MARK, OPTIONS, REVIEW, RUNTIME, SERVER, TAB, TIMING, TOOLBAR, type SimDevice } from "./previewConfig";
import { boxPositions, dividerHalves, layoutNode, lockedOptions, markGeom, tabOptions, type DividerHalf, type NodeLayout, type Size } from "./previewLayout";
import { parse, prepare, runs, type Parsed, type Run } from "./previewText";

export type Ease = "linear" | "outQuad" | "inQuad" | "inOutQuad";
export interface Tween {
  a: number;
  b: number;
  t0: number;
  d: number;
  e: Ease;
}
/** 可动画的数值：常数或一段 Tween */
export type Num = number | Tween;

export function ease(e: Ease, u: number): number {
  if (e === "outQuad") return 1 - (1 - u) * (1 - u);
  if (e === "inQuad") return u * u;
  if (e === "inOutQuad") return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
  return u;
}

export function valueAt(v: Num, t: number): number {
  if (typeof v === "number") return v;
  if (v.d <= 0 || t >= v.t0 + v.d) return v.b;
  if (t <= v.t0) return v.a;
  return v.a + (v.b - v.a) * ease(v.e, (t - v.t0) / v.d);
}

/** 1 锁定对话 / 2 非锁定对话 / 3 黑屏文字（docs/对话规格.md 1.1） */
export type DialogType = 1 | 2 | 3;

/** 预览用的节点（与编辑器 DialogNode 相同，少了界面用的 uid 和不执行的进入 / 离开事件） */
export interface SimNode {
  op: number;
  jump: number;
  branches: { title: string; jump: number }[];
  defaultBranch: number;
  inheritTitle: boolean;
  title: string;
  subtitle: string;
  content: string;
  textMode: number;
  duration: number;
}

export interface SimInput {
  nodes: SimNode[];
  startNode: number;
  type: DialogType;
  canvas: Size;
  playerName: string;
  /** 模拟的设备（DialogRuntime D.device）；不传为 PC 键鼠 */
  device?: SimDevice;
}

/**
 * 逻辑动作（DialogRuntime.bindKeys）：F = confirm，空格 / 左键 = continue，W / S = up / down，1–4 = pick；
 * 手柄 X = auto、Y = review、RB = hide、返回 = back；隐藏 UI 时点屏幕 = unhide
 */
export type Action =
  | "confirm"
  | "continue"
  | "up"
  | "down"
  | "pick1"
  | "pick2"
  | "pick3"
  | "pick4"
  | "auto"
  | "review"
  | "hide"
  | "back"
  | "unhide";

/** 预览结束的原因：end = 对话正常结束；stall = 停在了游戏里也无法继续的节点（见 Driver） */
export type EndState = null | { kind: "end" } | { kind: "stall"; node: number; reason: string };

interface Timer {
  at: number;
  fn: () => void;
  tag: string;
  dead?: boolean;
}

interface OptItem {
  label: Run[];
  y: number;
  pressed: boolean;
  /** 非锁定选项卡：该行的数字键 1–4 */
  key?: number;
}
interface OptState {
  locked: boolean;
  items: OptItem[];
  sel: number;
  hover: number | null;
  pressing: number | null;
  done: boolean;
  /** Lua 的 refresh() 至少跑过一次（卡片滑入后才显示高亮与按键提示） */
  refreshed: boolean;
  appearAt: number;
  /** 选中后开始淡出的时刻 */
  leaveAt: number | null;
  onSelect: (i: number) => void;
  duration: number;
  shownAt: number;
  raise: number;
  left: number;
}

interface ViewState {
  gen: number;
  open: boolean;
  closing: boolean;
  type: DialogType | null;
  shown: boolean;
  speaker: { name: string; title: string } | null;
  node: SimNode | null;
  nodeStart: number;
  advancing: boolean;
  optionsOpen: boolean;
  textDone: boolean;
  tw: { k: number; acc: number } | null;
  body: Parsed;
  /** 打字机已显示的字符数；null = 完整显示 */
  bodyK: number | null;
  layout: NodeLayout | null;
  readyAt: number;
  /** 继续指示出现的时刻（自动播放从这里起算 afterMark） */
  markAt: number | null;
  // 可动画的属性（Lua 里各控件的颜色 / 位置）
  speakerAlpha: Num;
  bodyAlpha: Num;
  sheetAlpha: Num;
  pos: { dividerY: Num; nameY: Num; titleY: Num; bodyTop: Num; bodyH: Num; boxY: Num };
  halves: DividerHalf[];
  hasTitle: boolean;
}

const EMPTY: Parsed = { toks: [], n: 0 };

function freshView(gen: number): ViewState {
  return {
    gen,
    open: false,
    closing: false,
    type: null,
    shown: false,
    speaker: null,
    node: null,
    nodeStart: 0,
    advancing: false,
    optionsOpen: false,
    textDone: false,
    tw: null,
    body: EMPTY,
    bodyK: null,
    layout: null,
    readyAt: 0,
    markAt: null,
    speakerAlpha: 0,
    bodyAlpha: 0,
    sheetAlpha: 0,
    pos: { dividerY: 0, nameY: 0, titleY: 0, bodyTop: 0, bodyH: 0, boxY: 0 },
    halves: [],
    hasTitle: false,
  };
}

// —— 渲染快照：组件只读这个 ——

export interface BoxSnap {
  type: 1 | 2;
  boxY: number;
  speakerAlpha: number;
  bodyAlpha: number;
  /** 锁定对话才有背景光斑 */
  background: boolean;
  name: Run[];
  nameY: number;
  title: Run[] | null;
  titleY: number;
  dividerY: number;
  halves: DividerHalf[];
  body: Run[];
  bodyTop: number;
  bodyH: number;
}
export interface BlackSnap {
  type: 3;
  sheetAlpha: number;
  bodyAlpha: number;
  body: Run[];
}
export interface CardSnap {
  label: Run[];
  /** 卡片左边缘 x（含入场滑动偏移）与中心 y，单位是选项根节点内的坐标 */
  x: number;
  y: number;
  alpha: number;
  pressed: boolean;
  /** 高亮边框的不透明度倍率（呼吸）；null = 未高亮 */
  /** 高亮内框线当前颜色（optionLit 与 optionLitLow 之间）；未高亮为 null */
  lit: [number, number, number, number] | null;
  arrow: boolean;
  /** 非锁定选项卡该行的数字键；不显示时为 null */
  key: number | null;
}
export interface OptionsSnap {
  locked: boolean;
  /** 根节点相对舞台底边中点的位置与缩放 */
  rootX: number;
  rootY: number;
  scale: number;
  width: number;
  height: number;
  cards: CardSnap[];
  arrowX: number;
  /** 锁定对话的 F 键提示（跟随键盘选中项）；不显示时为 null */
  keyF: { x: number; y: number } | null;
  /** 非锁定选项卡的倒计时条：剩余比例 */
  bar: { x: number; y: number; w: number; left: number } | null;
  interactive: boolean;
}
export interface MarkSnap {
  y: number;
  alpha: number;
  arrowY: number;
}
export interface BurstSnap {
  /** 0–1 */
  u: number;
  y: number;
  arrowY: number;
}
export interface ToolbarSnap {
  /** 整体淡入淡出 */
  alpha: number;
  auto: boolean;
  /** 有选项等待选择：自动按钮不可用并虚化 */
  disabled: boolean;
}
export interface ReviewRow {
  /** 名称；选项行为 null（画「选项」标签） */
  name: Run[] | null;
  text: Run[];
  choice: boolean;
}
export interface ReviewSnap {
  alpha: number;
  rows: ReviewRow[];
  /** 每次打开换一个值：渲染时据此滚到最底 */
  id: number;
}
export interface Snapshot {
  clock: number;
  device: SimDevice;
  /** D.ui 是否可见：隐藏 UI、回顾页打开（对话界面淡出后）到关闭后重新淡入前为 false */
  uiVisible: boolean;
  /** D.ui 的整体不透明度：回顾页打开时先淡出、关闭后再淡入 */
  uiAlpha: number;
  hidden: boolean;
  toolbar: ToolbarSnap | null;
  /** 手柄锁定对话右下角「确认」提示 */
  padHint: boolean;
  review: ReviewSnap | null;
  box: BoxSnap | BlackSnap | null;
  options: OptionsSnap | null;
  mark: MarkSnap | null;
  bursts: BurstSnap[];
  /** 全屏「继续」点击区是否生效（锁定对话与黑屏拦截点击） */
  blocks: boolean;
  ended: EndState;
}

export class DialogSim {
  clock = 0;
  frame = 0;
  ended: EndState = null;
  private readonly input: SimInput;
  private timers: Timer[] = [];
  private v: ViewState = freshView(0);
  private opt: OptState | null = null;
  private mark: { t0: number } | null = null;
  private bursts: { t0: number; y: number; arrowY: number }[] = [];
  private lastActionFrame = -1;
  // DialogOptions 模块级的呼吸 / 箭头相位：跨选项组延续
  private glowT = 0;
  private arrowT = 0;
  private arrowX: number = OPTIONS.arrowFrom;
  // 服务端模拟
  private drv = { index: 0, timer: null as Timer | null, shownBefore: false, finishing: false };
  // DialogToolbar / DialogReview
  private tb = { auto: false, hidden: false, resumeAt: 0 };
  private bar: { t0: number; leaveAt: number | null } | null = null;
  private hist: { name: string; text: string; choice: boolean }[] = [];
  private rv: { t0: number; closeAt: number | null; id: number } | null = null;
  /** 回顾页关闭后对话界面开始淡入的时刻 */
  private uiInAt: number | null = null;
  private rvSeq = 0;
  private stick = { dir: 0, wait: 0, v: 0 };
  private rvRows: ReviewRow[] = [];
  readonly device: SimDevice;

  constructor(input: SimInput) {
    this.input = input;
    this.device = input.device ?? "pc";
  }

  // ———————————————————————— 时钟与计时器（DialogUI D.after / D.runTimers） ————————————————————————

  private after(delay: number, fn: () => void, tag: string): Timer {
    const t: Timer = { at: this.clock + Math.max(0, delay), fn, tag };
    this.timers.push(t);
    return t;
  }
  private cancelTag(tag: string) {
    for (const t of this.timers) if (t.tag === tag) t.dead = true;
  }
  private runTimers() {
    const due: Timer[] = [];
    this.timers = this.timers.filter((t) => {
      if (t.dead) return false;
      if (this.clock >= t.at) {
        due.push(t);
        return false;
      }
      return true;
    });
    for (const t of due) t.fn();
  }

  /** DialogRuntime.R.update：一帧 */
  update(dt: number) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, RUNTIME.maxDt);
    this.clock += dt;
    this.frame += 1;
    this.runTimers();
    this.viewUpdate(dt);
    this.optUpdate(dt);
    this.toolbarUpdate();
    this.bursts = this.bursts.filter((b) => this.clock - b.t0 < MARK.burst + 0.02);
  }

  /** 把时钟往前推 total 秒（按 step 分帧），单测与「跳过」用 */
  advanceTime(total: number, step = 1 / 60) {
    let left = total;
    while (left > 1e-9) {
      const d = Math.min(step, left);
      this.update(d);
      left -= d;
    }
  }

  // ———————————————————————— 输入（DialogRuntime.R.action） ————————————————————————

  /** 一个逻辑动作；返回是否被消费。同一帧只处理一个动作，按住不重复由调用方保证 */
  action(a: Action): boolean {
    if (this.lastActionFrame === this.frame) return true;
    // 手柄的工具栏键只在锁定对话里生效（bindKeys 的 locked()），其余时候保持游戏原义
    if ((a === "auto" || a === "review" || a === "hide" || a === "back") && !this.isLocked()) return false;
    let used = false;
    if (this.tb.hidden) used = this.unhideInput(a);
    else if (this.rv) used = this.reviewInput(a);
    else if (a === "auto" || a === "review" || a === "hide") used = this.toolInput(a);
    else if (a === "unhide" || a === "back") used = false;
    else if (this.optActive()) used = this.optInput(a);
    else if (a === "continue" || a === "confirm") used = this.press();
    if (used) this.lastActionFrame = this.frame;
    return used;
  }

  /** 全屏点击：锁定对话与黑屏才有继续点击区（R.layerMode） */
  click(): boolean {
    if (this.tb.hidden) return this.action("unhide");
    if (this.rv) return true;
    return this.blocksInput() ? this.action("continue") : false;
  }

  /** 工具栏按钮的点击（键鼠 / 触屏）：自己吃掉这次点击，不传给下面的继续点击区 */
  toolClick(a: "auto" | "review" | "hide") {
    this.action(a);
  }
  /** 回顾页的关闭叉 */
  reviewCloseClick() {
    this.reviewClose();
  }
  /** 手柄左摇杆纵向读数（上为正）：锁定选项的光标移动（DialogOptions Opt.update） */
  setStick(v: number) {
    this.stick.v = Number.isFinite(v) && Math.abs(v) <= 1.5 ? v : 0;
  }

  // 选项卡片上的鼠标事件（DialogOptions card() 的命中区）
  cardEnter(i: number) {
    const o = this.opt;
    if (!o || !this.cardMouse() || o.done) return;
    o.hover = i;
    o.refreshed = true;
  }
  cardExit(i: number) {
    const o = this.opt;
    if (!o || !this.cardMouse() || o.hover !== i) return;
    o.hover = null;
    o.refreshed = true;
  }
  cardDown(i: number) {
    const o = this.opt;
    if (!o || !this.cardMouse() || o.done || !o.items[i]) return;
    o.pressing = i;
    o.items[i].pressed = true;
  }
  /** 松开：i 省略时松开当前按着的那项（鼠标在卡片外松开） */
  cardUp(i?: number) {
    const o = this.opt;
    if (!o || o.done) return;
    const at = i ?? o.pressing;
    if (at == null || !o.items[at]?.pressed) return;
    o.pressing = null;
    o.items[at].pressed = false;
    o.refreshed = true;
  }
  cardClick(i: number) {
    if (this.opt && this.cardMouse()) this.choose(i);
  }
  /** 键鼠端：锁定对话的选项能用鼠标，非锁定选项卡不能（previewConfig NONLOCKED_MOUSE） */
  private cardMouse(): boolean {
    if (this.tb.hidden || this.rv) return false;
    return this.opt != null && (this.opt.locked || this.device === "touch");
  }

  // ———————————————————————— 服务端模拟 ————————————————————————

  start() {
    this.drv.index = this.input.startNode;
    this.drv.shownBefore = false;
    this.drv.finishing = false;
    this.show();
  }

  /** 发出当前节点的快照；非锁定与黑屏启动服务端的自动推进计时 */
  private show() {
    const d = this.drv;
    if (d.timer) d.timer.dead = true;
    d.timer = null;
    const node = this.input.nodes[d.index];
    if (!node) return this.finish();
    this.apply(node);
    const t = this.input.type;
    if (t === 2 || t === 3) {
      const dur = Number(node.duration) || 0;
      const extra = t === 3 && !d.shownBefore ? BLACK.fadeIn : 0;
      d.shownBefore = true;
      if (t === 2 && node.op === 3) {
        d.timer = this.after(Math.max(SERVER.branchMin, dur), () => this.driverSelect(node.defaultBranch + 1), "server");
      } else {
        d.timer = this.after(extra + Math.max(TIMING.autoMin, dur), () => this.driverAdvance(), "server");
      }
    }
  }
  /** Dlg_Advance：操作码 0 结束、1 下一个、2 跳转、3 不处理 */
  private driverAdvance() {
    const d = this.drv;
    const node = this.input.nodes[d.index];
    if (!node) return this.finish();
    if (node.op === 0) return this.finish();
    if (node.op === 1) d.index += 1;
    else if (node.op === 2) d.index = node.jump;
    else return this.stall(this.input.type === 3 ? "黑屏文字不显示分支选项，服务端也不会推进分支节点" : "分支节点只能通过选择分支离开");
    this.show();
  }
  /** Dlg_Select（i 从 1 起） */
  private driverSelect(i: number) {
    const d = this.drv;
    const node = this.input.nodes[d.index];
    const b = node && node.op === 3 ? node.branches[i - 1] : undefined;
    if (!b) return this.stall("选择的分支不存在");
    d.index = b.jump;
    this.show();
  }
  private finish() {
    const d = this.drv;
    if (d.timer) d.timer.dead = true;
    d.timer = null;
    d.finishing = true;
    this.apply(null);
    if (!this.v.open) this.ended = { kind: "end" };
  }
  private stall(reason: string) {
    if (!this.ended) this.ended = { kind: "stall", node: this.drv.index, reason };
  }

  // ———————————————————————— DialogView ————————————————————————

  private val(v: Num): number {
    return valueAt(v, this.clock);
  }
  private tween(from: Num, to: number, d: number, e: Ease): Tween {
    return { a: this.val(from), b: to, t0: this.clock, d, e };
  }
  /** U.kill(st.fades)：正文与说话人部件的淡入淡出停在当前值 */
  private killFades() {
    this.v.speakerAlpha = this.val(this.v.speakerAlpha);
    this.v.bodyAlpha = this.val(this.v.bodyAlpha);
  }
  private killMoves() {
    const p = this.v.pos;
    for (const k of Object.keys(p) as (keyof typeof p)[]) p[k] = this.val(p[k]);
  }
  private prep(s: string): string {
    return prepare(s, this.input.playerName);
  }

  private build(kind: 1 | 2) {
    const gen = this.v.gen;
    this.v = freshView(gen);
    const v = this.v;
    v.open = true;
    v.type = kind;
    if (kind === 1) this.hist = []; // 新的锁定对话框：回顾记录从头开始
    // Lua 建框时用不带 lift 的初值；第一个节点总是换人（不做位置过渡），立即按布局摆好
    v.pos = {
      dividerY: BOX.noTitle.line,
      nameY: BOX.noTitle.name,
      titleY: BOX.withTitle.line,
      bodyTop: BOX.noTitle.body,
      bodyH: 0,
      boxY: 0,
    };
  }
  private buildBlack() {
    const gen = this.v.gen;
    this.v = freshView(gen);
    const v = this.v;
    v.open = true;
    v.type = 3;
    v.sheetAlpha = this.tween(0, 1, BLACK.fadeIn, "linear");
    v.readyAt = this.clock + BLACK.fadeIn;
  }
  private destroyBox() {
    this.hideMark(false);
    const gen = this.v.gen;
    this.v = freshView(gen);
  }

  /** V.apply：显示一个节点快照（null = 结束） */
  private apply(node: SimNode | null) {
    const v = this.v;
    v.gen += 1;
    const gen = v.gen;
    this.optHide();
    if (!node) return this.close();
    const kind = this.input.type;
    if (v.open && (v.type !== kind || v.closing)) this.destroyBox();
    if (kind === 3) return this.apply3(node, gen);
    if (!this.v.open) this.build(kind);
    const w = this.v;
    this.hideMark(false);
    w.tw = null;
    w.textDone = false;
    const same = node.inheritTitle === true && w.speaker != null;
    if (same) {
      if (w.shown) {
        this.killFades();
        w.bodyAlpha = this.tween(w.bodyAlpha, 0, BOX.bodyOut, "outQuad");
        this.after(BOX.bodyOut, () => this.present(node, gen, false), "view");
      } else this.present(node, gen, false);
    } else if (w.shown) {
      this.killFades();
      w.speakerAlpha = this.tween(w.speakerAlpha, 0, BOX.speakerOut, "outQuad");
      w.bodyAlpha = this.tween(w.bodyAlpha, 0, BOX.speakerOut, "outQuad");
      this.after(BOX.speakerOut, () => this.present(node, gen, true), "view");
    } else this.present(node, gen, true);
  }

  private applyLayout(lay: NodeLayout, animate: boolean) {
    const v = this.v;
    this.killMoves();
    // 分割线长度立即变化，不做过渡（DialogView applyLayout）
    v.halves = dividerHalves(lay);
    const target = boxPositions(lay);
    for (const k of Object.keys(target) as (keyof typeof target)[]) {
      v.pos[k] = animate ? this.tween(v.pos[k], target[k], BOX.relayout, "outQuad") : target[k];
    }
    v.hasTitle = lay.hasTitle;
    v.layout = lay;
  }

  /** present：旧内容淡出后显示新节点；newSpeaker 时重建名称 / 称号，否则只换正文 */
  private present(node: SimNode, gen: number, newSpeaker: boolean) {
    const v = this.v;
    if (gen !== v.gen || !v.open) return;
    if (newSpeaker) v.speaker = { name: this.prep(node.title), title: this.prep(node.subtitle) };
    v.body = parse(this.prep(node.content));
    const lay = layoutNode(v.type!, v.speaker!, v.body, this.input.canvas.w, this.input.canvas.w);
    if (newSpeaker) {
      this.killFades();
      this.applyLayout(lay, false);
      v.speakerAlpha = this.tween(0, 1, BOX.speakerIn, "outQuad");
    } else this.applyLayout(lay, true);
    v.shown = true;
    v.node = node;
    v.nodeStart = this.clock;
    v.advancing = false;
    v.optionsOpen = false;
    v.markAt = null;
    this.startBody(node);
    if (v.type === 1) this.hist.push({ name: v.speaker!.name, text: this.prep(node.content), choice: false });
    if (v.type === 2 && node.op === 3) this.openOptions();
  }

  private apply3(node: SimNode, gen: number) {
    if (!this.v.open) this.buildBlack();
    const v = this.v;
    this.hideMark(false);
    v.tw = null;
    v.textDone = false;
    let wait = Math.max(0, v.readyAt - this.clock);
    if (v.shown) {
      this.killFades();
      v.bodyAlpha = this.tween(v.bodyAlpha, 0, BLACK.textFadeOut, "linear");
      wait = Math.max(wait, BLACK.textFadeOut);
    }
    const present3 = () => {
      const w = this.v;
      if (gen !== w.gen || !w.open) return;
      w.body = parse(this.prep(node.content));
      w.shown = true;
      w.node = node;
      w.nodeStart = this.clock;
      w.advancing = false;
      w.optionsOpen = false;
      this.startBody(node);
    };
    if (wait > 0) this.after(wait, present3, "view");
    else present3();
  }

  /**
   * 显示模式：1 打字机、2 整段渐显、3 直出；0 = 按对话类型：锁定对话打字机（2026-11-18），
   * 其他渐显（服务端默认没关渐变，disableFadeIn = false）
   */
  private startBody(node: SimNode) {
    const v = this.v;
    let mode = Number(node.textMode) || 0;
    if (mode === 0) mode = v.type === 1 ? 1 : 2;
    v.tw = null;
    v.textDone = true;
    v.bodyAlpha = 1;
    v.bodyK = null;
    if (mode === 1 && v.body.n > 0) {
      v.tw = { k: 0, acc: 0 };
      v.textDone = false;
      v.bodyK = 0;
    } else if (mode === 2) {
      v.bodyAlpha = this.tween(0, 1, v.type === 3 ? BLACK.textFadeIn : BOX.fadeIn, "linear");
    }
  }
  private finishTyping(): boolean {
    const v = this.v;
    if (!v.tw) return false;
    v.tw = null;
    v.textDone = true;
    v.bodyK = null;
    return true;
  }

  private close() {
    const v = this.v;
    if (!v.open || v.closing) return;
    v.closing = true;
    v.node = null;
    v.tw = null;
    const gen = v.gen;
    this.hideMark(false);
    this.killFades();
    let dur: number = BOX.closeFade;
    if (v.type === 3) {
      // 黑屏：先淡出最后一行，再淡出黑幕（不同时进行）
      const textOut = v.shown ? BLACK.textFadeOut : 0;
      if (textOut > 0) v.bodyAlpha = this.tween(v.bodyAlpha, 0, textOut, "linear");
      const sheetOut = () => {
        if (gen !== this.v.gen) return;
        this.v.sheetAlpha = this.tween(this.v.sheetAlpha, 0, BLACK.fadeOut, "linear");
      };
      if (textOut > 0) this.after(textOut, sheetOut, "view");
      else sheetOut();
      dur = textOut + BLACK.fadeOut;
    } else {
      v.speakerAlpha = this.tween(v.speakerAlpha, 0, dur, "outQuad");
      v.bodyAlpha = this.tween(v.bodyAlpha, 0, dur, "outQuad");
    }
    this.after(
      dur + 0.02,
      () => {
        if (gen !== this.v.gen) return;
        this.destroyBox();
        if (this.drv.finishing && !this.ended) this.ended = { kind: "end" };
      },
      "view",
    );
  }

  private isLocked(): boolean {
    return this.v.open && !this.v.closing && this.v.type === 1;
  }
  /** 锁定对话和黑屏拦截点击（V.blocksInput） */
  blocksInput(): boolean {
    return this.v.open && !this.v.closing && (this.v.type === 1 || this.v.type === 3);
  }

  // 继续指示
  private markRootY(): number {
    if (!this.mark) return markGeom().y;
    const g = markGeom();
    return valueAt({ a: g.y + MARK.rise, b: g.y, t0: this.mark.t0, d: MARK.fadeIn, e: "outQuad" }, this.clock);
  }
  private markArrowY(): number {
    const g = markGeom();
    if (!this.mark) return g.arrowUp;
    // 一来一回为一个循环，两段都是 InOutQuad
    const t = (this.clock - this.mark.t0) % (2 * MARK.leg);
    const down = t < MARK.leg;
    const u = ease("inOutQuad", (down ? t : t - MARK.leg) / MARK.leg);
    return down ? g.arrowUp + (g.arrowDown - g.arrowUp) * u : g.arrowDown + (g.arrowUp - g.arrowDown) * u;
  }
  private showMark() {
    if (this.mark) return;
    this.mark = { t0: this.clock };
    this.v.markAt = this.clock;
  }
  private hideMark(burst: boolean) {
    if (!this.mark) return;
    if (burst) this.bursts.push({ t0: this.clock, y: this.markRootY(), arrowY: this.markArrowY() });
    this.mark = null;
  }

  private openOptions() {
    const v = this.v;
    const node = v.node;
    if (!node || v.optionsOpen) return;
    v.optionsOpen = true;
    let labels = node.branches.map((b) => this.prep(b.title));
    // 非锁定：每个选项占一个快捷键，只显示前 4 个（多出的游戏里打印 NONLOCKED_OPTIONS 警告）
    if (v.type === 2 && labels.length > TAB.nonLockedMax) labels = labels.slice(0, TAB.nonLockedMax);
    if (labels.length === 0) {
      // Opt.show 遇到 0 个选项直接返回：游戏里也会停在这里
      this.stall("分支节点没有分支");
      return;
    }
    this.optShow(labels, {
      locked: v.type === 1,
      duration: Number(node.duration) || 0,
      raise: v.layout?.raise ?? 0,
      onSelect: (i) => {
        if (this.v.type === 1 && labels[i - 1] != null) this.hist.push({ name: "", text: labels[i - 1], choice: true });
        this.v.advancing = true;
        this.driverSelect(i);
      },
    });
  }

  /** V.press：继续（点击任意处、F、空格） */
  private press(): boolean {
    const v = this.v;
    if (!this.isLocked() || !v.node || v.advancing) return false;
    if (v.tw) {
      this.finishTyping();
      return true;
    }
    if (v.optionsOpen || !this.mark) return true;
    this.hideMark(true);
    if (v.node.op === 3) this.openOptions();
    else {
      v.advancing = true;
      this.driverAdvance();
    }
    return true;
  }

  private viewUpdate(dt: number) {
    const v = this.v;
    if (!v.open || v.closing || !v.node) return;
    const tw = v.tw;
    if (tw) {
      tw.acc += dt;
      const stepT = v.type === 3 ? BLACK.typeStep : TIMING.typeStep;
      const steps = Math.floor(tw.acc / stepT + 1e-9);
      if (steps > 0) {
        tw.acc -= steps * stepT;
        tw.k += steps;
        if (tw.k >= v.body.n) this.finishTyping();
        else v.bodyK = tw.k;
      }
    }
    // 锁定对话：正文完整显示、并且过了 0.5 s（或「时长」秒）后出现继续指示
    if (v.type === 1 && v.textDone && !this.mark && !v.optionsOpen && !v.advancing) {
      const d = Number(v.node.duration) || 0;
      if (this.clock - v.nodeStart >= (d > 0 ? d : TIMING.continueDelay) - 1e-9) this.showMark();
    }
  }

  // ———————————————————————— DialogOptions ————————————————————————

  private optActive(): boolean {
    return this.opt != null && !this.opt.done;
  }
  private optHide() {
    this.cancelTag("options");
    this.opt = null;
  }
  private optShow(labels: string[], o: { locked: boolean; duration: number; raise: number; onSelect: (i: number) => void }) {
    this.optHide();
    const n = labels.length;
    const geo = o.locked ? lockedOptions(n, this.input.canvas.w) : tabOptions(n, this.input.canvas.w, o.raise, this.device === "touch");
    const st: OptState = {
      locked: o.locked,
      items: labels.map((l, i) => ({
        label: runs(parse(OPTIONS.bold && l !== "" ? `<b>${l}</b>` : l)),
        y: geo.ys[i],
        pressed: false,
        key: !o.locked && i < 4 ? i + 1 : undefined,
      })),
      sel: 0,
      hover: null,
      pressing: null,
      done: false,
      refreshed: false,
      appearAt: this.clock,
      leaveAt: null,
      onSelect: o.onSelect,
      duration: o.duration,
      shownAt: this.clock,
      raise: o.raise,
      left: o.locked ? (geo as ReturnType<typeof lockedOptions>).left : 0,
    };
    this.opt = st;
    // 卡片滑入后再显示高亮与按键提示
    this.after((n - 1) * OPTIONS.stagger + OPTIONS.appear, () => {
      if (this.opt === st) st.refreshed = true;
    }, "options");
  }
  private choose(i: number) {
    const st = this.opt;
    if (!st || st.done || !st.items[i]) return;
    st.done = true;
    st.items[i].pressed = true;
    st.refreshed = true;
    this.after(OPTIONS.press, () => {
      if (this.opt !== st) return;
      st.leaveAt = this.clock;
      this.after(OPTIONS.leave, () => {
        if (this.opt === st) {
          this.optHide();
          st.onSelect(i + 1);
        }
      }, "options");
    }, "options");
  }
  private move(d: number) {
    const st = this.opt!;
    const j = Math.max(0, Math.min(st.items.length - 1, st.sel + d));
    if (j !== st.sel) {
      st.sel = j;
      st.refreshed = true;
    }
  }
  /** Opt.input：锁定对话 up / down / confirm，continue 被吞掉；非锁定只认 pick1–4 */
  private optInput(a: Action): boolean {
    const st = this.opt!;
    if (st.locked) {
      if (a === "up") this.move(-1);
      else if (a === "down") this.move(1);
      else if (a === "confirm") this.choose(st.sel);
      else if (a !== "continue") return false;
      return true;
    }
    const m = /^pick(\d)$/.exec(a);
    const i = m ? Number(m[1]) - 1 : -1;
    if (i >= 0 && st.items[i]) {
      this.choose(i);
      return true;
    }
    return false;
  }
  private optUpdate(dt: number) {
    this.stickUpdate(dt);
    if (!this.opt) return;
    // 所有高亮项共用一个箭头横移与呼吸相位
    this.arrowT = (this.arrowT + dt) % (2 * OPTIONS.arrowLeg);
    let u = this.arrowT / OPTIONS.arrowLeg;
    if (u > 1) u = 2 - u;
    this.arrowX = OPTIONS.arrowFrom + (OPTIONS.arrowTo - OPTIONS.arrowFrom) * ease("inOutQuad", u);
    this.glowT = (this.glowT + dt) % (2 * OPTIONS.breathe);
  }

  // ———————————————————————— DialogToolbar / DialogReview ————————————————————————

  /** 工具栏出现的条件：锁定对话打开且已显示过节点 */
  private wanted(): boolean {
    return this.isLocked() && this.v.shown;
  }
  /** 有选项等待选择：自动按钮不可用（自动播放从不替玩家选） */
  private autoBlocked(): boolean {
    return this.optActive() && this.opt!.locked;
  }
  private setHidden(on: boolean) {
    if (this.tb.hidden === on) return;
    this.tb.hidden = on;
    // 隐藏 UI 同时关闭自动播放；恢复后要玩家手动再打开
    if (on) this.tb.auto = false;
    if (!on) this.tb.resumeAt = this.clock + AUTO.afterResume;
  }
  private resume() {
    this.tb.resumeAt = Math.max(this.tb.resumeAt, this.clock + AUTO.afterResume);
  }
  private toolInput(a: "auto" | "review" | "hide"): boolean {
    if (!this.wanted() || !this.bar) return false;
    if (a === "auto") {
      if (!this.autoBlocked()) this.tb.auto = !this.tb.auto;
    } else if (a === "review") this.reviewOpen();
    else this.setHidden(true);
    return true;
  }
  /** 隐藏 UI 时：继续 / 确认 / 返回 / 点屏幕只恢复显示，其余输入全部吞掉 */
  private unhideInput(a: Action): boolean {
    if (a === "continue" || a === "confirm" || a === "back" || a === "unhide") this.setHidden(false);
    return true;
  }
  private reviewOpen(): boolean {
    if (this.rv || this.hist.length === 0 || !this.isLocked() || this.tb.hidden) return false;
    this.rvSeq += 1;
    this.rv = { t0: this.clock, closeAt: null, id: this.rvSeq };
    this.uiInAt = null;
    this.rvRows = this.hist.map((h) => ({
      name: h.choice ? null : runs(parse(h.name)),
      text: runs(parse(h.text)),
      choice: h.choice,
    }));
    return true;
  }
  private reviewClose(now = false) {
    const r = this.rv;
    if (!r || r.closeAt != null) return;
    this.resume();
    if (now) {
      this.rv = null;
      this.uiInAt = null;
      return;
    }
    r.closeAt = this.clock;
    this.after(REVIEW.fade + 0.02, () => {
      if (this.rv !== r) return;
      this.rv = null;
      this.uiInAt = this.clock;
    }, "review");
  }
  /** 回顾页打开时：返回键或回顾键关闭，其余输入吞掉 */
  private reviewInput(a: Action): boolean {
    if (a === "back" || a === "review") this.reviewClose();
    return true;
  }
  private autoStep() {
    const v = this.v;
    if (!this.tb.auto || this.tb.hidden || this.rv) return;
    if (!v.node || v.advancing || !this.mark || v.optionsOpen || this.optActive()) return;
    const read = Math.max(AUTO.min, Math.min(AUTO.max, AUTO.base + v.body.n * AUTO.perChar));
    const due = Math.max(v.nodeStart + read, (v.markAt ?? this.clock) + AUTO.afterMark, this.tb.resumeAt);
    if (this.clock >= due - 1e-9) this.press();
  }
  private toolbarUpdate() {
    const want = this.wanted();
    if (want && (!this.bar || this.bar.leaveAt != null)) this.bar = { t0: this.clock, leaveAt: null };
    else if (!want && this.bar && this.bar.leaveAt == null) {
      if (this.v.closing) this.bar.leaveAt = this.clock;
      else this.bar = null;
    }
    if (this.bar && this.bar.leaveAt != null && this.clock - this.bar.leaveAt > TOOLBAR.fadeOut) this.bar = null;
    if (!want) {
      this.setHidden(false);
      if (this.rv) this.reviewClose(true);
      return;
    }
    this.autoStep();
  }
  /** DialogOptions Opt.update：手柄左摇杆移动锁定选项的光标（越过阈值走一步，按住重复） */
  private stickUpdate(dt: number) {
    const st = this.opt;
    const s = this.stick;
    if (!st || st.done || !st.locked || !isPad(this.device) || this.tb.hidden || this.rv) {
      s.dir = 0;
      return;
    }
    const d = s.v > OPTIONS.stickStep ? -1 : s.v < -OPTIONS.stickStep ? 1 : 0;
    if (d === 0) {
      s.dir = 0;
      return;
    }
    if (d !== s.dir) {
      s.dir = d;
      s.wait = OPTIONS.stickDelay;
      this.move(d);
      return;
    }
    s.wait -= dt;
    if (s.wait <= 0) {
      s.wait = OPTIONS.stickEvery;
      this.move(d);
    }
  }

  // ———————————————————————— 快照 ————————————————————————

  snapshot(): Snapshot {
    const rv = this.rv;
    const bar = this.bar;
    let barAlpha = 0;
    if (bar) {
      barAlpha = ease("outQuad", Math.min(1, (this.clock - bar.t0) / TOOLBAR.fadeIn));
      if (bar.leaveAt != null) barAlpha *= 1 - ease("outQuad", Math.min(1, (this.clock - bar.leaveAt) / TOOLBAR.fadeOut));
    }
    // 先后进行：打开时对话界面 uiFade 内淡出，回顾页随后 fade 内淡入；关闭时回顾页先淡出，对话界面再淡入
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    const pageAt = (r: { t0: number }, t: number) => clamp01((t - r.t0 - REVIEW.uiFade) / REVIEW.fade);
    let rvAlpha = 0;
    let uiAlpha = 1;
    if (rv) {
      rvAlpha = pageAt(rv, this.clock);
      if (rv.closeAt != null) rvAlpha = pageAt(rv, rv.closeAt) * (1 - clamp01((this.clock - rv.closeAt) / REVIEW.fade));
      uiAlpha = rv.closeAt == null ? ease("outQuad", 1 - clamp01((this.clock - rv.t0) / REVIEW.uiFade)) : 0;
    } else if (this.uiInAt != null) uiAlpha = ease("outQuad", clamp01((this.clock - this.uiInAt) / REVIEW.uiFade));
    return {
      clock: this.clock,
      device: this.device,
      uiVisible: !this.tb.hidden && !(rv && (rv.closeAt != null || this.clock >= rv.t0 + REVIEW.uiFade)),
      uiAlpha,
      hidden: this.tb.hidden,
      toolbar: bar ? { alpha: barAlpha, auto: this.tb.auto, disabled: this.autoBlocked() } : null,
      padHint: isPad(this.device) && this.isLocked() && !this.v.optionsOpen && !this.optActive(),
      review: rv ? { alpha: rvAlpha, rows: this.rvRows, id: rv.id } : null,
      box: this.boxSnap(),
      options: this.optSnap(),
      mark: this.mark
        ? { y: this.markRootY(), alpha: ease("outQuad", Math.min(1, (this.clock - this.mark.t0) / MARK.fadeIn)), arrowY: this.markArrowY() }
        : null,
      bursts: this.bursts.map((b) => ({ u: Math.min(1, (this.clock - b.t0) / MARK.burst), y: b.y, arrowY: b.arrowY })),
      blocks: this.blocksInput(),
      ended: this.ended,
    };
  }

  private boxSnap(): BoxSnap | BlackSnap | null {
    const v = this.v;
    if (!v.open || v.type == null) return null;
    const body = runs(v.body, v.bodyK ?? Infinity);
    if (v.type === 3) return { type: 3, sheetAlpha: this.val(v.sheetAlpha), bodyAlpha: this.val(v.bodyAlpha), body };
    const sp = v.speaker ?? { name: "", title: "" };
    return {
      type: v.type,
      boxY: this.val(v.pos.boxY),
      speakerAlpha: this.val(v.speakerAlpha),
      bodyAlpha: this.val(v.bodyAlpha),
      background: v.type === 1,
      name: runs(parse(BOX.nameBold && sp.name !== "" ? `<b>${sp.name}</b>` : sp.name)),
      nameY: this.val(v.pos.nameY),
      title: v.hasTitle ? runs(parse(sp.title)) : null,
      titleY: this.val(v.pos.titleY),
      dividerY: this.val(v.pos.dividerY),
      halves: v.halves,
      body,
      bodyTop: this.val(v.pos.bodyTop),
      bodyH: this.val(v.pos.bodyH),
    };
  }

  private optSnap(): OptionsSnap | null {
    const st = this.opt;
    if (!st) return null;
    const n = st.items.length;
    const appearU = (i: number) => {
      const delay = (n - 1 - i) * OPTIONS.stagger; // 最下面一行先出现
      return ease("outQuad", Math.max(0, Math.min(1, (this.clock - st.appearAt - delay) / OPTIONS.appear)));
    };
    const leave = st.leaveAt == null ? 1 : 1 - ease("outQuad", Math.min(1, (this.clock - st.leaveAt) / OPTIONS.leave));
    // 呼吸：0 亮 → 1 暗 → 0 亮，在 optionLit 与 optionLitLow 之间余弦插值
    const g = 0.5 - 0.5 * Math.cos((this.glowT / OPTIONS.breathe) * Math.PI);
    const a = COLORS.optionLit;
    const b = COLORS.optionLitLow;
    const litColor = a.map((v, k) => Math.round(v + (b[k] - v) * g)) as [number, number, number, number];
    const cards: CardSnap[] = st.items.map((it, i) => {
      // 触屏没有键盘光标：只有悬停（按下）的那项高亮（DialogOptions cursorDevice）
      const lit = st.refreshed && !it.pressed && st.locked && ((this.device !== "touch" && i === st.sel) || i === st.hover);
      const u = appearU(i);
      return {
        label: it.label,
        x: (st.locked ? st.left : 0) + OPTIONS.slide * (1 - u),
        y: it.y,
        alpha: u * leave,
        pressed: it.pressed,
        lit: lit ? litColor : null,
        arrow: lit || !st.locked,
        key: !st.locked && st.refreshed && !st.done && it.key && this.device !== "touch" ? it.key : null,
      };
    });
    if (st.locked) {
      const sel = st.items[st.sel];
      return {
        locked: true,
        rootX: 0,
        rootY: st.raise,
        scale: 1,
        width: OPTIONS.width,
        height: OPTIONS.height,
        cards,
        arrowX: this.arrowX,
        keyF: st.refreshed && !st.done && sel && this.device !== "touch" ? { x: st.left + OPTIONS.keyX, y: sel.y } : null,
        bar: null,
        interactive: true,
      };
    }
    const geo = tabOptions(n, this.input.canvas.w, st.raise, this.device === "touch");
    const d = st.duration;
    return {
      locked: false,
      rootX: geo.rootX,
      rootY: geo.rootY,
      scale: geo.scale,
      width: geo.width,
      height: geo.height,
      cards,
      arrowX: this.arrowX,
      keyF: null,
      bar: d > 0 ? { x: geo.barX, y: geo.barY, w: geo.barW, left: Math.max(0, 1 - (this.clock - st.shownAt) / d) } : null,
      interactive: this.device === "touch",
    };
  }

  // —— 给单测和界面看的只读状态 ——
  get debug() {
    return {
      nodeIndex: this.drv.index,
      open: this.v.open,
      type: this.v.type,
      shown: this.v.shown,
      typing: this.v.tw != null,
      bodyK: this.v.bodyK,
      markShown: this.mark != null,
      auto: this.tb.auto,
      hidden: this.tb.hidden,
      reviewOpen: this.rv != null,
      history: this.hist.map((h) => ({ ...h })),
      options: this.opt ? { locked: this.opt.locked, n: this.opt.items.length, sel: this.opt.sel, done: this.opt.done } : null,
      layout: this.v.layout,
      text: this.v.node ? this.v.body : null,
    };
  }
}
