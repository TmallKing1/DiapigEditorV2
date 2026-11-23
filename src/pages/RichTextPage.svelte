<script lang="ts" module>
  // 跨页签切换保留：草稿与撤销记录放在模块级变量，草稿另存 localStorage
  import { newHistory } from "../ui/RichEditor.svelte";
  import { DEFAULTS, setSetting } from "../lib/settings.svelte";

  const KEY_SOURCE = "diapig.richtext.source";
  const KEY_DARK = "diapig.richtext.dark";

  function read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function write(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 存不下或被禁用：只影响下次打开时的草稿
    }
  }

  const history = newHistory();
  let lastSource = read(KEY_SOURCE) ?? "";

  /**
   * 「重置」页面：清空草稿与撤销记录、关掉深色背景、预览字体回到「跟随界面字体」。
   * 页面可能没挂载，只动模块状态；App 重置后会重新挂载本页，组件从这里读到初始值。
   */
  export function resetRichText() {
    lastSource = "";
    // 撤销记录是传给编辑器的同一个对象，原地清空
    history.undo.length = 0;
    history.redo.length = 0;
    history.last = undefined;
    for (const key of [KEY_SOURCE, KEY_DARK]) {
      try {
        localStorage.removeItem(key);
      } catch {
        // 忽略：内存里的状态已经清掉
      }
    }
    setSetting("richPreviewFont", DEFAULTS.richPreviewFont);
  }
</script>

<script lang="ts">
  // 富文本编辑：上方为可直接编辑的预览（RichEditor），下方为字符串源码；两边任意一边修改，另一边实时更新。
  import { copyText } from "../lib/files";
  import { fontCss, settings } from "../lib/settings.svelte";
  import { parseRichText, visibleLength } from "../model/richtext";
  import FontPicker from "../ui/FontPicker.svelte";
  import Icon from "../ui/Icon.svelte";
  import RichEditor from "../ui/RichEditor.svelte";

  let { toast }: { toast: (text: string, kind?: "success" | "info" | "error") => void } = $props();

  let source = $state(lastSource);
  let dark = $state(read(KEY_DARK) === "1");
  let editor: RichEditor;
  let ta: HTMLTextAreaElement;

  /** 预览里文字用的字体；空串跟随界面字体。只作用于预览区，工具栏和源码框不变 */
  let previewFont = $derived(fontCss(settings.richPreviewFont));

  let warnings = $derived(parseRichText(source).warnings);
  let count = $derived(visibleLength(source));

  function setSource(v: string) {
    source = v;
    lastSource = v;
    write(KEY_SOURCE, v);
  }

  // —— 源码框 ——
  function onSourceInput() {
    let v = ta.value;
    if (/\r?\n/.test(v)) {
      // 源码里的真实换行统一写成字面量 \n
      const caret = ta.selectionStart;
      const before = v.slice(0, caret).replace(/\r?\n/g, "\\n");
      v = before + v.slice(caret).replace(/\r?\n/g, "\\n");
      ta.value = v;
      ta.setSelectionRange(before.length, before.length);
    }
    setSource(v);
  }

  function onSourceKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && (key === "z" || key === "y")) {
      e.preventDefault();
      if (key === "y" || e.shiftKey) editor.redo();
      else editor.undo();
    }
  }

  function clearAll() {
    setSource("");
  }

  async function copySource() {
    try {
      await copyText(source);
      toast("已复制源码", "success");
    } catch (err) {
      toast(`复制失败：${String(err)}`, "error");
    }
  }
</script>

<div class="page-stack">
  <section class="card setting enter">
    <h2 class="card-title">预览</h2>
    <div class="setting-body preview-font" style:--font-content={previewFont}>
    <RichEditor bind:this={editor} value={source} onchange={setSource} {history} {dark} ariaLabel="富文本预览">
      {#snippet extra()}
        <span class="hint">{count} 字</span>
        <span class="sep"></span>
        <label class="small" for="richtext-font">字体</label>
        <div class="font-pick">
          <FontPicker
            id="richtext-font"
            value={settings.richPreviewFont}
            onchange={(v) => setSetting("richPreviewFont", v)}
            followLabel="跟随界面字体"
            tip="预览使用的字体，不写进源码。"
          />
        </div>
        <span class="sep"></span>
        <label class="check small">
          <input type="checkbox" bind:checked={dark} onchange={() => write(KEY_DARK, dark ? "1" : "0")} />
          深色背景
        </label>
      {/snippet}
    </RichEditor>
    </div>
  </section>

  <section class="card setting enter" style:--enter-delay="40ms">
    <h2 class="card-title">源码</h2>
    <div class="setting-body">
    <textarea
      bind:this={ta}
      class="textarea mono"
      rows="5"
      spellcheck="false"
      aria-label="源码"
      data-tip={"支持 <b>、<i>、<color=#RRGGBB(AA)> 与 \\n 换行，可嵌套。"}
      value={source}
      oninput={onSourceInput}
      onkeydown={onSourceKeydown}
    ></textarea>
    {#each warnings as w}
      <span class="hint warn"><Icon name="warn" size={12} /> {w}</span>
    {/each}
    <div class="actions">
      <span class="hint">支持 b、i、color 标签与 \n 换行</span>
      <span class="grow"></span>
      <button class="btn" onclick={clearAll} disabled={!source}><Icon name="trash" />清空</button>
      <button class="btn accent" onclick={copySource} disabled={!source}><Icon name="copy" />复制源码</button>
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
  .actions {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .grow {
    flex: 1;
  }
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 var(--s1);
    background: var(--border);
  }
  .small {
    min-height: 0;
    font-size: 12.5px;
    color: var(--text-2);
  }
  /* 与工具栏按钮同高；字体名可能很长，固定宽度，超出由下拉框自己截断 */
  .font-pick {
    width: 200px;
    min-width: 0;
  }
  /* 预览字体：RichEditor 会改成读 --font-content；这里再直接给编辑区设一次，
     只设在编辑区上而不是整个容器，工具栏（按钮、下拉框、标签）保持界面字体 */
  .preview-font :global(.editor) {
    font-family: var(--font-content);
  }
  .mono {
    font-family: "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace;
    font-size: 13px;
  }
  textarea.mono {
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
</style>
