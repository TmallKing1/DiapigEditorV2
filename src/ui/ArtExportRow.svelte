<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let { moduleId, moduleName, moduleOk, onModuleNameChange, canExport, onExport, onCopyPrompt, help, extraAction }: {
    moduleId: string;
    moduleName: string;
    moduleOk: boolean;
    onModuleNameChange: (value: string) => void;
    canExport: boolean;
    onExport: () => void;
    onCopyPrompt: () => void;
    help: string;
    extraAction?: Snippet;
  } = $props();
</script>

<div class="export-row">
  <label class="label" for={moduleId}>模块名</label>
  <input
    id={moduleId}
    class="input module mono"
    class:invalid={!moduleOk}
    aria-invalid={!moduleOk}
    spellcheck="false"
    value={moduleName}
    oninput={(e) => onModuleNameChange(e.currentTarget.value)}
  />
  {#if moduleOk}
    <span class="hint mono">require("{moduleName}")</span>
  {:else}
    <span class="hint error"><Icon name="warn" size={12} />只能用字母、数字、下划线，且不以数字开头</span>
  {/if}
  <div class="export-actions">
    {@render extraAction?.()}
    <button class="btn accent" onclick={onExport} disabled={!canExport} data-tip={help}><Icon name="export" />导出 Lua</button>
    <button class="btn" onclick={onCopyPrompt} disabled={!canExport}><Icon name="copy" />复制 Agent 提示词</button>
  </div>
</div>

<style>
  .export-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
    min-height: var(--ctl-h);
  }
  .module { width: 200px; }
  .mono {
    font-family: "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace;
    font-size: 13px;
  }
  .hint { min-width: 0; overflow-wrap: anywhere; }
  .error { display: inline-flex; align-items: center; gap: 4px; }
  .export-actions {
    margin-left: auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s1);
  }
  @media (max-width: 760px) {
    .module { flex: 1; max-width: 200px; }
  }
</style>
