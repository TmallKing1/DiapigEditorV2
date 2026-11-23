<script lang="ts">
  // 成长曲线：三条“等级 → 倍率”公式，实时预览与作图，导出 1–200 级 CSV（格式与旧版相同）。
  // 公式用自然书写的公式框 + 数学键盘输入；旁边的切换按钮可改回直接编辑源码，两边实时同步。
  // 持久状态只有 localStorage 的 GROWTH_KEY（见 growth.ts），左侧栏「重置」调用 resetGrowth。
  import { copyText, saveText } from "../lib/files";
  import { CURVES, MAX_LEVEL, formatNumber, growthCsv, loadGrowth, parseExpr, sampleCurve, saveGrowth, type Expr } from "../model/growth";
  import { fromSource } from "../model/mathExpr";
  import Icon from "../ui/Icon.svelte";
  import MathField from "../ui/MathField.svelte";

  let { toast }: { toast: (text: string, kind?: "success" | "info" | "error") => void } = $props();

  const COLORS = ["#E5484D", "#E09A00", "#127AE1"];
  const saved = loadGrowth();
  let formulas = $state<string[]>(saved?.formulas ?? CURVES.map((c) => c.fallback));
  let shown = $state<boolean[]>(saved?.shown ?? [true, true, true]);
  let level = $state(Math.min(Math.max(Math.round(saved?.level ?? 1), 1), MAX_LEVEL));
  let busy = $state(false);
  // 源码有语法错误的旧公式一打开就用源码框，免得公式框显示空白、一输入就把原文覆盖掉
  let sourceMode = $state<boolean[]>((saved?.formulas ?? []).map((f) => !fromSource(f).ok).concat([false, false, false]).slice(0, CURVES.length));

  $effect(() => {
    saveGrowth({ formulas, shown, level });
  });

  type Curve = { ok: true; expr: Expr; values: number[] } | { ok: false; error: string };
  let curves = $derived<Curve[]>(
    formulas.map((f) => {
      try {
        const expr = parseExpr(f);
        return { ok: true, expr, values: sampleCurve(expr) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  let allOk = $derived(curves.every((c) => c.ok));

  function valueText(c: Curve, lv: number): string {
    return c.ok ? formatNumber(c.values[lv - 1]) : "—";
  }

  // —— 图表 ——
  const H = 300;
  const PAD = { l: 64, r: 16, t: 14, b: 30 };
  let width = $state(600);
  let hover = $state<number | null>(null);

  let range = $derived.by(() => {
    let lo = Infinity;
    let hi = -Infinity;
    curves.forEach((c, k) => {
      if (!c.ok || !shown[k]) return;
      for (const v of c.values) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    });
    if (lo === Infinity) return { lo: 0, hi: 1 };
    if (lo === hi) {
      const p = Math.max(Math.abs(lo) * 0.05, 1);
      return { lo: lo - p, hi: hi + p };
    }
    const p = (hi - lo) * 0.05;
    return { lo: lo - p, hi: hi + p };
  });

  let plotW = $derived(Math.max(1, width - PAD.l - PAD.r));
  const plotH = H - PAD.t - PAD.b;
  const xOf = (lv: number) => PAD.l + ((lv - 1) * plotW) / (MAX_LEVEL - 1);
  const yOf = (v: number) => PAD.t + ((range.hi - v) * plotH) / (range.hi - range.lo);

  /** 取 1、2、5 × 10^n 的刻度间隔 */
  let ticks = $derived.by(() => {
    const span = range.hi - range.lo;
    const raw = span / 5;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    const out: number[] = [];
    for (let v = Math.ceil(range.lo / step) * step; v <= range.hi + 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  });
  const tickText = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1e6 || (a > 0 && a < 1e-3)) return v.toExponential(1);
    return formatNumber(v);
  };

  let paths = $derived(
    curves.map((c, k) =>
      c.ok && shown[k] ? c.values.map((v, i) => `${i ? "L" : "M"}${xOf(i + 1).toFixed(1)} ${yOf(v).toFixed(1)}`).join("") : "",
    ),
  );

  function levelAt(e: PointerEvent): number | null {
    const svg = e.currentTarget as SVGSVGElement;
    const x = e.clientX - svg.getBoundingClientRect().left;
    if (x < PAD.l - 6 || x > PAD.l + plotW + 6) return null;
    return Math.min(MAX_LEVEL, Math.max(1, Math.round(1 + ((x - PAD.l) * (MAX_LEVEL - 1)) / plotW)));
  }

  function resize(node: HTMLElement) {
    const ro = new ResizeObserver(() => (width = node.clientWidth));
    ro.observe(node);
    width = node.clientWidth;
    return { destroy: () => ro.disconnect() };
  }

  // —— 操作 ——
  function setLevel(v: number) {
    if (Number.isFinite(v)) level = Math.min(Math.max(Math.round(v), 1), MAX_LEVEL);
  }

  function reset() {
    formulas = CURVES.map((c) => c.fallback);
    shown = [true, true, true];
    sourceMode = [false, false, false];
  }

  function csv(): string | null {
    if (!allOk) return null;
    return growthCsv(curves.map((c) => (c as { expr: Expr }).expr));
  }

  async function exportCsv() {
    const text = csv();
    if (!text || busy) return;
    busy = true;
    try {
      const saved = await saveText(text, "growth.csv", {
        title: "导出成长曲线为 CSV",
        filterName: "CSV 文件",
        extension: "csv",
        mime: "text/csv",
      });
      if (saved) toast(`已导出 ${saved.name}`);
    } catch (e) {
      toast(`导出失败：${String(e)}`, "error");
    } finally {
      busy = false;
    }
  }

  async function copyCsv() {
    const text = csv();
    if (!text) return;
    try {
      await copyText(text.replace(/^﻿/, ""));
      toast("已复制 CSV 内容");
    } catch (e) {
      toast(`复制失败：${String(e)}`, "error");
    }
  }
</script>

<div class="page-stack">
  <section class="card setting enter">
    <h2 class="card-title">倍率公式</h2>
    <div class="setting-body">
    <div class="rows">
      {#each CURVES as c, k (c.key)}
        {@const cur = curves[k]}
        <div class="row">
          <label class="name" for="growth-{c.key}{sourceMode[k] ? '-src' : ''}">
            <span class="dot" style:--dot={COLORS[k]}></span>{c.column}
          </label>
          <div class="formula">
            <!-- 源码模式下公式框只是隐藏：仍跟随源码，源码出错时保留上一次的有效内容 -->
            <div class="field-slot" class:hidden={sourceMode[k]}>
              <MathField
                id="growth-{c.key}"
                ariaLabel="{c.column}公式"
                placeholder="例如：{c.fallback}"
                value={formulas[k]}
                error={cur.ok ? "" : cur.error}
                onchange={(s) => (formulas[k] = s)}
              />
            </div>
            {#if sourceMode[k]}
              <input
                id="growth-{c.key}-src"
                class="input mono"
                class:invalid={!cur.ok}
                placeholder="例如：{c.fallback}"
                spellcheck="false"
                data-tip={cur.ok ? undefined : cur.error}
                aria-invalid={!cur.ok}
                bind:value={formulas[k]}
              />
            {/if}
            <button
              type="button"
              class="icon-btn mode"
              class:on={sourceMode[k]}
              aria-pressed={sourceMode[k]}
              aria-label={sourceMode[k] ? "改用公式框输入" : "直接编辑源码"}
              data-tip={sourceMode[k] ? "改用公式框输入" : "直接编辑源码"}
              onclick={() => (sourceMode[k] = !sourceMode[k])}
            >
              <Icon name={sourceMode[k] ? "edit" : "code"} />
            </button>
          </div>
          <span class="value" class:muted={!cur.ok}>
            {#if cur.ok}{valueText(cur, level)}{:else}<span class="err" data-tip={cur.error}><Icon name="warn" size={14} />有误</span>{/if}
          </span>
        </div>
      {/each}
    </div>

    <div class="level">
      <label class="name" for="growth-level">预览等级</label>
      <input
        id="growth-level"
        class="input level-num"
        type="number"
        min="1"
        max={MAX_LEVEL}
        value={level}
        onchange={(e) => setLevel(Number(e.currentTarget.value))}
      />
      <input
        class="slider"
        type="range"
        min="1"
        max={MAX_LEVEL}
        aria-label="预览等级滑块"
        value={level}
        oninput={(e) => setLevel(Number(e.currentTarget.value))}
      />
    </div>

    <div class="actions">
      <span class="grow"></span>
      <button class="btn" onclick={reset}><Icon name="refresh" />恢复默认</button>
    </div>
    </div>
  </section>

  <section class="card setting enter" style:--enter-delay="40ms">
    <h2 class="card-title">曲线</h2>
    <div class="setting-body">
    <div class="actions">
      <span class="hint">等级 1 – {MAX_LEVEL}（点击图表设为预览等级）</span>
      <span class="grow"></span>
      {#each CURVES as c, k (c.key)}
        <label class="check legend" style:--dot={COLORS[k]}>
          <input type="checkbox" bind:checked={shown[k]} />
          <span class="dot"></span>{c.name}
        </label>
      {/each}
    </div>

    <div class="chart" use:resize>
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
      <svg
        width={width}
        height={H}
        role="img"
        aria-label="成长曲线图"
        onpointermove={(e) => (hover = levelAt(e))}
        onpointerleave={() => (hover = null)}
        onclick={(e) => {
          const lv = levelAt(e as unknown as PointerEvent);
          if (lv) level = lv;
        }}
      >
        {#each ticks as t}
          <line class="grid" x1={PAD.l} x2={PAD.l + plotW} y1={yOf(t)} y2={yOf(t)} />
          <text class="tick" x={PAD.l - 8} y={yOf(t)} text-anchor="end" dominant-baseline="middle">{tickText(t)}</text>
        {/each}
        {#each [1, 50, 100, 150, 200] as lv}
          <text class="tick" x={xOf(lv)} y={H - 10} text-anchor="middle">{lv}</text>
        {/each}
        <line class="axis" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + plotH} />
        <line class="axis" x1={PAD.l} x2={PAD.l + plotW} y1={PAD.t + plotH} y2={PAD.t + plotH} />
        <line class="marker" x1={xOf(level)} x2={xOf(level)} y1={PAD.t} y2={PAD.t + plotH} />
        {#each paths as d, k}
          {#if d}<path class="curve" {d} style:stroke={COLORS[k]} />{/if}
        {/each}
        {#if hover}
          <line class="cross" x1={xOf(hover)} x2={xOf(hover)} y1={PAD.t} y2={PAD.t + plotH} />
          {#each curves as c, k}
            {#if c.ok && shown[k]}
              <circle cx={xOf(hover)} cy={yOf(c.values[hover - 1])} r="3.5" style:fill={COLORS[k]} />
            {/if}
          {/each}
        {/if}
      </svg>
      {#if hover}
        <div class="readout" style:left="{Math.min(xOf(hover) + 12, width - 150)}px">
          <strong>等级 {hover}</strong>
          {#each CURVES as c, k}
            {#if shown[k]}
              <span><span class="dot" style:--dot={COLORS[k]}></span>{c.name}：{valueText(curves[k], hover)}</span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    <div class="actions">
      {#if !allOk}<span class="hint error">公式有误，修正后才能导出</span>{/if}
      <span class="grow"></span>
      <button class="btn" onclick={copyCsv} disabled={!allOk}><Icon name="copy" />复制 CSV</button>
      <button class="btn accent" onclick={exportCsv} disabled={!allOk || busy}><Icon name="export" />导出 CSV</button>
    </div>
    </div>
  </section>
</div>

<style>
  .page-stack {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .grow {
    flex: 1;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .row {
    display: grid;
    grid-template-columns: 96px 1fr 88px;
    align-items: start;
    gap: var(--s3);
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--ctl-h);
    color: var(--text-2);
    white-space: nowrap;
  }
  .formula {
    display: flex;
    align-items: flex-start;
    gap: var(--s1);
    min-width: 0;
  }
  .field-slot {
    flex: 1;
    min-width: 0;
  }
  .field-slot.hidden {
    display: none;
  }
  .formula > .input {
    flex: 1;
  }
  /* 源码模式开启时按钮保持加深色，表示当前在编辑源码 */
  .mode.on {
    color: color-mix(in srgb, var(--theme) 68%, #000);
  }
  .err {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--danger);
    font-weight: 400;
    cursor: help;
  }
  .value {
    min-height: var(--ctl-h);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .value.muted {
    color: var(--text-3);
    font-weight: 400;
  }
  .dot {
    flex: none;
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--dot);
  }
  .level {
    display: grid;
    grid-template-columns: 96px 88px 1fr;
    align-items: center;
    gap: var(--s3);
  }
  .slider {
    accent-color: var(--theme);
  }
  .mono {
    font-family: "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace;
    font-size: 13px;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .legend {
    min-height: 0;
    gap: 6px;
    margin-left: var(--s2);
    font-size: 12.5px;
  }
  /* 曲线开关：勾上与未勾上都用各自曲线的颜色 */
  .legend {
    --check-color: var(--dot);
    --check-idle: var(--dot);
  }
  .chart {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
    cursor: crosshair;
    user-select: none;
  }
  .grid {
    stroke: #edf0f4;
  }
  .axis {
    stroke: #b8c0cc;
  }
  .tick {
    fill: var(--text-2);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
  .marker {
    stroke: var(--theme-light);
    stroke-width: 2;
  }
  .cross {
    stroke: #9aa5b5;
    stroke-dasharray: 3 3;
  }
  .curve {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
  }
  circle {
    stroke: #fff;
    stroke-width: 1.5;
  }
  .readout {
    position: absolute;
    top: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 128px;
    padding: var(--s2) var(--s3);
    border: 1px solid var(--theme-light);
    border-radius: var(--r-card);
    background: rgba(255, 255, 255, 0.96);
    box-shadow: var(--shadow-float);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .readout span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2);
    min-height: var(--ctl-h);
  }
</style>
