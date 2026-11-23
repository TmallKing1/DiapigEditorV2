<script lang="ts">
  // 图元拟合「重点区域」编辑对话框：在原图预览上涂抹 / 擦除权重蒙版，或自动生成。
  // 编辑在副本上进行，按「确定」才交给调用方写回；「取消」或 Esc 丢弃。
  // 蒙版与预览同尺寸（长边 ≤ 512），画布内部分辨率也取这个尺寸，CSS 放大显示。
  import { untrack } from "svelte";
  import Modal from "./Modal.svelte";
  import Dropdown from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";
  import {
    type Rect,
    type WeightMask,
    applyStroke,
    autoMask,
    coverage,
    dab,
    isEmptyMask,
    strokeLine,
  } from "../model/weightMask";

  let {
    preview,
    initial,
    checkerboard = false,
    onconfirm,
    oncancel,
  }: {
    /** 原图预览（RGBA，行自上而下） */
    preview: ImageData;
    /** 打开时的蒙版；没有时为 null */
    initial: WeightMask | null;
    /** 预览带透明度时用棋盘格衬底 */
    checkerboard?: boolean;
    onconfirm: (mask: WeightMask) => void;
    oncancel: () => void;
  } = $props();

  // 预览和初始蒙版在对话框打开期间不会变：只取一次
  const image = untrack(() => preview);
  const start = untrack(() => initial);
  const width = image.width;
  const height = image.height;
  const n = width * height;
  const UNDO_LIMIT = 20;
  /** 蒙版层的不透明度（满权重时） */
  const OVERLAY = 0.6;

  /** 正在编辑的副本 */
  let work: Uint8ClampedArray = start && start.width === width && start.height === height ? start.data.slice() : new Uint8ClampedArray(n);
  let undoStack: Uint8ClampedArray[] = [];
  let redoStack: Uint8ClampedArray[] = [];
  /** 蒙版每变一次加一：刷新覆盖率与撤销按钮 */
  let revision = $state(0);
  let history = $state({ undo: 0, redo: 0 });

  let mode = $state<"paint" | "erase">("paint");
  let radius = $state(24);
  let opacity = $state(100);
  let feather = $state(50);
  let method = $state("detail");
  const METHODS = [
    { value: "detail", label: "细节" },
    { value: "center", label: "中心" },
  ];

  let empty = $derived.by(() => {
    void revision;
    return isEmptyMask(work);
  });
  let coverageText = $derived.by(() => {
    void revision;
    const c = coverage(work) * 100;
    return c > 0 && c < 1 ? "不到 1%" : `${Math.round(c)}%`;
  });

  // —— 画布合成 ——
  let canvas = $state<HTMLCanvasElement>();
  let stage = $state<HTMLDivElement>();
  let ctx: CanvasRenderingContext2D | null = null;
  let frame: ImageData | null = null;
  let theme: [number, number, number] = [18, 122, 225];
  /** 画布在页面上的显示尺寸（CSS 像素） */
  let display = $state({ w: width, h: height });

  /** 读主题色：经 canvas 的 fillStyle 规范化成 #rrggbb */
  function readTheme(): [number, number, number] {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--theme").trim();
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe || !raw) return theme;
    probe.fillStyle = "#127ae1";
    probe.fillStyle = raw;
    const hex = probe.fillStyle;
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return theme;
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  /** 原图 + 主题色半透明蒙版（「over」合成，原图透明处也能看到蒙版），只重画 rect 范围 */
  function compose(rect: Rect | null = null) {
    if (!ctx || !frame) return;
    const { x0, y0, x1, y1 } = rect ?? { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    const src = image.data;
    const out = frame.data;
    const [tr, tg, tb] = theme;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0, p = y * width + x0; x <= x1; x++, p++) {
        const o = p * 4;
        const m = (work[p] / 255) * OVERLAY;
        const sa = src[o + 3] / 255;
        const a = m + sa * (1 - m);
        if (a <= 0) {
          out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
          continue;
        }
        const k = (sa * (1 - m)) / a;
        const q = m / a;
        out[o] = tr * q + src[o] * k;
        out[o + 1] = tg * q + src[o + 1] * k;
        out[o + 2] = tb * q + src[o + 2] * k;
        out[o + 3] = a * 255;
      }
    }
    ctx.putImageData(frame, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  $effect(() => {
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext("2d");
    frame = new ImageData(width, height);
    theme = readTheme();
    compose();
  });

  // 画布按比例放到舞台里，记下显示尺寸，指针坐标按它换算
  $effect(() => {
    if (!stage) return;
    const fit = () => {
      const r = stage!.getBoundingClientRect();
      const k = Math.min(r.width / width, r.height / height);
      if (k > 0) display = { w: Math.floor(width * k), h: Math.floor(height * k) };
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  });

  // —— 笔刷 ——
  let drawing = false;
  let strokeBase: Uint8ClampedArray | null = null;
  let strokeBuf: Float32Array | null = null;
  let strokeChanged = false;
  let last = { x: 0, y: 0 };
  /** 笔刷圆环的位置（蒙版像素坐标）；指针不在画布上时为 null */
  let cursor = $state<{ x: number; y: number } | null>(null);

  /** 指针位置 → 蒙版像素坐标（画布 CSS 尺寸与内部分辨率不同） */
  function toMask(e: PointerEvent) {
    const r = canvas!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  }

  function paint(rect: Rect | null) {
    if (!rect || !strokeBase || !strokeBuf) return;
    applyStroke(strokeBase, strokeBuf, opacity / 100, mode === "erase", width, work, rect);
    strokeChanged = true;
    compose(rect);
  }

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0 || !canvas) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    strokeBase = work.slice();
    strokeBuf = new Float32Array(n);
    strokeChanged = false;
    last = toMask(e);
    cursor = last;
    paint(dab(strokeBuf, width, height, last.x, last.y, radius, feather / 100));
  }

  function onpointermove(e: PointerEvent) {
    const p = toMask(e);
    cursor = p;
    if (!drawing || !strokeBuf) return;
    paint(strokeLine(strokeBuf, width, height, last.x, last.y, p.x, p.y, radius, feather / 100));
    last = p;
  }

  function endStroke() {
    if (!drawing) return;
    drawing = false;
    if (strokeChanged && strokeBase) {
      pushUndo(strokeBase);
      revision++;
    }
    strokeBase = null;
    strokeBuf = null;
  }

  // —— 撤销 / 重做 ——
  function pushUndo(snapshot: Uint8ClampedArray) {
    undoStack.push(snapshot);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    history = { undo: undoStack.length, redo: 0 };
  }

  /** 整体替换蒙版（自动生成、清空），可撤销 */
  function replace(next: Uint8ClampedArray) {
    if (drawing) return;
    pushUndo(work);
    work = next;
    revision++;
    compose();
  }

  function undo() {
    if (drawing || !undoStack.length) return;
    redoStack.push(work);
    work = undoStack.pop()!;
    history = { undo: undoStack.length, redo: redoStack.length };
    revision++;
    compose();
  }

  function redo() {
    if (drawing || !redoStack.length) return;
    undoStack.push(work);
    work = redoStack.pop()!;
    history = { undo: undoStack.length, redo: redoStack.length };
    revision++;
    compose();
  }

  function generate() {
    replace(autoMask(image, method === "center" ? "center" : "detail"));
  }

  function clearAll() {
    if (empty) return;
    replace(new Uint8ClampedArray(n));
  }

  function confirm() {
    endStroke();
    onconfirm({ width, height, data: work.slice() });
  }

  function setRadius(v: number) {
    radius = Math.min(128, Math.max(2, Math.round(v)));
  }

  // 快捷键只在对话框打开期间、在捕获阶段处理，并且不让 Ctrl 组合键冒泡到页面的全局快捷键（保存、打开等）
  $effect(() => {
    const onkey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 下拉框自己处理按键（键入首字母跳转、方向键）
      if (target?.closest?.('[role="combobox"], [role="listbox"]')) {
        if (e.ctrlKey || e.metaKey) e.stopPropagation();
        return;
      }
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        e.stopPropagation();
        if (key === "z" || key === "y") {
          e.preventDefault();
          if (key === "y" || e.shiftKey) redo();
          else undo();
        } else if (key === "s" || key === "o") {
          e.preventDefault();
        }
        return;
      }
      if (e.altKey) return;
      if (key === "b") mode = "paint";
      else if (key === "e") mode = "erase";
      else if (e.key === "[") setRadius(radius - Math.max(1, radius * 0.15));
      else if (e.key === "]") setRadius(radius + Math.max(1, radius * 0.15));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onkey, true);
    return () => window.removeEventListener("keydown", onkey, true);
  });
</script>

<Modal title="编辑重点区域" width={860} onclose={oncancel}>
  <div class="layout">
    <div class="stage" bind:this={stage}>
      <div class="canvas-box" class:checkerboard style:width="{display.w}px" style:height="{display.h}px">
        <canvas
          bind:this={canvas}
          aria-label="重点区域画布"
          {onpointerdown}
          {onpointermove}
          onpointerup={endStroke}
          onpointercancel={endStroke}
          onlostpointercapture={endStroke}
          onpointerleave={() => (cursor = drawing ? cursor : null)}
        ></canvas>
        {#if cursor}
          <svg class="ring" viewBox="0 0 {width} {height}" aria-hidden="true">
            <circle cx={cursor.x} cy={cursor.y} r={radius} />
            {#if feather > 0 && feather < 100}
              <circle class="inner" cx={cursor.x} cy={cursor.y} r={radius * (1 - feather / 100)} />
            {/if}
          </svg>
        {/if}
      </div>
    </div>

    <div class="side">
      <div class="field">
        <span class="label">模式</span>
        <div class="radios" role="radiogroup" aria-label="笔刷模式">
          <label class="check" data-tip="快捷键 B"><input type="radio" name="mask-mode" value="paint" bind:group={mode} />涂抹</label>
          <label class="check" data-tip="快捷键 E"><input type="radio" name="mask-mode" value="erase" bind:group={mode} />擦除</label>
        </div>
      </div>

      <div class="field">
        <div class="slider-head">
          <label class="label" for="mask-radius">笔刷半径</label>
          <span class="value">{radius} 像素</span>
        </div>
        <input id="mask-radius" class="slider" type="range" min="2" max="128" step="1" bind:value={radius} data-tip="快捷键 [ 和 ]" />
      </div>
      <div class="field">
        <div class="slider-head">
          <label class="label" for="mask-opacity">不透明度（权重）</label>
          <span class="value">{opacity}%</span>
        </div>
        <input id="mask-opacity" class="slider" type="range" min="1" max="100" step="1" bind:value={opacity} />
      </div>
      <div class="field">
        <div class="slider-head">
          <label class="label" for="mask-feather">羽化宽度</label>
          <span class="value">{feather}%</span>
        </div>
        <input id="mask-feather" class="slider" type="range" min="0" max="100" step="1" bind:value={feather} />
      </div>

      <div class="field">
        <div class="field-heading">
          <label class="label" for="mask-auto">自动生成</label>
        </div>
        <div class="auto">
          <Dropdown id="mask-auto" tip={"细节：突出边缘和纹理。\n中心：突出画面中心。"} options={METHODS} value={method} onchange={(v) => (method = v)} />
          <button class="btn" onclick={generate} data-tip="按图片内容生成，替换当前蒙版（可撤销）。"><Icon name="refresh" />生成</button>
        </div>
      </div>

      <div class="tools">
        <button class="btn icon" onclick={undo} disabled={history.undo === 0} data-tip="撤销（Ctrl+Z）" aria-label="撤销"><Icon name="undo" /></button>
        <button class="btn icon" onclick={redo} disabled={history.redo === 0} data-tip="重做（Ctrl+Shift+Z）" aria-label="重做"><Icon name="redo" /></button>
        <button class="btn" onclick={clearAll} disabled={empty}><Icon name="trash" />清空</button>
      </div>

      <span class="hint status">{empty ? "未设置重点区域" : `覆盖 ${coverageText}`}</span>
      <span class="hint">涂抹处的误差权重更高，拟合会把更多图元用在这里。按住鼠标左键在左侧画布上涂抹。</span>
    </div>
  </div>

  {#snippet footer()}
    <button class="btn" onclick={oncancel}>取消</button>
    <button class="btn accent" data-autofocus onclick={confirm}><Icon name="check" />确定</button>
  {/snippet}
</Modal>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 240px;
    gap: var(--s4);
    min-height: 0;
  }
  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
    height: min(520px, calc(100vh - 260px));
    min-height: 240px;
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--surface);
    overflow: hidden;
  }
  .canvas-box {
    position: relative;
    flex: none;
  }
  .canvas-box.checkerboard {
    background-color: var(--surface);
    background-image: conic-gradient(var(--border) 25%, transparent 0 50%, var(--border) 0 75%, transparent 0);
    background-size: 16px 16px;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
    touch-action: none;
  }
  .ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .ring circle {
    fill: none;
    stroke: var(--text);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
    filter: drop-shadow(0 0 1px var(--surface));
  }
  .ring circle.inner {
    stroke-dasharray: 3 3;
    stroke-width: 1px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    min-width: 0;
  }
  .radios {
    display: flex;
    gap: var(--s4);
  }
  .field-heading {
    display: flex;
    align-items: center;
    gap: var(--s1);
    min-height: 20px;
  }
  .slider-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s2);
  }
  .value {
    font-size: 12.5px;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .slider {
    width: 100%;
    accent-color: var(--theme);
    min-width: 0;
  }
  .auto {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s2);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .status {
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 720px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .stage {
      height: min(360px, 50vh);
    }
  }
</style>
