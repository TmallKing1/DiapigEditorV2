<script lang="ts">
  // 自然书写公式框：分式上下排版、根号盖住被开方式、指数上标、函数括号可继续嵌套。
  // 内容的“真身”是源码字符串 value（页面保存 / 导出用的仍是它）：编辑时生成源码交给 onchange；
  // 外部改了源码（如在源码框里直接编辑）就重新解析，解析失败时保留上一次的有效内容并标红。
  // 聚焦时在下方挂出数学键盘；失焦（点到别处、Tab、完成、Esc）即收起，同一时刻只有聚焦的那个框有键盘。
  import { tick, untrack } from "svelte";
  import {
    apply,
    emptyState,
    keyAction,
    rowKey,
    stateFromSource,
    toSource,
    type Atom,
    type Cursor,
    type MathAction,
    type MathState,
    type Row,
    type Step,
  } from "../model/mathExpr";
  import MathKeyboard from "./MathKeyboard.svelte";

  let {
    id,
    value,
    onchange,
    error = "",
    ariaLabel,
    placeholder = "",
  }: {
    id?: string;
    value: string;
    onchange: (source: string) => void;
    /** 公式的错误说明（求值失败时由页面给出）；非空即标红 */
    error?: string;
    ariaLabel: string;
    placeholder?: string;
  } = $props();

  /** 根行字号；分式、指数、根指数逐级缩小 */
  const BASE = 15;
  const shrink = (size: number, k: number, min: number) => Math.max(min, Math.round(size * k * 10) / 10);

  let el = $state<HTMLDivElement>();
  let content = $state<HTMLDivElement>();
  let focused = $state(false);
  // 树是不可变的：用 raw 状态，按引用判断有没有改动
  let st = $state.raw<MathState>(untrack(() => stateFromSource(value)) ?? emptyState());
  /** 源码解析失败，公式框显示的是上一次的有效内容 */
  let stale = $state(untrack(() => stateFromSource(value) === null));
  /** 最近一次见到（或自己生成）的源码，用来区分外部修改 */
  let seen = untrack(() => value);

  $effect(() => {
    const v = value;
    untrack(() => {
      if (v === seen) return;
      seen = v;
      const next = stateFromSource(v);
      if (next) {
        st = next;
        stale = false;
      } else stale = true;
    });
  });

  let source = $derived(toSource(st.root));
  let caretKey = $derived(focused ? rowKey(st.cursor.path) : null);
  let tooltip = $derived(error ? (stale ? `${error}\n公式框保留的是上一次的有效内容` : error) : "");

  function dispatch(a: MathAction) {
    const next = apply(st, a);
    if (next === st) return;
    const changed = next.root !== st.root;
    st = next;
    if (changed) {
      stale = false;
      seen = toSource(next.root);
      onchange(seen);
    }
    void reveal();
  }

  /** 公式超宽 / 超高时滚动，让光标保持可见 */
  async function reveal() {
    await tick();
    const caret = el?.querySelector<HTMLElement>(".caret");
    if (!el || !caret) return;
    const box = el.getBoundingClientRect();
    const c = caret.getBoundingClientRect();
    const pad = 12;
    if (c.left < box.left + pad) el.scrollLeft -= box.left + pad - c.left;
    else if (c.right > box.right - pad) el.scrollLeft += c.right - (box.right - pad);
    if (c.top < box.top) el.scrollTop -= box.top - c.top;
    else if (c.bottom > box.bottom) el.scrollTop += c.bottom - box.bottom;
  }

  function onkeydown(e: KeyboardEvent) {
    const map: Record<string, MathAction["type"]> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      Home: "home",
      End: "end",
      Backspace: "backspace",
      Delete: "delete",
    };
    const t = map[e.key];
    if (t) {
      e.preventDefault();
      dispatch({ type: t } as MathAction);
      return;
    }
    if (e.key === "Escape" || e.key === "Enter") {
      // 只收起键盘，不让外层（子页面返回等）也响应
      e.preventDefault();
      e.stopPropagation();
      el?.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    e.preventDefault();
    const a = keyAction(e.key);
    if (a) dispatch(a);
  }

  function onpaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    dispatch({ type: "paste", text });
  }

  function oncopy(e: ClipboardEvent) {
    if (!e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", source);
  }

  const parseKey = (key: string): Step[] =>
    key
      ? key.split("/").map((p) => {
          const [i, s] = p.split(".").map(Number);
          return { i, s };
        })
      : [];

  /** 鼠标点击：在所有行的所有光标位置里取最近的一个（竖直方向偏离行的距离加重计算，同分取更深的行） */
  function pick(x: number, y: number): Cursor | null {
    if (!content) return null;
    let best: { cursor: Cursor; score: number; depth: number } | null = null;
    for (const rowEl of content.querySelectorAll<HTMLElement>("[data-row]")) {
      const key = rowEl.dataset.row ?? "";
      const path = parseKey(key);
      const rr = rowEl.getBoundingClientRect();
      const dy = y < rr.top ? rr.top - y : y > rr.bottom ? y - rr.bottom : 0;
      const atoms = rowEl.querySelectorAll<HTMLElement>(":scope > [data-a]");
      const xs: number[] = [];
      atoms.forEach((a) => xs.push(a.getBoundingClientRect().left));
      xs.push(atoms.length ? atoms[atoms.length - 1].getBoundingClientRect().right : rr.left + rr.width / 2);
      xs.forEach((px, index) => {
        const score = Math.abs(x - px) + dy * 3;
        if (!best || score < best.score - 0.5 || (Math.abs(score - best.score) <= 0.5 && path.length > best.depth)) {
          best = { cursor: { path, index }, score, depth: path.length };
        }
      });
    }
    return best ? (best as { cursor: Cursor }).cursor : null;
  }

  function onmousedown(e: MouseEvent) {
    if (e.button !== 0) return;
    const c = pick(e.clientX, e.clientY);
    if (c) {
      st = apply(st, { type: "set", cursor: c });
      void reveal();
    }
  }

  const isOpCh = (a: Atom | undefined) => a?.t === "ch" && "+-*,".includes(a.v);
  /** 二元运算符两侧留空，一元负号紧贴 */
  const binary = (r: Row, i: number) => i > 0 && !isOpCh(r[i - 1]) && !(r[i - 1].t === "ch" && (r[i - 1] as { v: string }).v === "E");
  const sub = (path: Step[], i: number, s: number): Step[] => [...path, { i, s }];
</script>

{#snippet caret()}<span class="caret" aria-hidden="true"></span>{/snippet}

{#snippet parens(kind: "paren" | "abs")}
  <svg class="pl" viewBox="0 0 10 20" preserveAspectRatio="none" aria-hidden="true">
    <path d={kind === "abs" ? "M5 0.5V19.5" : "M8 0.5Q1.5 10 8 19.5"} vector-effect="non-scaling-stroke" />
  </svg>
  <svg class="pr" viewBox="0 0 10 20" preserveAspectRatio="none" aria-hidden="true">
    <path d={kind === "abs" ? "M5 0.5V19.5" : "M2 0.5Q8.5 10 2 19.5"} vector-effect="non-scaling-stroke" />
  </svg>
{/snippet}

{#snippet radical(body: Row, path: Step[], size: number)}
  <span class="rad">
    <svg class="rad-sign" viewBox="0 0 10 20" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0.5 12.5L2.8 11L5.6 19.5L9.4 0.5H10" vector-effect="non-scaling-stroke" />
    </svg>
    <span class="radicand">{@render row(body, path, size)}</span>
  </span>
{/snippet}

{#snippet atom(a: Atom, r: Row, i: number, path: Step[], size: number)}
  {#if a.t === "ch"}
    {#if a.v === "+" || a.v === "-" || a.v === "*"}
      <span data-a={i} class="op" class:bin={a.v === "*" || binary(r, i)}>{a.v === "-" ? "−" : a.v === "*" ? "×" : "+"}</span>
    {:else if a.v === ","}
      <span data-a={i} class="comma">,</span>
    {:else if a.v === "E"}
      <span data-a={i} class="sci">ᴇ</span>
    {:else if (a.v >= "0" && a.v <= "9") || a.v === "."}
      <span data-a={i} class="num">{a.v}</span>
    {:else}
      <span data-a={i} class="pending" data-tip="不认识的字母">{a.v}</span>
    {/if}
  {:else if a.t === "sym"}
    <span data-a={i} class="var" class:const={a.v !== "x"}>{a.v === "pi" ? "π" : a.v}</span>
  {:else if a.t === "frac"}
    <span data-a={i} class="frac">
      {@render row(a.num, sub(path, i, 0), shrink(size, 0.9, 10))}
      <span class="frac-bar"></span>
      {@render row(a.den, sub(path, i, 1), shrink(size, 0.9, 10))}
    </span>
  {:else if a.t === "pow"}
    <span data-a={i} class="pow">{@render row(a.exp, sub(path, i, 0), shrink(size, 0.72, 9))}</span>
  {:else if a.t === "sqrt"}
    <span data-a={i} class="root">{@render radical(a.body, sub(path, i, 0), size)}</span>
  {:else if a.t === "root"}
    <span data-a={i} class="root">
      <span class="root-index">{@render row(a.index, sub(path, i, 0), shrink(size, 0.6, 9))}</span>
      {@render radical(a.body, sub(path, i, 1), size)}
    </span>
  {:else if a.t === "fn"}
    <span data-a={i} class="fn">
      {#if a.name !== "abs"}<span class="fname">{a.name}</span>{/if}
      <span class="paren">
        {@render parens(a.name === "abs" ? "abs" : "paren")}
        {#each a.args as arg, s (s)}
          {#if s}<span class="comma">,</span>{/if}
          {@render row(arg, sub(path, i, s), size)}
        {/each}
      </span>
    </span>
  {:else if a.t === "paren"}
    <span data-a={i} class="paren">
      {@render parens("paren")}
      {@render row(a.body, sub(path, i, 0), size)}
    </span>
  {/if}
{/snippet}

{#snippet row(r: Row, path: Step[], size: number)}
  {@const key = rowKey(path)}
  <span class="row" class:slot={path.length > 0} class:empty={!r.length} data-row={key} style:font-size="{size}px">
    <!-- 各项之间不能留空白：行内元素间的空白会被渲染成一个空格，把数字拆开 -->
    {#each r as a, i (i)}{#if caretKey === key && st.cursor.index === i}{@render caret()}{/if}{@render atom(a, r, i, path, size)}{/each}{#if caretKey === key && st.cursor.index === r.length}{@render caret()}{/if}
  </span>
{/snippet}

<div
  {id}
  bind:this={el}
  class="mf"
  class:focused
  class:invalid={!!error}
  role="textbox"
  tabindex="0"
  aria-label={ariaLabel}
  aria-invalid={!!error}
  data-tip={tooltip || undefined}
  onfocus={() => {
    focused = true;
    void reveal();
  }}
  onblur={() => (focused = false)}
  {onkeydown}
  {onmousedown}
  {onpaste}
  {oncopy}
>
  <div class="mf-content" bind:this={content}>
    {@render row(st.root, [], BASE)}
    {#if !st.root.length && !focused && placeholder}<span class="ph">{placeholder}</span>{/if}
  </div>
</div>

{#if focused && el}
  <MathKeyboard anchor={el} {source} onaction={dispatch} ondone={() => el?.blur()} />
{/if}

<style>
  /* 外观与 .input 相同；高度随内容变化，超出上限后滚动 */
  .mf {
    box-sizing: border-box;
    display: flex;
    align-items: safe center;
    width: 100%;
    min-width: 0;
    min-height: var(--ctl-h);
    max-height: 132px;
    padding: 3px var(--s2);
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--surface);
    cursor: text;
    user-select: none;
    line-height: 1.3;
    transition:
      border-color var(--t-hover-out) var(--ease-out),
      box-shadow var(--t-hover-out) var(--ease-out);
  }
  .mf:hover {
    border-color: var(--theme-bright);
    transition-duration: var(--t-hover-in);
  }
  .mf.focused,
  .mf:focus-visible {
    outline: none;
    border-color: var(--theme);
    box-shadow: 0 0 0 2px var(--theme-light);
  }
  .mf.invalid {
    border-color: var(--danger);
  }
  .mf.invalid.focused {
    box-shadow: 0 0 0 2px var(--danger-bg);
  }
  .mf-content {
    flex: none;
    white-space: nowrap;
    padding: 2px 0;
  }
  .ph {
    color: var(--text-3);
    font-size: 14px;
  }
  .row {
    display: inline;
  }
  /* 空槽位：虚线小方框 */
  .row.slot.empty::before {
    content: "";
    display: inline-block;
    width: 0.62em;
    height: 0.86em;
    margin: 0 1px;
    border: 1px dashed var(--text-3);
    border-radius: 2px;
    vertical-align: -0.1em;
  }
  .num,
  .sci {
    font-variant-numeric: tabular-nums;
  }
  .sci {
    margin: 0 1px;
    color: var(--text-2);
  }
  .var {
    font-family: "Cambria Math", "Times New Roman", serif;
    font-style: italic;
    font-size: 1.1em;
    padding: 0 0.04em;
  }
  .var.const {
    font-style: normal;
  }
  .op.bin {
    margin: 0 0.22em;
  }
  .comma {
    margin-right: 0.25em;
  }
  .pending {
    color: var(--danger);
    text-decoration: underline dotted;
  }
  .fname {
    margin-right: 1px;
  }
  /* 分式：分子、分数线、分母竖排，整体居中对齐到文字中线 */
  .frac {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    vertical-align: middle;
    margin: 0 0.12em;
    padding: 1px 0;
  }
  .frac > .row {
    display: block;
    padding: 0 0.15em;
    text-align: center;
  }
  .frac-bar {
    align-self: stretch;
    height: 1px;
    margin: 1px 0;
    background: currentColor;
  }
  /* 指数：抬高半个字高 */
  .pow {
    display: inline-block;
    vertical-align: 0.5em;
    margin-left: 1px;
  }
  /* 括号与绝对值：两侧的 SVG 随内容高度伸缩 */
  .paren {
    display: inline-block;
    position: relative;
    padding: 0 0.36em;
  }
  .paren > svg {
    position: absolute;
    top: 0;
    width: 0.32em;
    height: 100%;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
  }
  .pl {
    left: 0;
  }
  .pr {
    right: 0;
  }
  /* 根号：钩子是绝对定位的 SVG，被开方式上方画横线 */
  .root {
    display: inline-block;
    white-space: nowrap;
  }
  .rad {
    display: inline-block;
    position: relative;
    padding-left: 0.62em;
    margin-right: 0.08em;
  }
  .rad-sign {
    position: absolute;
    left: 0;
    top: 0;
    width: 0.62em;
    height: 100%;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
  }
  .radicand {
    display: inline-block;
    padding: 0.12em 0.12em 0 0.08em;
    border-top: 1.2px solid currentColor;
  }
  .root-index {
    display: inline-block;
    vertical-align: 0.7em;
    margin-right: -0.42em;
    min-width: 0.5em;
    text-align: right;
  }
  /* 光标：零宽，细条闪烁 */
  .caret {
    display: inline-block;
    position: relative;
    width: 0;
    height: 1.2em;
    vertical-align: -0.25em;
  }
  .caret::after {
    content: "";
    position: absolute;
    left: -0.75px;
    top: 0;
    bottom: 0;
    width: 1.5px;
    background: var(--theme);
    animation: mf-blink 1.06s steps(1) infinite;
  }
  @keyframes mf-blink {
    50% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .caret::after {
      animation: none;
    }
  }
</style>
