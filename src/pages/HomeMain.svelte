<script lang="ts">
  // 主页的主区：按 nav.homeTab 显示对话或任务。
  // 切换页签：旧内容朝切换方向横移 16px 并淡出（90 ms），新内容从另一侧移入；对话在左，任务在右。
  // 快速连点只完成最后一次：每次切换带代次号，旧流程在等待点自行放弃。
  // 切过页签后，内容的入场只由外层横移负责：不再把 enterCls 交给子组件，否则横移结束后
  // 子组件又拿到 "enter" 类，标题和卡片会再入场一次。
  import { tick, untrack } from "svelte";
  import type { HomeTab } from "../lib/nav.svelte";
  import { nav } from "../lib/nav.svelte";
  import DialogMain from "./DialogMain.svelte";
  import TaskMain from "./TaskMain.svelte";

  let {
    scroller,
    enterCls = "",
  }: {
    scroller?: HTMLElement;
    enterCls?: string;
  } = $props();

  const ORDER: HomeTab[] = ["dialog", "task"];
  const LEAVE_MS = 90;

  let shown = $state<HomeTab>(untrack(() => nav.homeTab));
  /** 1 = 向右切（新内容从右侧进入），-1 = 向左 */
  let dir = $state(1);
  let phase = $state<"idle" | "leave" | "enter">("idle");
  let gen = 0;
  let switched = $state(false);
  const scrollMemo: Partial<Record<HomeTab, number>> = {};

  async function switchTo(next: HomeTab) {
    if (next === shown && phase !== "leave") return;
    const g = ++gen;
    switched = true;
    dir = ORDER.indexOf(next) > ORDER.indexOf(shown) ? 1 : -1;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollMemo[shown] = scroller?.scrollTop ?? 0;
    phase = "leave";
    await new Promise((r) => setTimeout(r, reduce ? 0 : LEAVE_MS));
    if (g !== gen) return;
    shown = nav.homeTab;
    phase = "enter";
    await tick();
    if (scroller) scroller.scrollTop = scrollMemo[shown] ?? 0;
  }

  $effect(() => {
    const next = nav.homeTab;
    untrack(() => void switchTo(next));
  });
</script>

<div
  class="home"
  class:leave={phase === "leave"}
  class:slide-in={phase === "enter"}
  style:--dir={dir}
  onanimationend={(e) => {
    if (e.target === e.currentTarget) phase = "idle";
  }}
>
  {#if shown === "dialog"}
    <DialogMain {scroller} enterCls={switched ? "" : enterCls} />
  {:else}
    <TaskMain {scroller} enterCls={switched ? "" : enterCls} />
  {/if}
</div>

<style>
  .home.leave {
    opacity: 0;
    transform: translateX(calc(var(--dir) * -16px));
    transition:
      opacity 90ms var(--ease-out),
      transform 90ms var(--ease-out);
    pointer-events: none;
  }
  .home.slide-in {
    animation:
      home-fade 150ms var(--ease-out) backwards,
      home-slide 300ms var(--ease-back) backwards;
  }
  @keyframes home-fade {
    from {
      opacity: 0;
    }
  }
  @keyframes home-slide {
    from {
      transform: translateX(calc(var(--dir) * 16px));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .home.leave {
      transform: none;
    }
    .home.slide-in {
      animation: home-fade 150ms var(--ease-out) backwards;
    }
  }
</style>
