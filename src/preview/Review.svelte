<script lang="ts">
  // 对话回顾页（DiapigDialogReview.lua）：深色底上，左上「气泡图标（#D3BC8E、水平镜像）+ 对话回顾」，上方 108018 分割线；
  // 键鼠 / 触屏右上角是 #D3BC8E 的关闭叉，手柄是下分割线与右下「[返回键] 关闭」。
  // 列表：名称右对齐、正文左对齐并换行，名称与正文第一行对齐；选过的选项画「选项」标签。打开时滚到最底。
  // 游戏里用网格视窗接滚轮 / 拖动，预览直接用可滚动的 div；手柄摇杆滚动由 PreviewApp 调 scrollBy。
  import { COLORS, PAD_HINT, REVIEW, rgba } from "../model/previewConfig";
  import type { DialogSim, ReviewSnap } from "../model/previewSim";
  import KeyHint from "./KeyHint.svelte";
  import PvText from "./PvText.svelte";
  import ToolIcon from "./ToolIcon.svelte";

  let { review, sim, pad, keyHints, canvas }: { review: ReviewSnap; sim: DialogSim; pad: boolean; keyHints: boolean; canvas: { w: number; h: number } } = $props();
  const cx = $derived(canvas.w / 2);
  const lh = REVIEW.fontSize * REVIEW.lineHeight;
  const bottom = $derived(pad ? REVIEW.padViewBottom : REVIEW.viewBottom);
  const gold = rgba(COLORS.reviewGold);
  const s = PAD_HINT.keyScale;

  /** 每次打开（id 变化）滚到最底：显示最新的一句 */
  function toBottom(node: HTMLElement, id: number) {
    const go = () => (node.scrollTop = node.scrollHeight);
    go();
    return {
      update(next: number) {
        if (next !== id) {
          id = next;
          go();
        }
      },
    };
  }
  // 关闭叉：「移动」光标（十字 + 四个箭头）转 45°
  const L = REVIEW.closeLen;
  const W = REVIEW.closeBar;
  const hw = REVIEW.closeHeadW;
  const hh = REVIEW.closeHeadH;
  const bar = L - 2 * hh;
</script>

{#snippet line(y: string, value: number)}
  <!-- 108018（花结 + 粗细双线）的近似：两端圆点、中间双线；整体 25% 不透明度 -->
  <div class="orn" style={`${y}: ${value - REVIEW.lineH / 2}px`} style:left="{REVIEW.lineEdge}px" style:right="{REVIEW.lineEdge}px" style:height="{REVIEW.lineH}px" style:--c={rgba(COLORS.reviewLine)}>
    <i class="dot l"></i><i class="thin"></i><i class="thick"></i><i class="dot r"></i>
  </div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="page panel-review" style:opacity={review.alpha} onclick={(e) => e.stopPropagation()}>
  <div class="bg" style:background={rgba(COLORS.reviewBg)}></div>
  <span class="ic" style:left="{REVIEW.iconX - REVIEW.iconSize / 2}px" style:top="{REVIEW.top - REVIEW.iconSize / 2}px">
    <ToolIcon name="bubble" size={REVIEW.iconSize} color={gold} mirror />
  </span>
  <div class="title" style:left="{REVIEW.titleX}px" style:top="{REVIEW.top - REVIEW.titleSize}px" style:height="{REVIEW.titleSize * 2}px" style:font-size="{REVIEW.titleSize}px" style:color={gold}>
    {REVIEW.title}
  </div>
  {@render line("top", REVIEW.line)}
  {#if pad}
    {@render line("bottom", REVIEW.padLine)}
    {#if keyHints}
      <KeyHint label="B" x={canvas.w - PAD_HINT.edge - PAD_HINT.textW - PAD_HINT.gap - (PAD_HINT.keyW * s) / 2} y={PAD_HINT.y} pad scale={s} />
    {/if}
    <div
      class="pad-text"
      style:left="{canvas.w - PAD_HINT.edge - PAD_HINT.textW}px"
      style:bottom="{PAD_HINT.y - PAD_HINT.textH / 2}px"
      style:width="{PAD_HINT.textW}px"
      style:height="{PAD_HINT.textH}px"
      style:font-size="{PAD_HINT.textSize}px"
      style:color={rgba(COLORS.body)}
    >
      {REVIEW.closeText}
    </div>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="close live"
      style:left="{canvas.w - REVIEW.closeX - REVIEW.closeHit / 2}px"
      style:top="{REVIEW.top - REVIEW.closeHit / 2}px"
      style:width="{REVIEW.closeHit}px"
      style:height="{REVIEW.closeHit}px"
      style:--hover-s={REVIEW.closeHover}
      style:--press-s={REVIEW.closePress}
      style:--anim="{REVIEW.closeAnim * 1000}ms"
      onclick={(e) => {
        e.stopPropagation();
        sim.reviewCloseClick();
      }}
    >
      <svg width={L} height={L} viewBox="{-L / 2} {-L / 2} {L} {L}" aria-hidden="true">
        <g fill={gold}>
          <rect x={-bar / 2} y={-W / 2} width={bar} height={W} />
          <rect x={-W / 2} y={-bar / 2} width={W} height={bar} />
          {#each [0, 90, 180, 270] as r (r)}
            <path transform="rotate({r})" d="M{-hw / 2} {-bar / 2}L0 {-bar / 2 - hh}L{hw / 2} {-bar / 2}z" />
          {/each}
        </g>
      </svg>
    </div>
  {/if}
  <div class="view rv-view" style:top="{REVIEW.viewTop}px" style:bottom="{bottom}px" use:toBottom={review.id}>
    <div class="rows" style:padding-top="{REVIEW.padTop}px" style:padding-bottom="{REVIEW.padBottom}px" style:gap="{REVIEW.rowGap}px">
      {#each review.rows as row, i (i)}
        <div class="row" style:font-size="{REVIEW.fontSize}px" style:line-height="{lh}px" style:padding-top="{REVIEW.textPad / 2}px" style:padding-bottom="{REVIEW.textPad / 2}px">
          {#if row.choice}
            <span
              class="tag"
              style:right="{canvas.w - (cx + REVIEW.nameRight)}px"
              style:top="{REVIEW.textPad / 2 + lh / 2 - REVIEW.tagH / 2}px"
              style:width="{REVIEW.tagW}px"
              style:height="{REVIEW.tagH}px"
              style:font-size="{REVIEW.tagSize}px"
              style:background={gold}
              style:color={rgba(COLORS.tagText)}>{REVIEW.choice}</span
            >
          {:else if row.name}
            <span class="name" style:top="{REVIEW.textPad / 2}px" style:right="{canvas.w - (cx + REVIEW.nameRight)}px" style:width="{REVIEW.nameW}px" style:color={gold}><PvText runs={row.name} /></span>
          {/if}
          <div class="text" style:margin-left="{cx + REVIEW.textLeft}px" style:width="{REVIEW.textW}px" style:color={rgba(COLORS.reviewText)}>
            <PvText runs={row.text} />
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .page {
    position: absolute;
    inset: 0;
    pointer-events: auto;
  }
  .bg {
    position: absolute;
    inset: -25%;
  }
  .ic,
  .title,
  .orn,
  .close,
  .pad-text,
  .view {
    position: absolute;
  }
  .title,
  .pad-text {
    display: flex;
    align-items: center;
    white-space: nowrap;
    line-height: 1.2;
  }
  .orn {
    pointer-events: none;
  }
  .orn i {
    position: absolute;
    background: var(--c);
  }
  .orn .thin {
    left: 8px;
    right: 8px;
    top: 2px;
    height: 1px;
  }
  .orn .thick {
    left: 8px;
    right: 8px;
    top: 4.5px;
    height: 2px;
  }
  .orn .dot {
    top: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .orn .dot.l {
    left: 0;
  }
  .orn .dot.r {
    right: 0;
  }
  .close {
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .close svg {
    transform: rotate(45deg);
    transition: transform var(--anim) cubic-bezier(0.5, 1, 0.89, 1);
  }
  /* 悬停略放大（触屏没有悬停）；按下再缩小并半透明 */
  @media (hover: hover) {
    .close:hover svg {
      transform: rotate(45deg) scale(var(--hover-s));
    }
  }
  .close:active svg {
    transform: rotate(45deg) scale(var(--press-s));
    opacity: 0.5;
  }
  .view {
    left: 0;
    right: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }
  .view::-webkit-scrollbar {
    display: none;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    position: relative;
  }
  .name {
    position: absolute;
    top: 0;
    text-align: right;
    white-space: nowrap;
  }
  .tag {
    position: absolute;
    display: grid;
    place-items: center;
    border-radius: 4px;
    /* 游戏里文本框比标签高（tagTextH）、文字居中；这里按字形居中，效果相同 */
    line-height: 1;
    white-space: nowrap;
  }
  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
