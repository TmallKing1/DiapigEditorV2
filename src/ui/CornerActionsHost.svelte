<script lang="ts">
  // 跨整个 Editor 的「右下角操作按钮」列表宿主。
  // 固定在窗口右下角（z-index: 12，低于 Modal 的 20，对话框等覆盖层会遮住按钮并阻止操作）。
  // 三层 DOM 分别承担不同变换，避免 CSS transform 冲突：
  //   1. .slot      — 按 --slot 定位，负责下方按钮离开后上方按钮的统一下落占位；
  //   2. .fab-anim  — 原地入场（放大带回弹）与原地退出（缩小不带回弹）；
  //   3. button.fab — 悬停变亮、按下缩小、松开回弹与从下到上的亮色进度填充。
  import { cornerActions } from "../lib/cornerActions.svelte";
  import Icon from "./Icon.svelte";
</script>

{#if cornerActions.length}
  <div class="corner-host" role="region" aria-label="快捷操作">
    {#each cornerActions as item (item.id)}
      <div class="slot" class:exiting={item.exiting} style:--slot={item.slot}>
        {#key item.enterKey}
          <div class="fab-anim" class:exiting={item.exiting}>
            <button
              type="button"
              class="fab"
              aria-label={item.label}
              disabled={item.exiting}
              onclick={() => {
                if (!item.exiting) item.onclick();
              }}
            >
              {#if item.progress !== undefined}
                <span class="fab-fill" style:height="{Math.round(item.progress * 1000) / 10}%" aria-hidden="true"></span>
              {/if}
              <span class="fab-icon">
                <Icon name={item.icon} size={22} />
              </span>
            </button>
          </div>
        {/key}
        {#if item.detail && !item.exiting}
          <div class="detail" role="tooltip">{item.detail}</div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .corner-host {
    --fab-size: 44px;
    --fab-gap: var(--s3);
    position: fixed;
    right: var(--s5);
    bottom: var(--s5);
    z-index: 12;
    width: var(--fab-size);
    height: var(--fab-size);
    pointer-events: none;
  }
  .slot {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--fab-size);
    height: var(--fab-size);
    transform: translateY(calc(-1 * var(--slot) * (var(--fab-size) + var(--fab-gap))));
    transition: transform 220ms var(--ease-out);
    pointer-events: none;
  }
  @keyframes fab-in {
    from {
      transform: scale(0);
    }
    to {
      transform: scale(1);
    }
  }
  @keyframes fab-out {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0);
    }
  }
  .fab-anim {
    width: 100%;
    height: 100%;
    transform-origin: center center;
    animation:
      enter-fade 140ms var(--ease-out) backwards,
      fab-in 280ms cubic-bezier(0.34, 1.45, 0.64, 1) backwards;
  }
  .fab-anim.exiting {
    animation: fab-out 130ms cubic-bezier(0.4, 0, 1, 1) forwards;
    pointer-events: none;
  }
  .fab {
    pointer-events: auto;
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--fab-size);
    height: var(--fab-size);
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--theme);
    color: #fff;
    cursor: pointer;
    user-select: none;
    box-shadow:
      0 0 0 1px rgba(20, 60, 130, 0.08),
      0 3px 10px rgba(20, 40, 80, 0.22);
    transition:
      background-color var(--t-hover-out) var(--ease-out),
      box-shadow var(--t-hover-out) var(--ease-out),
      transform var(--t-release) var(--ease-back);
  }
  .fab:hover:not(:disabled) {
    background: color-mix(in srgb, var(--theme) 82%, #fff);
    box-shadow:
      0 0 0 1px rgba(20, 60, 130, 0.08),
      0 5px 14px color-mix(in srgb, var(--theme) 32%, rgba(20, 40, 80, 0.2));
    transition-duration: var(--t-hover-in), var(--t-hover-in), var(--t-release);
  }
  .fab:active:not(:disabled) {
    transform: scale(0.86);
    transition-duration: var(--t-hover-in), var(--t-hover-in), var(--t-press);
    transition-timing-function: var(--ease-out);
  }
  .fab:focus-visible {
    outline: 2px solid var(--theme);
    outline-offset: 3px;
  }
  .fab:disabled {
    pointer-events: none;
  }
  /* 进度填充：从下到上填充更亮的主题色 */
  .fab-fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--theme) 72%, #fff);
    transition:
      height 180ms var(--ease-out),
      background-color var(--t-hover-out) var(--ease-out);
    pointer-events: none;
  }
  .fab:hover:not(:disabled) .fab-fill {
    background: color-mix(in srgb, var(--theme) 60%, #fff);
    transition-duration: 180ms, var(--t-hover-in);
  }
  .fab-icon {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  /* 悬停详情气泡：显示在按钮左侧、垂直居中 */
  .detail {
    position: absolute;
    right: calc(100% + var(--s3));
    top: 50%;
    width: max-content;
    max-width: 280px;
    padding: var(--s2) var(--s3);
    border: 1px solid var(--theme-light);
    border-radius: var(--r-card);
    background: var(--surface);
    box-shadow: var(--shadow-float);
    color: var(--text);
    font-size: 12.5px;
    line-height: 1.6;
    white-space: pre-line;
    pointer-events: none;
    opacity: 0;
    transform: translate(6px, -50%);
    transition:
      opacity 140ms var(--ease-out),
      transform 140ms var(--ease-out);
  }
  .slot:not(.exiting):has(.fab:hover, .fab:focus-visible) .detail {
    opacity: 1;
    transform: translate(0, -50%);
  }
  @media (prefers-reduced-motion: reduce) {
    .slot,
    .fab,
    .fab-fill,
    .detail {
      transition: none;
    }
    .fab-anim {
      animation: enter-fade 120ms linear backwards;
    }
    .fab-anim.exiting {
      animation: enter-fade 100ms linear reverse forwards;
    }
    .fab:active:not(:disabled) {
      transform: none;
    }
    .detail {
      transform: translate(0, -50%);
    }
  }
</style>
