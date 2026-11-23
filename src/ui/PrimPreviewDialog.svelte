<script lang="ts">
  // 图元拟合的放大预览：原图 / 拟合图放大显示，滚轮以指针为中心缩放，左键拖动平移，双击还原。
  // 两张图共用一个视图（归一化中心 + 倍数），切换时停在同一位置，方便对比。
  // 每次视图变化都按舞台的实际像素重画一次：拟合图用页面预览同一套 drawArt 矢量重画，放大后边缘依然清晰；
  // 原图只有预览分辨率（长边 ≤ 512），和页面一样平滑插值放大。
  import { untrack } from "svelte";
  import { fit, previewCache, shapes } from "../lib/primfit.svelte";
  import { drawArt } from "../model/primfit";
  import { FIT_VIEW, type Size, type ZoomView, clampView, panBy, placement, wheelFactor, zoomAt } from "../model/zoomView";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";

  let {
    initial = "source",
    onclose,
  }: {
    /** 打开时显示哪张图 */
    initial?: "source" | "fit";
    onclose: () => void;
  } = $props();

  let showFit = $state(untrack(() => initial === "fit" && !!fit.canvas));
  // 拟合图被清掉（不会在对话框打开期间发生，保险起见）就退回原图
  let fitShown = $derived(showFit && !!fit.canvas);
  let canToggle = $derived(fitShown ? !!fit.source : !!fit.canvas && !!fit.source);

  /** 当前图片的尺寸：原图按预览像素，拟合图按工作分辨率；两者比例相同，只差取整 */
  let image = $derived<Size>(
    fitShown && fit.canvas
      ? { w: fit.canvas.width, h: fit.canvas.height }
      : fit.source
        ? { w: fit.source.preview.width, h: fit.source.preview.height }
        : { w: 0, h: 0 },
  );
  /** 底色与页面预览一致：保留透明度时棋盘格，否则页面底色 */
  let checker = $derived(fitShown ? fit.canvas?.bgAlpha === 0 : fit.params.preserveAlpha);

  let stage = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let box = $state<Size>({ w: 0, h: 0 });
  /** 用户操作得到的视图；舞台或图片尺寸变化后按 shown 夹取后的结果显示 */
  let view = $state<ZoomView>(FIT_VIEW);
  let shown = $derived(clampView(view, box, image));
  let dragging = $state(false);

  // 原图预览只转一次位图，重画时直接缩放贴上
  let sourceBitmap = $derived.by(() => {
    const img = fit.source?.preview;
    if (!img) return null;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")?.putImageData(img, 0, 0);
    return c;
  });

  $effect(() => {
    if (!stage) return;
    const measure = () => (box = { w: stage!.clientWidth, h: stage!.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  });

  // —— 绘制 ——
  // 图元多时矢量重画一次要几百毫秒，不能每帧都画。拆成两步：
  // ① 快速：贴上页面预览的离屏位图（previewCache），再把上一次的清晰结果按新视图平移 / 缩放贴在上面；每帧一次。
  // ② 清晰：视图停下约 150 毫秒后（连续变化时最多每 600 毫秒）矢量重画一次，存进 crisp。
  const SETTLE_MS = 150;
  const MAX_WAIT_MS = 600;
  /** 上一次矢量重画的结果（设备像素）与当时的状态；状态对不上就不能再用 */
  const crisp = { canvas: null as HTMLCanvasElement | null, at: null as { x: number; y: number; w: number; h: number } | null, key: "" };
  let frame = 0;
  let settle = 0;
  let firstChange = 0;

  /** 拟合图当前内容的标识：任务、精修次数、图元数、背景 */
  function artKey(): string {
    return `${fit.jobId}/${fit.revision}/${fit.use}/${fit.canvas?.bg}/${fit.canvas?.bgAlpha}`;
  }

  function prepare(): { g: CanvasRenderingContext2D; dpr: number; at: ReturnType<typeof placement> } | null {
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(box.w * dpr));
    const h = Math.max(1, Math.round(box.h * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, dpr, at: placement(shown, box, image) };
  }

  function drawQuick() {
    frame = 0;
    const p = prepare();
    if (!p || p.at.w <= 0 || p.at.h <= 0) return;
    const { g, dpr, at } = p;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    if (!fitShown || !fit.canvas) {
      if (sourceBitmap) g.drawImage(sourceBitmap, at.x, at.y, at.w, at.h);
      return;
    }
    const key = artKey();
    const cache = previewCache;
    const cacheOk = !!cache.canvas && cache.job === fit.jobId && cache.revision === fit.revision && cache.count === fit.use;
    const crispOk = !!crisp.canvas && !!crisp.at && crisp.key === key;
    if (!cacheOk && !crispOk) return drawCrisp();
    // 上次的清晰结果对应 crisp.at 时的视图，换算到当前视图
    const s = crispOk ? at.w / crisp.at!.w : 0;
    const r = crispOk
      ? { x: at.x - crisp.at!.x * s, y: at.y - crisp.at!.y * s, w: (crisp.canvas!.width / dpr) * s, h: (crisp.canvas!.height / dpr) * s }
      : null;
    if (cacheOk) {
      // 位图只补清晰结果没覆盖到的地方（它只含当时的舞台范围）；透明背景的图不会叠两层
      g.save();
      g.beginPath();
      g.rect(at.x, at.y, at.w, at.h);
      if (r) g.rect(r.x, r.y, r.w, r.h);
      g.clip("evenodd");
      g.drawImage(cache.canvas!, at.x, at.y, at.w, at.h);
      g.restore();
    }
    if (r) g.drawImage(crisp.canvas!, r.x, r.y, r.w, r.h);
  }

  function drawCrisp() {
    if (settle) clearTimeout(settle);
    settle = 0;
    firstChange = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const p = prepare();
    if (!p) return;
    const { g, at } = p;
    if (at.w <= 0 || at.h <= 0) return;
    if (!fitShown || !fit.canvas) {
      if (sourceBitmap) {
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = "high";
        g.drawImage(sourceBitmap, at.x, at.y, at.w, at.h);
      }
      return;
    }
    drawArt(g, { ...fit.canvas, shapes }, at.x, at.y, at.w, fit.use);
    crisp.canvas ??= document.createElement("canvas");
    crisp.canvas.width = canvas!.width;
    crisp.canvas.height = canvas!.height;
    crisp.canvas.getContext("2d")!.drawImage(canvas!, 0, 0);
    crisp.at = { ...at };
    crisp.key = artKey();
  }

  $effect(() => {
    // 读一遍所有会改变画面的状态（shapes 本身不是响应式的，靠 use / revision / jobId 跟踪）
    void [canvas, shown, box, image, fitShown, sourceBitmap, fit.use, fit.done, fit.revision, fit.jobId, fit.canvas?.bg, fit.canvas?.bgAlpha];
    if (!frame) frame = requestAnimationFrame(drawQuick);
    const now = performance.now();
    firstChange ||= now;
    if (settle) clearTimeout(settle);
    settle = window.setTimeout(drawCrisp, Math.max(0, Math.min(SETTLE_MS, firstChange + MAX_WAIT_MS - now)));
  });
  $effect(() => () => {
    if (frame) cancelAnimationFrame(frame);
    if (settle) clearTimeout(settle);
  });

  // —— 交互 ——
  function local(e: { clientX: number; clientY: number }) {
    const r = stage!.getBoundingClientRect();
    return { x: e.clientX - r.left - stage!.clientLeft, y: e.clientY - r.top - stage!.clientTop };
  }

  // 滚轮要阻止页面滚动，必须是非被动监听
  $effect(() => {
    if (!stage) return;
    const onwheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!e.deltaY) return;
      const p = local(e);
      view = zoomAt(shown, wheelFactor(e.deltaY, e.deltaMode), p.x, p.y, box, image);
    };
    stage.addEventListener("wheel", onwheel, { passive: false });
    return () => stage!.removeEventListener("wheel", onwheel);
  });

  let last = { id: -1, x: 0, y: 0 };
  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0 || !stage) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    last = { id: e.pointerId, x: e.clientX, y: e.clientY };
    dragging = true;
  }
  function onpointermove(e: PointerEvent) {
    if (!dragging || e.pointerId !== last.id) return;
    view = panBy(shown, e.clientX - last.x, e.clientY - last.y, box, image);
    last.x = e.clientX;
    last.y = e.clientY;
  }
  function endDrag() {
    dragging = false;
    last.id = -1;
  }

  function toggle() {
    if (!canToggle) return;
    // 先把当前显示的（夹取后的）视图记下来，切换后在新图上停在同一位置
    view = shown;
    showFit = !fitShown;
  }

  let zoomText = $derived(`${Math.round(shown.zoom * 100)}%`);
</script>

<Modal title="放大预览" width={960} {onclose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="stage"
    data-tip="滚轮缩放，拖动平移，双击还原。"
    class:checkerboard={checker}
    class:zoomed={shown.zoom > 1.001}
    class:dragging
    bind:this={stage}
    {onpointerdown}
    {onpointermove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onlostpointercapture={endDrag}
    ondblclick={() => (view = FIT_VIEW)}
  >
    <canvas bind:this={canvas} aria-label={fitShown ? "拟合图" : "原图"}></canvas>
  </div>

  {#snippet footer()}
    <div class="left">
      <ul class="info hint" aria-label="预览状态">
        <li><Icon name={fitShown ? "shapes" : "image"} size={15} /><span>{fitShown ? "拟合图" : "原图"}</span></li>
        <li><Icon name="zoom" size={15} /><span class="num">{zoomText}</span></li>
      </ul>
    </div>
    <button class="btn toggle" onclick={toggle} disabled={!canToggle} data-tip={fit.canvas ? undefined : "还没有拟合结果"}>
      <Icon name="swap" />
      <!-- 两段文字叠在同一格里，按钮宽度取较宽的一段，切换时不变 -->
      <span class="stack">
        <span class:off={fitShown}>切换到拟合图</span>
        <span class:off={!fitShown}>切换到原图</span>
      </span>
    </button>
    <button class="btn accent" data-autofocus onclick={onclose}><Icon name="check" />完成</button>
  {/snippet}
</Modal>

<style>
  .stage {
    position: relative;
    height: min(620px, calc(100vh - 230px));
    min-height: 240px;
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--page);
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }
  .stage.checkerboard {
    background-color: var(--surface);
    background-image: conic-gradient(var(--border) 25%, transparent 0 50%, var(--border) 0 75%, transparent 0);
    background-size: 16px 16px;
  }
  .stage.zoomed {
    cursor: grab;
  }
  .stage.dragging {
    cursor: grabbing;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }
  .info {
    display: flex;
    align-items: center;
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .info li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .info li + li {
    margin-left: var(--s3);
    padding-left: var(--s3);
    border-left: 1px solid var(--border);
  }
  .info :global(svg) {
    flex: none;
    color: var(--text-3);
  }
  .num {
    display: inline-block;
    min-width: 4ch;
    font-variant-numeric: tabular-nums;
  }
  /* 底栏左侧：状态与说明；占满剩余宽度，把两个按钮推到右边 */
  .left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-width: 0;
  }
  .stack {
    display: inline-grid;
  }
  .stack > span {
    grid-area: 1 / 1;
    text-align: center;
  }
  .stack > .off {
    visibility: hidden;
  }
</style>
