<script lang="ts">
  // 子页面「对话设置 - <文件名>」：当前对话的结构体 ID、开始节点、起止黑场。暂时没有左侧栏，卡片沿用设置页的样式。
  // 从主页文件区的「设置」进入；结构体 ID 没填时进入后聚焦第一个空的 ID。
  // 起止设置总是开启：游戏内导入只接受新版完整结构，旧结构的文件载入时已补上（dialog.svelte.ts）。
  import { onMount, tick } from "svelte";
  import { closeSub } from "../lib/nav.svelte";
  import { dlg, setBeginEnd, setIds, setStart } from "../lib/dialog.svelte";
  import { nodeLabel } from "../lib/labels";
  import { blackoutEnabled } from "../model/types";
  import Dropdown from "../ui/Dropdown.svelte";
  import Icon from "../ui/Icon.svelte";
  import StructIdActions from "../ui/StructIdActions.svelte";

  let root = $state<HTMLElement>();
  let doc = $derived(dlg.doc);

  // 对话被关掉（不应发生，保险起见）时回到主页
  $effect(() => {
    if (!doc) closeSub();
  });

  onMount(async () => {
    if (dlg.ready) return;
    await tick();
    const inputs = [...(root?.querySelectorAll<HTMLInputElement>("input.id-input") ?? [])];
    (inputs.find((el) => !el.value.trim() || el.value.trim() === "0") ?? inputs[0])?.focus();
  });

  /** 黑场秒数：不小于 0 的数才写入，否则恢复显示当前值 */
  function setSecs(e: Event & { currentTarget: HTMLInputElement }, key: "enterTime" | "leaveTime") {
    const v = Number(e.currentTarget.value);
    if (e.currentTarget.value.trim() !== "" && Number.isFinite(v) && v >= 0) setBeginEnd({ [key]: Math.round(v * 100) / 100 });
    else e.currentTarget.value = String(doc?.beginEnd?.[key] ?? 0);
  }
</script>

{#if doc}
  <div class="settings" bind:this={root}>
    <section class="card setting enter">
      <h2 class="card-title">结构体 ID</h2>
      <div class="setting-body">
        {#if dlg.v1Notice && !dlg.idsTouched}
          <p class="notice">
            <Icon name="warn" size={14} />
            <span>这份文件是旧版格式，下面是旧结构体的 ID。导出前请换成游戏里新结构体的 ID。</span>
          </p>
        {:else if dlg.shapeNotice && !dlg.idsTouched}
          <p class="notice">
            <Icon name="warn" size={14} />
            <span>这份文件是旧结构（没有起止设置），已按新结构补上。请填写起止设置结构体 ID，并确认其他 ID 来自新结构。</span>
          </p>
        {/if}
        {#each [["dialog", "对话结构体"], ["node", "对话节点结构体"], ["branch", "对话分支结构体"]] as const as [key, label] (key)}
          <div class="row">
            <label class="name" for="id-{key}">{label}</label>
            <div class="control">
              <input id="id-{key}" data-tip="在游戏导出的结构体文件里查看，导入时自动带出。全部填写后才能保存。" class="input id-input" inputmode="numeric" value={doc.ids[key]} oninput={(e) => setIds({ [key]: e.currentTarget.value.trim() })} />
            </div>
          </div>
        {/each}
        <div class="row">
          <label class="name" for="id-begin-end">对话起止设置结构体</label>
          <div class="control">
            <input
              id="id-begin-end" data-tip="在游戏导出的结构体文件里查看，导入时自动带出。全部填写后才能保存。"
              class="input id-input"
              inputmode="numeric"
              value={doc.ids.beginEnd ?? ""}
              oninput={(e) => setIds({ beginEnd: e.currentTarget.value.trim() })}
            />
          </div>
        </div>
        <StructIdActions kind="dialog" />
      </div>
    </section>

    <section class="card setting enter" style:--enter-delay="40ms">
      <h2 class="card-title">开始节点</h2>
      <div class="setting-body">
        <div class="row">
          <label class="name" for="start-node">开始节点</label>
          <div class="control">
            <Dropdown
              id="start-node"
              options={doc.nodes.map((n, i) => ({ value: String(i), label: nodeLabel(n, i) }))}
              value={String(doc.startNode)}
              onchange={(v) => setStart(Number(v))}
            />
          </div>
        </div>
      </div>
    </section>

    <section class="card setting enter" style:--enter-delay="80ms">
      <h2 class="card-title">起止黑场</h2>
      <div class="setting-body">
        <p class="notice"><Icon name="warn" size={14} />只对锁定对话生效</p>
        {#each [["enter", "进入黑场", "enterTime", "enterEvent"], ["leave", "离开黑场", "leaveTime", "leaveEvent"]] as const as [key, label, time, ev] (key)}
          {@const enabled = blackoutEnabled(doc.beginEnd, key)}
          <div class="row">
            <label class="name check">
              <input type="checkbox" checked={enabled} onchange={(e) => setBeginEnd({ [`${key}Enabled`]: e.currentTarget.checked })} />{label}
            </label>
            <div class="control">
              <input
                id="be-{key}"
                class="input secs"
                type="number"
                min="0"
                step="0.5"
                aria-label="{label}停留秒数"
                disabled={!enabled}
                value={doc.beginEnd?.[time] ?? 0}
                onchange={(e) => setSecs(e, time)}
              />
              <span class="unit">秒</span>
              <input
                class="input event"
                placeholder="事件名（可空）"
                aria-label="{label}事件"
                disabled={!enabled}
                value={doc.beginEnd?.[ev] ?? ""}
                onchange={(e) => setBeginEnd({ [ev]: e.currentTarget.value })}
              />
            </div>
          </div>
        {/each}
      </div>
    </section>
  </div>
{/if}

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    /* 最长的名称「对话起止设置结构体」9 个字 */
    --name-w: 9.5em;
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
    align-items: center;
    gap: var(--s2);
  }
  .control > .id-input {
    flex: 1;
    min-width: 0;
  }
  .secs {
    flex: 0 0 80px;
    width: 80px;
  }
  .unit {
    color: var(--text-2);
  }
  .event {
    flex: 1;
    min-width: 0;
    margin-left: var(--s2);
  }
  .notice {
    display: flex;
    align-items: center;
    gap: var(--s2);
    margin: 0;
    padding: var(--s1) var(--s2) var(--s1) var(--s3);
    border: 1px solid #ecd9a6;
    border-radius: var(--r-btn);
    background: #fff8e5;
    color: #6b4700;
    font-size: 12.5px;
  }
</style>
