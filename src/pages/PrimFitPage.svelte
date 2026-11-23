<script lang="ts">
  // 图元拟合：把一张图片拟合成染色的硬图元与渐变图元，导出为一个 Lua 数据模块。
  // 计算在桌面端后端（Rust）里跑，这里只管参数、预览和导出。
  import { copyText, isTauri, saveText } from "../lib/files";
  import { agentPrompt } from "../model/agentPrompt";
  import {
    clearMask,
    currentArt,
    fit,
    getMask,
    pickImage,
    PREVIEW_MARK_STEP,
    previewCache,
    reloadPreview,
    saveParams,
    setMask,
    shapes,
    similarityAt,
    startFit,
    stopFit,
  } from "../lib/primfit.svelte";
  import WeightMaskDialog from "../ui/WeightMaskDialog.svelte";
  import PrimPreviewDialog from "../ui/PrimPreviewDialog.svelte";
  import { artFormat, beginArt, drawShape, isModuleName, serializeArtLua } from "../model/primfit";
  import Dropdown from "../ui/Dropdown.svelte";
  import CollapsibleCard from "../ui/CollapsibleCard.svelte";
  import ArtExportRow from "../ui/ArtExportRow.svelte";
  import Icon from "../ui/Icon.svelte";

  let { toast }: { toast: (text: string, kind?: "success" | "info" | "error") => void } = $props();

  const p = fit.params;
  let busy = $state(false);

  $effect(() => {
    JSON.stringify(fit.params);
    saveParams();
  });

  const ALPHAS = [
    { value: "0", label: "自动（每个图元各自选）" },
    { value: "64", label: "固定 25%" },
    { value: "128", label: "固定 50%" },
    { value: "192", label: "固定 75%" },
    { value: "255", label: "不透明" },
  ];
  const REFINES = [
    { value: "0", label: "关闭" },
    { value: "1", label: "1 轮" },
    { value: "2", label: "2 轮（推荐）" },
    { value: "4", label: "4 轮" },
  ];
  const QUALITIES = [
    { value: "fast", label: "快速" },
    { value: "normal", label: "标准" },
    { value: "fine", label: "精细（约慢 3 倍）" },
  ];

  function setInt(key: "count" | "size" | "seed" | "threads", raw: string, lo: number, hi: number) {
    const v = Math.round(Number(raw));
    if (Number.isFinite(v)) p[key] = Math.min(hi, Math.max(lo, v));
  }

  let anyKind = $derived(p.rect || p.ellipse || p.triangle || p.radial || p.linear || p.band);
  let moduleOk = $derived(isModuleName(p.module));
  let canStart = $derived(!!fit.source && anyKind && !fit.running);
  let canExport = $derived(!!fit.canvas && (fit.use > 0 || fit.canvas.bgAlpha === 0) && moduleOk && !busy);

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function choose() {
    if (busy) return;
    busy = true;
    try {
      await pickImage();
    } catch (e) {
      toast(`载入图片失败：${message(e)}`, "error");
    } finally {
      busy = false;
    }
  }

  async function previewChanged() {
    try {
      await reloadPreview();
    } catch (e) {
      toast(`载入图片失败：${message(e)}`, "error");
    }
  }

  async function start() {
    if (!canStart) return;
    try {
      await startFit((stopped) => {
        const sim = (similarityAt(fit.done) * 100).toFixed(2);
        const secs = (fit.elapsedMs / 1000).toFixed(1);
        if (stopped) toast(`已停止：${fit.done} 个图元，相似度 ${sim}%`, "info");
        else if (fit.done < fit.goal) toast(`已收敛：${fit.done} 个图元后再也找不到能改善画面的图元，相似度 ${sim}%，用时 ${secs} 秒`, "info");
        else toast(`拟合完成：${fit.done} 个图元，相似度 ${sim}%，用时 ${secs} 秒`);
      });
    } catch (e) {
      toast(`无法开始拟合：${message(e)}`, "error");
    }
  }

  // —— 预览 ——
  /** 画布内部分辨率的长边（像素）；显示尺寸由 CSS 决定 */
  const VIEW = 720;
  let srcCanvas = $state<HTMLCanvasElement>();
  let outCanvas = $state<HTMLCanvasElement>();

  $effect(() => {
    const canvas = srcCanvas;
    const img = fit.source?.preview;
    if (!canvas || !img) return;
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")!.putImageData(img, 0, 0);
  });

  // —— 放大预览：打开时先显示哪张图；null 为关闭 ——
  let zoomOpen = $state<"source" | "fit" | null>(null);

  // —— 重点区域 ——
  let maskOpen = $state(false);
  let maskCanvas = $state<HTMLCanvasElement>();
  const MASK_TIP =
    "涂出要重点还原的区域（如脸、文字），拟合会把更多图元用在这里。修改后需重新拟合；换图片时清除。";
  let maskText = $derived.by(() => {
    void fit.maskRevision;
    if (!getMask()) return "未设置";
    const c = fit.maskCoverage * 100;
    return `已设置，覆盖 ${c > 0 && c < 1 ? "不到 1" : Math.round(c)}%`;
  });

  // 「原图」上叠一层淡淡的主题色显示当前蒙版；与原图画布同尺寸、同样的 object-fit，位置自然对齐
  $effect(() => {
    const canvas = maskCanvas;
    void fit.maskRevision;
    const mask = getMask();
    const img = fit.source?.preview;
    if (!canvas || !img) return;
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!mask || mask.width !== img.width || mask.height !== img.height) return;
    g.fillStyle = getComputedStyle(canvas).getPropertyValue("--theme").trim() || "#127ae1";
    g.fillRect(0, 0, 1, 1);
    const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
    const layer = new ImageData(mask.width, mask.height);
    for (let p = 0, o = 0; p < mask.data.length; p++, o += 4) {
      layer.data[o] = r;
      layer.data[o + 1] = gr;
      layer.data[o + 2] = b;
      layer.data[o + 3] = mask.data[p] * 0.45;
    }
    g.putImageData(layer, 0, 0);
  });

  $effect(() => {
    const canvas = outCanvas;
    const art = fit.canvas;
    const use = fit.use;
    const job = fit.jobId;
    const revision = fit.revision;
    if (!canvas || !art) return;
    const c = previewCache;
    const scale = VIEW / Math.max(art.width, art.height);
    const w = Math.round(art.width * scale);
    const h = Math.round(art.height * scale);
    c.canvas ??= document.createElement("canvas");
    const off = c.canvas.getContext("2d")!;
    if (c.job !== job || c.revision !== revision || c.canvas.width !== w || c.canvas.height !== h) {
      // 换了任务、精修替换了图元或尺寸变了：存档点全部作废，从背景重画
      c.canvas.width = w;
      c.canvas.height = h;
      c.marks.clear();
      Object.assign(c, { job, revision, count: 0, k: beginArt(off, art, 0, 0, w) });
    }
    // 往回拖，或往前跳得比最近的存档点还远：从不超过 use 的最近存档点接着画（没有就回到背景）
    const mark = Math.floor(use / PREVIEW_MARK_STEP) * PREVIEW_MARK_STEP;
    if (use < c.count || (mark > c.count && c.marks.has(mark))) {
      let from = mark;
      while (from > 0 && !c.marks.has(from)) from -= PREVIEW_MARK_STEP;
      off.clearRect(0, 0, w, h);
      if (from > 0) off.drawImage(c.marks.get(from)!, 0, 0);
      else beginArt(off, art, 0, 0, w);
      c.count = from;
    }
    for (let i = c.count; i < use; i++) {
      drawShape(off, shapes[i], 0, 0, c.k, art.height);
      const n = i + 1;
      if (n % PREVIEW_MARK_STEP === 0 && !c.marks.has(n)) {
        const snap = document.createElement("canvas");
        snap.width = w;
        snap.height = h;
        snap.getContext("2d")!.drawImage(c.canvas, 0, 0);
        c.marks.set(n, snap);
      }
    }
    c.count = use;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    g.drawImage(c.canvas, 0, 0);
  });

  function setUse(v: number) {
    fit.use = Math.min(fit.done, Math.max(0, Math.round(v)));
    fit.follow = fit.use === fit.done;
  }

  let luaText = $derived.by(() => {
    fit.done;
    fit.revision;
    const art = currentArt(fit.use);
    if (!art) return "";
    return serializeArtLua(art, { module: p.module, source: fit.resultSource, similarity: similarityAt(fit.use) });
  });
  let sizeKb = $derived((new TextEncoder().encode(luaText).length / 1024).toFixed(1));
  let exportFormat = $derived.by(() => {
    fit.done;
    fit.revision;
    const art = currentArt(fit.use);
    return art ? artFormat(art) : 1;
  });

  /** 复制给其他设备上的 Agent 用的完整说明（格式、参考绘制代码、要向用户索要的内容、完成后的手动步骤），代入本次导出的参数 */
  async function copyPrompt() {
    const art = canExport ? currentArt(fit.use) : null;
    if (!art) return;
    try {
      await copyText(agentPrompt({ module: p.module, art, similarity: similarityAt(fit.use), source: fit.resultSource }));
      toast("已复制 Agent 提示词，可以连同导出的 Lua 文件一起交给 Agent");
    } catch (e) {
      toast(`复制失败：${message(e)}`, "error");
    }
  }

  async function exportLua() {
    if (!canExport) return;
    busy = true;
    try {
      const saved = await saveText(luaText, `${p.module}.lua`, {
        title: "导出图元拟合结果为 Lua 模块",
        filterName: "Lua 脚本",
        extension: "lua",
        mime: "text/x-lua",
      });
      if (!saved) return;
      if (saved.name !== `${p.module}.lua`) {
        toast(`已导出 ${saved.name}。注意：脚本映射名跟随文件名，require 时要用文件名（去掉 .lua）`, "info");
      } else {
        toast(`已导出 ${saved.name}，在千星沙箱为它建立同名脚本映射后即可 require`);
      }
    } catch (e) {
      toast(`导出失败：${message(e)}`, "error");
    } finally {
      busy = false;
    }
  }
</script>

{#snippet zoomButton(which: "source" | "fit", disabled: boolean)}
  <button
    class="icon-btn zoom-btn"
    data-tip={disabled ? (which === "source" ? "尚未选择图片" : "尚未拟合") : "放大预览"}
    aria-label={which === "source" ? "放大预览原图" : "放大预览拟合图"}
    {disabled}
    onclick={() => (zoomOpen = which)}
  ><Icon name="zoom" /></button>
{/snippet}

{#snippet metric(icon: string, text: string)}
  <li class="metric"><Icon name={icon} size={15} /><span>{text}</span></li>
{/snippet}

<div class="page-stack">
  {#if !isTauri}
    <section class="card setting enter">
      <h2 class="card-title">图元拟合</h2>
      <div class="setting-body">
        <span class="hint">图元拟合的计算在桌面端后端里运行，仅桌面端可用。请用 Diapig Editor 桌面程序打开这个页签。</span>
      </div>
    </section>
  {:else}
    <section class="card setting enter">
      <h2 class="card-title">图片与参数</h2>
      <div class="setting-body">
        <div class="actions">
          <button class="btn" onclick={choose} disabled={busy || fit.running}><Icon name="import" />选择图片</button>
          {#if fit.source}
            <span class="file" data-tip={fit.source.path}>{fit.source.name}</span>
            <span class="hint">{fit.source.width}×{fit.source.height}</span>
          {:else}
            <span class="hint">支持 PNG、JPEG、WebP，单边不超过 8192 像素</span>
          {/if}
        </div>

        <div class="grid">
          <div class="field">
            <label class="label" for="primfit-count">图元数量</label>
            <input
              id="primfit-count" data-tip="图元数上限（1–5000）。游戏里的控件数为图元数加 1。"
              class="input"
              type="number"
              min="1"
              max="5000"
              value={p.count}
              disabled={fit.running}
              onchange={(e) => {
                setInt("count", e.currentTarget.value, 1, 5000);
                e.currentTarget.value = String(p.count);
              }}
            />
          </div>
          <div class="field">
            <label class="label" for="primfit-size">工作分辨率（长边）</label>
            <input
              id="primfit-size" data-tip="拟合前缩到这个长边（32–512）。越大细节越多，也越慢。"
              class="input"
              type="number"
              min="32"
              max="512"
              value={p.size}
              disabled={fit.running}
              onchange={(e) => {
                setInt("size", e.currentTarget.value, 32, 512);
                e.currentTarget.value = String(p.size);
              }}
            />
          </div>
          <div class="field">
            <span class="label">保留透明度</span>
            <label class="check" data-tip="开启后连同透明度一起拟合；关闭后先合成到底色。修改后需重新拟合。"><input id="primfit-preserve-alpha" type="checkbox" bind:checked={p.preserveAlpha} disabled={fit.running} onchange={previewChanged} />启用</label>
          </div>
          {#if !p.preserveAlpha}
            <div class="field">
              <label class="label" for="primfit-matte">透明处底色</label>
              <div class="matte-control">
                <input id="primfit-matte" data-tip="关闭保留透明度时，透明处先合成到这个颜色。" class="color" type="color" bind:value={p.matte} disabled={fit.running} onchange={previewChanged} />
                <span class="mono">{p.matte.toUpperCase()}</span>
              </div>
            </div>
          {/if}
        </div>

        <div class="kind-field">
          <span class="label">图元类型</span>
          <div class="kind-options" data-tip="至少选一种。柔边椭圆适合平滑过渡，但约慢 3 倍；渐变与光带为实验类型。" role="group" aria-label="图元类型">
            <label class="check"><input type="checkbox" bind:checked={p.ellipse} disabled={fit.running} />椭圆</label>
            <label class="check"><input type="checkbox" bind:checked={p.rect} disabled={fit.running} />矩形</label>
            <label class="check"><input type="checkbox" bind:checked={p.triangle} disabled={fit.running} />三角形</label>
            <label class="check"><input type="checkbox" bind:checked={p.radial} disabled={fit.running} />柔边椭圆</label>
            <label class="check"><input type="checkbox" bind:checked={p.linear} disabled={fit.running} />单向渐变（实验）</label>
            <label class="check"><input type="checkbox" bind:checked={p.band} disabled={fit.running} />对称光带（实验）</label>
          </div>
        </div>
        {#if !anyKind}<span class="hint error"><Icon name="warn" size={12} /> 至少选择一种图元</span>{/if}
        {#if p.linear}
          <span class="hint"><Icon name="warn" size={12} /> 线性渐变使用图集边缘的近似模型，预览与游戏内素材边缘可能略有差异。</span>
        {/if}
      </div>
    </section>

    <CollapsibleCard title="高级参数" enterDelay="40ms">
      <div class="grid">
        <div class="field">
          <label class="label" for="primfit-quality">搜索强度</label>
          <Dropdown
            id="primfit-quality" tip="越精细结果通常越好，也越慢。"
            options={QUALITIES}
            value={p.quality}
            disabled={fit.running}
            onchange={(v) => (p.quality = v as typeof p.quality)}
          />
        </div>
        <div class="field">
          <label class="label" for="primfit-alpha">不透明度</label>
          <Dropdown
            id="primfit-alpha" tip="自动为每个图元选不透明度，通常效果最好；固定值让所有图元共用一档。"
            options={ALPHAS}
            value={String(p.alpha)}
            disabled={fit.running}
            onchange={(v) => (p.alpha = Number(v))}
          />
        </div>
        <div class="field">
          <label class="label" for="primfit-refine">精修</label>
          <Dropdown
            id="primfit-refine" tip="图元全部加入后再微调的轮数。越多越慢，收益递减。"
            options={REFINES}
            value={String(p.refine)}
            disabled={fit.running}
            onchange={(v) => (p.refine = Number(v))}
          />
        </div>
        <div class="field">
          <span class="label">抗锯齿评分</span>
          <label class="check" data-tip="按图元实际盖住每个像素的比例评分，与预览和游戏的绘制一致，黑底白字这类图不会留下细线。关闭后约快一倍，但细长图元可能在底色上留下线条。"><input id="primfit-antialias" type="checkbox" bind:checked={p.antialias} disabled={fit.running} />启用</label>
        </div>
        <div class="field">
          <label class="label" for="primfit-seed">随机种子</label>
          <input
            id="primfit-seed" data-tip="同样的图片、参数、种子和线程数得到相同结果。"
            class="input"
            type="number"
            min="0"
            max="4294967295"
            value={p.seed}
            disabled={fit.running}
            onchange={(e) => {
              setInt("seed", e.currentTarget.value, 0, 4294967295);
              e.currentTarget.value = String(p.seed);
            }}
          />
        </div>
        <div class="field">
          <label class="label" for="primfit-threads">线程数（0 为自动）</label>
          <input
            id="primfit-threads" data-tip="0 = CPU 核数减 1；手动 1–64。改变线程数结果也会变。"
            class="input"
            type="number"
            min="0"
            max="64"
            value={p.threads}
            disabled={fit.running}
            onchange={(e) => {
              setInt("threads", e.currentTarget.value, 0, 64);
              e.currentTarget.value = String(p.threads);
            }}
          />
        </div>
        <div class="field mask-field">
          <span class="label">重点区域</span>
          <div class="mask-control">
            <button class="btn" data-tip={MASK_TIP} onclick={() => (maskOpen = true)} disabled={!fit.source || fit.running}><Icon name="edit" />编辑…</button>
            <span class="hint status">{maskText}</span>
            {#if fit.maskCoverage > 0}
              <button class="btn" onclick={clearMask} disabled={fit.running}><Icon name="close" />清除</button>
            {/if}
          </div>
        </div>
      </div>
    </CollapsibleCard>

    {#if maskOpen && fit.source}
      <WeightMaskDialog
        preview={fit.source.preview}
        initial={getMask()}
        checkerboard={p.preserveAlpha}
        oncancel={() => (maskOpen = false)}
        onconfirm={(mask) => {
          setMask(mask);
          maskOpen = false;
        }}
      />
    {/if}

    {#if zoomOpen}
      <PrimPreviewDialog initial={zoomOpen} onclose={() => (zoomOpen = null)} />
    {/if}

    <section class="card setting enter" style:--enter-delay="80ms">
      <h2 class="card-title">拟合与导出</h2>
      <div class="setting-body">
        <div class="views">
          <figure>
            <div class="frame" class:checkerboard={p.preserveAlpha}>
              {#if fit.source}
                <canvas bind:this={srcCanvas} aria-label="原图"></canvas>
                <canvas class="mask-layer" bind:this={maskCanvas} aria-hidden="true"></canvas>
              {:else}<span class="hint">尚未选择图片</span>{/if}
            </div>
            <figcaption class="hint">
              原图
              {@render zoomButton("source", !fit.source)}
            </figcaption>
          </figure>
          <figure>
            <div class="frame" class:checkerboard={fit.canvas?.bgAlpha === 0}>
              {#if fit.canvas}<canvas bind:this={outCanvas} aria-label="拟合预览"></canvas>{:else}<span class="hint">尚未拟合</span>{/if}
            </div>
            <figcaption class="hint">
              {#if fit.canvas}
                拟合预览 <span class="preview-size"><Icon name="image" size={13} />{fit.canvas.width}×{fit.canvas.height}</span>
              {:else}
                拟合预览
              {/if}
              {@render zoomButton("fit", !fit.canvas)}
            </figcaption>
          </figure>
        </div>

        <div class="actions fit-actions">
          {#if fit.running}
            <button class="btn danger" onclick={stopFit} disabled={fit.stopping}><Icon name="close" />{fit.stopping ? "正在停止…" : "停止"}</button>
          {:else}
            <button class="btn accent" onclick={start} disabled={!canStart}><Icon name="refresh" />{fit.canvas ? "重新拟合" : "开始拟合"}</button>
          {/if}
          {#if fit.running || fit.canvas}
            <ul class="metrics hint status" aria-label="拟合状态">
              {#if fit.refining}
                {@render metric("refresh", `精修 ${fit.refining.pass} / ${fit.refining.passes} 轮 ${Math.round((fit.refining.index / fit.refining.total) * 100)}%`)}
              {/if}
              {@render metric("shapes", fit.running ? `${fit.done} / ${fit.goal} 个图元` : `共 ${fit.done} 个图元`)}
              {@render metric("target", `相似度 ${(similarityAt(fit.done) * 100).toFixed(2)}%`)}
              {@render metric("clock", `用时 ${(fit.elapsedMs / 1000).toFixed(1)} 秒`)}
              {#if fit.running}{@render metric("cpu", `${fit.threads} 线程`)}{/if}
            </ul>
          {:else if !fit.source}
            <span class="hint">先选择一张图片</span>
          {/if}
        </div>

        {#if fit.canvas}
          <div class="use">
            <label class="label" for="primfit-use">使用前</label>
            <input
              id="primfit-use"
              class="input use-num"
              type="number"
              min="0"
              max={fit.done}
              value={fit.use}
              onchange={(e) => {
                setUse(Number(e.currentTarget.value));
                e.currentTarget.value = String(fit.use);
              }}
            />
            <input
              class="slider"
              type="range"
              min="0"
              max={Math.max(1, fit.done)}
              aria-label="使用前几个图元"
              value={fit.use}
              oninput={(e) => setUse(Number(e.currentTarget.value))}
            />
          </div>
          <ul class="metrics selection-metrics hint status" aria-label="当前导出范围">
            {@render metric("layers", `控件 ${fit.use + 1} 个`)}
            {@render metric("doc", `${sizeKb} KB`)}
            {@render metric("target", `相似度 ${(similarityAt(fit.use) * 100).toFixed(2)}%`)}
          </ul>

          <ArtExportRow
            moduleId="primfit-module"
            moduleName={p.module}
            {moduleOk}
            onModuleNameChange={(value) => (p.module = value)}
            {canExport}
            onExport={exportLua}
            onCopyPrompt={copyPrompt}
            help={(exportFormat >= 2 ? `当前为 format=${exportFormat}，需要支持该格式的读取器。\n` : "") + "导出前 k 个图元。文件名即脚本映射名，放进 external_lua_file 后建立同名映射。\n「复制 Agent 提示词」可粘贴给 Agent 接入。"}
          />

        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .page-stack {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
    min-height: var(--ctl-h);
  }
  .file {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: var(--s3);
  }
  .kind-field { display: grid; gap: var(--s1); }
  .kind-options { display: flex; flex-wrap: wrap; gap: 0 var(--s4); }
  .matte-control { display: flex; align-items: center; gap: var(--s2); min-height: var(--ctl-h); }
  .color {
    width: 38px;
    height: var(--ctl-h);
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--surface);
    cursor: pointer;
  }
  .color:disabled { cursor: not-allowed; opacity: 0.6; }
  .metrics {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) 0;
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .metrics :global(.metric) { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .metrics :global(.metric + .metric) { margin-left: var(--s3); padding-left: var(--s3); border-left: 1px solid var(--border); }
  .metrics :global(svg) { flex: none; color: var(--text-3); }
  .fit-actions { gap: var(--s3) var(--s4); }
  .selection-metrics { padding: var(--s1) 0; }
  /* 预览下方说明行里的「放大预览」：比通用图标按钮矮一些，不把说明行撑高太多 */
  .zoom-btn { width: 28px; height: 28px; }
  .zoom-btn > :global(svg) { width: 18px; height: 18px; }
  .preview-size { display: inline-flex; align-items: center; gap: var(--s1); margin-left: var(--s2); font-variant-numeric: tabular-nums; }
  @media (max-width: 760px) {
    .fit-actions .metrics { flex-basis: 100%; }
  }
  .views {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s3);
  }
  figure {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s1);
    margin: 0;
    min-width: 0;
  }
  .frame {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1;
    max-height: 420px;
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--page);
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    max-width: 100%;
    max-height: 100%;
  }
  .frame {
    position: relative;
  }
  /* 叠在原图上的重点区域：与原图画布同尺寸，铺满整个框，object-fit 一致所以位置对齐 */
  canvas.mask-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .mask-field {
    grid-column: 1 / -1;
  }
  .mask-control {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
    min-height: var(--ctl-h);
  }
  .frame.checkerboard {
    background-color: var(--surface);
    background-image: conic-gradient(var(--border) 25%, transparent 0 50%, var(--border) 0 75%, transparent 0);
    background-size: 16px 16px;
  }
  .status {
    font-variant-numeric: tabular-nums;
  }
  .use {
    display: grid;
    grid-template-columns: auto 88px minmax(0, 1fr);
    align-items: center;
    gap: var(--s3);
  }
  .slider {
    accent-color: var(--theme);
    min-width: 0;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
</style>
