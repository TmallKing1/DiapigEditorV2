<script lang="ts">
  // 右键菜单。全局禁用了系统右键菜单；只有在文本输入框（单行、多行、富文本编辑区）上才弹出这里的菜单。
  // 菜单按钮阻止了 mousedown 的默认行为，点击时焦点与选区留在输入框里，操作直接作用于它。
  import { readText as readClipboardText } from "@tauri-apps/plugin-clipboard-manager";
  import { toast } from "../lib/ui.svelte";
  import { menuIn, menuOut } from "./motion";

  type Action = "cut" | "copy" | "paste" | "selectAll" | "delete" | "undo" | "redo";

  /** 可以用右键菜单编辑的单行文本类型；复选框、按钮之类不弹菜单 */
  const TEXT_INPUT = new Set(["text", "search", "url", "tel", "password", "email", "number"]);
  const FIELD = 'input, textarea, [contenteditable=""], [contenteditable="true"]';
  const ITEMS: { action: Action; label: string; key: string }[] = [
    { action: "cut", label: "剪切", key: "Ctrl+X" },
    { action: "copy", label: "复制", key: "Ctrl+C" },
    { action: "paste", label: "粘贴", key: "Ctrl+V" },
    { action: "selectAll", label: "全选", key: "Ctrl+A" },
    { action: "delete", label: "删除", key: "Del" },
    { action: "undo", label: "撤销", key: "Ctrl+Z" },
    { action: "redo", label: "重做", key: "Ctrl+Y" },
  ];
  const MARGIN = 8;

  let field: HTMLElement | null = null;
  let at = $state<{ x: number; y: number } | null>(null);
  let pos = $state<{ x: number; y: number } | null>(null);
  let box = $state<HTMLDivElement>();
  let enabled = $state<Record<Action, boolean>>({ cut: false, copy: false, paste: false, selectAll: true, delete: false, undo: true, redo: true });

  /** 找到右键所在的文本输入区；不是的话返回 null */
  function fieldAt(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const f = target.closest<HTMLElement>(FIELD);
    if (!f) return null;
    if (f instanceof HTMLInputElement) return TEXT_INPUT.has(f.type) ? f : null;
    return f;
  }

  function editable(f: HTMLElement): boolean {
    if (f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement) return !f.readOnly && !f.disabled;
    return f.isContentEditable;
  }

  function hasSelection(f: HTMLElement): boolean {
    if (f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement) return f.selectionStart !== f.selectionEnd;
    const s = window.getSelection();
    return !!s && !s.isCollapsed && f.contains(s.anchorNode);
  }

  function close() {
    at = null;
    pos = null;
    field = null;
  }

  function onContextMenu(e: MouseEvent) {
    // 任何地方都不显示系统右键菜单
    e.preventDefault();
    const f = fieldAt(e.target);
    if (!f) return close();
    field = f;
    const canEdit = editable(f);
    const sel = hasSelection(f);
    enabled = { cut: canEdit && sel, copy: sel, paste: canEdit, selectAll: true, delete: canEdit && sel, undo: true, redo: true };
    pos = null;
    at = { x: e.clientX, y: e.clientY };
  }

  // 按屏幕边界修正位置：右侧、下方放不下时向左、向上翻
  $effect(() => {
    if (!at || !box) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const x = at.x + w + MARGIN > window.innerWidth ? Math.max(MARGIN, at.x - w) : at.x;
    const y = at.y + h + MARGIN > window.innerHeight ? Math.max(MARGIN, at.y - h) : at.y;
    if (!pos || pos.x !== x || pos.y !== y) pos = { x, y };
  });

  // 通过 Tauri 剪贴板插件读取文本（由原生端读取，不走 WebView2 的权限确认）
  async function paste(f: HTMLElement) {
    let text: string | null;
    try {
      text = await readClipboardText();
    } catch (err) {
      toast(`粘贴失败：${String(err)}`, "error");
      return;
    }
    if (!text) return;
    f.focus();
    document.execCommand("insertText", false, text);
  }

  function run(action: Action) {
    const f = field;
    close();
    if (!f) return;
    f.focus();
    switch (action) {
      case "cut":
        document.execCommand("cut");
        break;
      case "copy":
        document.execCommand("copy");
        break;
      case "paste":
        void paste(f);
        break;
      case "selectAll":
        if (f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement) f.select();
        else document.execCommand("selectAll");
        break;
      case "delete":
        document.execCommand("delete");
        break;
      case "undo":
        document.execCommand("undo");
        break;
      case "redo":
        document.execCommand("redo");
        break;
    }
  }

  $effect(() => {
    document.addEventListener("contextmenu", onContextMenu);
    // 点菜单外、按 Esc、滚动、缩放或窗口失焦时收起
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Node && box?.contains(e.target))) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  });
</script>

{#if at}
  <div
    class="ctx"
    role="menu"
    tabindex="-1"
    aria-label="文本编辑"
    bind:this={box}
    style:left="{(pos ?? at).x}px"
    style:top="{(pos ?? at).y}px"
    style:visibility={pos ? "visible" : "hidden"}
    in:menuIn
    out:menuOut
    onmousedown={(e) => e.preventDefault()}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#each ITEMS as it (it.action)}
      <button type="button" role="menuitem" class="item" disabled={!enabled[it.action]} onclick={() => run(it.action)}>
        <span>{it.label}</span>
        <kbd>{it.key}</kbd>
      </button>
    {/each}
  </div>
{/if}

<style>
  .ctx {
    position: fixed;
    z-index: 10001;
    display: flex;
    flex-direction: column;
    min-width: 176px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    box-shadow: var(--shadow-float);
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s4);
    height: 30px;
    padding: 0 var(--s3);
    border: 0;
    border-radius: var(--r-btn);
    background: transparent;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .item:hover:not(:disabled) {
    background: var(--hover-bg);
  }
  .item:disabled {
    color: var(--text-3);
    cursor: default;
  }
  kbd {
    font: inherit;
    font-size: 11.5px;
    color: var(--text-3);
  }
</style>
