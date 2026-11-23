<script lang="ts">
  import { parseRichText } from "../model/richtext";

  let { text }: { text: string } = $props();
  let segments = $derived(parseRichText(text.replaceAll("\\n", " ↵ ")).segments);
</script>

<span class="rt">{#each segments as seg}{#if seg.player}<span
      class="pn"
      class:c={seg.color}
      class:b={seg.bold}
      class:i={seg.italic}
      style:--c={seg.color}
      data-tip="<PLAYER_NAME>：游戏中显示为玩家名">玩家名</span
    >{:else if seg.color || seg.bold || seg.italic}<span
      class:c={seg.color}
      class:b={seg.bold}
      class:i={seg.italic}
      style:--c={seg.color}>{seg.text}</span
    >{:else}{seg.text}{/if}{/each}</span>

<style>
  /* 对话内容预览字体（设置「常规 → 编辑」）：根元素上的 --font-content，未设置时沿用外层字体 */
  .rt {
    font-family: var(--font-content, inherit);
  }
  /* 白底上浅色文字看不清：给彩色段一个细描边式的文字阴影兜底 */
  .c {
    color: var(--c);
    text-shadow: 0 0 1px rgba(52, 61, 74, 0.35);
  }
  .b {
    font-weight: 700;
  }
  .i {
    font-style: italic;
  }
  /* 玩家名：与预览编辑器里的整块标记同样式 */
  .pn {
    display: inline-block;
    margin: 0 1px;
    padding: 0 4px;
    border: 1px solid var(--theme-light);
    border-radius: 4px;
    background: var(--tint-bg);
    line-height: 1.3;
  }
</style>
