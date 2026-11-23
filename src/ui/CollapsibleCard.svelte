<script lang="ts">
  import { type Snippet, untrack } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    title,
    open = $bindable(false),
    enter = true,
    enterDelay = "0ms",
    unclip = false,
    children,
  }: {
    title: string;
    open?: boolean;
    enter?: boolean;
    enterDelay?: string;
    /** 完全展开后不再裁剪内容：输入框的焦点描边、内容里绝对定位的浮层（如选色面板）可以超出内容区。
     *  展开 / 收起的过程中仍然裁剪，高度动画不受影响 */
    unclip?: boolean;
    children: Snippet;
  } = $props();

  const id = $props.id();

  /** 展开动画已经结束 */
  let settled = $state(untrack(() => open));
  $effect(() => {
    if (!open) {
      settled = false;
      return;
    }
    // 比展开过渡（--t-release，260 ms）稍长；减少动态效果时过渡为 0，晚一点放开裁剪也无妨
    const timer = setTimeout(() => (settled = true), 300);
    return () => clearTimeout(timer);
  });
</script>

<section
  class="card setting collapsible-card"
  class:open
  class:enter
  style:--enter-delay={enter ? enterDelay : undefined}
>
  <h2 class="heading">
    <button
      id={`${id}-header`}
      type="button"
      class="header"
      aria-expanded={open}
      aria-controls={`${id}-content`}
      onclick={() => (open = !open)}
    >
      <span class="card-title">{title}</span>
      <span class="chevron" aria-hidden="true"><Icon name="chevron" size={16} /></span>
    </button>
  </h2>
  <div
    id={`${id}-content`}
    class="collapse"
    role="region"
    aria-labelledby={`${id}-header`}
    aria-hidden={!open}
    inert={!open}
  >
    <div class="clip" class:unclipped={unclip && open && settled}>
      <div class="setting-body content">{@render children()}</div>
    </div>
  </div>
</section>

<style>
  .collapsible-card {
    padding: 0;
  }
  .heading {
    margin: 0;
    font-size: inherit;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
    width: 100%;
    min-height: var(--row-h);
    padding: var(--s2) var(--s5) var(--s2) calc(var(--s5) * 2 / 3 + var(--s1));
    border: 0;
    border-radius: var(--r-card);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .header .card-title {
    position: static;
    margin: 0;
  }
  .header:focus-visible .card-title {
    color: var(--theme);
  }
  .chevron {
    display: grid;
    place-items: center;
    flex: none;
    color: var(--text-2);
    transition: transform 180ms var(--ease-out), color var(--t-hover-out) var(--ease-out);
  }
  .open .chevron {
    transform: rotate(180deg);
    color: var(--theme);
  }
  .collapse {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--t-release) var(--ease-out);
  }
  .open .collapse {
    grid-template-rows: 1fr;
  }
  .clip {
    min-height: 0;
    overflow: hidden;
  }
  .clip.unclipped {
    overflow: visible;
  }
  .content {
    padding: 0 var(--s5) var(--s5) calc(var(--s5) * 2 / 3 + var(--s4));
  }
  @media (prefers-reduced-motion: reduce) {
    .collapse,
    .chevron {
      transition: none;
    }
  }
</style>
