<script lang="ts" module>
  export type DropdownOption = { value: string; label: string; /** 该项用的字体（CSS font-family） */ font?: string };
</script>

<script lang="ts">
  // 自绘下拉框：列表与触发框同宽，展开时箭头顺时针转 180°。
  // 列表只渲染可见范围内的项（虚拟滚动）：选项多、每项字体不同时（字体列表），
  // 原生 <select> 展开会一次排版全部选项并加载全部字体，造成明显卡顿。
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { menuIn, menuOut, tipIn, tipOut } from "./motion";

  let {
    id,
    options,
    value,
    onchange,
    disabled = false,
    placeholder = "",
    tip = "",
    ariaLabel,
  }: {
    id: string;
    options: DropdownOption[];
    value: string;
    onchange: (value: string) => void;
    disabled?: boolean;
    placeholder?: string;
    /** 鼠标悬停 0.5 秒且未点击时显示的说明 */
    tip?: string;
    /** 没有 <label for> 时的无障碍名称 */
    ariaLabel?: string;
  } = $props();

  const ITEM_H = 32;
  const PAD = 4;
  const MAX_H = 320;
  const GAP = 4;
  const MARGIN = 8;
  const OVERSCAN = 6;
  const TIP_DELAY = 500;
  const TIP_W = 320;

  let trigger: HTMLButtonElement;
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  /** 最近一次展开时的位置；收起后保留，供退出动画使用 */
  let menu = $state({ left: 0, top: 0, width: 0, height: 0, up: false });
  let active = $state(-1);
  let scrollTop = $state(0);
  let tipPos = $state<{ x: number; y: number } | null>(null);
  let tipTimer: ReturnType<typeof setTimeout> | undefined;

  let listId = $derived(`${id}-list`);
  const optId = (i: number) => `${id}-opt-${i}`;

  let selectedIndex = $derived(options.findIndex((o) => o.value === value));
  let current = $derived(selectedIndex >= 0 ? options[selectedIndex] : undefined);
  let totalH = $derived(options.length * ITEM_H + PAD * 2);
  let visible = $derived.by(() => {
    const top = scrollTop - PAD;
    const start = Math.max(0, Math.floor(top / ITEM_H) - OVERSCAN);
    const end = Math.min(options.length, Math.ceil((top + menu.height) / ITEM_H) + OVERSCAN);
    const out: { o: DropdownOption; i: number }[] = [];
    for (let i = start; i < end; i++) out.push({ o: options[i], i });
    return out;
  });

  /** 展开前先确定最终方向和高度，避免出现后再翻向（动效规范 6.4） */
  function place() {
    const r = trigger.getBoundingClientRect();
    const want = Math.min(totalH, MAX_H) + 2;
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = below < want && above > below;
    const height = Math.max(ITEM_H + PAD * 2 + 2, Math.min(want, up ? above : below));
    menu = { left: r.left, top: up ? r.top - GAP - height : r.bottom + GAP, width: r.width, height, up };
  }

  const maxScroll = () => Math.max(0, totalH + 2 - menu.height);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  async function openMenu() {
    if (disabled || open || options.length === 0) return;
    hideTip();
    place();
    active = selectedIndex >= 0 ? selectedIndex : 0;
    // 让当前项大致居中
    scrollTop = clamp(PAD + active * ITEM_H - (menu.height - ITEM_H) / 2, 0, maxScroll());
    open = true;
    await tick();
    if (list) list.scrollTop = scrollTop;
  }

  function close() {
    open = false;
    typed = "";
  }

  function choose(i: number) {
    const o = options[i];
    close();
    trigger.focus();
    if (o && o.value !== value) onchange(o.value);
  }

  function setActive(i: number) {
    if (options.length === 0) return;
    active = clamp(i, 0, options.length - 1);
    if (!list) return;
    const y = PAD + active * ITEM_H;
    const view = list.clientHeight;
    if (y < list.scrollTop + PAD) list.scrollTop = y - PAD;
    else if (y + ITEM_H > list.scrollTop + view - PAD) list.scrollTop = y + ITEM_H - view + PAD;
  }

  // 键入首字母跳转（与原生选择框一致），按显示名和字体名匹配
  let typed = "";
  let typedTimer: ReturnType<typeof setTimeout> | undefined;
  function typeahead(ch: string) {
    clearTimeout(typedTimer);
    typedTimer = setTimeout(() => (typed = ""), 700);
    typed += ch.toLowerCase();
    const n = options.length;
    const from = typed.length === 1 ? active + 1 : active;
    for (let k = 0; k < n; k++) {
      const i = (from + k + n) % n;
      const o = options[i];
      if (o.label.toLowerCase().startsWith(typed) || o.value.toLowerCase().startsWith(typed)) {
        setActive(i);
        return;
      }
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void openMenu();
      }
      return;
    }
    const page = Math.max(1, Math.floor(menu.height / ITEM_H) - 1);
    switch (e.key) {
      case "ArrowDown":
        setActive(active + 1);
        break;
      case "ArrowUp":
        setActive(active - 1);
        break;
      case "PageDown":
        setActive(active + page);
        break;
      case "PageUp":
        setActive(active - page);
        break;
      case "Home":
        setActive(0);
        break;
      case "End":
        setActive(options.length - 1);
        break;
      case "Enter":
        choose(active);
        break;
      case " ":
        if (typed) typeahead(" ");
        else choose(active);
        break;
      case "Escape":
        // 只收起下拉框，不让上层（如浮层）也响应 Esc
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close();
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) typeahead(e.key);
        else return;
    }
    e.preventDefault();
  }

  // 点在外面、窗口缩放或外层滚动时收起
  $effect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => t instanceof Node && (trigger.contains(t) || !!list?.contains(t));
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

  function startTip() {
    if (!tip || open || disabled) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      const r = trigger.getBoundingClientRect();
      tipPos = { x: clamp(r.left, MARGIN, window.innerWidth - TIP_W - MARGIN), y: r.bottom + 6 };
    }, TIP_DELAY);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipPos = null;
  }
  $effect(() => () => {
    clearTimeout(tipTimer);
    clearTimeout(typedTimer);
  });

  /** 浮层挂到 body 下，不受卡片入场动画的 transform 和滚动容器裁剪影响 */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<button
  {id}
  type="button"
  class="select trigger"
  class:open
  role="combobox"
  aria-label={ariaLabel}
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={listId}
  aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
  {disabled}
  bind:this={trigger}
  onclick={() => (open ? close() : void openMenu())}
  {onkeydown}
  onmouseenter={startTip}
  onmouseleave={hideTip}
  onpointerdown={hideTip}
  onblur={close}
>
  <span class="value" class:placeholder={!current} style:font-family={current?.font}>
    {current ? current.label : placeholder}
  </span>
  <span class="chev"><Icon name="chevron" size={16} /></span>
</button>

{#if open}
  <div
    use:portal
    bind:this={list}
    id={listId}
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
      {#each visible as { o, i } (i)}
        <div
          id={optId(i)}
          class="item"
          class:active={i === active}
          class:selected={i === selectedIndex}
          role="option"
          tabindex="-1"
          aria-selected={i === selectedIndex}
          style:top="{PAD + i * ITEM_H}px"
          style:font-family={o.font}
          onpointermove={() => (active = i)}
          onclick={() => choose(i)}
          onkeydown={() => {}}
        >
          <span class="label">{o.label}</span>
          {#if i === selectedIndex}<Icon name="check" size={16} />{/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if tipPos}
  <div use:portal class="tip-bubble" role="tooltip" style:left="{tipPos.x}px" style:top="{tipPos.y}px" style:max-width="{TIP_W}px" in:tipIn out:tipOut>
    {tip}
  </div>
{/if}

<style>
  .trigger {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: 0 var(--s2) 0 var(--s3);
    text-align: left;
    cursor: pointer;
  }
  .trigger:disabled {
    cursor: not-allowed;
  }
  .trigger.open {
    border-color: var(--theme);
    box-shadow: 0 0 0 2px var(--theme-light);
  }
  .value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .value.placeholder {
    color: var(--text-3);
  }
  /* 展开时箭头顺时针转 180° 变为上箭头，收起时转回 */
  .chev {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--text-2);
    transition: transform 180ms var(--ease-out);
  }
  .trigger.open .chev {
    transform: rotate(180deg);
    color: var(--theme);
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
  .item {
    position: absolute;
    left: var(--s1);
    right: var(--s1);
    height: 32px;
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: 0 var(--s2);
    border-radius: var(--r-btn);
    cursor: pointer;
    user-select: none;
  }
  .item.active {
    background: var(--hover-bg);
  }
  .item.selected {
    color: var(--theme-deep);
    font-weight: 600;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
</style>
