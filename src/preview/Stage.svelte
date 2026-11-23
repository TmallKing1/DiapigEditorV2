<script lang="ts">
  // 逻辑画布上的对话界面：按 DialogSim 的快照画出对话框、黑屏、继续指示与选项。
  // 坐标照 Lua：左下原点、Y 向上，x 从中线量起；所以元素一律用 left / bottom 定位。
  // 游戏素材（光斑 106056、选项底板 106081 / 106086、气泡图标 100160、三角 100003）拿不到，
  // 这里用 CSS 渐变 / SVG 近似，见各处注释。
  import { BLACK, BLEED, BOX, COLORS, DIVIDER, DIVIDER_IMG, isPad, MARK, OPTIONS, rgba, TAB, type SimDevice } from "../model/previewConfig";
  import dividerUrl from "./divider.png";
  import { bodyMax, lineH } from "../model/previewLayout";
  import type { DialogSim, Snapshot } from "../model/previewSim";
  import KeyHint from "./KeyHint.svelte";
  import PvText from "./PvText.svelte";
  import Review from "./Review.svelte";
  import Toolbar from "./Toolbar.svelte";

  // keyHint：kbm 键鼠提示、pad 手柄提示、none 不显示；device：模拟的设备（工具栏样式、选项卡尺寸）
  let { snap, canvas, sim, keyHint, device }: { snap: Snapshot; canvas: { w: number; h: number }; sim: DialogSim; keyHint: string; device: SimDevice } = $props();
  const kbm = $derived(keyHint === "kbm");
  const padKeys = $derived(keyHint === "pad");
  const pad = $derived(isPad(device));
  /** 非锁定选项卡第 i 行的手柄键：LB + 十字键 上 / 右 / 左 / 下（DialogOptions PAD_PICK） */
  const PAD_PICK = ["LB+↑", "LB+→", "LB+←", "LB+↓"];

  const cx = $derived(canvas.w / 2);
  const outline = `1px 1px 0 ${rgba(COLORS.outline)}, -1px 1px 0 ${rgba(COLORS.outline)}, 1px -1px 0 ${rgba(COLORS.outline)}, -1px -1px 0 ${rgba(COLORS.outline)}`;
  // 背景遮罩：上沿在 bgTop，下沿在画布下沿以下（舞台高 × 外扩 + bgBelow）；光斑中心在 spotY
  const below = $derived(canvas.h * BLEED + BOX.bgBelow);
  const bgW = $derived(canvas.w * BOX.spotWidth);
  // 菱形框的边：转 45° 的正方形，描边 stroke
  const frameColor = rgba([MARK.color[0], MARK.color[1], MARK.color[2], MARK.frameAlpha]);
</script>

{#snippet frame(color: string, scale: number, alpha: number)}
  <div
    class="mk-frame"
    style:width="{MARK.side}px"
    style:height="{MARK.side}px"
    style:border="{MARK.stroke}px solid {color}"
    style:transform="translate(-50%, 50%) rotate(45deg) scale({scale})"
    style:opacity={alpha}
  ></div>
{/snippet}

{#snippet arrow(y: number, alpha: number)}
  <!-- 100003 三角转 180°：尖朝下，底 tri、高 tri / 2 -->
  <div
    class="mk-arrow"
    style:width="{MARK.tri}px"
    style:height="{MARK.tri / 2}px"
    style:bottom="{y - MARK.tri / 4}px"
    style:background={rgba(MARK.color)}
    style:opacity={alpha}
  ></div>
{/snippet}

<!-- D.ui：隐藏 UI、回顾页打开期间整体隐藏；打开前先淡出、关闭后再淡入（uiAlpha） -->
<div class="ui" class:off={!snap.uiVisible} style:opacity={snap.uiAlpha < 1 ? snap.uiAlpha : null}>
{#if snap.box?.type === 3}
  {@const b = snap.box}
  <!-- 黑屏：黑幕铺满舞台（外扩部分在等比框外，本来就是黑的），文字框宽 = 画布宽 × 80%，高 = 画布高 -->
  <div class="sheet" style:opacity={b.sheetAlpha}></div>
  <div
    class="black-text"
    style:left="{(canvas.w - Math.floor(canvas.w * (1 - 2 * BLACK.margin))) / 2}px"
    style:width="{Math.floor(canvas.w * (1 - 2 * BLACK.margin))}px"
    style:height="{canvas.h}px"
    style:font-size="{BLACK.fontSize}px"
    style:line-height="{BLACK.fontSize * BOX.lineHeight}px"
    style:color={rgba(COLORS.body)}
    style:opacity={b.bodyAlpha}
  >
    <div><PvText runs={b.body} /></div>
  </div>
{:else if snap.box}
  {@const b = snap.box}
  <div class="box" style:bottom="{b.boxY}px" style:width="{canvas.w}px" style:height="{canvas.h}px">
    {#if b.background}
      <!-- 背景：透明遮罩（上沿羽化 bgFeather）裁切一块拉成椭圆的 106056 径向光斑 -->
      <div
        class="bg-mask"
        style:left="{cx - bgW / 2}px"
        style:bottom="{-below}px"
        style:width="{bgW}px"
        style:height="{BOX.bgTop + below}px"
        style:mask-image="linear-gradient(to bottom, transparent 0, #000 {BOX.bgFeather}px)"
        style:opacity={b.speakerAlpha}
      >
        <div
          class="bg-spot"
          style:bottom="{BOX.spotY - BOX.spotH / 2 + below}px"
          style:height="{BOX.spotH}px"
          style:background="radial-gradient(closest-side, {rgba(COLORS.background)} 0%, {rgba(COLORS.background, 0.8)} 30%, {rgba(COLORS.background, 0.45)} 60%, {rgba(COLORS.background, 0.15)} 82%, transparent 100%)"
        ></div>
      </div>
    {/if}

    <!-- 名称：900 宽、字号 × 2 高的文本框，居中 -->
    <div
      class="txt center"
      style:left="{cx - BOX.nameBoxW / 2}px"
      style:bottom="{b.nameY - BOX.nameSize}px"
      style:width="{BOX.nameBoxW}px"
      style:height="{BOX.nameSize * 2}px"
      style:font-size="{BOX.nameSize}px"
      style:color={rgba(COLORS.name)}
      style:text-shadow={outline}
      style:opacity={b.speakerAlpha}
    >
      <span><PvText runs={b.name} /></span>
    </div>

    {#if b.title}
      <div
        class="txt center"
        style:left="{cx - BOX.titleBoxW / 2}px"
        style:bottom="{b.titleY - BOX.titleSize}px"
        style:width="{BOX.titleBoxW}px"
        style:height="{BOX.titleSize * 2}px"
        style:font-size="{BOX.titleSize}px"
        style:color={rgba(COLORS.title)}
        style:text-shadow={outline}
        style:opacity={b.speakerAlpha}
      >
        <span><PvText runs={b.title} /></span>
      </div>
    {/if}

    <!-- 分割线：两半各一个遮罩，里面是拉伸的 108005（左端尖角、右端卷曲）；右半左右镜像 -->
    {#each b.halves as h, i (i)}
      <!-- 三宫格：左端、右端按原比例画，中段的直线横向拉伸；比两端之和还窄时整体等比压窄 -->
      {@const f = Math.min(1, h.imgW / (DIVIDER_IMG.left + DIVIDER_IMG.right))}
      {@const capL = DIVIDER_IMG.left * f}
      {@const capR = DIVIDER_IMG.right * f}
      {@const mid = Math.max(0, h.imgW - capL - capR)}
      <div
        class="div-mask"
        style:left="{cx + h.maskX - h.maskW / 2}px"
        style:bottom="{b.dividerY - BOX.dividerMaskH / 2}px"
        style:width="{h.maskW}px"
        style:height="{BOX.dividerMaskH}px"
        style:opacity={b.speakerAlpha}
      >
        <div
          class="div-img"
          class:mirror={h.mirror}
          style:width="{h.imgW}px"
          style:top="{(BOX.dividerMaskH - DIVIDER.height) / 2}px"
          style:height="{DIVIDER.height}px"
          style:opacity={COLORS.divider[3] / 255}
          style:--div-url="url({dividerUrl})"
          style:--div-color="rgb({COLORS.divider[0]}, {COLORS.divider[1]}, {COLORS.divider[2]})"
        >
          <i class="div-part" style:left="0" style:width="{capL}px" style:mask-size="{DIVIDER_IMG.width * f}px 100%" style:mask-position="0 0"></i>
          {#if mid > 0}
            <!-- 中段两头各多画半个像素盖住接缝 -->
            <i
              class="div-part"
              style:left="{capL - 0.5}px"
              style:width="{mid + 1}px"
              style:mask-size="{(DIVIDER_IMG.width * (mid + 1)) / DIVIDER_IMG.mid}px 100%"
              style:mask-position="{(-DIVIDER_IMG.left * (mid + 1)) / DIVIDER_IMG.mid}px 0"
            ></i>
          {/if}
          <i class="div-part" style:right="0" style:width="{capR}px" style:mask-size="{DIVIDER_IMG.width * f}px 100%" style:mask-position="100% 0"></i>
        </div>
      </div>
    {/each}

    <!-- 正文：宽 = 画布宽 × 60%，轴心在顶边，文字居中、顶对齐；行距按 Lua 的估算值 -->
    <div
      class="body-text"
      style:left="{cx - bodyMax(canvas.w) / 2}px"
      style:top="{canvas.h - b.bodyTop}px"
      style:width="{bodyMax(canvas.w)}px"
      style:padding-top="{BOX.bodyPad / 2}px"
      style:font-size="{BOX.bodySize}px"
      style:line-height="{lineH()}px"
      style:color={rgba(COLORS.body)}
      style:text-shadow={outline}
      style:opacity={b.bodyAlpha}
    >
      <PvText runs={b.body} />
    </div>
  </div>
{/if}

<!-- 继续指示：画布底部居中，菱形下顶点离下沿 16 px -->
{#if snap.mark}
  {@const m = snap.mark}
  <div class="mk-root" style:left="{cx}px" style:bottom="{m.y}px">
    {@render frame(frameColor, 1, m.alpha)}
    {@render arrow(m.arrowY, m.alpha)}
  </div>
{/if}
{#each snap.bursts as bu, i (i)}
  {@const quick = Math.min(1, bu.u / 0.6)}
  {@const out = 1 - (1 - bu.u) * (1 - bu.u)}
  {@const outQ = 1 - (1 - quick) * (1 - quick)}
  <div class="mk-root" style:left="{cx}px" style:bottom="{bu.y}px">
    <!-- 点击：光斑放大淡出、亮框外扩淡出、原框略放大淡出 -->
    <div
      class="mk-spot"
      style:width="{MARK.spotSize}px"
      style:height="{MARK.spotSize}px"
      style:background="radial-gradient(closest-side, {rgba(MARK.glow)}, transparent)"
      style:transform="translate(-50%, 50%) scale({0.6 + 0.8 * out})"
      style:opacity={1 - out}
    ></div>
    {@render frame(rgba(MARK.glow), 1 + (MARK.burstScale - 1) * out, 1 - bu.u * bu.u)}
    {@render frame(frameColor, 1 + 0.15 * outQ, 1 - outQ)}
    {@render arrow(bu.arrowY, 1 - outQ)}
  </div>
{/each}

{#if snap.options}
  {@const o = snap.options}
  <div
    class="opt-root"
    style:left="{cx + o.rootX}px"
    style:bottom="{o.rootY}px"
    style:transform={o.scale !== 1 ? `scale(${o.scale})` : null}
  >
    {#if o.bar}
      <div class="bar" style:left="{o.bar.x}px" style:bottom="{o.bar.y - 2}px" style:width="{o.bar.w}px" style:background={rgba(COLORS.timerTrack)}></div>
      <div class="bar" style:left="{o.bar.x}px" style:bottom="{o.bar.y - 2}px" style:width="{o.bar.w * o.bar.left}px" style:background={rgba(COLORS.timerBar)}></div>
    {/if}
    {#each o.cards as c, i (i)}
      {@const inset = c.pressed ? 2 : OPTIONS.fillInset}
      {@const fillH = c.pressed ? OPTIONS.lineSize : OPTIONS.fillSize}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="card"
        class:live={o.interactive}
        style:left="{c.x}px"
        style:bottom="{c.y - o.height / 2}px"
        style:width="{o.width}px"
        style:height="{o.height}px"
        style:opacity={c.alpha}
        onpointerenter={() => sim.cardEnter(i)}
        onpointerleave={() => sim.cardExit(i)}
        onpointerdown={(e) => {
          if (e.button === 0) sim.cardDown(i);
        }}
        onpointerup={() => sim.cardUp(i)}
        onclick={(e) => {
          e.stopPropagation();
          sim.cardClick(i);
        }}
      >
        <!-- 106081 填充：左端半圆，向右渐隐；按下时变黄并扩到内框线的范围（左缩 2、高 48），内框线隐藏 -->
        <div
          class="fill"
          style:left="{inset}px"
          style:width="{o.width - 2 * inset}px"
          style:top="{(o.height - fillH) / 2}px"
          style:height="{fillH}px"
          style:border-radius="{fillH / 2}px 0 0 {fillH / 2}px"
          style:background="linear-gradient(to right, {rgba(c.pressed ? COLORS.optionPressed : COLORS.optionFill)} 40%, transparent)"
        ></div>
        <!-- 106084 内框线：高 48，左缩 2；未高亮 #484848，高亮时在灰 / 白之间呼吸，补上外框与填充之间的缝 -->
        <div
          class="line"
          style:display={c.pressed ? "none" : undefined}
          style:left="2px"
          style:width="{o.width - 4}px"
          style:top="{(o.height - OPTIONS.lineSize) / 2}px"
          style:height="{OPTIONS.lineSize}px"
          style:border-color={rgba(c.lit ?? COLORS.optionLine)}
        ></div>
        <!-- 106086 外框：左端半圆 R=26 的轮廓，向右渐隐；固定颜色 -->
        <div class="border" style:border-color={rgba(COLORS.optionBorder)}></div>
        <!-- 100160 白色三点对话气泡 -->
        <svg class="icon" style:left="{OPTIONS.iconX - OPTIONS.iconSize / 2}px" width={OPTIONS.iconSize} height={OPTIONS.iconSize} viewBox="0 0 34 34">
          <path
            fill-rule="evenodd"
            fill="#fff"
            d="M17 6C9.3 6 4 10.6 4 16.2c0 3.2 1.8 6 4.6 7.8L7 29l5.6-3c1.4.4 2.9.6 4.4.6 7.7 0 13-4.6 13-10.4S24.7 6 17 6zM11 14.4a1.9 1.9 0 110 3.8 1.9 1.9 0 010-3.8zm6 0a1.9 1.9 0 110 3.8 1.9 1.9 0 010-3.8zm6 0a1.9 1.9 0 110 3.8 1.9 1.9 0 010-3.8z"
          />
        </svg>
        <div
          class="opt-text"
          style:left="{OPTIONS.textX}px"
          style:width="{o.width - OPTIONS.textX - OPTIONS.textRight}px"
          style:font-size="{OPTIONS.fontSize}px"
          style:color={rgba(COLORS.optionText)}
          style:text-shadow={outline}
        >
          <span><PvText runs={c.label} /></span>
        </div>
        {#if c.arrow}
          <!-- 100003 三角转 -90°：尖朝右，底 12、高 6 -->
          <div
            class="opt-arrow"
            style:left="{o.arrowX - OPTIONS.arrowW / 4}px"
            style:top="{(o.height - OPTIONS.arrowW) / 2}px"
            style:width="{OPTIONS.arrowW / 2}px"
            style:height="{OPTIONS.arrowW}px"
            style:background={rgba(COLORS.arrow)}
          ></div>
        {/if}
        {#if kbm && c.key != null}
          <KeyHint label={String(c.key)} x={OPTIONS.keyX} y={o.height / 2} />
        {:else if padKeys && c.key != null}
          <KeyHint label={PAD_PICK[c.key - 1]} x={TAB.padKeyX} y={o.height / 2} pad wide />
        {/if}
      </div>
    {/each}
    {#if kbm && o.keyF}
      <KeyHint label="F" x={o.keyF.x} y={o.keyF.y} />
    {:else if padKeys && o.keyF}
      <KeyHint label="A" x={o.keyF.x} y={o.keyF.y} pad />
    {/if}
  </div>
{/if}

<Toolbar {snap} {sim} {device} keyHints={padKeys} width={canvas.w} />
</div>

{#if snap.review}
  <Review review={snap.review} {sim} {pad} keyHints={padKeys} {canvas} />
{/if}

<style>
  .ui {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .ui.off {
    visibility: hidden;
  }
  .box,
  .sheet,
  .black-text,
  .txt,
  .bg-mask,
  .bg-spot,
  .div-mask,
  .body-text,
  .mk-root,
  .opt-root,
  .card,
  .bar {
    position: absolute;
  }
  .box {
    left: 0;
    pointer-events: none;
  }
  .sheet {
    inset: 0;
    background: #000;
  }
  .black-text {
    top: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    pointer-events: none;
  }
  .bg-mask {
    overflow: hidden;
  }
  .bg-spot {
    left: 0;
    width: 100%;
  }
  .txt {
    display: flex;
    justify-content: center;
    align-items: center;
    text-align: center;
    line-height: 1.2;
    white-space: pre-wrap;
  }
  .div-mask {
    overflow: hidden;
  }
  .div-img {
    position: absolute;
    left: 0;
  }
  /* 分割线图片（divider.png，白色 + 透明度）当遮罩，颜色由 --div-color 着色 */
  .div-part {
    position: absolute;
    top: 0;
    height: 100%;
    background: var(--div-color);
    mask-image: var(--div-url);
    mask-repeat: no-repeat;
  }
  .div-img.mirror {
    left: auto;
    right: 0;
    transform: scaleX(-1);
  }
  .body-text {
    text-align: center;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .mk-root {
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .mk-frame,
  .mk-spot {
    position: absolute;
    left: 0;
    bottom: 0;
    box-sizing: border-box;
  }
  .mk-arrow {
    position: absolute;
    left: 0;
    transform: translateX(-50%);
    clip-path: polygon(0 0, 100% 0, 50% 100%);
  }
  .opt-root {
    width: 0;
    height: 0;
    transform-origin: 0 100%;
  }
  /* 选项卡是透明的：覆盖全局 .card（app.css）带来的白底、阴影、圆角与内边距 */
  .card {
    pointer-events: none;
    background: none;
    box-shadow: none;
    border-radius: 0;
    padding: 0;
  }
  .card.live {
    pointer-events: auto;
  }
  .fill,
  .border,
  .line,
  .icon,
  .opt-text,
  .opt-arrow {
    position: absolute;
  }
  .fill {
    border-radius: 22px 0 0 22px;
  }
  .line {
    border: 2px solid;
    border-right: 0;
    border-radius: 24px 0 0 24px;
    mask-image: linear-gradient(to right, #000 40%, transparent);
  }
  .border {
    inset: 0;
    border: 2px solid;
    border-right: 0;
    border-radius: 26px 0 0 26px;
    mask-image: linear-gradient(to right, #000 40%, transparent);
  }
  .icon {
    top: calc(50% - 17px);
  }
  .opt-text {
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    white-space: nowrap;
    line-height: 1.2;
  }
  .opt-arrow {
    clip-path: polygon(0 0, 100% 50%, 0 100%);
  }
  .bar {
    height: 4px;
  }
</style>
