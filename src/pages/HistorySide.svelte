<script lang="ts">
  // 历史文件子页面的左侧栏：「页签列表」与「添加或导入」两组。
  // 页签样式照搬 SideTabs 的列表式页签；两个操作按钮外观相同但没有选中态。
  import { onMount } from "svelte";
  import { isTauri } from "../lib/files";
  import { createTab, currentTab, deleteTab, dissolveTab, hist, importFolder, selectHistoryTab } from "../lib/history.svelte";
  import { ask, toast } from "../lib/ui.svelte";
  import { type HistoryTab, UNSORTED, UNSORTED_NAME, checkTabName, countIn, visibleTabs } from "../model/history";
  import Icon from "../ui/Icon.svelte";
  import NewTabDialog from "../ui/NewTabDialog.svelte";

  let {
    entering = false,
    leaving = false,
  }: {
    /** 切页进入：条目逐个从左侧滑入，带轻回弹 */
    entering?: boolean;
    /** 切页退出：全部条目同步向左滑出并淡出 */
    leaving?: boolean;
  } = $props();

  let tabs = $derived(visibleTabs(hist.data));
  let current = $derived(currentTab());
  let naming = $state(false);

  onMount(() => selectHistoryTab(currentTab()));

  function askDelete(t: HistoryTab) {
    ask({
      title: "解散或删除页签",
      tone: "danger",
      message:
        `你正在删除页签「${t.name}」。\n` +
        "「解散页签」将把页签内的文件引用移至「未分类」；\n" +
        "「删除页签」将删除该页签下所有文件引用，不会删除本地文件。",
      actions: [
        { label: "取消" },
        {
          label: "解散页签",
          style: "danger",
          run: () => {
            dissolveTab(t.id);
            toast(`已解散页签「${t.name}」，文件已移至「${UNSORTED_NAME}」`);
          },
        },
        {
          label: "删除页签",
          style: "danger",
          run: () => {
            deleteTab(t.id);
            toast(`已删除页签「${t.name}」`);
          },
        },
      ],
    });
  }

  function create(name: string) {
    naming = false;
    createTab(name);
    toast(`已新建页签「${name}」`);
  }

  // 鼠标 / 触摸自己判定点击（同 SideTabs）：按下后移出即取消，松开不触发。原生 click 只留给键盘（detail 为 0）
  let pressed = $state<string | null>(null);
  function down(e: PointerEvent, id: string) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    pressed = id;
  }
  function up(id: string, run: () => void) {
    if (pressed !== id) return;
    pressed = null;
    run();
  }
  /** 页签和操作按钮共用的指针处理 */
  function press(id: string, run: () => void) {
    return {
      onpointerdown: (e: PointerEvent) => down(e, id),
      onpointerup: () => up(id, run),
      onpointerleave: () => {
        if (pressed === id) pressed = null;
      },
      onpointercancel: () => (pressed = null),
      onclick: (e: MouseEvent) => {
        if (e.detail === 0) run();
      },
    };
  }

  let importLabel = $derived(
    hist.importing ? (hist.importing.total ? `导入中 ${hist.importing.done}/${hist.importing.total}` : "正在读取…") : "导入文件夹",
  );
  // 条目序号用于入场错峰：两个小标题、页签、操作按钮依次排下来
  let actionBase = $derived(tabs.length + (tabs.length ? 1 : 2));
</script>

<svelte:window onpointerup={() => (pressed = null)} onblur={() => (pressed = null)} />

<nav class="hnav" class:entering class:leaving aria-label="历史文件">
  <div class="subrow" style:--i={0}><span class="head">页签列表</span></div>
  {#each tabs as t, i (t.id)}
    <div class="subrow" style:--i={i + 1}>
      <button
        class="subtab"
        class:active={current === t.id}
        class:pressed={pressed === t.id && current !== t.id}
        class:deletable={t.id !== UNSORTED}
        aria-current={current === t.id ? "page" : undefined}
        data-tip="{t.name}（{countIn(hist.data, t.id)} 个文件）"
        {...press(t.id, () => selectHistoryTab(t.id))}
      >
        <Icon name="folder" size={18} /><span class="text">{t.name}</span>
      </button>
      {#if t.id !== UNSORTED}
        <button class="icon-btn danger del" data-tip="删除页签「{t.name}」" aria-label="删除页签「{t.name}」" onclick={() => askDelete(t)}>
          <Icon name="trash" />
        </button>
      {/if}
    </div>
  {:else}
    <div class="subrow" style:--i={1}><span class="none">暂无页签</span></div>
  {/each}

  <div class="subrow gap" style:--i={actionBase}><span class="head">添加或导入</span></div>
  <div class="subrow" style:--i={actionBase + 1}>
    <button class="subtab action" class:pressed={pressed === ":new"} {...press(":new", () => (naming = true))}>
      <Icon name="tab-plus" size={18} /><span class="text">新建页签</span>
    </button>
  </div>
  <!-- 悬停说明放在外层：禁用的按钮本身不一定显示 title -->
  <div
    class="subrow"
    style:--i={actionBase + 2}
    data-tip={isTauri ? "把文件夹里的对话和任务链导入到新页签" : "仅桌面版可用"}
  >
    <button
      class="subtab action"
      class:pressed={pressed === ":import"}
      disabled={!isTauri || !!hist.importing}
      aria-busy={!!hist.importing}
      {...press(":import", () => void importFolder())}
    >
      <Icon name="folder-plus" size={18} /><span class="text">{importLabel}</span>
    </button>
  </div>
</nav>

{#if naming}
  <NewTabDialog check={(name) => checkTabName(hist.data, name)} onconfirm={create} oncancel={() => (naming = false)} />
{/if}

<style>
  .hnav {
    display: flex;
    flex-direction: column;
    padding: var(--s3) 0;
    /* 悬停时的上下边线；按下（非当前页签）时整块填充成同一颜色 */
    --subtab-line: var(--theme-line);
  }
  .subrow {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  /* 小标题：灰色靠左小字，和页签文字左对齐 */
  .head {
    padding: var(--s1) var(--s3);
    color: var(--text-3);
    font-size: 12px;
    line-height: 20px;
    user-select: none;
  }
  .gap {
    margin-top: var(--s3);
  }
  .none {
    padding: 0 var(--s3);
    color: var(--text-3);
    line-height: 36px;
  }
  /* 删除按钮叠在页签右端，只在悬停或键盘聚焦到这一行时出现 */
  .del {
    position: absolute;
    right: 2px;
    top: 1px;
    opacity: 0;
    transition:
      opacity var(--t-hover-out) var(--ease-out),
      color var(--t-hover-out) var(--ease-out);
  }
  .subrow:hover .del,
  .del:focus-visible {
    opacity: 1;
    transition-duration: var(--t-hover-in);
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .subtab.deletable {
    padding-right: 36px;
  }

  /* —— 以下照搬 SideTabs.svelte 的列表式页签（规范 7.3） —— */
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
  .subtab:hover:not(:disabled) {
    background: var(--hover-bg);
    box-shadow:
      inset 0 1px 0 var(--subtab-line),
      inset 0 -1px 0 var(--subtab-line);
    transition-duration: var(--t-hover-in), var(--t-hover-in), 120ms;
  }
  .subtab.pressed:not(:disabled) {
    background: var(--subtab-line);
    transition-duration: 120ms, var(--t-hover-in), 120ms;
  }
  .subtab:focus-visible {
    outline-offset: -2px;
  }
  .subtab:disabled {
    color: var(--text-3);
    cursor: not-allowed;
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
  /* 操作按钮不是页签：没有竖条和选中态 */
  .subtab.action::before {
    content: none;
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

  /* 切页动效同 SideTabs：进入 X −20 → 0，300 ms 轻回弹，淡入 150 ms，条目间错峰 40 ms；
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
