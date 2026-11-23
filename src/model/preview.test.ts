// 对话预览：富文本 / 打字机（DiapigTypewriter.lua）、布局与缩放、状态机（DialogView / DialogOptions / 服务端规则）
import { describe, expect, it } from "vitest";
import { AUTO, BLACK, BOX, OPTIONS, REVIEW, TIMING } from "./previewConfig";
import { canvasSize, dividerHalves, fitBox, layoutNode, lineH, lockedOptions, luaStage, tabOptions, windowSize } from "./previewLayout";
import { isPayload, simDevice, toSimNodes } from "./previewPayload";
import { DialogSim, valueAt, type SimNode } from "./previewSim";
import { measure, parse, prepare, runs } from "./previewText";
import { newDoc } from "./types";

const visible = (s: string, k?: number) =>
  runs(parse(s), k)
    .filter((r) => !r.hidden)
    .map((r) => r.text)
    .join("");

describe("previewText（DiapigTypewriter.lua）", () => {
  it("按码点计数，标签不占字符", () => {
    expect(parse("你好<color=#F00>ab</color>").n).toBe(4);
    expect(parse("").n).toBe(0);
  });
  it("位数不对的颜色与未知标签按字面", () => {
    expect(parse("<color=#12345>x").n).toBe(15);
    expect(parse("<u>x</u>").n).toBe(8);
  });
  it("未闭合补齐、多余闭合丢掉", () => {
    expect(visible("a</b>b")).toBe("ab");
    const r = runs(parse("<b>粗"));
    expect(r).toEqual([{ text: "粗", color: undefined, bold: true, italic: false, hidden: false }]);
  });
  it("交叉嵌套被修复：</b> 关掉后 <i> 重新打开", () => {
    const r = runs(parse("<b>a<i>b</b>c</i>"));
    expect(r.map((x) => [x.text, x.bold, x.italic])).toEqual([
      ["a", true, false],
      ["b", true, true],
      ["c", false, true],
    ]);
  });
  it("打字机第 k 步：前 k 个带颜色显示，其余透明且去掉颜色、保留粗体", () => {
    const r = runs(parse("<color=#FF0000><b>红色</b></color>白"), 1);
    expect(r).toEqual([
      { text: "红", color: "#FF0000", bold: true, italic: false, hidden: false },
      { text: "色", color: undefined, bold: true, italic: false, hidden: true },
      { text: "白", color: undefined, bold: false, italic: false, hidden: true },
    ]);
    expect(visible("abc", 0)).toBe("");
    expect(visible("abc", 5)).toBe("abc");
  });
  it("宽度估算与换行数（T.measure）", () => {
    expect(measure("中文", 26).width).toBe(52);
    expect(measure("Ai", 10).width).toBeCloseTo(6.2 + 3);
    expect(measure("一\n二", 26).lines).toBe(2);
    // 960 宽放 26 号字：36 个汉字 936 → 1 行，37 个 962 → 2 行
    expect(measure("字".repeat(36), 26, 960).lines).toBe(1);
    expect(measure("字".repeat(37), 26, 960).lines).toBe(2);
    expect(measure("粗", 20, undefined, true).width).toBeCloseTo(21);
  });
  it("prepare：字面量 \\n 换行，玩家名替换", () => {
    expect(prepare("你好，<PLAYER_NAME>\\n再见", "旅行者")).toBe("你好，旅行者\n再见");
  });
});

describe("previewLayout", () => {
  it("逻辑画布", () => {
    expect(canvasSize("1280x720", 0, 0)).toEqual({ w: 1280, h: 720 });
    expect(canvasSize("custom", 1000, 500)).toEqual({ w: 1000, h: 500 });
    expect(canvasSize("custom", 0, 500)).toEqual({ w: 1600, h: 900 });
  });
  it("窗口大小：跟随画布，超出工作区等比缩小；全屏为 null", () => {
    const c = { w: 1920, h: 1080 };
    expect(windowSize("canvas", c, c, { w: 2560, h: 1400 })).toEqual({ w: 1920, h: 1080 });
    expect(windowSize("canvas", c, c, { w: 1536, h: 824 })).toEqual({ w: 1464, h: 824 });
    expect(windowSize("custom", c, { w: 800, h: 800 }, null)).toEqual({ w: 800, h: 800 });
    expect(windowSize("fullscreen", c, c, null)).toBeNull();
  });
  it("等比框：多余部分留给两侧 / 上下的黑边", () => {
    const c = { w: 1600, h: 900 };
    expect(fitBox(1600, 900, c)).toEqual({ x: 0, y: 0, w: 1600, h: 900, k: 1 });
    const wide = fitBox(2000, 900, c);
    expect(wide).toEqual({ x: 200, y: 0, w: 1600, h: 900, k: 1 });
    const tall = fitBox(800, 900, c);
    expect(tall.k).toBe(0.5);
    expect(tall.y).toBe(225);
  });
  it("Lua 舞台：短边缩放，舞台加宽铺满（4:3 → 1600×1200）；等比框里恰好是画布", () => {
    expect(luaStage(1024, 768, { w: 1600, h: 900 })).toEqual({ w: 1600, h: 1200, k: 0.64 });
    expect(luaStage(800, 450, { w: 1600, h: 900 })).toEqual({ w: 1600, h: 900, k: 0.5 });
  });
  it("锁定对话：正文超过 2 行才整体上抬；分割线不短于 300", () => {
    const one = layoutNode(1, { name: "派蒙", title: "" }, parse("短句"), 1600, 1600);
    expect(one.raise).toBe(0);
    expect(one.L).toBe(300);
    expect(one.P).toBe(BOX.noTitle);
    const three = layoutNode(1, { name: "派蒙", title: "" }, parse("一\n二\n三"), 1600, 1600);
    expect(three.raise).toBeCloseTo(lineH());
    // 有称号：L ≥ 称号宽 + 64 × 2
    const t = layoutNode(1, { name: "派蒙", title: "应急食品".repeat(4) }, parse("短"), 1600, 1600);
    expect(t.L).toBeCloseTo(16 * 17 + 128);
  });
  it("分割线两半：无称号时图片比遮罩长 45（裁掉卷曲），有称号时留出称号空隙", () => {
    const lay = layoutNode(1, { name: "派蒙", title: "" }, parse("短"), 1600, 1600);
    const [l, r] = dividerHalves(lay);
    expect(l).toEqual({ maskX: -75, maskW: 150, imgW: 195, mirror: false });
    expect(r.maskX).toBe(75);
    const lt = layoutNode(1, { name: "派蒙", title: "称号" }, parse("短"), 1600, 1600);
    const [a] = dividerHalves(lt);
    expect(a.imgW).toBe(a.maskW);
    expect(a.maskX + a.maskW / 2).toBeCloseTo(-(17 + 10));
  });
  it("非锁定对话：分割线定在 172，正文下沿不低于血条上方 4 px", () => {
    const lay = layoutNode(2, { name: "派蒙", title: "" }, parse("短"), 1600, 1600);
    expect(lay.boxY + BOX.noTitle.line + BOX.lift).toBeCloseTo(172);
    const bottom = lay.boxY + BOX.noTitle.body + BOX.lift + lineH() / 2 - (lay.lines * lineH() + BOX.bodyPad);
    expect(bottom).toBeGreaterThanOrEqual(72 - 1e-9);
  });
  it("选项位置：锁定 1600 画布左边缘 255，1280 画布收到 196；末项底边 255", () => {
    expect(lockedOptions(2, 1600).left).toBe(255);
    expect(lockedOptions(2, 1280).left).toBe(196);
    const { ys } = lockedOptions(3, 1600);
    expect(ys[2] - OPTIONS.height / 2).toBe(255);
    expect(ys[0] - ys[1]).toBe(62.5);
    const tab = tabOptions(2, 1600, 0);
    expect(tab.rootX).toBeCloseTo(800 - 330 * 0.8 - 40);
    expect(tab.barY).toBe(60 + 52 + 10);
  });
  it("宽舞台（主机 1920）锁定选项右端离边缘 125；触屏非锁定选项卡与锁定选项一样大", () => {
    expect(lockedOptions(2, 1920).left).toBe(960 - 420 - 125);
    const t = tabOptions(2, 1280, 0, true);
    expect([t.width, t.height, t.scale]).toEqual([420, 52, 1]);
    expect(t.rootX).toBe(640 - 420 - 40);
  });
});

function node(p: Partial<SimNode>): SimNode {
  return { op: 1, jump: 0, branches: [], defaultBranch: 0, inheritTitle: false, title: "派蒙", subtitle: "", content: "你好", textMode: 0, duration: 0, ...p };
}
function sim(nodes: SimNode[], type: 1 | 2 | 3 = 1, startNode = 0, device: "pc" | "touch" | "console" | "mobilePad" = "pc") {
  const s = new DialogSim({ nodes, startNode, type, canvas: { w: 1600, h: 900 }, playerName: "旅行者", device });
  s.start();
  return s;
}

describe("previewSim", () => {
  it("valueAt 按缓动插值", () => {
    expect(valueAt({ a: 0, b: 10, t0: 1, d: 2, e: "linear" }, 2)).toBe(5);
    expect(valueAt({ a: 0, b: 10, t0: 1, d: 2, e: "outQuad" }, 2)).toBe(7.5);
    expect(valueAt(3, 99)).toBe(3);
  });

  it("打字机每 0.03 s 一个字，点击先跳过打字", () => {
    const s = sim([node({ content: "一二三四", textMode: 1, op: 0 })]);
    expect(s.debug.bodyK).toBe(0);
    s.advanceTime(0.031, 0.031);
    expect(s.debug.bodyK).toBe(1);
    s.update(0.01);
    expect(s.action("continue")).toBe(true);
    expect(s.debug.typing).toBe(false);
    expect(s.debug.markShown).toBe(false);
  });

  it("锁定对话：正文完整后 0.5 s（或时长秒）才出现继续指示，之前点击不推进", () => {
    const s = sim([node({ textMode: 3 }), node({ content: "第二句", inheritTitle: true, duration: 1.5, op: 0 })]);
    s.advanceTime(0.4);
    expect(s.debug.markShown).toBe(false);
    s.update(0.02);
    expect(s.action("continue")).toBe(true); // 被吞掉
    expect(s.debug.nodeIndex).toBe(0);
    s.advanceTime(0.2);
    expect(s.debug.markShown).toBe(true);
    s.update(0.016);
    s.action("confirm");
    expect(s.debug.nodeIndex).toBe(1);
    // 继承标题：旧正文先淡出 0.12 s 才显示新节点，时长 1.5 s 后出现继续指示
    s.advanceTime(BOX.bodyOut + 1.4);
    expect(s.debug.markShown).toBe(false);
    s.advanceTime(0.2);
    expect(s.debug.markShown).toBe(true);
  });

  it("操作码：跳转、结束后进入结束状态", () => {
    const s = sim([node({ op: 2, jump: 2, textMode: 3 }), node({ content: "跳过我" }), node({ op: 0, textMode: 3 })]);
    s.advanceTime(0.6);
    s.update(0.016);
    s.action("continue");
    // 换人：旧内容淡出 0.2 s 后显示
    s.advanceTime(BOX.speakerOut + 0.6);
    expect(s.debug.nodeIndex).toBe(2);
    s.update(0.016);
    s.action("continue");
    expect(s.ended).toBeNull();
    s.advanceTime(BOX.closeFade + 0.1);
    expect(s.ended).toEqual({ kind: "end" });
    expect(s.snapshot().box).toBeNull();
  });

  it("锁定分支：点继续后才出现选项，W/S 移动、F 选择，空格不选", () => {
    const s = sim([
      node({ op: 3, textMode: 3, branches: [{ title: "去看看", jump: 1 }, { title: "<PLAYER_NAME>算了", jump: 2 }] }),
      node({ content: "A", op: 0 }),
      node({ content: "B", op: 0 }),
    ]);
    s.advanceTime(0.6);
    s.update(0.016);
    s.action("continue");
    expect(s.debug.options).toEqual({ locked: true, n: 2, sel: 0, done: false });
    s.advanceTime(OPTIONS.appear + 0.02);
    const o = s.snapshot().options!;
    expect(o.keyF).not.toBeNull();
    expect(o.cards[1].label.map((r) => r.text).join("")).toBe("旅行者算了");
    s.action("down");
    s.update(0.016);
    s.action("continue");
    expect(s.debug.options?.done).toBe(false);
    s.update(0.016);
    s.action("confirm");
    s.advanceTime(OPTIONS.press + OPTIONS.leave + 0.05);
    expect(s.debug.nodeIndex).toBe(2);
  });

  it("非锁定：自动推进 max(2, 时长)，分支只显示前 4 个，超时选默认分支", () => {
    const branches = [1, 2, 3, 4, 5].map((i) => ({ title: `选项${i}`, jump: 1 }));
    branches[4].jump = 2;
    const s = sim(
      [node({ content: "开场", textMode: 3, duration: 1 }), node({ op: 3, branches, defaultBranch: 4, duration: 3 }), node({ content: "默认", op: 0 })],
      2,
    );
    s.advanceTime(1.9);
    expect(s.debug.nodeIndex).toBe(0);
    s.advanceTime(0.2);
    expect(s.debug.nodeIndex).toBe(1);
    s.advanceTime(BOX.speakerOut + 0.05);
    expect(s.debug.options).toMatchObject({ locked: false, n: 4 });
    // 鼠标点不了（键鼠端非锁定选项卡不显示光标），数字键 5 不存在
    s.cardClick(0);
    expect(s.debug.options?.done).toBe(false);
    expect(s.action("pick4")).toBe(true);
    expect(s.debug.options?.done).toBe(true);
  });

  it("非锁定：不选时到时长后走默认分支", () => {
    const s = sim([node({ op: 3, branches: [{ title: "a", jump: 1 }, { title: "b", jump: 2 }], defaultBranch: 1, duration: 1 }), node({}), node({ op: 0 })], 2);
    s.advanceTime(1.05);
    expect(s.debug.nodeIndex).toBe(2);
  });

  it("黑屏：首行等黑幕淡入 1 s 再显示，打字机 0.06 s 一字，点击无效", () => {
    const s = sim([node({ content: "一二", textMode: 1, op: 0 })], 3);
    s.advanceTime(BLACK.fadeIn - 0.05);
    expect(s.debug.shown).toBe(false);
    s.advanceTime(0.06);
    expect(s.debug.bodyK).toBe(0);
    expect(s.click()).toBe(false);
    s.advanceTime(BLACK.typeStep + 0.001);
    expect(s.debug.bodyK).toBe(1);
    // 自动推进：黑幕淡入 + max(2, 时长) 后结束，文字先淡出再淡出黑幕
    s.advanceTime(BLACK.fadeIn + TIMING.autoMin);
    expect(s.ended).toBeNull();
    s.advanceTime(BLACK.textFadeOut + BLACK.fadeOut + 0.1);
    expect(s.ended).toEqual({ kind: "end" });
  });

  it("黑屏遇到分支节点、锁定分支没有分支：停住", () => {
    const b = sim([node({ op: 3, branches: [{ title: "a", jump: 0 }] })], 3);
    b.advanceTime(BLACK.fadeIn + TIMING.autoMin + 0.1);
    expect(b.ended?.kind).toBe("stall");
    const l = sim([node({ op: 3, textMode: 3 })], 1);
    l.advanceTime(0.6);
    l.update(0.016);
    l.action("continue");
    expect(l.ended?.kind).toBe("stall");
  });

  it("一帧只处理一个动作", () => {
    const s = sim([node({ content: "一二三", textMode: 1 }), node({ op: 0 })]);
    s.update(0.001);
    s.action("continue"); // 跳过打字
    s.advanceTime(0.6);
    s.update(0.016);
    expect(s.action("continue")).toBe(true);
    expect(s.debug.nodeIndex).toBe(1);
  });
});

describe("previewSim：工具栏、自动播放、对话回顾、隐藏 UI（DialogToolbar / DialogReview）", () => {
  const lines = () => [
    node({ content: "一二三四五六七八九十", textMode: 3 }),
    node({ content: "要去吗", textMode: 3, op: 3, branches: [{ title: "去", jump: 2 }, { title: "不去", jump: 2 }] }),
    node({ title: "凯安", content: "走吧", textMode: 3, op: 0 }),
  ];
  it("锁定对话显示工具栏；自动播放按字数与继续指示后 3 秒推进，从不替玩家选选项", () => {
    const s = sim(lines());
    s.update(0.016);
    expect(s.snapshot().toolbar).not.toBeNull();
    s.update(0.016);
    s.toolClick("auto");
    expect(s.debug.auto).toBe(true);
    // 继续指示 0.5 s 出现，自动推进在其后 3 s（10 字的阅读时间 2.5 s 更短）
    s.advanceTime(TIMING.continueDelay + AUTO.afterMark - 0.1);
    expect(s.debug.nodeIndex).toBe(0);
    s.advanceTime(0.2);
    expect(s.debug.nodeIndex).toBe(1);
    // 分支节点：自动按一次继续打开选项，然后一直等
    s.advanceTime(BOX.speakerOut + 10);
    expect(s.debug.options?.n).toBe(2);
    expect(s.snapshot().toolbar?.disabled).toBe(true);
    s.update(0.016);
    s.action("auto");
    expect(s.debug.auto).toBe(true); // 不可用时切换无效
    s.advanceTime(10);
    expect(s.debug.nodeIndex).toBe(1);
  });
  it("对话回顾：记录本段已显示的句子与选过的选项；打开期间吞掉继续、自动不推进", () => {
    const s = sim(lines());
    s.advanceTime(0.6);
    s.action("continue");
    s.advanceTime(BOX.speakerOut + 0.6);
    s.action("continue"); // 打开选项
    s.advanceTime(OPTIONS.appear + 0.05);
    s.action("confirm"); // 选「去」
    s.advanceTime(OPTIONS.press + OPTIONS.leave + BOX.speakerOut + 0.1);
    expect(s.debug.history.map((h) => [h.choice, h.text])).toEqual([
      [false, "一二三四五六七八九十"],
      [false, "要去吗"],
      [true, "去"],
      [false, "走吧"],
    ]);
    s.update(0.016);
    s.toolClick("review");
    expect(s.debug.reviewOpen).toBe(true);
    // 先后进行：对话界面先淡出，回顾页这时还透明
    s.advanceTime(REVIEW.uiFade / 2);
    let snap = s.snapshot();
    expect(snap.uiVisible).toBe(true);
    expect(snap.uiAlpha).toBeGreaterThan(0);
    expect(snap.uiAlpha).toBeLessThan(1);
    expect(snap.review?.alpha).toBe(0);
    s.advanceTime(REVIEW.uiFade / 2 + REVIEW.fade + 0.01);
    snap = s.snapshot();
    expect(snap.uiVisible).toBe(false);
    expect(snap.review?.alpha).toBe(1);
    expect(s.snapshot().review?.rows.length).toBe(4);
    s.update(0.016);
    expect(s.action("continue")).toBe(true);
    expect(s.debug.nodeIndex).toBe(2);
    s.reviewCloseClick();
    // 关闭：回顾页先淡出，对话界面这时仍隐藏；之后再淡入
    s.advanceTime(REVIEW.fade / 2);
    expect(s.snapshot().uiVisible).toBe(false);
    s.advanceTime(REVIEW.fade / 2 + 0.05);
    expect(s.debug.reviewOpen).toBe(false);
    snap = s.snapshot();
    expect(snap.uiVisible).toBe(true);
    expect(snap.uiAlpha).toBeLessThan(1);
    s.advanceTime(REVIEW.uiFade);
    expect(s.snapshot().uiAlpha).toBe(1);
  });
  it("隐藏 UI：恢复显示的那次操作不推进对话；手柄返回键也能恢复", () => {
    const s = sim(lines());
    s.advanceTime(0.6);
    s.toolClick("auto");
    s.update(0.016);
    expect(s.debug.auto).toBe(true);
    s.toolClick("hide");
    expect(s.snapshot().uiVisible).toBe(false);
    expect(s.debug.auto).toBe(false);
    s.update(0.016);
    expect(s.click()).toBe(true);
    expect(s.debug.hidden).toBe(false);
    expect(s.debug.nodeIndex).toBe(0);
    // 恢复后自动播放保持关闭：等多久都不自动推进
    s.advanceTime(20);
    expect(s.debug.auto).toBe(false);
    expect(s.debug.nodeIndex).toBe(0);
    s.update(0.016);
    s.action("hide");
    s.update(0.016);
    s.action("back");
    expect(s.debug.hidden).toBe(false);
    expect(s.debug.nodeIndex).toBe(0);
  });
  it("手柄：确认提示在没有选项时显示；触屏没有键盘光标高亮", () => {
    const p = sim(lines(), 1, 0, "console");
    p.advanceTime(0.1);
    expect(p.snapshot().padHint).toBe(true);
    const t = sim(lines(), 1, 1, "touch");
    t.advanceTime(0.6);
    t.action("continue");
    t.advanceTime(OPTIONS.appear + 0.05);
    expect(t.snapshot().options?.cards.some((c) => c.lit != null)).toBe(false);
    expect(t.snapshot().options?.keyF).toBeNull();
  });
});

describe("previewPayload", () => {
  it("预览设备：指定设备直接用，自定义按按键提示推断", () => {
    expect(simDevice("touch", "kbm", 1600)).toBe("touch");
    expect(simDevice(undefined, "pad", 1920)).toBe("console");
    expect(simDevice(undefined, "pad", 1280)).toBe("mobilePad");
    expect(simDevice(undefined, "none", 1600)).toBe("touch");
    expect(simDevice(undefined, "kbm", 1280)).toBe("pc");
  });
  it("去掉 uid 与事件，校验结构", () => {
    const nodes = toSimNodes(newDoc());
    expect(Object.keys(nodes[0])).not.toContain("uid");
    expect(Object.keys(nodes[0])).not.toContain("enterEvent");
    expect(isPayload({ seq: 1, kind: "locked", nodes, startNode: 0, canvas: { w: 1600, h: 900 }, keyHint: "kbm", font: "", uiFonts: [] })).toBe(true);
    expect(isPayload({ seq: 1, kind: "x", nodes, startNode: 0, canvas: { w: 1600, h: 900 } })).toBe(false);
  });
});
