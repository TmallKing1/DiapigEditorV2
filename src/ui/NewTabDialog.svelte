<script lang="ts">
  // 历史文件：输入新页签名称。名称不能为空、不能与已有页签重名；回车确认
  import Modal from "./Modal.svelte";

  let {
    check,
    onconfirm,
    oncancel,
  }: {
    /** 名称的问题；没问题返回空串 */
    check: (name: string) => string;
    onconfirm: (name: string) => void;
    oncancel: () => void;
  } = $props();

  let name = $state("");
  /** 输入过或按过确认后才显示错误，刚打开时不先报「不能为空」 */
  let touched = $state(false);
  let error = $derived(check(name));

  function submit() {
    touched = true;
    if (!error) onconfirm(name.trim());
  }
</script>

<Modal title="新建页签" width={400} tone="info" onclose={oncancel}>
  <div class="field">
    <label class="label" for="new-tab-name">页签名称</label>
    <input
      id="new-tab-name"
      class="input"
      class:invalid={touched && !!error}
      maxlength="60"
      autocomplete="off"
      spellcheck="false"
      data-autofocus
      bind:value={name}
      oninput={() => (touched = true)}
      onkeydown={(e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          submit();
        }
      }}
    />
    <!-- 错误行始终占位，出现时对话框高度不跳 -->
    <span class="hint error" aria-live="polite">{touched ? error : ""}&nbsp;</span>
  </div>
  {#snippet footer()}
    <button class="btn" onclick={oncancel}>取消</button>
    <button class="btn accent" disabled={touched && !!error} onclick={submit}>新建</button>
  {/snippet}
</Modal>
