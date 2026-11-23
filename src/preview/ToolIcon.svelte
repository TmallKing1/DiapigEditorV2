<script lang="ts">
  // 工具栏与回顾页用到的游戏图标的 SVG 近似（素材拿不到）：
  //   play 101044 / pause 101046 / review 101061 / hide 101057：浅米色圆盘 + 深蓝灰符号
  //   padReview 100200（列表 + 放大镜）/ padHide 100189（带斜杠的眼睛）：无底的白色图标
  //   bubble 100160：三点对话气泡（回顾页标题左边，染色并水平镜像）
  type ToolIconName = "play" | "pause" | "review" | "hide" | "padReview" | "padHide" | "bubble";
  let { name, size, color = "#fff", mirror = false }: { name: ToolIconName; size: number; color?: string; mirror?: boolean } = $props();
  const DISC = "#ece5d8";
  const GLYPH = "#3b4255";
</script>

<svg width={size} height={size} viewBox="0 0 48 48" style:transform={mirror ? "scaleX(-1)" : null} aria-hidden="true">
  {#if name === "play" || name === "pause" || name === "review" || name === "hide"}
    <circle cx="24" cy="24" r="22" fill={DISC} />
    {#if name === "play"}
      <path d="M19 14.5v19l15-9.5z" fill={GLYPH} />
    {:else if name === "pause"}
      <rect x="16.5" y="15" width="5" height="18" rx="1.5" fill={GLYPH} />
      <rect x="26.5" y="15" width="5" height="18" rx="1.5" fill={GLYPH} />
    {:else if name === "review"}
      {#each [16, 24, 32] as y (y)}
        <rect x="14" y={y - 2} width="4" height="4" fill={GLYPH} />
        <rect x="21" y={y - 1.5} width="13" height="3" rx="1" fill={GLYPH} />
      {/each}
    {:else}
      <path d="M11 24c3.5-5.5 8-8.5 13-8.5s9.5 3 13 8.5c-3.5 5.5-8 8.5-13 8.5s-9.5-3-13-8.5z" fill="none" stroke={GLYPH} stroke-width="3" />
      <circle cx="24" cy="24" r="3.6" fill={GLYPH} />
      <path d="M14 34L34 14" stroke={DISC} stroke-width="6" />
      <path d="M14 34L34 14" stroke={GLYPH} stroke-width="3" stroke-linecap="round" />
    {/if}
  {:else if name === "padReview"}
    <rect x="6" y="10" width="28" height="5" rx="2.5" fill={color} />
    <rect x="6" y="21" width="12" height="5" rx="2.5" fill={color} />
    <circle cx="30" cy="29" r="7.5" fill="none" stroke={color} stroke-width="4" />
    <path d="M35.5 34.5l6 6" stroke={color} stroke-width="4.5" stroke-linecap="round" />
  {:else if name === "padHide"}
    <path d="M5 24c4.5-7 11-11 19-11s14.5 4 19 11c-4.5 7-11 11-19 11S9.5 31 5 24z" fill="none" stroke={color} stroke-width="4" />
    <circle cx="24" cy="24" r="5" fill={color} />
    <path d="M9 39L39 9" stroke={color} stroke-width="4.5" stroke-linecap="round" />
  {:else}
    <path
      fill-rule="evenodd"
      fill={color}
      d="M24 8.5C13.1 8.5 5.6 15 5.6 22.9c0 4.5 2.5 8.5 6.5 11L9.9 41l7.9-4.2c2 .6 4.1.8 6.2.8 10.9 0 18.4-6.5 18.4-14.7S34.9 8.5 24 8.5zM15.5 20.4a2.7 2.7 0 110 5.4 2.7 2.7 0 010-5.4zm8.5 0a2.7 2.7 0 110 5.4 2.7 2.7 0 010-5.4zm8.5 0a2.7 2.7 0 110 5.4 2.7 2.7 0 010-5.4z"
    />
  {/if}
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
