<script lang="ts" module>
  export interface SideTab {
    id: string;
    label: string;
    icon: string;
    /** 未实现的页签：点击只报 TODO，不切换 */
    ready?: boolean;
  }
</script>

<script lang="ts">
  // 多页签左侧栏的子页签导航（设置、更多共用）
  import Icon from "../ui/Icon.svelte";

  let {
    tabs,
    current,
    label,
    onpick,
    ontodo,
    onreset,
    entering = false,
    leaving = false,
  }: {
    tabs: SideTab[];
    current: string;
    label: string;
    onpick: (id: string) => void;
    ontodo?: (label: string) => void;
    /** 传了就在每个页签右侧显示「重置」按钮（悬停或键盘聚焦到该行时出现） */
    onreset?: (tab: SideTab) => void;
    /** 切页进入：页签逐个从左侧滑入，带轻回弹 */
    entering?: boolean;
    /** 切页退出：全部页签同步向左滑出并淡出 */
    leaving?: boolean;
  } = $props();

  function pick(t: SideTab) {
    if (t.ready === false) ontodo?.(t.label);
    else if (t.id !== current) onpick(t.id);
  }

  // 鼠标 / 触摸自己判定点击：按下后移出页签即取消，再移回也不恢复按下，
  // 松开不切页。原生 click 只留给键盘（detail 为 0）。
  let pressed = $state<string | null>(null);
  function down(e: PointerEvent, t: SideTab) {
    if (e.button !== 0) return;
    // 触摸默认隐式捕获指针，移出后收不到 pointerleave：释放掉
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    pressed = t.id;
  }
  function up(t: SideTab) {
    if (pressed !== t.id) return;
    pressed = null;
    pick(t);
  }
</script>

<svelte:window onpointerup={() => (pressed = null)} onblur={() => (pressed = null)} />

<nav class="subnav" class:entering class:leaving aria-label={label}>
  {#each tabs as t, i (t.id)}
    <div class="subrow" style:--i={i}>
    <button
      class="subtab"
      class:active={current === t.id}
      class:pressed={pressed === t.id && current !== t.id}
      aria-current={current === t.id ? "page" : undefined}
      onpointerdown={(e) => down(e, t)}
      onpointerup={() => up(t)}
      onpointerleave={() => {
        if (pressed === t.id) pressed = null;
      }}
      onpointercancel={() => (pressed = null)}
      onclick={(e) => {
        if (e.detail === 0) pick(t);
      }}
    >
      <Icon name={t.icon} size={18} /><span class="text">{t.label}</span>
    </button>
    {#if onreset && t.ready !== false}
      <button class="icon-btn reset" data-tip="重置「{t.label}」页面" aria-label="重置「{t.label}」页面" onclick={() => onreset(t)}>
        <Icon name="reset" />
      </button>
    {/if}
    </div>
  {/each}
</nav>

<style>
  .subnav {
    display: flex;
    flex-direction: column;
    padding: var(--s3) 0;
  }
  /* 列表导航（规范 7.3）：贴满侧栏宽度、无圆角、页签间无额外间隔；
     悬停浅底，选中为主题色文字 + 左侧竖条 */
  .subnav {
    /* 悬停时的上下边线；按下（非当前页签）时整块填充成同一颜色 */
    --subtab-line: var(--theme-line);
  }
  .subrow {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  /* 重置按钮叠在页签右端，不占页签的宽度；只在悬停或键盘聚焦到这一行时出现 */
  .reset {
    position: absolute;
    right: 2px;
    top: 1px;
    opacity: 0;
    transition:
      opacity var(--t-hover-out) var(--ease-out),
      color var(--t-hover-out) var(--ease-out);
  }
  .subrow:hover .reset,
  .reset:focus-visible {
    opacity: 1;
    transition-duration: var(--t-hover-in);
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .subrow:has(.reset) .subtab {
    padding-right: 36px;
  }
  .subtab {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s2);
    height: 36px;
    padding: 0 var(--s3);
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    touch-action: manipulation;
    transition:
      background-color var(--t-hover-out) var(--ease-out),
      box-shadow var(--t-hover-out) var(--ease-out),
      color 120ms var(--ease-out);
  }
  /* 边线用内阴影，不占布局，相邻页签不跳动 */
  .subtab:hover {
    background: var(--hover-bg);
    box-shadow:
      inset 0 1px 0 var(--subtab-line),
      inset 0 -1px 0 var(--subtab-line);
    transition-duration: var(--t-hover-in), var(--t-hover-in), 120ms;
  }
  .subtab.pressed {
    background: var(--subtab-line);
    transition-duration: 120ms, var(--t-hover-in), 120ms;
  }
  .subtab:focus-visible {
    outline-offset: -2px;
  }
  /* 左侧竖条：离开时向中线收拢并淡出；进入时从中线张开，轻回弹后落位 */
  .subtab::before {
    content: "";
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 0 2px 2px 0;
    background: var(--theme);
    opacity: 0;
    transform: scaleY(0);
    transition:
      transform 200ms cubic-bezier(0.4, 0, 1, 1),
      opacity 200ms cubic-bezier(0.4, 0, 1, 1);
  }
  .subtab.active {
    color: var(--theme-deep);
    font-weight: 600;
  }
  .subtab.active::before {
    opacity: 1;
    transform: scaleY(1);
    transition:
      transform 420ms cubic-bezier(0.34, 1.6, 0.6, 1) 80ms,
      opacity 120ms var(--ease-out) 80ms;
  }

  /* 切页动效，与左下角提示条同一套路但位移更小：
     进入 X −20 → 0，300 ms 轻回弹，淡入 150 ms，页签间错峰 40 ms；
     退出同步 X 0 → −20，90 ms 缓入并淡出，无回弹 */
  @keyframes tab-fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes tab-slide-in {
    from {
      transform: translateX(-20px);
    }
  }
  @keyframes tab-out {
    to {
      opacity: 0;
      transform: translateX(-20px);
    }
  }
  .entering .subrow {
    animation:
      tab-fade-in 150ms var(--ease-out) backwards,
      tab-slide-in 300ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
    animation-delay: calc(var(--i) * 40ms);
  }
  .leaving .subrow {
    animation: tab-out 90ms cubic-bezier(0.4, 0, 1, 1) forwards;
  }
  .leaving {
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .entering .subrow {
      animation: tab-fade-in 100ms linear backwards;
    }
    .leaving .subrow {
      animation: none;
      opacity: 0;
    }
    .subtab::before,
    .subtab.active::before {
      transform: none;
      transition: opacity 120ms linear;
    }
  }
</style>
