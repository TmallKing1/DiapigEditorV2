<script lang="ts">
  // 界面字体回退列表的标签输入框：已选字体排成标签（按顺序生效，拖动手柄排序，× 移除），
  // 后面的输入框用来搜索并添加字体。下拉列表分「自定义字体」「系统字体」两组，每项右侧用该字体显示示例文字。
  // 列表只渲染可见范围内的项（虚拟滚动），写法与 Dropdown.svelte 相同：系统字体多、每项字体不同，全部排版会卡顿。
  import { tick } from "svelte";
  import { type FontFamily, customFontState, listFonts, settings } from "../lib/settings.svelte";
  import { SYSTEM_UI } from "../model/prefs";
  import Icon from "./Icon.svelte";
  import { menuIn, menuOut, tipOut } from "./motion";
  import { RowDrag } from "./rowDrag.svelte";

  let {
    id,
    value,
    onchange,
    placeholder = "未添加字体，将使用系统默认字体",
    ariaLabel,
  }: {
    id: string;
    /** 字体家族名列表，按顺序生效 */
    value: string[];
    onchange: (value: string[]) => void;
    placeholder?: string;
    ariaLabel?: string;
  } = $props();

  const ITEM_H = 32;
  const HEAD_H = 28;
  const PAD = 4;
  const MAX_H = 320;
  const GAP = 4;
  const MARGIN = 8;
  const OVERSCAN = 6;
  /** 下拉项右侧的示例文字：英文、中文、数字各一段，便于比较字形 */
  const SAMPLE = "Diapig Editor Pro Max 我吃一口尝尝咸淡 3.1415926";
  const SYSTEM_UI_LABEL = "系统界面字体";

  type Item =
    | { kind: "head"; label: string; top: number }
    | { kind: "font"; value: string; label: string; en: string; css: string; top: number; bad: boolean };

  let fonts = $state<FontFamily[] | null>(null);
  let error = $state("");
  let showLoading = $state(false);

  async function load() {
    error = "";
    fonts = null;
    const timer = setTimeout(() => (showLoading = true), 150);
    try {
      fonts = await listFonts();
    } catch (e) {
      error = String(e);
    } finally {
      clearTimeout(timer);
      showLoading = false;
    }
  }
  load();

  const cssOf = (name: string) => (name === SYSTEM_UI ? SYSTEM_UI : `"${name.replaceAll('"', '\\"')}", var(--font-default)`);

  /** 标签上显示的名称：系统字体有中文名时用中文名 */
  function labelOf(name: string): string {
    if (name === SYSTEM_UI) return SYSTEM_UI_LABEL;
    return fonts?.find((f) => f.name === name)?.local || name;
  }

  /** 标签上的状态徽标；系统字体列表还没读到时不显示 */
  function badgeOf(name: string): { text: string; cls: string; tip?: string } | null {
    if (name === SYSTEM_UI) return { text: "已安装", cls: "ok" };
    if (settings.customFonts.some((f) => f.family === name)) {
      const st = customFontState[name];
      return st?.status === "error" ? { text: "失效", cls: "bad", tip: st.message } : { text: "自定义", cls: "custom" };
    }
    if (!fonts) return null;
    return fonts.some((f) => f.name === name) ? { text: "已安装", cls: "ok" } : { text: "未找到", cls: "missing", tip: "系统里没有这个字体，会跳过它用下一个" };
  }

  // —— 下拉列表 ——

  let box = $state<HTMLDivElement>();
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  let query = $state("");
  let menu = $state({ left: 0, top: 0, width: 0, height: 0, up: false });
  /** 当前高亮的字体项在 picks 里的序号 */
  let active = $state(0);
  let scrollTop = $state(0);

  let items = $derived.by<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const taken = new Set(value.map((v) => v.toLowerCase()));
    const hit = (...names: (string | null | undefined)[]) => !q || names.some((n) => n?.toLowerCase().includes(q));
    const out: Item[] = [];
    let top = PAD;
    const head = (label: string) => {
      out.push({ kind: "head", label, top });
      top += HEAD_H;
    };
    const font = (v: string, label: string, en: string, bad = false) => {
      out.push({ kind: "font", value: v, label, en, css: cssOf(v), top, bad });
      top += ITEM_H;
    };
    const custom = settings.customFonts.filter((f) => !taken.has(f.family.toLowerCase()) && hit(f.family));
    if (custom.length) {
      head("自定义字体");
      for (const f of custom) font(f.family, f.family, "", customFontState[f.family]?.status === "error");
    }
    const system = (fonts ?? []).filter((f) => !taken.has(f.name.toLowerCase()) && hit(f.name, f.local));
    const sysUi = !taken.has(SYSTEM_UI) && hit(SYSTEM_UI_LABEL, SYSTEM_UI);
    if (system.length || sysUi) {
      head("系统字体");
      if (sysUi) font(SYSTEM_UI, SYSTEM_UI_LABEL, SYSTEM_UI);
      for (const f of system) font(f.name, f.local || f.name, f.local ? f.name : "");
    }
    return out;
  });
  /** 可选的字体项（不含分组标题），键盘上下移动用 */
  let picks = $derived(items.filter((i): i is Extract<Item, { kind: "font" }> => i.kind === "font"));
  let totalH = $derived((items.at(-1) ? items.at(-1)!.top + (items.at(-1)!.kind === "head" ? HEAD_H : ITEM_H) : PAD) + PAD);
  let visible = $derived.by(() => {
    const lo = scrollTop - OVERSCAN * ITEM_H;
    const hi = scrollTop + menu.height + OVERSCAN * ITEM_H;
    return items.filter((i) => i.top + ITEM_H >= lo && i.top <= hi);
  });
  const activeValue = $derived(picks[active]?.value);
  const optId = (v: string) => `${id}-opt-${encodeURIComponent(v)}`;

  function place() {
    if (!box) return;
    const r = box.getBoundingClientRect();
    const want = Math.min(Math.max(totalH, ITEM_H + PAD * 2), MAX_H) + 2;
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = below < want && above > below;
    const height = Math.max(ITEM_H + PAD * 2 + 2, Math.min(want, up ? above : below));
    menu = { left: r.left, top: up ? r.top - GAP - height : r.bottom + GAP, width: r.width, height, up };
  }

  async function openMenu() {
    if (open || error) return;
    place();
    active = 0;
    scrollTop = 0;
    open = true;
    await tick();
    if (list) list.scrollTop = 0;
  }
  function close() {
    open = false;
  }

  /** 列表内容或输入框高度变了：重新定位，高亮回到第一项 */
  async function refresh() {
    active = 0;
    await tick();
    if (!open) return;
    place();
    if (list) list.scrollTop = scrollTop = 0;
  }

  function setActive(i: number) {
    if (!picks.length) return;
    active = Math.min(picks.length - 1, Math.max(0, i));
    const it = picks[active];
    if (!list || !it) return;
    // 高亮项上方紧挨分组标题时一起滚进来
    const prev = items[items.indexOf(it) - 1];
    const top = prev?.kind === "head" ? prev.top : it.top;
    if (top < list.scrollTop + PAD) list.scrollTop = top - PAD;
    else if (it.top + ITEM_H > list.scrollTop + list.clientHeight - PAD) list.scrollTop = it.top + ITEM_H - list.clientHeight + PAD;
  }

  function add(v: string) {
    if (value.includes(v)) return;
    onchange([...value, v]);
    query = "";
    input?.focus();
    void refresh();
  }
  function remove(i: number) {
    onchange(value.filter((_, k) => k !== i));
    void refresh();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    const page = Math.max(1, Math.floor(menu.height / ITEM_H) - 1);
    switch (e.key) {
      case "ArrowDown":
        if (!open) void openMenu();
        else setActive(active + 1);
        break;
      case "ArrowUp":
        if (!open) void openMenu();
        else setActive(active - 1);
        break;
      case "PageDown":
        if (!open) return;
        setActive(active + page);
        break;
      case "PageUp":
        if (!open) return;
        setActive(active - page);
        break;
      case "Enter":
        if (open && picks[active]) add(picks[active].value);
        else void openMenu();
        break;
      case "Escape":
        if (!open) return;
        // 只收起下拉列表，不让上层也响应 Esc
        e.stopPropagation();
        close();
        break;
      case "Backspace":
        if (query || !value.length) return;
        remove(value.length - 1);
        break;
      case "Tab":
        close();
        return;
      default:
        return;
    }
    e.preventDefault();
  }

  // 点在外面、窗口缩放或外层滚动时收起
  $effect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => t instanceof Node && (!!box?.contains(t) || !!list?.contains(t));
    const down = (e: PointerEvent) => {
      if (!inside(e.target)) close();
    };
    const scroll = (e: Event) => {
      if (e.target !== list) close();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  });

  /** 浮层挂到 body 下，不受卡片入场动画的 transform 和滚动容器裁剪影响 */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // —— 拖动排序 ——

  let chips = $state<HTMLUListElement>();
  const drag = new RowDrag({
    list: () => chips,
    items: ":scope > li.chip",
    layout: "wrap",
    scroller: () => undefined,
    canStart: () => value.length > 1,
    onmove: (from, to) => {
      if (from === to) return;
      const next = [...value];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onchange(next);
    },
  });
  function ongrip(i: number, e: PointerEvent) {
    close();
    drag.start(i, e);
  }
</script>

{#if error}
  <div class="error-row">
    <span class="error" data-tip={error}>读取系统字体失败</span>
    <button class="btn" onclick={load}><Icon name="refresh" />重试</button>
  </div>
{:else}
  <!-- 点空白处聚焦输入框 -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="box" class:open bind:this={box} onclick={(e) => (e.target === e.currentTarget || e.target === chips) && input?.focus()}>
    <ul class="chips" bind:this={chips} aria-label="已选字体（按顺序生效）">
      {#each value as name, i (name)}
        {@const badge = badgeOf(name)}
        <li class="chip" class:dragging={drag.state?.from === i} out:tipOut>
          <span class="grip" role="img" aria-label="拖动排序" data-tip={value.length > 1 ? "拖动排序" : undefined} onpointerdown={(e) => ongrip(i, e)}>
            <Icon name="grip" size={14} />
          </span>
          <span class="no">{i + 1}</span>
          <span class="family" style:font-family={badge?.cls === "bad" ? undefined : cssOf(name)} data-tip={labelOf(name) !== name ? name : undefined}>{labelOf(name)}</span>
          {#if badge}<span class="state {badge.cls}" data-tip={badge.tip}>{badge.text}</span>{/if}
          <button type="button" class="x" aria-label="移除字体 {labelOf(name)}" data-tip="移除" onclick={() => remove(i)}>
            <Icon name="close" size={14} />
          </button>
        </li>
      {/each}
      {#if drag.state && drag.showLine && drag.state.lineX != null}
        <li class="vline" aria-hidden="true" style:left="{drag.state.lineX}px" style:top="{drag.state.lineY}px" style:height="{drag.state.lineH}px"></li>
      {/if}
      <li class="query-li">
    <input
      {id}
      bind:this={input}
      class="query"
      role="combobox"
      aria-label={ariaLabel}
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls="{id}-list"
      aria-activedescendant={open && activeValue ? optId(activeValue) : undefined}
      autocomplete="off"
      spellcheck="false"
      placeholder={showLoading ? "正在读取系统字体…" : value.length ? "" : placeholder}
      bind:value={query}
      oninput={() => (open ? void refresh() : void openMenu())}
      onfocus={() => void openMenu()}
      onclick={() => void openMenu()}
      onblur={close}
      {onkeydown}
    />
      </li>
    </ul>
  </div>
{/if}

{#if open}
  <div
    use:portal
    bind:this={list}
    id="{id}-list"
    class="menu"
    role="listbox"
    tabindex="-1"
    style:left="{menu.left}px"
    style:top="{menu.top}px"
    style:width="{menu.width}px"
    style:height="{menu.height}px"
    onscroll={() => list && (scrollTop = list.scrollTop)}
    onmousedown={(e) => e.preventDefault()}
    in:menuIn={{ up: menu.up }}
    out:menuOut={{ up: menu.up }}
  >
    <div class="track" style:height="{totalH}px">
      {#each visible as it (it.kind === "head" ? `h:${it.label}` : it.value)}
        {#if it.kind === "head"}
          <div class="head" role="presentation" style:top="{it.top}px">{it.label}</div>
        {:else}
          <div
            id={optId(it.value)}
            class="item"
            class:active={it.value === activeValue}
            role="option"
            tabindex="-1"
            aria-selected={it.value === activeValue}
            style:top="{it.top}px"
            data-tip={it.en || undefined}
            onpointermove={() => (active = picks.indexOf(it))}
            onclick={() => add(it.value)}
            onkeydown={() => {}}
          >
            <span class="name" style:font-family={it.bad ? undefined : it.css}>{it.label}{#if it.bad}<span class="bad-mark">（失效）</span>{/if}</span>
            {#if !it.bad}<span class="sample" style:font-family={it.css}>{SAMPLE}</span>{/if}
          </div>
        {/if}
      {/each}
      {#if !picks.length}
        <div class="empty" style:top="{PAD}px">{fonts ? (query ? "没有匹配的字体" : "所有字体都已添加") : "正在读取系统字体…"}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .box {
    flex: 1;
    min-width: 0;
    display: flex;
    min-height: var(--ctl-h);
    padding: 3px var(--s1);
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--surface);
    cursor: text;
    transition:
      border-color var(--t-hover-out) var(--ease-out),
      box-shadow var(--t-hover-out) var(--ease-out);
  }
  .box:hover {
    border-color: var(--theme-bright);
    transition-duration: var(--t-hover-in);
  }
  .box:focus-within,
  .box.open {
    border-color: var(--theme);
    box-shadow: 0 0 0 2px var(--theme-light);
  }
  /* 标签与输入框（最后一项）一起换行排布；拖动时的插入竖线相对它定位 */
  .chips {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .query-li {
    flex: 1 1 120px;
    min-width: 120px;
    display: flex;
  }
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    max-width: 100%;
    padding: 0 2px 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--page);
    cursor: default;
  }
  .chip.dragging {
    opacity: 0.35;
  }
  .grip {
    display: flex;
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
  }
  .grip:hover {
    color: var(--theme);
  }
  .no {
    color: var(--text-3);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .family {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    flex: none;
    height: 18px;
    padding: 0 6px;
    border-radius: 9px;
    font-size: 11.5px;
    line-height: 18px;
    white-space: nowrap;
  }
  .state.ok {
    background: #e3f6ec;
    color: #1a8a4f;
  }
  .state.custom {
    background: var(--tint-bg);
    color: var(--theme-deep);
  }
  .state.missing {
    background: #fff3dc;
    color: #a86400;
  }
  .state.bad {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .x {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .x:hover {
    background: var(--danger-bg);
    color: var(--danger);
  }
  /* 拖动时的插入竖线（横排换行布局） */
  .vline {
    position: absolute;
    z-index: 2;
    width: 3px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: var(--theme);
    pointer-events: none;
    transition:
      left 90ms var(--ease-out),
      top 90ms var(--ease-out);
  }
  .query {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 var(--s1);
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font: inherit;
  }
  .query::placeholder {
    color: var(--text-3);
  }

  .menu {
    position: fixed;
    z-index: 60;
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    box-shadow: var(--shadow-float);
    color: var(--text);
    font-size: 14px;
  }
  .track {
    position: relative;
  }
  .head {
    position: absolute;
    left: var(--s1);
    right: var(--s1);
    height: 28px;
    display: flex;
    align-items: flex-end;
    padding: 0 var(--s2) 4px;
    color: var(--text-3);
    font-size: 12px;
    font-weight: 600;
  }
  .item,
  .empty {
    position: absolute;
    left: var(--s1);
    right: var(--s1);
    height: 32px;
    display: flex;
    align-items: center;
    gap: var(--s4);
    padding: 0 var(--s2);
    border-radius: var(--r-btn);
  }
  .item {
    cursor: pointer;
    user-select: none;
  }
  .item.active {
    background: var(--hover-bg);
  }
  .empty {
    color: var(--text-3);
  }
  .name {
    flex: none;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .bad-mark {
    color: var(--danger);
    font-weight: 400;
  }
  .sample {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: var(--text-2);
  }
  .error-row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--s3);
  }
  .error {
    flex: 1;
    min-width: 0;
    color: var(--danger);
    font-size: 12.5px;
  }
  @media (prefers-reduced-motion: reduce) {
    .vline {
      transition: none;
    }
  }
</style>
