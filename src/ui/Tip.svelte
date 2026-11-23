<script lang="ts">
  // 悬停 / 键盘聚焦时显示的说明标记。气泡用 fixed 定位，不受侧栏、浮层滚动区域裁剪。
  import Icon from "./Icon.svelte";
  import { tipIn, tipOut } from "./motion";

  let { text }: { text: string } = $props();

  const WIDTH = 260;
  let anchor: HTMLButtonElement;
  let bubble = $state<HTMLDivElement>();
  const tipId = $props.id();
  let pos = $state<{ x: number; y: number } | null>(null);

  $effect(() => {
    if (!pos || !bubble) return;
    const r = anchor.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left - 12, window.innerWidth - bubble.offsetWidth - 8));
    const below = r.bottom + 6;
    const y = below + bubble.offsetHeight <= window.innerHeight - 8 ? below : Math.max(8, r.top - bubble.offsetHeight - 6);
    if (pos.x !== x || pos.y !== y) pos = { x, y };
  });

  function show() {
    const r = anchor.getBoundingClientRect();
    const x = Math.min(Math.max(8, r.left - 12), window.innerWidth - WIDTH - 8);
    pos = { x, y: r.bottom + 6 };
  }
  function hide() {
    pos = null;
  }

  $effect(() => {
    if (!pos) return;
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  });
</script>

<button
  type="button"
  class="tip"
  aria-label="说明：{text}"
  aria-describedby={pos ? tipId : undefined}
  bind:this={anchor}
  onmouseenter={show}
  onmouseleave={hide}
  onfocus={show}
  onblur={hide}
  onkeydown={(e) => { if (e.key === "Escape") hide(); }}
>
  <Icon name="info" size={15} />
</button>

{#if pos}
  <div id={tipId} bind:this={bubble} class="tip-bubble" role="tooltip" style:left="{pos.x}px" style:top="{pos.y}px" style:max-width="{WIDTH}px" in:tipIn out:tipOut>
    {text}
  </div>
{/if}

<style>
  .tip {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-3);
    vertical-align: middle;
    cursor: help;
    transition: color var(--t-hover-out) var(--ease-out);
  }
  .tip:hover,
  .tip:focus-visible {
    color: var(--theme);
    transition-duration: var(--t-hover-in);
  }
  .tip:focus-visible {
    outline-offset: 0;
  }
</style>
