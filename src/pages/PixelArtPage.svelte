<script lang="ts">
  import { copyText, isTauri, saveText } from "../lib/files";
  import { DEFAULT_PIXEL_MODULE, generatePixelArt, pickPixelSource, pixelArt, recordPixelExport, setPixelModule, setPixelParams } from "../lib/pixelArt.svelte";
  import { agentPrompt } from "../model/agentPrompt";
  import { MAX_PIXEL_SIDE } from "../model/pixelArt";
  import { isModuleName } from "../model/primfit";
  import ArtExportRow from "../ui/ArtExportRow.svelte";
  import Icon from "../ui/Icon.svelte";
  import NumberField from "../ui/NumberField.svelte";
  import RadioGroup from "../ui/RadioGroup.svelte";

  let { toast }: { toast: (text: string, kind?: "success" | "info" | "error") => void } = $props();
  const { params } = pixelArt;
  const colors = [{ value: "exact", label: "原色" }, { value: "merge", label: "轻微合色", title: "只合并透明度相同的颜色，每个 RGB 通道最多变化 3。" }];
  let sourceUrl = $state("");
  let resultUrl = $state("");
  let saving = $state(false);
  let moduleOk = $derived(isModuleName(params.module));
  let luaBytes = $derived(pixelArt.result
    ? pixelArt.result.lua.bytes + (moduleOk ? params.module.length - DEFAULT_PIXEL_MODULE.length : 0)
    : 0);

  function pngUrl(bytes: Uint8Array<ArrayBuffer> | undefined, set: (url: string) => void) {
    const url = bytes ? URL.createObjectURL(new Blob([bytes], { type: "image/png" })) : "";
    set(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }

  $effect(() => pngUrl(pixelArt.source?.preview, (url) => { sourceUrl = url; }));
  $effect(() => pngUrl(pixelArt.result?.png, (url) => { resultUrl = url; }));

  async function report(action: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      toast(`${action}失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  async function generate() {
    await report("生成", async () => {
      if (await generatePixelArt()) toast("像素画已生成");
    });
  }

  async function exportPng() {
    const { result, source } = pixelArt;
    if (!result || !source || saving || pixelArt.busy) return;
    saving = true;
    try {
      await report("导出 PNG", async () => {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const directory = source.path.slice(0, -source.name.length);
        const path = await save({
          title: "导出像素画 PNG",
          defaultPath: `${directory}${source.name.replace(/\.[^.]+$/, "")}-pixel.png`,
          filters: [{ name: "PNG 图片", extensions: ["png"] }],
        });
        if (!path) return;
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        await writeFile(path, result.png);
        toast("已导出 PNG");
      });
    } finally {
      saving = false;
    }
  }

  async function exportLua() {
    const { result } = pixelArt;
    const module = params.module;
    if (!result || !moduleOk || saving || pixelArt.busy) return;
    saving = true;
    try {
      await report("导出 Lua", async () => {
        const name = `${module}.lua`;
        // 只有注释里的文件名随输入变动，矩形和压缩数据只在生成时编码一次。
        const text = result.lua.text.replace(`-- ${DEFAULT_PIXEL_MODULE}.lua`, `-- ${name}`);
        const saved = await saveText(text, name, {
          title: "导出像素画 Lua 模块",
          filterName: "Lua 脚本",
          extension: "lua",
          mime: "text/x-lua",
        });
        if (!saved) return;
        recordPixelExport(result, module, saved.name);
        toast(`已导出 ${saved.name}，请在千星沙箱建立同名脚本映射`);
      });
    } finally {
      saving = false;
    }
  }

  async function copyPrompt() {
    const { result, source, lastExport } = pixelArt;
    if (!result || !moduleOk || saving || pixelArt.busy) return;
    const filename = lastExport?.requested === params.module ? lastExport.filename : `${params.module}.lua`;
    await report("复制", async () => {
      await copyText(agentPrompt({
        module: filename.replace(/\.lua$/i, ""),
        art: result.art,
        source: source?.name,
        pixelArt: { filename, packed: result.lua.packed },
      }));
      toast("已复制 Agent 提示词");
    });
  }
</script>

<div class="page-stack">
  <section class="card setting enter">
    <h2 class="card-title">图片与参数</h2>
    <div class="setting-body">
      {#if !isTauri}
        <span class="hint">请在 Diapig Editor 桌面端生成像素画。</span>
      {:else}
        <div class="actions">
          <button class="btn" data-tip="支持 PNG、JPEG、WebP，原图单边最大 8192 px。" onclick={() => report("载入图片", pickPixelSource)} disabled={!!pixelArt.busy || saving}>
            <Icon name="import" />{pixelArt.busy === "loading" ? "载入图片…" : "选择图片"}
          </button>
          {#if pixelArt.source}
            <span class="filename" data-tip={pixelArt.source.path}>{pixelArt.source.name}</span>
            <span class="hint">{pixelArt.source.width} × {pixelArt.source.height} px</span>
          {/if}
        </div>
        <div class="parameter-row">
          <div class="field">
            <label class="label" for="pixel-art-width">宽度</label>
            <NumberField id="pixel-art-width" tip="宽高可分别修改。比例变化时，整张原图会拉伸至成品比例。" value={params.width} min={1} max={MAX_PIXEL_SIDE} suffix="px" disabled={pixelArt.busy === "loading"} onchange={(width) => setPixelParams({ width })} />
          </div>
          <div class="field">
            <label class="label" for="pixel-art-height">高度</label>
            <NumberField id="pixel-art-height" tip="宽高可分别修改。比例变化时，整张原图会拉伸至成品比例。" value={params.height} min={1} max={MAX_PIXEL_SIDE} suffix="px" disabled={pixelArt.busy === "loading"} onchange={(height) => setPixelParams({ height })} />
          </div>
          <div class="field colors">
            <span class="label" id="pixel-art-colors">颜色</span>
            <RadioGroup name="pixel-art-colors" ariaLabelledby="pixel-art-colors" options={pixelArt.busy === "loading" ? colors.map((color) => ({ ...color, disabled: true })) : colors} value={params.merge ? "merge" : "exact"} columns={2} onchange={(value) => setPixelParams({ merge: value === "merge" })} />
          </div>
        </div>
      {/if}
    </div>
  </section>

  {#if isTauri}
    <section class="card setting enter" style:--enter-delay="80ms">
      <h2 class="card-title">生成与导出</h2>
      <div class="setting-body">
        <div class="views">
          <figure>
            <div class="frame" class:checkerboard={!!sourceUrl}>
              {#if sourceUrl}<img src={sourceUrl} alt="原图" draggable="false" />{:else}<span class="hint">尚未选择图片</span>{/if}
            </div>
            <figcaption class="heading"><Icon name="image" size={15} />原图</figcaption>
          </figure>
          <figure>
            <div class="frame" class:checkerboard={!!resultUrl}>
              {#if resultUrl}<img class="pixelated" src={resultUrl} alt="像素画成品" draggable="false" />{:else}<span class="hint">{pixelArt.busy === "generating" ? "正在生成…" : "尚未生成"}</span>{/if}
            </div>
            <figcaption class="heading"><Icon name="grid" size={15} />像素画</figcaption>
          </figure>
        </div>

        <div class="actions separated" aria-live="polite">
          <button class="btn accent" onclick={generate} disabled={!pixelArt.source || !!pixelArt.busy || saving}>
            <Icon name="refresh" />{pixelArt.busy === "generating" ? "正在生成…" : "生成"}
          </button>
          {#if pixelArt.result}
            <ul class="metrics hint" aria-label="成品参数">
              <li class="heading"><Icon name="image" size={15} />{pixelArt.result.art.width / 2} × {pixelArt.result.art.height / 2} px</li>
              <li class="heading" data-tip="包含 1 个外层遮罩。"><Icon name="shapes" size={15} />{pixelArt.result.art.shapes.length + 1} 个控件</li>
              <li class="heading" data-tip={pixelArt.result.lua.packed ? "压缩 Lua 模块" : "字面量 Lua 模块"}><Icon name="file" size={15} />Lua {(luaBytes / 1024).toFixed(1)} KB</li>
            </ul>
          {/if}
        </div>

        <div class="separated">
          <ArtExportRow
            moduleId="pixel-art-module"
            moduleName={params.module}
            {moduleOk}
            onModuleNameChange={setPixelModule}
            canExport={!!pixelArt.result && moduleOk && !pixelArt.busy && !saving}
            onExport={exportLua}
            onCopyPrompt={copyPrompt}
            help="文件名即脚本映射名。可把 Lua 文件和提示词一起交给 Agent。"
          >
            {#snippet extraAction()}
              <button class="btn" disabled={!pixelArt.result || !!pixelArt.busy || saving} onclick={exportPng}><Icon name="image" />导出 PNG</button>
            {/snippet}
          </ArtExportRow>
        </div>
      </div>
    </section>
  {/if}
</div>

<style>
  .page-stack { display: grid; gap: var(--s3); }
  .heading { display: flex; align-items: center; gap: var(--s2); }
  .actions, .parameter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
  }
  .parameter-row { align-items: end; }
  .colors { min-width: 190px; }
  .filename { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .views { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s3); }
  figure { display: grid; justify-items: center; gap: var(--s2); margin: 0; }
  figcaption { color: var(--text-2); font-size: 13px; }
  .frame {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 4 / 3;
    max-height: 360px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--page);
  }
  .checkerboard {
    background-color: var(--surface);
    background-image: conic-gradient(var(--border) 25%, transparent 0 50%, var(--border) 0 75%, transparent 0);
    background-size: 16px 16px;
  }
  .frame img { display: block; width: 100%; height: 100%; min-height: 0; object-fit: contain; }
  .pixelated { image-rendering: pixelated; }
  .separated { border-top: 1px solid var(--border); padding-top: var(--s3); }
  .metrics { display: flex; flex-wrap: wrap; row-gap: var(--s2); margin: 0; padding: 0; list-style: none; }
  .metrics li { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .metrics li + li { margin-left: var(--s3); padding-left: var(--s3); border-left: 1px solid var(--border); }
</style>
