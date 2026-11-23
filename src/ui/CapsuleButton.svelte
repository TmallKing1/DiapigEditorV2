<script lang="ts">
  // 胶囊按钮：主面板底部居中的悬浮主操作（图标 + 文字）。
  // 用法：放在页面内容的最后一个位置。
  // 实现：
  //   · 实际按钮由 App.svelte 中与 <main class="main"> 平级的 <CapsuleHost> 渲染，
  //     所以主面板滚动时全程固定可见，切页/显隐变化时也在目标位置独立原地缩放，不跟随容器位移。
  //   · 显示时在页面文档流末尾放置等高占位块，保证滚到最底时最后一段内容完全露在按钮上方。
  import { setCapsule } from "../lib/capsule.svelte";

  let {
    show = true,
    icon,
    label,
    onclick,
    disabled = false,
    tip,
  }: {
    /** 是否显示；false 时隐藏按钮并撤掉底部占位 */
    show?: boolean;
    icon: string;
    label: string;
    onclick: () => void;
    disabled?: boolean;
    /** 悬停说明（不可用时可写原因） */
    tip?: string;
  } = $props();

  const token = Symbol("capsule");

  $effect(() => {
    setCapsule(token, show ? { icon, label, onclick, disabled, tip } : null);
    return () => setCapsule(token, null);
  });
</script>

{#if show}
  <div class="capsule-spacer" aria-hidden="true"></div>
{/if}

<style>
  .capsule-spacer {
    flex: none;
    height: calc(var(--primary-h) + var(--s4));
  }
</style>
