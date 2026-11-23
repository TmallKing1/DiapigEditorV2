<script lang="ts">
  // 历史文件：把一个文件引用移到其他页签
  import Dropdown, { type DropdownOption } from "./Dropdown.svelte";
  import Modal from "./Modal.svelte";

  let {
    fileName,
    options,
    onconfirm,
    oncancel,
  }: {
    fileName: string;
    /** 可选的目标页签（不含文件当前所在的页签） */
    options: DropdownOption[];
    onconfirm: (tab: string) => void;
    oncancel: () => void;
  } = $props();

  // 默认选第一个；选中的目标不在列表里（打开时、列表变化后）时退回第一个
  let target = $state("");
  $effect.pre(() => {
    if (!options.some((o) => o.value === target)) target = options[0]?.value ?? "";
  });
</script>

<Modal title="移到其他页签" width={400} tone="info" onclose={oncancel}>
  <div class="field">
    <label class="label" for="move-tab-target">把「{fileName}」移到</label>
    <Dropdown id="move-tab-target" {options} value={target} onchange={(v) => (target = v)} />
  </div>
  {#snippet footer()}
    <button class="btn" onclick={oncancel}>取消</button>
    <button class="btn accent" data-autofocus disabled={!target} onclick={() => onconfirm(target)}>移动</button>
  {/snippet}
</Modal>
