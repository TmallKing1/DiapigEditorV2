<script lang="ts">
  // 锁定对话的工具栏（DiapigDialogToolbar.lua）与手柄的「确认」提示（DialogView padHint）。
  // 键鼠 / 触屏：左上角、千星退出按钮右边同一行（1600×900 下 y = 863）三个米色圆形按钮，自动按钮带「自动 / 播放中」。
  //   悬停时图标放大（带过渡；触屏没有悬停），按下时图标半透明；文字只在不可用时变淡。
  // 手柄：左下「Y + 回顾图标」「RB + 隐藏图标」（图标无底），右下「X + 自动 / 播放中」在「[确认键] 确认」左边。
  import { COLORS, PAD_HINT, rgba, TOOLBAR, type SimDevice } from "../model/previewConfig";
  import type { DialogSim, Snapshot } from "../model/previewSim";
  import KeyHint from "./KeyHint.svelte";
  import ToolIcon from "./ToolIcon.svelte";

  let { snap, sim, device, keyHints, width }: { snap: Snapshot; sim: DialogSim; device: SimDevice; keyHints: boolean; width: number } = $props();
  const pad = $derived(device === "console" || device === "mobilePad");
  const tb = $derived(snap.toolbar);
  const outline = `1px 1px 0 ${rgba(COLORS.outline)}, -1px 1px 0 ${rgba(COLORS.outline)}, 1px -1px 0 ${rgba(COLORS.outline)}, -1px -1px 0 ${rgba(COLORS.outline)}`;
  const P = TOOLBAR.pad;
  const s = PAD_HINT.keyScale;
  // 手柄右下：确认提示宽 = 文字框 + 间距 + 放大后的键；自动提示的右端再往左 autoGap
  const confirmW = PAD_HINT.textW + PAD_HINT.gap + PAD_HINT.keyW * s;
  const autoRight = PAD_HINT.edge + confirmW + P.autoGap;
  // 手柄左下：键中心、图标中心（DialogToolbar keyIcon）
  const reviewKeyX = P.edge + (PAD_HINT.keyW * s) / 2;
  const reviewIconX = P.edge + PAD_HINT.keyW * s + P.keyGap + P.iconSize / 2;
  const hideKeyX = reviewIconX + P.iconSize / 2 + P.groupGap + (PAD_HINT.keyW * s) / 2;
  const hideIconX = hideKeyX + (PAD_HINT.keyW * s) / 2 + P.keyGap + P.iconSize / 2;

  function tool(e: MouseEvent, a: "auto" | "review" | "hide") {
    e.stopPropagation();
    sim.toolClick(a);
  }
</script>

{#if tb && !pad}
  <div
    class="bar"
    class:touch={device === "touch"}
    style:left="{TOOLBAR.x - TOOLBAR.size / 2}px"
    style:top="{TOOLBAR.y - TOOLBAR.size / 2}px"
    style:height="{TOOLBAR.size}px"
    style:opacity={tb.alpha}
    style:--hover-scale={TOOLBAR.hoverScale}
    style:--hover-t="{TOOLBAR.hover * 1000}ms"
    style:--press-a={TOOLBAR.pressAlpha}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="tbtn live" class:dis={tb.disabled} style:gap="{TOOLBAR.textGap}px" onclick={(e) => tool(e, "auto")}>
      <span class="ic" style:opacity={tb.disabled ? TOOLBAR.disabledAlpha : null}><ToolIcon name={tb.auto ? "pause" : "play"} size={TOOLBAR.size} /></span>
      <span
        class="label"
        style:font-size="{TOOLBAR.textSize}px"
        style:color={rgba(COLORS.toolText)}
        style:text-shadow={outline}
        style:opacity={tb.disabled ? TOOLBAR.disabledAlpha : null}>{tb.auto ? TOOLBAR.playingText : TOOLBAR.autoText}</span
      >
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="tbtn live" style:margin-left="{TOOLBAR.textAfter}px" onclick={(e) => tool(e, "review")}>
      <span class="ic"><ToolIcon name="review" size={TOOLBAR.size} /></span>
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="tbtn live" style:margin-left="{TOOLBAR.step - TOOLBAR.size}px" onclick={(e) => tool(e, "hide")}>
      <span class="ic"><ToolIcon name="hide" size={TOOLBAR.size} /></span>
    </div>
  </div>
{/if}

{#if pad}
  {#if tb}
    <div class="pad-layer" style:opacity={tb.alpha}>
      {#if keyHints}
        <KeyHint label="Y" x={reviewKeyX} y={P.y} pad scale={s} />
        <KeyHint label="RB" x={hideKeyX} y={P.y} pad scale={s} />
        <KeyHint label="X" x={width - autoRight - P.textW - PAD_HINT.gap - (PAD_HINT.keyW * s) / 2} y={P.y} pad scale={s} />
      {/if}
      <span class="pad-ic" style:left="{reviewIconX - P.iconSize / 2}px" style:bottom="{P.y - P.iconSize / 2}px"><ToolIcon name="padReview" size={P.iconSize} /></span>
      <span class="pad-ic" style:left="{hideIconX - P.iconSize / 2}px" style:bottom="{P.y - P.iconSize / 2}px"><ToolIcon name="padHide" size={P.iconSize} /></span>
      <div
        class="pad-text"
        style:left="{width - autoRight - P.textW}px"
        style:bottom="{P.y - P.textH / 2}px"
        style:width="{P.textW}px"
        style:height="{P.textH}px"
        style:font-size="{P.textSize}px"
        style:color={rgba(COLORS.body)}
        style:text-shadow={outline}
        style:opacity={tb.disabled ? TOOLBAR.disabledAlpha : null}
      >
        {tb.auto ? TOOLBAR.playingText : TOOLBAR.autoText}
      </div>
    </div>
  {/if}
  {#if snap.padHint}
    <!-- 右下「[菜单确认键] 确认」：键放大 1.2 倍，文字框紧接在键右边 -->
    {#if keyHints}
      <KeyHint label="A" x={width - PAD_HINT.edge - PAD_HINT.textW - PAD_HINT.gap - (PAD_HINT.keyW * s) / 2} y={PAD_HINT.y} pad scale={s} />
    {/if}
    <div
      class="pad-text"
      style:left="{width - PAD_HINT.edge - PAD_HINT.textW}px"
      style:bottom="{PAD_HINT.y - PAD_HINT.textH / 2}px"
      style:width="{PAD_HINT.textW}px"
      style:height="{PAD_HINT.textH}px"
      style:font-size="{PAD_HINT.textSize}px"
      style:color={rgba(COLORS.body)}
      style:text-shadow={outline}
    >
      {PAD_HINT.text}
    </div>
  {/if}
{/if}

<style>
  .bar {
    position: absolute;
    display: flex;
    align-items: center;
  }
  .tbtn {
    display: flex;
    align-items: center;
    height: 100%;
    cursor: pointer;
    pointer-events: auto;
  }
  .tbtn.dis {
    cursor: default;
  }
  .ic {
    display: block;
    transition:
      transform var(--hover-t) cubic-bezier(0.5, 1, 0.89, 1),
      opacity 60ms linear;
  }
  .bar:not(.touch) .tbtn:not(.dis):hover .ic {
    transform: scale(var(--hover-scale));
  }
  .tbtn:not(.dis):active .ic {
    opacity: var(--press-a);
  }
  .label {
    white-space: nowrap;
    line-height: 1.2;
  }
  .pad-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .pad-ic {
    position: absolute;
  }
  .pad-text {
    position: absolute;
    display: flex;
    align-items: center;
    white-space: nowrap;
    line-height: 1.2;
    pointer-events: none;
  }
</style>
