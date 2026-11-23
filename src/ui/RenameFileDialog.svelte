<script lang="ts">
  import { jsonFileStem } from "../lib/files";
  import Modal from "./Modal.svelte";

  let { path, onconfirm, oncancel }: {
    path: string;
    onconfirm: (stem: string) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let stem = $state("");
  $effect.pre(() => {
    stem = jsonFileStem(path);
  });
  let busy = $state(false);
  let error = $state("");

  async function submit() {
    if (busy || !stem.trim()) return;
    busy = true;
    error = "";
    try {
      await onconfirm(stem.trim());
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function cancel() {
    if (!busy) oncancel();
  }
</script>

<Modal title="重命名文件" width={440} tone="info" onclose={cancel}>
  <div class="field">
    <label class="label" for="rename-file-stem">文件名称</label>
    <div class="name-field">
      <input
        class="input"
        id="rename-file-stem"
        class:invalid={!!error}
        aria-invalid={!!error}
        aria-describedby="rename-file-error"
        autocomplete="off"
        spellcheck="false"
        data-autofocus
        readonly={busy}
        bind:value={stem}
        onfocus={(e) => e.currentTarget.select()}
        oninput={() => (error = "")}
        onkeydown={(e) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <span class="hint">{path.slice(-5)}</span>
    </div>
    <span class="hint error" id="rename-file-error" aria-live="polite">{error}</span>
  </div>
  {#snippet footer()}
    <button class="btn" disabled={busy} onclick={cancel}>取消</button>
    <button class="btn accent" disabled={busy || !stem.trim()} onclick={() => void submit()}>确定</button>
  {/snippet}
</Modal>

<style>
  .name-field {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
</style>
