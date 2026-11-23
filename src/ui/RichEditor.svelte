<script lang="ts" module>
  // 画笔颜色在所有富文本编辑器之间共用并跨会话保存
  const KEY_COLOR = "diapig.richtext.color";

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
      // 存不下或被禁用：只影响下次打开时的默认颜色
    }
  }

  interface Snapshot {
    source: string;
    sel: { start: number; end: number };
  }
  /** 撤销记录；调用方可传入模块级对象，让记录在组件重建后保留 */
  export interface RichHistory {
    undo: Snapshot[];
    redo: Snapshot[];
    /** 编辑器最后一次知道的源码；重建时与 value 不同说明期间被外部改过（如源码模式），记一步撤销 */
    last?: string;
  }
  /** initial：编辑开始时的源码（编辑器可能晚于源码框创建时，用它作撤销起点） */
  export const newHistory = (initial?: string): RichHistory => ({ undo: [], redo: [], last: initial });
</script>

<script lang="ts">
  // 类 Word 的富文本编辑框：工具栏 + 可直接编辑的预览。值为字符串源码（<b> <i> <color> 与字面量 \n）。
  // 预览的 DOM 不交给 Svelte 管理：浏览器直接改动 DOM 后读回纯文本，与模型比对出插入 / 删除，
  // 样式由模型决定（新输入的文字沿用前一个字符的样式），再整体重绘并恢复光标。
  // 外部改动 value（如源码框）时整体重绘；预览里的改动按规范格式重新生成源码后经 onchange 交回。
  import { onMount, type Snippet, untrack } from "svelte";
  import {
    PLAIN,
    PLAYER_CHAR,
    type RichDoc,
    type Style,
    diffApply,
    every,
    fromSource,
    mapStyles,
    normalizeColor,
    plainDoc,
    replaceRange,
    sameStyle,
    sliceDoc,
    styleAt,
    toSource,
  } from "../model/richdoc";
  import Icon from "./Icon.svelte";

  let {
    value,
    onchange,
    history = newHistory(),
    id,
    ariaLabel = "富文本编辑",
    placeholder = "在这里输入文字，框选后可加粗、斜体或上色",
    dark = false,
    minHeight = 140,
    extra,
  }: {
    value: string;
    onchange: (source: string) => void;
    history?: RichHistory;
    id?: string;
    ariaLabel?: string;
    placeholder?: string;
    dark?: boolean;
    minHeight?: number;
    /** 工具栏右侧的附加内容 */
    extra?: Snippet;
  } = $props();

  type Range = { start: number; end: number };

  const SWATCHES = ["#FFFFFF", "#FFD86E", "#FF9F40", "#E85A4F", "#F07AB4", "#B48CF0", "#58B4F0", "#7ED07A", "#1A8BCC", "#A0A0A0"];
  const TYPE_MERGE_MS = 800;

  let source = untrack(() => value);
  untrack(() => {
    const h = history;
    if (h.last !== undefined && h.last !== source) {
      const end = fromSource(h.last).text.length;
      h.undo.push({ source: h.last, sel: { start: end, end } });
      h.redo = [];
    }
    h.last = source;
  });
  let doc: RichDoc = fromSource(source);
  let ed: HTMLDivElement;
  let composing = false;
  /** 光标处待用样式：未选中文字时按 B / I / 颜色，作用于接下来输入的文字 */
  let pending = $state<Style | null>(null);
  let pendingAt = -1;
  /** 预览里最近一次的选区（焦点离开预览后，工具栏命令仍作用于它） */
  let lastSel = $state<Range>({ start: doc.text.length, end: doc.text.length });
  let version = $state(0);
  let lastKind = "";
  let lastAt = 0;

  let brush = $state(normalizeColor(read(KEY_COLOR) ?? "") ?? "#1A8BCC");
  let colorOpen = $state(false);
  let hexInput = $state("");
  let hexBad = $state(false);

  // —— 工具栏状态：选中范围全部满足才算激活；光标时看待用样式或前一个字符 ——
  let caretStyle = $derived.by(() => {
    void version;
    return pending ?? styleAt(doc, lastSel.start);
  });
  let isBold = $derived.by(() => {
    void version;
    return lastSel.start === lastSel.end ? caretStyle.b : every(doc, lastSel.start, lastSel.end, (s) => s.b);
  });
  let isItalic = $derived.by(() => {
    void version;
    return lastSel.start === lastSel.end ? caretStyle.i : every(doc, lastSel.start, lastSel.end, (s) => s.i);
  });

  // —— 预览 DOM：渲染、读回、选区换算 ——
  /** 预览里的一个单位：文字节点、换行（br）或玩家名块（pn，占 1 个字符） */
  type Unit = { node: Node; start: number; len: number; br: boolean; pn?: boolean };
  const atomic = (u: Unit) => u.br || !!u.pn;

  function render() {
    const frag = document.createDocumentFragment();
    const t = doc.text;
    let k = 0;
    while (k < t.length) {
      if (t[k] === PLAYER_CHAR) {
        // 玩家名：不可编辑的整块，跟随所在位置的样式
        const st = doc.styles[k];
        const chip = document.createElement("span");
        chip.className = "pn";
        chip.dataset.pn = "";
        chip.contentEditable = "false";
        chip.title = "<PLAYER_NAME>：游戏中显示为玩家名";
        if (st.b) chip.classList.add("b");
        if (st.i) chip.classList.add("i");
        if (st.c) chip.style.color = st.c;
        chip.textContent = "玩家名";
        frag.append(chip);
        k++;
        continue;
      }
      if (t[k] === "\n") {
        const br = document.createElement("br");
        br.dataset.nl = "";
        frag.append(br);
        k++;
        continue;
      }
      const st = doc.styles[k];
      let end = k + 1;
      while (end < t.length && t[end] !== "\n" && t[end] !== PLAYER_CHAR && sameStyle(doc.styles[end], st)) end++;
      const span = document.createElement("span");
      if (st.b) span.classList.add("b");
      if (st.i) span.classList.add("i");
      if (st.c) span.style.color = st.c;
      span.textContent = t.slice(k, end);
      frag.append(span);
      k = end;
    }
    // 末尾是换行或玩家名时补一个占位 <br>，否则最后放不下光标
    if (t.endsWith("\n") || t.endsWith(PLAYER_CHAR)) frag.append(document.createElement("br"));
    ed.replaceChildren(frag);
  }

  function units(): Unit[] {
    const out: Unit[] = [];
    let pos = 0;
    const walk = (n: Node) => {
      for (const c of n.childNodes) {
        if (c.nodeType === Node.TEXT_NODE) {
          const len = (c as Text).data.length;
          out.push({ node: c, start: pos, len, br: false });
          pos += len;
        } else if (c instanceof HTMLBRElement) {
          // 只认自己画的换行；浏览器在空容器里自动补的 <br> 不算文字
          if ("nl" in c.dataset) {
            out.push({ node: c, start: pos, len: 1, br: true });
            pos += 1;
          }
        } else if (c instanceof HTMLElement && "pn" in c.dataset) {
          out.push({ node: c, start: pos, len: 1, br: false, pn: true });
          pos += 1;
        } else if (c instanceof HTMLElement) {
          // 浏览器偶尔会在换行处插入 <div>：按换行处理
          if ((c.tagName === "DIV" || c.tagName === "P") && pos > 0) {
            out.push({ node: c, start: pos, len: 1, br: true });
            pos += 1;
          }
          walk(c);
        }
      }
    };
    walk(ed);
    return out;
  }

  function readText(us: Unit[]): string {
    return us.map((u) => (u.br ? "\n" : u.pn ? PLAYER_CHAR : (u.node as Text).data)).join("");
  }

  function offsetOf(us: Unit[], container: Node, off: number): number {
    const total = us.length ? us[us.length - 1].start + us[us.length - 1].len : 0;
    // 选区端点落在玩家名块内部：按块的前或后算
    const el = container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element);
    const chip = el?.closest?.("[data-pn]");
    if (chip && ed.contains(chip)) {
      const u = us.find((x) => x.node === chip);
      if (u) return u.start + (off > 0 ? 1 : 0);
    }
    if (container.nodeType === Node.TEXT_NODE) {
      const u = us.find((x) => x.node === container);
      return u ? u.start + Math.min(off, u.len) : total;
    }
    const ref = container.childNodes[off] ?? null;
    for (const u of us) {
      const after = ref
        ? ref === u.node || ref.contains(u.node) || !!(ref.compareDocumentPosition(u.node) & Node.DOCUMENT_POSITION_FOLLOWING)
        : !container.contains(u.node) && !!(container.compareDocumentPosition(u.node) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (after) return u.start;
    }
    return total;
  }

  function getSel(): Range | null {
    const sel = getSelection();
    if (!sel || !sel.rangeCount || !ed.contains(sel.anchorNode) || !ed.contains(sel.focusNode)) return null;
    const us = units();
    const a = offsetOf(us, sel.anchorNode!, sel.anchorOffset);
    const b = offsetOf(us, sel.focusNode!, sel.focusOffset);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  const indexIn = (n: Node) => Array.prototype.indexOf.call(n.parentNode!.childNodes, n);

  /** 位置 → DOM 点；落在两段之间时放在前一段末尾，这样继续输入沿用前一段的样式 */
  function pointAt(us: Unit[], pos: number): [Node, number] {
    for (const u of us) if (!atomic(u) && u.start < pos && pos <= u.start + u.len) return [u.node, pos - u.start];
    for (const u of us) {
      if (u.start >= pos) return atomic(u) ? [u.node.parentNode!, indexIn(u.node)] : [u.node, 0];
    }
    const last = us[us.length - 1];
    if (!last) return [ed, 0];
    return atomic(last) ? [last.node.parentNode!, indexIn(last.node) + 1] : [last.node, last.len];
  }

  function setSel(r: Range) {
    const us = units();
    const sel = getSelection();
    if (!sel) return;
    const range = document.createRange();
    const [sn, so] = pointAt(us, r.start);
    range.setStart(sn, so);
    if (r.end !== r.start) {
      const [en, eo] = pointAt(us, r.end);
      range.setEnd(en, eo);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    lastSel = r;
  }

  // —— 修改与撤销 ——
  function pushUndo(kind: string) {
    const now = Date.now();
    if (!(kind !== "edit" && lastKind === kind && now - lastAt < TYPE_MERGE_MS)) {
      history.undo.push({ source, sel: lastSel });
      if (history.undo.length > 200) history.undo.shift();
    }
    history.redo = [];
    lastKind = kind;
    lastAt = now;
  }

  function setDoc(next: RichDoc, kind: "type" | "edit", sel: Range, fromSourceText?: string) {
    const nextSource = fromSourceText ?? toSource(next);
    if (nextSource === source && next.text === doc.text) {
      doc = next;
      version++;
      return;
    }
    pushUndo(kind);
    doc = next;
    source = nextSource;
    history.last = nextSource;
    lastSel = sel;
    version++;
    onchange(nextSource);
  }

  /** 外部改了源码（源码框、模式切换后）：记入撤销并整体重绘 */
  function syncFromValue(v: string) {
    pushUndo("source");
    source = v;
    history.last = v;
    doc = fromSource(v);
    pending = null;
    render();
    lastSel = { start: doc.text.length, end: doc.text.length };
    version++;
  }

  $effect(() => {
    const v = value;
    untrack(() => {
      if (v !== source) syncFromValue(v);
    });
  });

  function restore(snap: Snapshot) {
    doc = fromSource(snap.source);
    source = snap.source;
    history.last = snap.source;
    lastKind = "";
    pending = null;
    render();
    const max = doc.text.length;
    const sel = { start: Math.min(snap.sel.start, max), end: Math.min(snap.sel.end, max) };
    // 焦点在别处（如源码框）时不抢焦点，只记下选区
    if (document.activeElement === ed) setSel(sel);
    else lastSel = sel;
    version++;
    onchange(snap.source);
  }

  export function undo() {
    const snap = history.undo.pop();
    if (!snap) return;
    history.redo.push({ source, sel: lastSel });
    restore(snap);
  }
  export function redo() {
    const snap = history.redo.pop();
    if (!snap) return;
    history.undo.push({ source, sel: lastSel });
    restore(snap);
  }

  /** 命令作用的选区：预览有焦点时取实时选区，否则取最近一次 */
  function currentSel(): Range {
    const max = doc.text.length;
    const r = (document.activeElement === ed && getSel()) || lastSel;
    return { start: Math.min(r.start, max), end: Math.min(r.end, max) };
  }

  function applyRange(fn: (s: Style) => Style, pendingFn: (s: Style) => Style) {
    const r = currentSel();
    ed.focus();
    if (r.start === r.end) {
      pending = pendingFn(pending ?? styleAt(doc, r.start));
      pendingAt = r.start;
      setSel(r);
      version++;
      return;
    }
    setDoc(mapStyles(doc, r.start, r.end, fn), "edit", r);
    render();
    setSel(r);
  }

  function toggle(kind: "b" | "i") {
    const r = currentSel();
    const on = r.start === r.end ? !(pending ?? styleAt(doc, r.start))[kind] : !every(doc, r.start, r.end, (s) => s[kind]);
    applyRange(
      (s) => ({ ...s, [kind]: on }),
      (s) => ({ ...s, [kind]: on }),
    );
  }

  function setColor(c: string | undefined) {
    applyRange(
      (s) => ({ ...s, c }),
      (s) => ({ ...s, c }),
    );
  }

  function clearFormat() {
    applyRange(
      () => PLAIN,
      () => PLAIN,
    );
  }

  function insertAt(r: Range, ins: RichDoc) {
    const next = replaceRange(doc, r.start, r.end, ins);
    const caret = r.start + ins.text.length;
    setDoc(next, "edit", { start: caret, end: caret });
    pending = null;
    render();
    ed.focus();
    setSel({ start: caret, end: caret });
  }

  /** 在光标处插入一个玩家名（整块），沿用该处的样式 */
  export function insertPlayer() {
    const r = currentSel();
    insertAt(r, plainDoc(PLAYER_CHAR, pending ?? styleAt(doc, r.start)));
  }

  function insertNewline() {
    const r = currentSel();
    insertAt(r, plainDoc("\n", pending ?? styleAt(doc, r.start)));
  }

  // —— 预览事件 ——
  function syncFromDom() {
    const us = units();
    const text = readText(us);
    if (text === doc.text) return;
    const caret = getSel()?.end ?? text.length;
    const r = diffApply(doc, text, caret, pending ?? undefined);
    if (r.inserted > 0) pending = null;
    setDoc(r.doc, "type", { start: caret, end: caret });
    render();
    setSel({ start: caret, end: caret });
  }

  function onbeforeinput(e: InputEvent) {
    const t = e.inputType;
    if (t === "historyUndo" || t === "historyRedo") {
      e.preventDefault();
      if (t === "historyUndo") undo();
      else redo();
    } else if (t === "formatBold" || t === "formatItalic") {
      e.preventDefault();
      toggle(t === "formatBold" ? "b" : "i");
    } else if (t.startsWith("format")) {
      // 下划线、删除线等格式游戏不支持
      e.preventDefault();
    } else if (t === "insertParagraph" || t === "insertLineBreak") {
      e.preventDefault();
      insertNewline();
    } else if (t === "insertFromDrop" || t === "deleteByDrag") {
      e.preventDefault();
    }
  }

  function oninput(e: Event) {
    if (composing || (e as InputEvent).isComposing) return;
    syncFromDom();
  }

  function onEdKeydown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && (key === "b" || key === "i")) {
      e.preventDefault();
      toggle(key);
    } else if (mod && (key === "z" || key === "y")) {
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    } else if (mod && key === "u") {
      e.preventDefault();
    } else if (e.key === "Enter" && !mod) {
      // Ctrl + Enter 留给外层（如节点编辑的保存）
      e.preventDefault();
      insertNewline();
    }
  }

  /** 从预览复制 / 剪切：剪贴板里放选中部分的源码，粘回预览时保留格式 */
  function oncopy(e: ClipboardEvent, cut = false) {
    const r = getSel();
    if (!r || r.start === r.end || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", toSource(sliceDoc(doc, r.start, r.end)));
    if (cut) insertAt(r, plainDoc(""));
  }

  function onpaste(e: ClipboardEvent) {
    e.preventDefault();
    const raw = e.clipboardData?.getData("text/plain") ?? "";
    if (!raw) return;
    const parsed = fromSource(raw.replace(/\r?\n/g, "\\n"));
    const r = currentSel();
    const formatted = parsed.styles.some((s) => s.b || s.i || s.c);
    insertAt(r, formatted ? parsed : plainDoc(parsed.text, pending ?? styleAt(doc, r.start)));
  }

  export function focus() {
    ed.focus();
    setSel(lastSel);
  }

  // —— 颜色 ——
  function openColor() {
    colorOpen = !colorOpen;
    hexInput = brush;
    hexBad = false;
  }
  function useColor(c: string) {
    brush = c;
    hexInput = c;
    write(KEY_COLOR, c);
    setColor(c);
    colorOpen = false;
  }
  function applyHex() {
    const c = normalizeColor(hexInput);
    if (!c) {
      hexBad = true;
      return;
    }
    useColor(c);
  }
  let alpha = $derived(brush.length === 9 ? parseInt(brush.slice(7), 16) : 255);
  function setAlpha(a: number) {
    const rgb = (normalizeColor(hexInput) ?? brush).slice(0, 7);
    hexInput = a >= 255 ? rgb : rgb + a.toString(16).padStart(2, "0").toUpperCase();
    hexBad = false;
  }
  let shownColor = $derived(normalizeColor(hexInput) ?? brush);

  /** Esc 只关闭选色面板，不再冒泡到外层浮层 */
  function onRootKeydown(e: KeyboardEvent) {
    if (colorOpen && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      colorOpen = false;
      ed.focus();
    }
  }

  $effect(() => {
    if (!colorOpen) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".color-wrap")) colorOpen = false;
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  });

  onMount(() => {
    render();
    const onSelChange = () => {
      if (composing) return;
      const r = getSel();
      if (!r) return;
      if (pending && (r.start !== pendingAt || r.end !== pendingAt)) pending = null;
      if (r.start !== lastSel.start || r.end !== lastSel.end) lastSel = r;
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  });

  /** 工具栏按钮按下时不抢走预览的选区 */
  const keep = (e: MouseEvent) => e.preventDefault();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="rich" onkeydown={onRootKeydown}>
  <div class="toolbar" role="toolbar" aria-label="格式">
    <button class="btn icon" data-tip="撤销（Ctrl + Z）" aria-label="撤销" onmousedown={keep} onclick={undo}><Icon name="undo" /></button>
    <button class="btn icon" data-tip="重做（Ctrl + Y）" aria-label="重做" onmousedown={keep} onclick={redo}><Icon name="redo" /></button>
    <span class="sep"></span>
    <button class="btn icon tool" class:on={isBold} aria-pressed={isBold} data-tip="粗体（Ctrl + B）" aria-label="粗体" onmousedown={keep} onclick={() => toggle("b")}>
      <Icon name="bold" />
    </button>
    <button class="btn icon tool" class:on={isItalic} aria-pressed={isItalic} data-tip="斜体（Ctrl + I）" aria-label="斜体" onmousedown={keep} onclick={() => toggle("i")}>
      <Icon name="italic" />
    </button>
    <div class="color-wrap">
      <button class="btn color-main" data-tip="把选中文字设为 {brush}" onmousedown={keep} onclick={() => setColor(brush)}>
        <Icon name="palette" />
        <span class="chip" style:--chip={brush}></span>
      </button>
      <button class="btn color-more" class:open={colorOpen} data-tip="选择颜色" aria-label="选择颜色" aria-expanded={colorOpen} onmousedown={keep} onclick={openColor}>
        <Icon name="chevron" size={14} />
      </button>
      {#if colorOpen}
        <div class="color-pop" role="dialog" aria-label="选择颜色">
          <div class="swatches">
            {#each SWATCHES as c}
              <button class="swatch" class:cur={brush.slice(0, 7) === c} style:--chip={c} data-tip={c} aria-label={c} onmousedown={keep} onclick={() => useColor(c)}></button>
            {/each}
          </div>
          <div class="color-row">
            <input
              class="native"
              type="color"
              aria-label="自定义颜色"
              value={shownColor.slice(0, 7).toLowerCase()}
              oninput={(e) => {
                hexInput = e.currentTarget.value.toUpperCase() + (normalizeColor(hexInput)?.slice(7) ?? "");
                hexBad = false;
              }}
            />
            <input
              class="input mono"
              class:invalid={hexBad}
              aria-label="颜色值"
              data-tip={hexBad ? "颜色格式应为 #RRGGBB 或 #RRGGBBAA" : undefined}
              placeholder="#RRGGBB(AA)"
              bind:value={hexInput}
              oninput={() => (hexBad = false)}
              onkeydown={(e) => e.key === "Enter" && applyHex()}
            />
          </div>
          <label class="alpha">
            <span class="label">不透明度</span>
            <input
              type="range"
              min="0"
              max="255"
              value={shownColor.length === 9 ? parseInt(shownColor.slice(7), 16) : alpha}
              oninput={(e) => setAlpha(Number(e.currentTarget.value))}
            />
          </label>
          <div class="color-actions">
            <button class="btn" onmousedown={keep} onclick={() => { setColor(undefined); colorOpen = false; }}>清除颜色</button>
            <button class="btn accent" onclick={applyHex}><Icon name="check" />应用</button>
          </div>
        </div>
      {/if}
    </div>
    <button class="btn icon" data-tip="清除格式" aria-label="清除格式" onmousedown={keep} onclick={clearFormat}><Icon name="eraser" /></button>
    <button class="btn icon" data-tip="插入换行（Enter）" aria-label="插入换行" onmousedown={keep} onclick={insertNewline}><Icon name="newline" /></button>
    {#if extra}
      <span class="grow"></span>
      {@render extra()}
    {/if}
  </div>

  <div
    bind:this={ed}
    {id}
    class="editor"
    class:dark
    style:min-height="{minHeight}px"
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    aria-label={ariaLabel}
    spellcheck="false"
    data-placeholder={placeholder}
    {onbeforeinput}
    {oninput}
    onkeydown={onEdKeydown}
    oncompositionstart={() => (composing = true)}
    oncompositionend={() => {
      composing = false;
      syncFromDom();
    }}
    oncopy={(e) => oncopy(e)}
    oncut={(e) => oncopy(e, true)}
    {onpaste}
    ondrop={(e) => e.preventDefault()}
    ondragstart={(e) => e.preventDefault()}
  ></div>
</div>

<style>
  .rich {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    min-width: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s1);
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
  .tool.on {
    border-color: var(--theme-light);
    background: var(--tint-bg);
    color: var(--theme-deep);
  }

  /* 颜色：左半应用当前颜色，右半展开选色面板 */
  .color-wrap {
    position: relative;
    display: inline-flex;
  }
  .color-main {
    gap: 6px;
    padding: 0 var(--s2);
    border-color: transparent;
    border-radius: var(--r-btn) 0 0 var(--r-btn);
    background: transparent;
    color: var(--text-2);
  }
  .color-more {
    width: 22px;
    padding: 0;
    border-color: transparent;
    border-radius: 0 var(--r-btn) var(--r-btn) 0;
    background: transparent;
    color: var(--text-2);
  }
  .color-more :global(svg) {
    transition: transform 180ms var(--ease-out);
  }
  .color-more.open :global(svg) {
    transform: rotate(180deg);
  }
  .chip {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    background:
      linear-gradient(var(--chip), var(--chip)),
      repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 6px 6px;
  }
  .color-pop {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    left: 0;
    width: 232px;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    box-shadow: var(--shadow-float);
    animation: enter-fade 140ms var(--ease-out);
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }
  .swatch {
    height: 28px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: var(--r-btn);
    background: var(--chip);
    cursor: pointer;
    transition: transform var(--t-release) var(--ease-back);
  }
  .swatch:hover {
    box-shadow: 0 0 0 2px var(--theme-light);
  }
  .swatch:active {
    transform: scale(0.94);
    transition-duration: var(--t-press);
  }
  .swatch.cur {
    box-shadow: 0 0 0 2px var(--theme);
  }
  .color-row {
    display: flex;
    gap: var(--s2);
  }
  .native {
    flex: none;
    width: var(--ctl-h);
    height: var(--ctl-h);
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--surface);
    cursor: pointer;
  }
  .alpha {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .alpha input {
    flex: 1;
    accent-color: var(--theme);
  }
  .color-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s2);
  }
  .mono {
    font-family: "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace;
    font-size: 13px;
  }

  .editor {
    max-height: 360px;
    overflow-y: auto;
    padding: var(--s3) var(--s4);
    border: 1px solid var(--border);
    border-radius: var(--r-btn);
    background: var(--surface);
    /* 对话内容预览字体（设置「常规 → 编辑」）；富文本编辑页会在自己的容器上覆盖 --font-content */
    font-family: var(--font-content, inherit);
    font-size: 16px;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    cursor: text;
    transition:
      border-color var(--t-hover-out) var(--ease-out),
      box-shadow var(--t-hover-out) var(--ease-out),
      background-color 200ms var(--ease-out),
      color 200ms var(--ease-out);
  }
  .editor:hover {
    border-color: var(--theme-bright);
  }
  .editor:focus {
    outline: none;
    border-color: var(--theme);
    box-shadow: 0 0 0 2px var(--theme-light);
  }
  .editor.dark {
    background: #2b3340;
    color: #fff;
  }
  .editor:empty::before {
    content: attr(data-placeholder);
    color: var(--text-3);
    pointer-events: none;
  }
  /* 玩家名块：浅色底的整块标记，文字样式与颜色跟随所在位置 */
  .editor :global(.pn) {
    display: inline-block;
    margin: 0 1px;
    padding: 0 5px;
    border: 1px solid var(--theme-light);
    border-radius: 4px;
    background: var(--tint-bg);
    line-height: 1.35;
    cursor: default;
    user-select: all;
  }
  .editor.dark :global(.pn) {
    border-color: rgba(255, 255, 255, 0.35);
    background: rgba(255, 255, 255, 0.12);
  }
  .editor :global(.b) {
    font-weight: 700;
  }
  .editor :global(.i) {
    font-style: italic;
  }
  @media (prefers-reduced-motion: reduce) {
    .color-pop {
      animation: none;
    }
    .color-more :global(svg) {
      transition: none;
    }
  }
</style>
