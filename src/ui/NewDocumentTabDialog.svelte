<script lang="ts">
  import { tick } from "svelte";
  import { createTab, hist } from "../lib/history.svelte";
  import type { HomeTab } from "../lib/nav.svelte";
  import { UNSORTED, UNSORTED_NAME, checkTabName, hasTab } from "../model/history";
  import { DEFAULT_TASK_NAME } from "../model/task";
  import Dropdown from "./Dropdown.svelte";
  import Modal from "./Modal.svelte";

  let { kind, dirty, busy, onconfirm, oncancel }: {
    kind: HomeTab;
    dirty: boolean;
    busy: boolean;
    onconfirm: (tab: string, taskName: string) => void;
    oncancel: () => void;
  } = $props();

  const NEW_TAB = ":new";
  let isTask = $derived(kind === "task");
  let taskName = $state(DEFAULT_TASK_NAME);
  let selected = $state(UNSORTED);
  let name = $state("");
  let touched = $state(false);
  let nameInput = $state<HTMLInputElement>();
  let options = $derived([
    { value: UNSORTED, label: UNSORTED_NAME },
    ...hist.data.tabs.map((tab) => ({ value: tab.id, label: tab.name })),
    { value: NEW_TAB, label: "+ 新增页签" },
  ]);
  let target = $derived(selected === NEW_TAB || hasTab(hist.data, selected) ? selected : UNSORTED);
  let error = $derived(target === NEW_TAB ? checkTabName(hist.data, name) : "");
  let submitting = false;

  async function pick(value: string) {
    selected = value;
    if (value !== NEW_TAB) return;
    await tick();
    nameInput?.focus();
  }

  function submit() {
    touched = true;
    if (busy || error || submitting) return;
    submitting = true;
    onconfirm(target === NEW_TAB ? createTab(name, false) : target, taskName);
  }

  function submitOnEnter(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    submit();
  }
</script>

<Modal title={isTask ? "新建任务" : "新建对话"} width={440} tone="info" onclose={oncancel}>
  {#if isTask}
    <div class="field form-row">
      <label class="label" for="new-task-name">任务名称</label>
      <input
        id="new-task-name"
        class="input"
        autocomplete="off"
        data-autofocus={dirty ? undefined : ""}
        bind:value={taskName}
        onkeydown={submitOnEnter}
      />
    </div>
  {/if}
  <div class="field form-row">
    <label class="label" for="new-document-tab">所属页签</label>
    <Dropdown id="new-document-tab" {options} value={target} onchange={pick} />
  </div>
  {#if target === NEW_TAB}
    <div class="field form-row">
      <label class="label" for="new-document-tab-name">新页签名称</label>
      <input
        id="new-document-tab-name"
        class="input"
        class:invalid={touched && !!error}
        aria-invalid={touched && !!error}
        aria-describedby="new-document-tab-error"
        maxlength="60"
        autocomplete="off"
        spellcheck="false"
        bind:this={nameInput}
        bind:value={name}
        oninput={() => (touched = true)}
        onkeydown={submitOnEnter}
      />
      <span id="new-document-tab-error" class="hint error" aria-live="polite">{touched ? error : ""}&nbsp;</span>
    </div>
  {/if}
  {#if dirty}
    <p class="hint error" role="status">当前{isTask ? "任务链" : "对话"}有尚未保存的修改，继续后这些修改会丢失。</p>
  {/if}
  {#snippet footer()}
    <button class="btn" data-autofocus={dirty ? "" : undefined} onclick={oncancel}>取消</button>
    <button class="btn accent" data-autofocus={!dirty && !isTask ? "" : undefined} disabled={busy || !!error} onclick={submit}>继续</button>
  {/snippet}
</Modal>

<style>
  .form-row {
    display: grid;
    grid-template-columns: 5em minmax(0, 1fr);
    align-items: center;
    column-gap: var(--s3);
  }

  .form-row .hint {
    grid-column: 2;
  }
</style>
