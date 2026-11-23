<script lang="ts">
  import type { Snippet } from "svelte";
  import { dialogIn, dialogOut, scrim } from "./motion";

  let {
    title,
    width = 640,
    tone,
    onclose,
    children,
    footer,
  }: {
    title: string;
    width?: number;
    /** 简单选择对话框的色调：标题放大并加分隔线；danger 时标题、分隔线为红色，遮罩为半透明深红。不传为普通浮层 */
    tone?: "info" | "danger";
    /** Esc 时调用；不传则 Esc 无效 */
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  let panel: HTMLDivElement;
  let previous: Element | null = null;

  $effect(() => {
    previous = document.activeElement;
    const first = panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    first.focus();
    return () => (previous as HTMLElement | null)?.focus?.();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && onclose) {
      e.stopPropagation();
      onclose();
      return;
    }
    if (e.key !== "Tab") return;
    // 焦点留在浮层内
    const items = [
      ...panel.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
      ),
    ];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<!-- 父组件用 {#if} 移除浮层，过渡需加 |global 才会播放退场 -->
<div class="scrim" class:danger={tone === "danger"} transition:scrim|global>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="panel"
    in:dialogIn|global
    out:dialogOut|global
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    style:max-width="{width}px"
    bind:this={panel}
    {onkeydown}
  >
    <header class={tone ? `tone ${tone}` : undefined}>{title}</header>
    <div class="body">{@render children()}</div>
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s6);
    background: rgba(30, 40, 60, 0.36);
  }
  .scrim.danger {
    background: rgba(90, 10, 4, 0.42);
  }
  .panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 100%;
    background: var(--page);
    border: 1px solid var(--theme-light);
    border-radius: var(--r-panel);
    box-shadow: var(--shadow-float);
  }
  .panel:focus {
    outline: none;
  }
  header {
    padding: var(--s4) var(--s6) var(--s3);
    font-size: 18px;
    font-weight: 700;
  }
  /* 简单选择对话框：标题 1.5 倍正文字号；下方 3px 分隔线横跨对话框内部，只留左右内边距 */
  header.tone {
    --tone: var(--theme);
    margin: 0 var(--s6) var(--s4);
    padding: var(--s4) 0 var(--s3);
    border-bottom: 3px solid var(--tone);
    color: var(--tone);
    font-size: 21px;
    line-height: 1.3;
  }
  header.tone.danger {
    --tone: var(--danger);
  }
  .body {
    padding: 0 var(--s6) var(--s4);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s4);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--s3);
    padding: var(--s3) var(--s6) var(--s4);
    border-top: 1px solid var(--border);
  }
</style>
