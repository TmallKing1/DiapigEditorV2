<script lang="ts">
  // 设置页主容器：每个设置类别一张横向卡片。
  // 「对话」：新节点、显示与修正、预览；「个性化」：主题色、字体设置、标题栏。
  import { isTauri } from "../lib/files";
  import { pickStructIds } from "../lib/structIdImport";
  import type { DefaultIds } from "../model/defaultIds";
  import {
    type AutoSaveWhen,
    type PreviewCanvas,
    type PreviewDevice,
    type PreviewKeyHint,
    type PreviewKind,
    type PreviewWindow,
    type DefaultIdKey,
    type TitleBarMode,
    type UiFontMode,
    PRODUCT_NAME,
    THEMES,
    customFontState,
    registerCustomFont,
    removeCustomFont,
    setContentFont,
    setSetting,
    setThemeColor,
    setTitleBar,
    setTitleText,
    setUiFontMode,
    setUiFonts,
    settings,
  } from "../lib/settings.svelte";
  import { toast } from "../lib/ui.svelte";
  import { joypad, startJoypadToggle } from "../lib/joypad.svelte";
  import { CANVAS_PRESETS, DEVICE_PRESETS, INTERVAL_RANGE, deviceFor } from "../model/prefs";
  import { OP_LABELS } from "../model/types";
  import Dropdown, { type DropdownOption } from "../ui/Dropdown.svelte";
  import FontPicker from "../ui/FontPicker.svelte";
  import FontStackInput from "../ui/FontStackInput.svelte";
  import Icon from "../ui/Icon.svelte";
  import NumberField from "../ui/NumberField.svelte";
  import RadioGroup, { type RadioOption } from "../ui/RadioGroup.svelte";
  import SizeInput from "../ui/SizeInput.svelte";
  import { tipOut } from "../ui/motion";

  /** 当前显示的设置页签：general（常规）/ personal（个性化） */
  let { tab = "personal" }: { tab?: string } = $props();

  // —— 常规：默认结构体 ID ——

  const ID_ROWS: { key: DefaultIdKey; label: string; from: keyof DefaultIds }[] = [
    { key: "idDialog", label: "对话", from: "dialog" },
    { key: "idNode", label: "对话节点", from: "node" },
    { key: "idBranch", label: "对话分支", from: "branch" },
    { key: "idBeginEnd", label: "对话起止设置", from: "beginEnd" },
    { key: "idChain", label: "任务链", from: "chain" },
    { key: "idTask", label: "任务", from: "task" },
  ];
  let importingIds = $state(false);

  /** 选一个对话或任务文件，把其中的结构体 ID 填进来（文件里为 0 或空的项不动） */
  async function importIds() {
    if (importingIds) return;
    importingIds = true;
    try {
      const source = await pickStructIds();
      if (!source) return;
      const rows = ID_ROWS.filter((r) => source.ids[r.from] !== undefined);
      for (const r of rows) setSetting(r.key, source.ids[r.from]!);
      if (rows.length) toast(`已从 ${source.name} 填入 ${rows.length} 个结构体 ID`);
      else toast(`${source.name} 里没有已填的结构体 ID`, "info");
    } finally {
      importingIds = false;
    }
  }

  // —— 对话：新节点 ——

  const OP_OPTIONS: DropdownOption[] = OP_LABELS.map((label, i) => ({ value: String(i), label }));

  // —— 对话：预览 ——

  /** 四种设备都可预览（2026-11-17 解禁触屏与手柄） */
  const ENABLED_DEVICES: PreviewDevice[] = ["pc", "touch", "console", "mobilePad"];

  const DEVICE_OPTIONS: RadioOption[] = [
    { value: "pc", label: "PC 键鼠" },
    { value: "touch", label: "移动触屏" },
    { value: "console", label: "主机手柄" },
    { value: "mobilePad", label: "移动端手柄" },
    { value: "custom", label: "自定义", title: "自行设置下面各项" },
  ];
  const KEY_HINT_OPTIONS: RadioOption[] = [
    { value: "none", label: "无" },
    { value: "kbm", label: "键鼠" },
    { value: "pad", label: "手柄" },
  ];
  const CANVAS_OPTIONS: DropdownOption[] = [
    ...CANVAS_PRESETS.map((c) => ({ value: c, label: c.replace("x", "×") })),
    { value: "custom", label: "自定义" },
  ];
  const WINDOW_OPTIONS: DropdownOption[] = [
    { value: "canvas", label: "跟随逻辑画布大小窗口" },
    { value: "fullscreen", label: "全屏无边框窗口" },
    { value: "custom", label: "自定大小窗口" },
  ];
  const KIND_OPTIONS: RadioOption[] = [
    { value: "ask", label: "每次询问" },
    { value: "locked", label: "锁定对话" },
    { value: "nonlocked", label: "非锁定对话" },
    { value: "black", label: "黑屏文字" },
  ];

  /** 选设备：同步改按键提示与逻辑画布；选「自定义」不动其他项 */
  function pickDevice(d: string) {
    const device = d as PreviewDevice;
    setSetting("previewDevice", device);
    if (device === "custom") return;
    setSetting("previewKeyHint", DEVICE_PRESETS[device].keyHint);
    setSetting("previewCanvas", DEVICE_PRESETS[device].canvas);
  }

  /** 手动改了按键提示或画布后：正好是某个设备的预设就选中它，否则选「自定义」 */
  function syncDevice() {
    const s = settings;
    setSetting("previewDevice", deviceFor(s.previewKeyHint, s.previewCanvas, s.previewCanvasW, s.previewCanvasH, ENABLED_DEVICES));
  }

  // —— 常规：自动保存 ——

  const WHEN_OPTIONS: DropdownOption[] = [
    { value: "step", label: "每步操作时" },
    { value: "commit", label: "提交改动时" },
    { value: "interval", label: "固定间隔" },
  ];

  // —— 个性化：主题色 ——

  const THEME_OPTIONS: RadioOption[] = THEMES.map((t) => ({ value: t.id, label: t.label, color: t.color }));

  // —— 个性化：字体设置 ——

  let registering = $state(false);

  async function addFont() {
    if (registering) return;
    registering = true;
    try {
      const { font, existing } = await registerCustomFont();
      if (font) toast(`已注册字体「${font.family}」`);
      else if (existing) toast(`该字体文件已注册为「${existing.family}」`, "info");
    } catch (e) {
      toast(`注册字体失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      registering = false;
    }
  }

  function dropFont(family: string) {
    const used = settings.uiFonts.includes(family) || [settings.contentFont, settings.previewFont, settings.richPreviewFont].includes(family);
    removeCustomFont(family);
    toast(used ? `已移除字体「${family}」，用到它的设置已改回默认` : `已移除字体「${family}」`, "info");
  }

  /** 界面字体的两种方式：单选卡片的标题、说明与说明标记 */
  const UI_FONT_MODES: { value: UiFontMode; label: string; desc: string }[] = [
    { value: "default", label: "系统默认", desc: "微软雅黑 UI → Segoe UI → PingFang SC → 系统界面字体" },
    {
      value: "custom",
      label: "自定义",
      desc: "自定义字体搭配和顺序，支持 CSS 字体回退机制",
    },
  ];

  const TITLE_MODES: RadioOption[] = [
    { value: "none", label: "无" },
    { value: "default", label: "默认", title: `显示 ${PRODUCT_NAME}` },
    { value: "custom", label: "自定文本" },
  ];
</script>

<div class="settings" class:dialog={tab === "dialog"} class:general={tab === "general"}>
  {#if tab === "general"}
    <section class="card setting enter">
      <h2 class="card-title">启动</h2>
      <div class="setting-body">
        <div class="row">
          <label class="check">
            <input type="checkbox" checked={settings.reopenLast} onchange={(e) => setSetting("reopenLast", e.currentTarget.checked)} />自动打开上次关闭时的文件
          </label>
        </div>
      </div>
    </section>

    <section class="card setting enter" style:--enter-delay="40ms">
      <h2 class="card-title">默认结构体 ID</h2>
      <div class="setting-body">
        {#each ID_ROWS as r (r.key)}
          <div class="row">
            <label class="name" for="def-{r.key}">{r.label}</label>
            <div class="control">
              <input
                id="def-{r.key}"
                data-tip="新建文件时使用的结构体 ID。留空沿用当前文件。"
                class="input grow-input"
                inputmode="numeric"
                placeholder="沿用当前文件"
                value={settings[r.key]}
                onchange={(e) => setSetting(r.key, e.currentTarget.value.trim())}
              />
            </div>
          </div>
        {/each}
        <div class="row">
          <button class="btn" data-tip="从对话或任务文件读取结构体 ID" onclick={importIds} disabled={importingIds}>
            <Icon name="import" />从文件导入
          </button>
        </div>
      </div>
    </section>

    <section class="card setting enter" style:--enter-delay="80ms">
      <h2 class="card-title">自动保存</h2>
      <div class="setting-body">
        <div class="row">
          <label class="check">
            <input type="checkbox" checked={settings.saveOnClose} onchange={(e) => setSetting("saveOnClose", e.currentTarget.checked)} />关闭应用时自动保存
          </label>
        </div>
        <div class="row">
          <label class="check">
            <input type="checkbox" checked={settings.autoSave} onchange={(e) => setSetting("autoSave", e.currentTarget.checked)} />编辑过程中自动保存
          </label>
        </div>
        <!-- 开启时向下展开「自动保存时机」 -->
        <div class="expand" class:open={settings.autoSave} inert={!settings.autoSave}>
          <div class="clip">
            <div class="row">
              <label class="name" for="auto-save-when">自动保存时机</label>
              <div class="control wrap">
                <div class="grow">
                  <Dropdown id="auto-save-when" options={WHEN_OPTIONS} value={settings.autoSaveWhen} onchange={(v) => setSetting("autoSaveWhen", v as AutoSaveWhen)} />
                </div>
                <div class="side" class:open={settings.autoSaveWhen === "interval"} inert={settings.autoSaveWhen !== "interval"}>
                  <div class="clip-x">
                    <NumberField
                      id="auto-save-interval"
                      value={settings.autoSaveInterval}
                      min={INTERVAL_RANGE.min}
                      max={INTERVAL_RANGE.max}
                      suffix="秒"
                      ariaLabel="自动保存间隔（秒）"
                      onchange={(v) => setSetting("autoSaveInterval", v)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  {:else if tab === "dialog"}
    <section class="card setting enter">
      <h2 class="card-title">新节点</h2>
      <div class="setting-body">
        <div class="row">
          <label class="check">
            <input type="checkbox" checked={settings.newNodeInheritTitle} onchange={(e) => setSetting("newNodeInheritTitle", e.currentTarget.checked)} />新节点继承标题
          </label>
        </div>
        <div class="expand" class:open={!settings.newNodeInheritTitle} inert={settings.newNodeInheritTitle}>
          <div class="clip title-rows">
            <div class="row">
              <label class="name" for="new-title">新节点默认标题</label>
              <div class="control">
                <input
                  id="new-title"
                  class="input"
                  maxlength="200"
                  placeholder="（无标题）"
                  value={settings.newNodeTitle}
                  oninput={(e) => setSetting("newNodeTitle", e.currentTarget.value)}
                />
              </div>
            </div>
            <div class="row">
              <label class="name" for="new-subtitle">新节点默认副标题</label>
              <div class="control">
                <input
                  id="new-subtitle"
                  class="input"
                  maxlength="200"
                  placeholder="（无副标题）"
                  value={settings.newNodeSubtitle}
                  oninput={(e) => setSetting("newNodeSubtitle", e.currentTarget.value)}
                />
              </div>
            </div>
          </div>
        </div>
        <div class="row">
          <label class="name" for="new-content">新节点默认内容</label>
          <div class="control">
            <input
              id="new-content"
              class="input"
              maxlength="2000"
              placeholder="（无内容）"
              value={settings.newNodeContent}
              oninput={(e) => setSetting("newNodeContent", e.currentTarget.value)}
            />
          </div>
        </div>
        <div class="row">
          <label class="name" for="new-op">新节点默认操作类型</label>
          <div class="control">
            <Dropdown id="new-op" options={OP_OPTIONS} value={String(settings.newNodeOp)} onchange={(v) => setSetting("newNodeOp", Number(v))} />
          </div>
        </div>
      </div>
    </section>

    <section class="card setting enter" style:--enter-delay="40ms">
      <h2 class="card-title">显示与修正</h2>
      <div class="setting-body">
        <div class="row">
          <label class="name" for="content-font">对话内容预览字体</label>
          <div class="control">
            <FontPicker
              id="content-font"
              value={settings.contentFont}
              onchange={setContentFont}
              followLabel="跟随界面字体"
              tip="节点内容的显示字体，只影响本机显示。"
            />
          </div>
        </div>
        <div class="row">
          <label class="check" data-tip="末尾节点为「跳转下个节点」时，按「结束对话」导出。">
            <input type="checkbox" checked={settings.autoEnd} onchange={(e) => setSetting("autoEnd", e.currentTarget.checked)} />自动处理末尾结束
          </label>
        </div>
      </div>
    </section>

    <section class="card setting enter" style:--enter-delay="80ms">
      <h2 class="card-title">预览</h2>
      <div class="setting-body">
        <div class="row">
          <span class="name" id="device-label">设备预设</span>
          <div class="control">
            <RadioGroup name="preview-device" ariaLabelledby="device-label" options={DEVICE_OPTIONS} value={settings.previewDevice} onchange={pickDevice} />
          </div>
        </div>
        <div class="row">
          <span class="name" id="key-hint-label">按键提示</span>
          <div class="control">
            <RadioGroup
              name="preview-key-hint"
              ariaLabelledby="key-hint-label"
              options={KEY_HINT_OPTIONS}
              value={settings.previewKeyHint}
              onchange={(v) => {
                setSetting("previewKeyHint", v as PreviewKeyHint);
                syncDevice();
              }}
            />
          </div>
        </div>
        <div class="row">
          <label class="name" for="preview-canvas">逻辑画布大小</label>
          <div class="control wrap">
            <div class="grow">
              <Dropdown
                id="preview-canvas"
                options={CANVAS_OPTIONS}
                value={settings.previewCanvas}
                onchange={(v) => {
                  setSetting("previewCanvas", v as PreviewCanvas);
                  syncDevice();
                }}
              />
            </div>
            <!-- 选「自定义」时从右侧展开尺寸输入框，把下拉框向左挤 -->
            <div class="side" class:open={settings.previewCanvas === "custom"} inert={settings.previewCanvas !== "custom"}>
              <div class="clip-x">
                <SizeInput
                  id="canvas-size"
                  label="逻辑画布"
                  w={settings.previewCanvasW}
                  h={settings.previewCanvasH}
                  onchange={(w, h) => {
                    setSetting("previewCanvasW", w);
                    setSetting("previewCanvasH", h);
                    syncDevice();
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <div class="row">
          <label class="name" for="preview-font">预览字体</label>
          <div class="control">
            <FontPicker
              id="preview-font"
              value={settings.previewFont}
              onchange={(v) => setSetting("previewFont", v)}
              followLabel="跟随界面字体"
              tip="对话预览使用的字体。"
            />
          </div>
        </div>
        <div class="row">
          <label class="name" for="preview-window">窗口模式</label>
          <div class="control wrap">
            <div class="grow">
              <Dropdown id="preview-window" options={WINDOW_OPTIONS} value={settings.previewWindow} onchange={(v) => setSetting("previewWindow", v as PreviewWindow)} />
            </div>
            <div class="side" class:open={settings.previewWindow === "custom"} inert={settings.previewWindow !== "custom"}>
              <div class="clip-x">
                <SizeInput
                  id="window-size"
                  label="预览窗口"
                  w={settings.previewWindowW}
                  h={settings.previewWindowH}
                  onchange={(w, h) => {
                    setSetting("previewWindowW", w);
                    setSetting("previewWindowH", h);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <div class="row">
          <span class="name" id="kind-label">预览对话类型</span>
          <div class="control">
            <RadioGroup
              name="preview-kind"
              ariaLabelledby="kind-label"
              options={KIND_OPTIONS}
              value={settings.previewKind}
              onchange={(v) => setSetting("previewKind", v as PreviewKind)}
            />
          </div>
        </div>
      </div>
    </section>
  {:else if tab === "advanced"}
    <section class="card setting enter">
      <h2 class="card-title">原神输入设备切换</h2>
      <div class="setting-body">
        <div class="row">
          <button class="btn" disabled={!isTauri || joypad.busy || joypad.prompting || joypad.disclaimer}
            data-tip={isTauri ? undefined : "仅桌面版可用"} onclick={startJoypadToggle}>切换输入设备</button>
        </div>
      </div>
    </section>
    <section class="card setting enter">
      <h2 class="card-title">调试选项</h2>
      <div class="setting-body">
        <div class="row">
          <label class="check" data-tip="用输入框填写路径，代替系统文件选择器。">
            <input type="checkbox" checked={settings.manualPaths} onchange={(e) => setSetting("manualPaths", e.currentTarget.checked)} />手动输入文件路径
          </label>
        </div>
      </div>
    </section>
  {:else}
    <section class="card setting enter">
      <h2 class="card-title">主题色</h2>
      <div class="setting-body">
        <div class="row">
          <RadioGroup name="theme-color" ariaLabel="主题色" columns={4} options={THEME_OPTIONS} value={settings.themeColor} onchange={setThemeColor} />
        </div>
      </div>
    </section>

    <section class="card setting enter" style:--enter-delay="40ms">
      <h2 class="card-title">字体设置</h2>
      <div class="setting-body">
        <div class="row top">
          <span class="name" id="ui-font-label">界面字体</span>
          <div class="font-modes" role="radiogroup" aria-labelledby="ui-font-label">
            {#each UI_FONT_MODES as m (m.value)}
              {@const on = settings.uiFontMode === m.value}
              <div class="mode" class:on>
                <div class="mode-head">
                  <label class="check mode-label">
                    <input type="radio" name="ui-font-mode" value={m.value} checked={on} onchange={() => setUiFontMode(m.value)} />
                    <span class="mode-text">
                      <span class="mode-title">{m.label}</span>
                      <span class="mode-desc">{m.desc}</span>
                    </span>
                  </label>
                </div>
                {#if m.value === "custom"}
                  <!-- 选中「自定义」时向下展开字体列表 -->
                  <div class="expand" class:open={on} inert={!on}>
                    <div class="clip">
                      <div class="mode-body">
                        <FontStackInput id="ui-fonts" ariaLabel="添加界面字体" value={settings.uiFonts} onchange={setUiFonts} />
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
        {#if settings.customFonts.length}
          <ul class="fonts" aria-label="自定义字体">
            {#each settings.customFonts as f (f.family)}
              {@const st = customFontState[f.family]}
              {@const bad = st?.status === "error"}
              <li class="font enter" out:tipOut>
                <span class="font-icon" class:bad data-tip={bad ? st?.message : undefined}><Icon name={bad ? "warn" : "type"} size={26} /></span>
                <span class="font-text">
                  <span class="font-name">
                    <span class="family" style:font-family={bad ? undefined : `"${f.family.replaceAll('"', '\\"')}", var(--font-default)`}>{f.family}</span>
                    {#if bad}<span class="badge bad-badge" data-tip={f.path}>{st?.message}</span>{/if}
                  </span>
                  <span class="font-path" data-tip={f.path}>{f.path}</span>
                </span>
                <button class="icon-btn danger remove" data-tip="移除（不删除字体文件）" aria-label="移除字体 {f.family}" onclick={() => dropFont(f.family)}>
                  <Icon name="trash" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="row">
          <button class="btn" disabled={!isTauri || registering} data-tip={isTauri ? "选择 TTF / OTF / WOFF / WOFF2 / TTC 字体文件" : "仅桌面版可用"} onclick={addFont}>
            <Icon name="plus" />注册自定义字体
          </button>
        </div>
      </div>
    </section>

    <section class="card setting enter" style:--enter-delay="80ms">
      <h2 class="card-title">标题栏</h2>
      <div class="setting-body">
        <div class="row">
          <!-- 三个选项均分卡片内宽，各自在格内左对齐 -->
          <RadioGroup name="title-bar" ariaLabel="标题栏" columns={3} options={TITLE_MODES} value={settings.titleBar} onchange={(v) => setTitleBar(v as TitleBarMode)} />
        </div>
        <!-- 选「自定文本」时向下展开文本框 -->
        <div class="expand" class:open={settings.titleBar === "custom"} inert={settings.titleBar !== "custom"}>
          <div class="clip">
            <div class="row">
              <label class="name" for="title-text">标题栏文本</label>
              <div class="control">
                <input
                  id="title-text"
                  class="input"
                  maxlength="40"
                  placeholder={PRODUCT_NAME}
                  value={settings.titleText}
                  oninput={(e) => setTitleText(e.currentTarget.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  {/if}
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    /* 设置项名称列宽：个性化的名称最多 5 个字；对话页最长的「新节点默认操作类型」9 个字 */
    --name-w: 72px;
  }
  .settings.dialog {
    --name-w: 9.5em;
  }
  /* 常规页最长的名称「对话起止设置」「自动保存时机」6 个字 */
  .settings.general {
    --name-w: 6.5em;
  }
  .grow-input {
    flex: 1;
    min-width: 0;
  }
  .card-title:has(> :global(.tip)) {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  /* 卡片样式见 app.css 的 .setting / .setting-body。左：设置项名称（定宽，同页各项的控件左边界对齐）；右：控件一直延伸到卡片右内边距 */
  .row {
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-width: 0;
  }
  /* 复选框行：说明标记紧跟在文字后面 */
  .row > .check + :global(.tip) {
    margin-left: calc(-1 * var(--s2));
  }
  .row.top {
    align-items: flex-start;
  }
  .row.top > .name {
    padding-top: 13px;
  }
  /* —— 界面字体：两张单选卡片，「自定义」选中时在卡内展开字体列表 —— */
  .font-modes {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .mode {
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    transition:
      border-color var(--t-hover-out) var(--ease-out),
      box-shadow var(--t-hover-out) var(--ease-out);
  }
  .mode:hover {
    border-color: var(--theme-bright);
    transition-duration: var(--t-hover-in);
  }
  .mode.on {
    border-color: var(--theme);
    box-shadow: 0 0 0 1px var(--theme);
  }
  .mode-head {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding-right: var(--s3);
  }
  .mode-label {
    flex: 1;
    min-width: 0;
    align-items: flex-start;
    gap: var(--s3);
    padding: var(--s2) 0 var(--s2) var(--s3);
    cursor: pointer;
  }
  .mode-label > input {
    flex: none;
    margin-top: 3px;
  }
  .mode-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .mode-title {
    font-weight: 600;
  }
  .mode-desc {
    color: var(--text-2);
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 卡片未选中时标题不随悬停变色：悬停反馈由卡片边框给出 */
  .mode-label:hover .mode-desc {
    color: var(--text-2);
  }
  .mode-body {
    display: flex;
    padding: 0 var(--s3) var(--s3) calc(var(--s3) + 16px + var(--s3));
  }
  .mode .expand {
    margin-top: 0;
  }
  .name {
    flex: none;
    width: var(--name-w);
    color: var(--text-2);
    white-space: nowrap;
  }
  .control {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s3);
  }
  /* 下拉框 + 按需出现的输入框：一行放不下时输入框换到下一行，不溢出 */
  .control.wrap {
    flex-wrap: wrap;
    row-gap: var(--s2);
  }
  .grow {
    flex: 1 1 160px;
    min-width: 0;
    display: flex;
  }
  /* 向右展开：宽度从 0 过渡到内容宽度，把下拉框向左挤；收起时连同左侧间距一起收回 */
  .side {
    flex: none;
    display: grid;
    grid-template-columns: 0fr;
    margin-left: calc(-1 * var(--s3));
    opacity: 0;
    transition:
      grid-template-columns var(--t-release) var(--ease-out),
      margin-left var(--t-release) var(--ease-out),
      opacity 150ms var(--ease-out);
  }
  .side.open {
    grid-template-columns: 1fr;
    margin-left: 0;
    opacity: 1;
  }
  .clip-x {
    min-width: 0;
    overflow: hidden;
    /* 给输入框的焦点描边留出位置 */
    margin: -4px;
    padding: 4px;
    white-space: nowrap;
  }
  /* 展开：高度从 0 过渡到内容高度；收起时连同上方的行间距一起收回 */
  .expand {
    display: grid;
    grid-template-rows: 0fr;
    margin-top: calc(-1 * var(--s3));
    opacity: 0;
    transition:
      grid-template-rows var(--t-release) var(--ease-out),
      margin-top var(--t-release) var(--ease-out),
      opacity 150ms var(--ease-out);
  }
  .expand.open {
    grid-template-rows: 1fr;
    margin-top: 0;
    opacity: 1;
  }
  .clip {
    min-height: 0;
    overflow: hidden;
    /* 给输入框的焦点描边留出位置 */
    margin: -4px;
    padding: 4px;
  }
  .title-rows {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }

  /* —— 自定义字体列表：左大图标（两行字高）+ 名称 + 灰色路径；悬停时右侧出现移除按钮 —— */
  .fonts {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .font {
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-height: 52px;
    padding: var(--s1) var(--s1) var(--s1) var(--s2);
    border-radius: var(--r-card);
    transition: background-color var(--t-hover-out) var(--ease-out);
  }
  .font:hover,
  .font:focus-within {
    background: var(--tint-bg);
    transition-duration: var(--t-hover-in);
  }
  .font-icon {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--theme);
  }
  .font-icon.bad {
    color: var(--danger);
  }
  .font-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .font-name {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-width: 0;
  }
  .family {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bad-badge {
    flex: none;
    background: var(--danger-bg);
    color: var(--danger);
  }
  .font-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-3);
    font-size: 12.5px;
  }
  .remove {
    opacity: 0;
    transition:
      opacity var(--t-hover-out) var(--ease-out),
      color var(--t-hover-out) var(--ease-out);
  }
  .font:hover .remove,
  .font:focus-within .remove {
    opacity: 1;
    transition-duration: var(--t-hover-in);
  }

  @media (prefers-reduced-motion: reduce) {
    .expand,
    .side {
      transition: none;
    }
  }
</style>
