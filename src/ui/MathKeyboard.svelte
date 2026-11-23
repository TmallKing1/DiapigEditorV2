<script lang="ts" module>
  import type { MathAction } from "../model/mathExpr";

  /** 键面：文字，或几种结构的示意图形 */
  type Glyph = "frac" | "square" | "pow" | "sqrt" | "root" | "abs";
  export interface MathKey {
    label: string;
    title: string;
    action: MathAction;
    glyph?: Glyph;
    /** 键的类别，决定底色与字体 */
    kind?: "num" | "op" | "var" | "fn";
  }

  const ins = (text: string): MathAction => ({ type: "insert", text });
  const fn = (name: string, title: string): MathKey => ({ label: name, title, action: { type: "fn", name }, kind: "fn" });

  // 三个分区各 4 行；顺序即网格的阅读顺序
  const NUMBERS: MathKey[] = [
    ...["7", "8", "9"].map((d) => ({ label: d, title: d, action: ins(d), kind: "num" as const })),
    { label: "×", title: "乘", action: ins("*"), kind: "op" },
    ...["4", "5", "6"].map((d) => ({ label: d, title: d, action: ins(d), kind: "num" as const })),
    { label: "−", title: "减 / 负号", action: ins("-"), kind: "op" },
    ...["1", "2", "3"].map((d) => ({ label: d, title: d, action: ins(d), kind: "num" as const })),
    { label: "+", title: "加", action: ins("+"), kind: "op" },
    { label: "0", title: "0", action: ins("0"), kind: "num" },
    { label: ".", title: "小数点", action: ins("."), kind: "num" },
    { label: "ᴇ", title: "科学计数（1ᴇ3 = 1000）", action: ins("E"), kind: "num" },
    { label: "÷", title: "除（建分式，同 /）", action: { type: "frac" }, kind: "op" },
  ];
  const STRUCTURES: MathKey[] = [
    { label: "", title: "分式（/）", action: { type: "frac" }, glyph: "frac" },
    { label: "", title: "平方", action: { type: "square" }, glyph: "square" },
    { label: "", title: "乘方（^）", action: { type: "pow" }, glyph: "pow" },
    { label: "", title: "平方根 sqrt", action: { type: "sqrt" }, glyph: "sqrt" },
    { label: "", title: "n 次方根 root", action: { type: "root" }, glyph: "root" },
    { label: "", title: "绝对值 abs（|）", action: { type: "fn", name: "abs" }, glyph: "abs" },
    { label: "(", title: "左括号（自动配对）", action: { type: "open" }, kind: "op" },
    { label: ")", title: "右括号（移出括号）", action: { type: "close" }, kind: "op" },
    { label: ",", title: "逗号（max / min 的下一个参数）", action: { type: "comma" }, kind: "op" },
    { label: "x", title: "等级 x", action: ins("x"), kind: "var" },
    { label: "π", title: "圆周率 pi", action: ins("π"), kind: "var" },
    { label: "e", title: "自然常数 e", action: ins("e"), kind: "var" },
  ];
  const FUNCS: MathKey[] = [
    fn("sin", "正弦 sin"),
    fn("cos", "余弦 cos"),
    fn("tan", "正切 tan"),
    fn("ln", "自然对数 ln"),
    fn("log", "常用对数 log（以 10 为底）"),
    fn("exp", "e 的幂 exp"),
    fn("max", "最大值 max（两个或更多参数）"),
    fn("min", "最小值 min（两个或更多参数）"),
    fn("round", "四舍五入 round"),
    fn("floor", "向下取整 floor"),
    fn("ceil", "向上取整 ceil"),
  ];
  export const KEY_GROUPS = [
    { name: "数字与运算", cols: 4, keys: NUMBERS },
    { name: "结构", cols: 3, keys: STRUCTURES },
    { name: "函数", cols: 3, keys: FUNCS },
  ];
</script>

<script lang="ts">
  // 数学键盘：挂在公式框下方的浮层（与 Dropdown 的菜单同一套定位与进出场）。
  // 所有按键在 mousedown 时阻止默认行为，焦点始终留在公式框里；公式框失焦时由它移除键盘。
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";
  import { menuIn, menuOut } from "./motion";

  let {
    anchor,
    source,
    onaction,
    ondone,
  }: {
    /** 公式框，键盘跟随它定位 */
    anchor: HTMLElement;
    /** 当前公式的源码，显示在键盘顶部 */
    source: string;
    onaction: (a: MathAction) => void;
    ondone: () => void;
  } = $props();

  // 尺寸写死在样式里，展开前就能算出方向，避免出现后再翻向
  const W = 488;
  const H = 236;
  const GAP = 4;
  const MARGIN = 8;

  let pos = $state({ left: 0, top: 0, up: false });

  function place() {
    const r = anchor.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = below < H && above > below;
    const left = Math.min(Math.max(MARGIN, r.left), Math.max(MARGIN, window.innerWidth - W - MARGIN));
    const top = up ? Math.max(MARGIN, r.top - GAP - H) : Math.min(r.bottom + GAP, window.innerHeight - H - MARGIN);
    pos = { left, top, up };
  }
  place();

  // 外层滚动、窗口缩放、公式框变高时跟随
  onMount(() => {
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const ro = new ResizeObserver(follow);
    ro.observe(anchor);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  });

  // 退格与左右键按住时连发（先停 400 ms，之后每 60 ms 一次）
  let repeatTimer: ReturnType<typeof setTimeout> | undefined;
  function stopRepeat() {
    clearTimeout(repeatTimer);
    clearInterval(repeatTimer);
    repeatTimer = undefined;
  }
  function startRepeat(e: PointerEvent, a: MathAction) {
    if (e.button !== 0) return;
    stopRepeat();
    onaction(a);
    repeatTimer = setTimeout(() => {
      repeatTimer = setInterval(() => onaction(a), 60);
    }, 400);
  }
  $effect(() => stopRepeat);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

{#snippet keyFace(k: MathKey)}
  {#if k.glyph === "frac"}
    <span class="g-frac"><i class="bx"></i><i class="g-bar"></i><i class="bx"></i></span>
  {:else if k.glyph === "square"}
    <span class="g-pow"><i class="bx"></i><sup>2</sup></span>
  {:else if k.glyph === "pow"}
    <span class="g-pow"><i class="bx"></i><sup><i class="bx small"></i></sup></span>
  {:else if k.glyph === "sqrt"}
    <span class="g-rad">√<i class="bx over"></i></span>
  {:else if k.glyph === "root"}
    <span class="g-rad"><sup class="g-idx">n</sup>√<i class="bx over"></i></span>
  {:else if k.glyph === "abs"}
    <span class="g-abs">|<i class="bx"></i>|</span>
  {:else}
    {k.label}
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  use:portal
  class="mk"
  role="group"
  aria-label="数学键盘"
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  style:width="{W}px"
  style:height="{H}px"
  onmousedown={(e) => e.preventDefault()}
  in:menuIn={{ up: pos.up }}
  out:menuOut={{ up: pos.up }}
>
  <div class="src" data-tip={source ? `源码：${source}` : "源码为空"}>
    <Icon name="code" size={14} />
    <span class="src-text" class:empty={!source}>{source || "源码"}</span>
  </div>

  <div class="pad">
    {#each KEY_GROUPS as g, gi (g.name)}
      {#if gi}<span class="divider"></span>{/if}
      <div class="group" role="group" aria-label={g.name} style:grid-template-columns="repeat({g.cols}, 1fr)" style:--cols={g.cols}>
        {#each g.keys as k (k.title)}
          <button type="button" tabindex="-1" class="mk-key {k.kind ?? 'struct'}" aria-label={k.title} data-tip={k.title} onclick={() => onaction(k.action)}>
            {@render keyFace(k)}
          </button>
        {/each}
      </div>
    {/each}
  </div>

  <div class="bar">
    <button
      type="button"
      tabindex="-1"
      class="mk-key tool"
      aria-label="光标左移"
      data-tip="光标左移（←）"
      onpointerdown={(e) => startRepeat(e, { type: "left" })}
      onpointerup={stopRepeat}
      onpointerleave={stopRepeat}
      onpointercancel={stopRepeat}><Icon name="chev-left" size={18} /></button
    >
    <button
      type="button"
      tabindex="-1"
      class="mk-key tool"
      aria-label="光标右移"
      data-tip="光标右移（→）"
      onpointerdown={(e) => startRepeat(e, { type: "right" })}
      onpointerup={stopRepeat}
      onpointerleave={stopRepeat}
      onpointercancel={stopRepeat}><Icon name="chev-right" size={18} /></button
    >
    <button
      type="button"
      tabindex="-1"
      class="mk-key tool"
      aria-label="退格"
      data-tip="退格"
      onpointerdown={(e) => startRepeat(e, { type: "backspace" })}
      onpointerup={stopRepeat}
      onpointerleave={stopRepeat}
      onpointercancel={stopRepeat}><Icon name="backspace" size={18} /></button
    >
    <button type="button" tabindex="-1" class="mk-key tool wide" aria-label="清空公式" data-tip="清空公式" onclick={() => onaction({ type: "clear" })}>
      <Icon name="eraser" size={16} />清空
    </button>
    <span class="grow"></span>
    <button type="button" tabindex="-1" class="btn accent done" data-tip="收起键盘（Enter / Esc）" onclick={ondone}>
      <Icon name="check" />完成
    </button>
  </div>
</div>

<style>
  .mk {
    position: fixed;
    z-index: 60;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    box-shadow: var(--shadow-float);
    color: var(--text);
    user-select: none;
  }
  /* 顶部一行源码，只读；完整内容见悬停提示 */
  .src {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 var(--s2);
    border-radius: var(--r-btn);
    background: var(--page);
    color: var(--text-2);
  }
  .src-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-family: "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace;
    font-size: 12.5px;
  }
  .src-text.empty {
    color: var(--text-3);
  }
  .pad {
    flex: none;
    display: flex;
    gap: var(--s2);
    height: 140px;
  }
  .group {
    display: grid;
    grid-template-rows: repeat(4, 32px);
    gap: 4px;
    /* 数字区键窄一些，结构与函数区键宽一些，三区总宽正好填满键盘 */
    width: calc(var(--cols) * 38px + (var(--cols) - 1) * 4px);
  }
  .group:not(:first-child) {
    width: calc(var(--cols) * 42px + (var(--cols) - 1) * 4px);
  }
  .divider {
    flex: none;
    width: 1px;
    background: var(--border);
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 32px;
  }
  .grow {
    flex: 1;
  }
  /* 按键：与 .btn 相同的悬停 / 按下反馈，边框收淡、尺寸紧凑 */
  .mk-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    height: 32px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--surface);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    transition:
      background-color var(--t-hover-out) var(--ease-out),
      border-color var(--t-hover-out) var(--ease-out),
      color var(--t-hover-out) var(--ease-out),
      transform var(--t-release) var(--ease-back);
  }
  .mk-key:hover {
    border-color: var(--theme);
    color: var(--theme-deep);
    background: var(--hover-bg);
    transition-duration: var(--t-hover-in), var(--t-hover-in), var(--t-hover-in), var(--t-release);
  }
  .mk-key:active {
    transform: scale(0.94);
    transition-duration: var(--t-hover-in), var(--t-hover-in), var(--t-hover-in), var(--t-press);
    transition-timing-function: var(--ease-out);
  }
  .mk-key.num {
    font-variant-numeric: tabular-nums;
  }
  .mk-key.op,
  .mk-key.struct,
  .mk-key.tool {
    background: var(--tint-bg);
  }
  .mk-key.op:hover,
  .mk-key.struct:hover,
  .mk-key.tool:hover {
    background: var(--hover-bg);
  }
  .mk-key.var {
    font-family: "Cambria Math", "Times New Roman", serif;
    font-style: italic;
    font-size: 17px;
  }
  .mk-key.fn {
    font-size: 13px;
  }
  .mk-key.tool {
    width: 40px;
    color: var(--text-2);
  }
  .mk-key.tool:hover {
    color: var(--theme-deep);
  }
  .mk-key.wide {
    width: auto;
    padding: 0 var(--s3);
    font-size: 13px;
  }
  .done {
    height: 32px;
  }
  /* 结构键的示意图形：虚线小方框代表待填的槽位 */
  .bx {
    display: inline-block;
    width: 9px;
    height: 11px;
    border: 1px solid currentColor;
    border-radius: 1px;
    opacity: 0.75;
  }
  .bx.small {
    width: 6px;
    height: 7px;
  }
  .bx.over {
    margin-left: 1px;
    border-top-width: 1.5px;
    opacity: 1;
  }
  .g-frac {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .g-frac .bx {
    width: 8px;
    height: 7px;
  }
  .g-bar {
    display: block;
    width: 14px;
    height: 1.5px;
    background: currentColor;
  }
  .g-pow {
    display: inline-flex;
    align-items: flex-start;
  }
  .g-pow sup {
    margin-left: 1px;
    font-size: 10px;
    line-height: 1;
  }
  .g-rad,
  .g-abs {
    display: inline-flex;
    align-items: center;
    font-size: 15px;
  }
  .g-idx {
    margin-right: -3px;
    font-size: 9px;
    align-self: flex-start;
  }
  .g-abs .bx {
    margin: 0 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .mk-key,
    .mk-key:active {
      transform: none;
    }
  }
</style>
