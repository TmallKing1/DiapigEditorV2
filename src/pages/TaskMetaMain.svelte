<script lang="ts">
  // 子页面「任务设置 - <文件名>」：当前任务链的结构体 ID 与完成事件，卡片沿用对话设置的样式。
  // 从主页文件区的「设置」进入；结构体 ID 没填时进入后聚焦第一个空的 ID。
  import { onMount, tick } from "svelte";
  import { closeSub } from "../lib/nav.svelte";
  import { setChainCompleteEvent, setTaskIds, tsk } from "../lib/task.svelte";
  import StructIdActions from "../ui/StructIdActions.svelte";

  let root = $state<HTMLElement>();
  let doc = $derived(tsk.doc);

  $effect(() => {
    if (!doc) closeSub();
  });

  onMount(async () => {
    if (tsk.ready) return;
    await tick();
    const inputs = [...(root?.querySelectorAll<HTMLInputElement>("input.id-input") ?? [])];
    (inputs.find((el) => !el.value.trim() || el.value.trim() === "0") ?? inputs[0])?.focus();
  });
</script>

{#if doc}
  <div class="settings" bind:this={root}>
    <section class="card setting enter">
      <h2 class="card-title">结构体 ID</h2>
      <div class="setting-body">
        {#each [["chain", "任务链结构体"], ["task", "任务结构体"]] as const as [key, label] (key)}
          <div class="row">
            <label class="name" for="id-{key}">{label}</label>
            <div class="control">
              <input id="id-{key}" data-tip="在游戏导出的结构体文件里查看，导入时自动带出。两个都填写后才能保存。" class="input id-input" inputmode="numeric" value={doc.ids[key]} oninput={(e) => setTaskIds({ [key]: e.currentTarget.value.trim() })} />
            </div>
          </div>
        {/each}
        <StructIdActions kind="task" />
      </div>
    </section>

    <section class="card setting enter" style:--enter-delay="40ms">
      <h2 class="card-title">任务完成事件</h2>
      <div class="setting-body">
        <div class="row">
          <label class="name" for="chain-complete-event">事件名</label>
          <div class="control">
            <input
              id="chain-complete-event"
              class="input"
              placeholder="留空不派发"
              value={doc.completeEvent}
              onchange={(e) => {
                const input = e.currentTarget;
                input.value = input.value.trim();
                setChainCompleteEvent(input.value);
              }}
              onkeydown={(e) => {
                if (e.key === "Enter" && !e.isComposing) e.currentTarget.blur();
              }}
            />
          </div>
        </div>
      </div>
    </section>
  </div>
{/if}

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    --name-w: 6.5em;
  }
  .card-title {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-width: 0;
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
  }
  .control > .input {
    flex: 1;
    min-width: 0;
  }
</style>
