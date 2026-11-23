// 对话预览复刻的游戏内表现常量。唯一依据是千星奇域对话模板的 dialog/*.lua（游戏里实际跑的对话界面），
// 每项后面注明对应的 Lua 文件与常量名；游戏内对话表现更新时，逐项对照这里同步修改。
// 布局单位是逻辑画布像素：原点在画布左下角、Y 向上，x 从中线量起（docs/对话框UI布局.md 1）。

export type RGBA = readonly [number, number, number, number];

/** 预览里 <PLAYER_NAME> 显示成的占位玩家名（游戏里由服务端写入昵称，见 DialogConfig.playerNameVar） */
export const PREVIEW_PLAYER_NAME = "旅行者";

/** DialogConfig.bleed：屏外容差，舞台尺寸的比例（黑屏底板向四周外扩） */
export const BLEED = 0.25;

/** DialogConfig.colors */
export const COLORS = {
  background: [14, 18, 27, 127], // colors.background：锁定对话背景光斑
  name: [255, 204, 51, 255], // colors.name
  title: [255, 204, 51, 255], // colors.title（称号）
  divider: [255, 204, 51, 153], // colors.divider
  body: [240, 240, 240, 255], // colors.body
  outline: [51, 51, 51, 102], // colors.outline：名称 / 称号 / 正文 / 选项文字的描边
  optionFill: [20, 26, 36, 200], // colors.optionFill
  optionBorder: [38, 50, 64, 255], // colors.optionBorder：外框线，固定不变色
  optionLine: [72, 72, 72, 255], // colors.optionLine：内框线（106084）未高亮时的颜色 #484848
  optionLit: [255, 255, 255, 255], // colors.optionLit：高亮内框线亮端
  optionLitLow: [72, 72, 72, 255], // colors.optionLitLow：高亮内框线暗端（灰白之间闪烁）
  optionPressed: [255, 204, 51, 255], // colors.optionPressed：按下时的填充
  optionText: [240, 240, 240, 255], // colors.optionText
  arrow: [255, 255, 255, 255], // colors.arrow
  timerTrack: [255, 255, 255, 48], // colors.timerTrack
  timerBar: [255, 204, 51, 220], // colors.timerBar
  black: [0, 0, 0, 255], // colors.black：黑屏底板
  toolText: [255, 255, 255, 255], // colors.toolText：「自动 / 播放中」
  reviewBg: [14, 20, 30, 215], // colors.reviewBg：对话回顾的深色底
  reviewGold: [211, 188, 142, 255], // colors.reviewGold：#D3BC8E 图标、关闭叉、名称、选项标签
  reviewTitle: [236, 229, 216, 255], // colors.reviewTitle
  reviewText: [236, 232, 224, 255], // colors.reviewText
  reviewLine: [255, 255, 255, 64], // colors.reviewLine：108018 分割线 25%
  tagText: [40, 44, 54, 255], // colors.tagText
} satisfies Record<string, RGBA>;

/** DialogConfig.box：锁定 / 非锁定对话框本体 */
export const BOX = {
  nameSize: 28, // box.nameSize
  titleSize: 17, // box.titleSize
  bodySize: 26, // box.bodySize
  nameBold: false, // box.nameBold
  bodyBold: false, // box.bodyBold
  lineHeight: 1.55, // box.lineHeight：正文行距 / 字号（Lua 自己也是估算）
  bodyMaxRatio: 0.6, // box.bodyMaxRatio：正文框宽 = 画布宽 × 0.6（向下取整）
  nameBoxW: 900, // box.nameBoxW
  titleBoxW: 700, // box.titleBoxW
  bodyPad: 8, // box.bodyPad
  withTitle: { name: 171, line: 141, body: 109 }, // box.withTitle：有称号时的中心高度
  noTitle: { name: 173, line: 150, body: 127 }, // box.noTitle
  lift: 30, // box.lift：名称 / 称号 / 分割线 / 正文整体上移
  bgTop: 235, // box.bgTop：背景遮罩上沿
  bgFeather: 20, // box.bgFeather：遮罩上沿羽化宽度
  bgBelow: 320, // box.bgBelow：遮罩在画布下沿以下多出的深度
  spotY: 245, // box.spotY：光斑中心高度
  spotH: 680, // box.spotH
  spotWidth: 1, // box.spotWidth：光斑宽 = 画布宽 × 1
  dividerMaskH: 20, // box.dividerMaskH
  speakerOut: 0.2, // box.speakerOut：换人时旧名称等淡出
  speakerIn: 0.28, // box.speakerIn：新名称等淡入
  bodyOut: 0.12, // box.bodyOut：继承标题时旧正文淡出
  fadeIn: 0.12, // box.fadeIn：整段渐显
  relayout: 0.18, // box.relayout：继承标题时位置过渡
  closeFade: 0.25, // box.closeFade：对话结束淡出
} as const;

/** DialogConfig.nonLocked：非锁定对话（无背景、不缩放，分割线定在 dividerY） */
export const NON_LOCKED = { dividerY: 172, hudTop: 68, hudGap: 4 } as const;

/**
 * 分割线图片 src/preview/divider.png：从游戏里 108005 的实机截图抠出的三宫格图（白色 + 透明度，4 倍分辨率）。
 * 数值是真实比例下的宽度：左端（菱形与线头）、中段（可横向拉伸的直线）、右端（卷曲）。
 * 实测 108005 宽 61.33 时没有中段、宽 100 时中段长约 39.7，两端不随宽度变化。
 */
export const DIVIDER_IMG = { width: 65, left: 20, mid: 4, right: 41 } as const;

/** DialogConfig.divider */
export const DIVIDER = {
  height: 16, // divider.height：108005 图片本体高度
  minSpan: 300, // divider.minSpan
  textPad: 48, // divider.textPad
  titleSide: 64, // divider.titleSide
  titleGap: 10, // divider.titleGap：称号与两侧分割线的间距
  cut: 45, // divider.cut：无称号时裁掉靠中线一侧的卷曲装饰
  edge: 40, // divider.edge：分割线离舞台边缘的最小距离
} as const;

/** DialogConfig.options：锁定对话右侧选项 */
export const OPTIONS = {
  left: 255, // options.left：选项左边缘（从中线量）
  right: 125, // options.right：宽舞台（主机 1920、21:9）上选项右端离舞台边缘
  width: 420, // options.width
  height: 52, // options.height
  step: 62.5, // options.step
  bottom: 255, // options.bottom：末项底边
  edge: 24, // options.edge：选项右端离舞台边缘的最小距离
  fillSize: 44, // options.fillSize
  lineSize: 48, // options.lineSize：内框线高度（左缩 2、宽 w - 4）
  iconX: 28, // options.iconX
  iconSize: 34, // options.iconSize
  textX: 51, // options.textX
  textRight: 16, // DiapigDialogOptions.lua card()：文字框宽 = w - textX - 16
  fillInset: 4, // DiapigDialogOptions.lua card()：填充左缩 4、宽 w - 8
  fontSize: 26, // options.fontSize
  bold: false, // options.bold
  keyX: -32, // options.keyX：按键提示中心离选项左边缘
  arrowFrom: -12, // options.arrowFrom：三角箭头来回横移的起点
  arrowTo: -5, // options.arrowTo
  arrowW: 12, // options.arrowW：箭头底边（高 = 底边 / 2）
  arrowLeg: 0.45, // options.arrowLeg：横移单程时长
  breathe: 0.8, // options.breathe：高亮边框呼吸半周期
  appear: 0.18, // options.appear
  stagger: 0, // options.stagger
  slide: 24, // options.slide：入场时从右侧滑入的距离
  press: 0.08, // options.press：选中后保持按下外观
  leave: 0.08, // options.leave：随后全部淡出
  stickStep: 0.5, // options.stickStep：手柄左摇杆越过此值移动一步
  stickDelay: 0.35, // options.stickDelay：按住后开始重复
  stickEvery: 0.15, // options.stickEvery：重复间隔
} as const;

/** DialogConfig.tab：非锁定对话的选项卡 */
export const TAB = {
  nonLockedMax: 4, // tab.nonLockedMax：只显示前 4 个分支
  width: 330, // tab.width
  height: 52, // tab.height
  step: 60, // tab.step
  bottom: 330, // tab.bottom
  scale: 0.8, // tab.scale
  barH: 4, // tab.barH：倒计时条高度
  barGap: 10, // tab.barGap
  barInset: 12, // DiapigDialogOptions.lua Opt.show()：倒计时条左起 12、宽 w - 24
  edge: 40, // tab.edge：右端离舞台边缘
  keyX: 28, // tab.keyX：键鼠数字键提示中心离卡片左边缘（卡片内坐标）
  padKeyX: -61, // tab.padKeyX：手柄 LB 组合键提示中心
  /** tab.touch：触屏的非锁定选项卡与锁定选项一样大 */
  touch: { width: 420, height: 52, step: 62.5, scale: 1 },
} as const;

/** DialogConfig.black：黑屏文字 */
export const BLACK = {
  fadeIn: 1, // black.fadeIn：黑幕淡入
  fadeOut: 1, // black.fadeOut
  fontSize: 32, // black.fontSize
  margin: 0.1, // black.margin：文字框左右各留画布宽的 10%
  outline: false, // black.outline
  textFadeIn: 0.75, // black.textFadeIn
  textFadeOut: 0.75, // black.textFadeOut
  typeStep: 0.06, // black.typeStep：黑屏打字机间隔
} as const;

/** DialogConfig.mark：继续指示（菱形框 + 上下浮动的箭头） */
export const MARK = {
  side: 14, // mark.side：菱形框（转 45° 的正方形）边长
  stroke: 1.5, // mark.stroke
  tri: 11, // mark.tri：箭头底边（高 = 底边 / 2）
  bottomGap: 16, // mark.bottomGap：菱形下顶点离画布下沿
  color: [255, 204, 51, 255], // mark.color
  frameAlpha: 191, // mark.frameAlpha
  glow: [255, 236, 150, 255], // mark.glow：点击时外扩的亮框颜色
  fadeIn: 0.25, // mark.fadeIn
  rise: 12, // mark.rise：出现时从上方 12 px 落下
  leg: 0.42, // mark.leg：箭头单程浮动时长
  burst: 0.45, // mark.burst：点击动效时长
  burstScale: 1.9, // mark.burstScale
  spotSize: 48, // mark.spotSize：点击时的光斑
} as const satisfies Record<string, unknown>;

/** DialogConfig.padHint：手柄锁定对话右下角「[确认键] 确认」 */
export const PAD_HINT = { edge: 76, y: 50, keyW: 34, keyH: 34, keyScale: 1.2, gap: 9, text: "确认", textSize: 24, textW: 56, textH: 48 } as const;

/** DialogConfig.toolbar：锁定对话的「自动 / 对话回顾 / 隐藏 UI」（逻辑像素，从舞台左上角量） */
export const TOOLBAR = {
  x: 112, // toolbar.x：自动按钮中心
  y: 37, // toolbar.y：中心离上沿（1600×900 下 y = 863，与千星退出按钮同一行）
  size: 42.67, // toolbar.size：图标边长
  hit: 50, // toolbar.hit：命中区高（宽按内容）
  textSize: 20, // toolbar.textSize
  textGap: 8, // toolbar.textGap：图标右缘到文字
  textAfter: 22, // toolbar.textAfter：文字右端到回顾按钮左缘
  step: 62, // toolbar.step：回顾到隐藏的中心距
  hoverScale: 1.12, // toolbar.hoverScale
  hover: 0.12, // toolbar.hover：悬停缩放过渡
  pressAlpha: 0.5, // toolbar.pressAlpha
  disabledAlpha: 0.4, // toolbar.disabledAlpha
  fadeIn: 0.28, // toolbar.fadeIn
  fadeOut: 0.25, // toolbar.fadeOut
  autoText: "自动",
  playingText: "播放中",
  /** toolbar.pad：手柄左下「Y + 回顾」「RB + 隐藏」，右下「X + 自动」 */
  pad: { edge: 76, y: 50, iconSize: 34, keyGap: 8, groupGap: 36, autoGap: 34, textW: 84, textSize: 24, textH: 48 },
} as const;

/** DialogConfig.auto：自动播放的阅读时间 = clamp(base + 字数 × perChar, min, max)，且不早于继续指示出现后 afterMark 秒 */
export const AUTO = { base: 1, perChar: 0.15, min: 2, max: 12, afterMark: 3, afterResume: 1 } as const;

/** DialogConfig.review：对话回顾页 */
export const REVIEW = {
  fade: 0.15, // 回顾页自身的淡入 / 淡出
  uiFade: 0.15, // 对话界面先淡出、关闭后再淡入（与回顾页先后进行，不交叉叠化）
  top: 39, // 标题行中心离上沿
  iconX: 63,
  iconSize: 46,
  titleX: 100,
  titleSize: 20,
  closeX: 66, // 关闭叉中心离右沿
  closeLen: 42,
  closeBar: 6,
  closeHeadW: 14,
  closeHeadH: 9,
  closeHit: 52,
  closeHover: 1.1, // 关闭叉悬停放大
  closePress: 0.9, // 按下缩小（同时半透明）
  closeAnim: 0.1,
  line: 80, // 上分割线中心离上沿
  lineEdge: 24,
  lineH: 8,
  padLine: 100, // 手柄下分割线中心离下沿
  viewTop: 90,
  viewBottom: 24,
  padViewBottom: 108,
  padTop: 14,
  padBottom: 24,
  nameRight: -328, // 名称右端（从中线量）
  nameW: 300,
  textLeft: -304, // 正文左端（从中线量）
  textW: 816,
  fontSize: 20,
  lineHeight: 1.55,
  textPad: 6,
  rowGap: 18,
  tagW: 60,
  tagH: 26,
  tagSize: 20,
  tagTextH: 40, // 「选项」文本框比标签高，字形仍在标签高度内
  stick: 900,
  stickDead: 0.2,
  closeText: "关闭",
  title: "对话回顾",
  choice: "选项",
} as const;

/** DialogConfig.timing */
export const TIMING = {
  typeStep: 0.03, // timing.typeStep：打字机间隔
  continueDelay: 0.5, // timing.continueDelay：时长为 0 时继续指示的延迟
  autoMin: 2, // timing.autoMin：非锁定 / 黑屏自动推进的最短时长
} as const;

/** 服务端计时（docs/迁移方案.md 4.6 定时器表；预览里由本地模拟） */
export const SERVER = {
  /** 「分支选择超时」= max(0.5, 时长) */
  branchMin: 0.5,
} as const;

/** 会话运行时（DiapigDialogRuntime.lua） */
export const RUNTIME = {
  /** DialogRuntime.R.update：单帧时钟最多前进 0.25 s */
  maxDt: 0.25,
} as const;

/**
 * 键鼠按键提示（原生按键提示控件）：单个数字 / 字母按键实际按 34×28 渲染（docs/UI布局与图片语义.md 10），
 * 白色圆角矩形、圆角半径 2、外侧略带阴影、键名 #333333 居中无描边（需求原文「预览」卡片与参考图 2）。
 */
export const KEY_HINT = { w: 34, h: 28, radius: 2, color: "#333333" } as const;

/**
 * 非锁定选项卡能否用鼠标点。DialogRuntime.R.layerMode 在键鼠端只给锁定对话开 showCursor，
 * 非锁定选项卡只在触屏上显示光标，所以 PC 上只能按 1–4 选（AGENTS.md 3.5：光标事件要求 showCursor）。
 */
export const NONLOCKED_MOUSE = false;

/** 预览模拟的设备（DialogRuntime deviceName）：pc 键鼠、touch 触屏、console 主机手柄、mobilePad 移动端手柄 */
export type SimDevice = "pc" | "touch" | "console" | "mobilePad";
export const isPad = (d: SimDevice) => d === "console" || d === "mobilePad";

/** RGBA（0–255）转 CSS 颜色；mul 是额外乘上的不透明度 */
export function rgba(c: RGBA, mul = 1): string {
  const a = Math.max(0, Math.min(1, (c[3] / 255) * mul));
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.round(a * 1000) / 1000})`;
}
