<script lang="ts">
  // 胶囊按钮宿主：放在 App.svelte 的 .main-wrap 内（与 <main class="main"> 平级、在切页容器之外）。
  // 这样无论主面板滚动还是切换页签/显示状态，按钮都固定在目标位置原地播放独立缩放动效：
  //   · 出现：原地放大带回弹；
  //   · 离开：原地缩小不带回弹。
  import { untrack } from "svelte";
  import { capsuleState, type CapsuleProps } from "../lib/capsule.svelte";
  import Icon from "./Icon.svelte";

  let { leaving = false }: { leaving?: boolean } = $props();

  const LEAVE_MS = 130;

  let shown = $state<CapsuleProps | null>(null);
  let exiting = $state(false);
  let enterKey = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  let target = $derived(leaving ? null : capsuleState.item);

  $effect(() => {
    const next = target;
    untrack(() => {
      if (next) {
        clearTimeout(timer);
        if (!shown || exiting) enterKey++;
        shown = next;
        exiting = false;
      } else if (shown && !exiting) {
        exiting = true;
        clearTimeout(timer);
        const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
        timer = setTimeout(() => {
          shown = null;
          exiting = false;
        }, reduce ? 0 : LEAVE_MS);
      }
    });
  });

  $effect(() => () => clearTimeout(timer));
</script>

{#if shown}
  <div class="capsule-host">
    {#key enterKey}
      <div class="capsule-wrap" class:exiting>
        <button type="button" class="capsule" disabled={shown.disabled} data-tip={shown.tip} onclick={shown.onclick}>
          <Icon name={shown.icon} size={22} />
          <span>{shown.label}</span>
        </button>
      </div>
    {/key}
  </div>
{/if}

<style>
  .capsule-host {
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--s5);
    z-index: 5;
    display: flex;
    justify-content: center;
    /* 只有按钮本身接收点击，两侧空白处仍可点到下面的内容 */
    pointer-events: none;
  }
  @media (max-width: 900px) {
    .capsule-host {
      position: fixed;
      bottom: var(--s4);
    }
  }
  @keyframes capsule-in {
    from {
      transform: scale(0.76);
    }
    to {
      transform: scale(1);
    }
  }
  @keyframes capsule-out {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.76);
    }
  }
  .capsule-wrap {
    transform-origin: center center;
    animation:
      enter-fade 140ms var(--ease-out) backwards,
      capsule-in 280ms cubic-bezier(0.34, 1.45, 0.64, 1) backwards;
  }
  .capsule-wrap.exiting {
    animation: capsule-out 130ms cubic-bezier(0.4, 0, 1, 1) forwards;
    pointer-events: none;
  }
  .capsule {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--s3);
    height: var(--primary-h);
    padding: 0 var(--s6) 0 calc(var(--s6) - 2px);
    border: none;
    border-radius: 999px;
    background: var(--theme);
    color: #fff;
    font: inherit;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    box-shadow:
      0 0 0 1px rgba(20, 60, 130, 0.08),
      0 4px 14px color-mix(in srgb, var(--theme) 30%, rgba(20, 40, 80, 0.2));
    transition:
      background-color var(--t-hover-out) var(--ease-out),
      box-shadow var(--t-hover-out) var(--ease-out),
      transform var(--t-release) var(--ease-back);
  }
  .capsule > :global(svg) {
    flex: none;
  }
  .capsule:hover:not(:disabled) {
    background: color-mix(in srgb, var(--theme) 88%, #000);
    box-shadow:
      0 0 0 1px rgba(20, 60, 130, 0.08),
      0 6px 18px color-mix(in srgb, var(--theme) 38%, rgba(20, 40, 80, 0.2));
    transition-duration: var(--t-hover-in), var(--t-hover-in), var(--t-release);
  }
  .capsule:active:not(:disabled) {
    transform: scale(0.96);
    transition-duration: var(--t-hover-in), var(--t-hover-in), var(--t-press);
    transition-timing-function: var(--ease-out);
  }
  .capsule:focus-visible {
    outline: 2px solid var(--theme);
    outline-offset: 3px;
  }
  .capsule:disabled {
    background: #e3e7ee;
    color: var(--text-3);
    box-shadow: 0 0 0 1px rgba(20, 60, 130, 0.06), 0 2px 8px rgba(20, 40, 80, 0.12);
    cursor: not-allowed;
  }
  @media (prefers-reduced-motion: reduce) {
    .capsule-wrap {
      animation: enter-fade 120ms linear backwards;
    }
    .capsule-wrap.exiting {
      animation: enter-fade 100ms linear reverse forwards;
    }
    .capsule,
    .capsule:active:not(:disabled) {
      transform: none;
      transition: none;
    }
  }
</style>
