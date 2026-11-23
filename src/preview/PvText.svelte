<script lang="ts">
  // 一段富文本：Typewriter 的分段结果。打字机没打到的字透明但占位（描边也去掉，否则会露出轮廓）
  import type { Run } from "../model/previewText";
  let { runs }: { runs: Run[] } = $props();
</script>

{#each runs as r, i (i)}<span
    class:hidden={r.hidden}
    style:color={r.hidden ? "transparent" : r.color}
    style:font-weight={r.bold ? 700 : null}
    style:font-style={r.italic ? "italic" : null}>{r.text}</span
  >{/each}

<style>
  .hidden {
    text-shadow: none;
  }
</style>
