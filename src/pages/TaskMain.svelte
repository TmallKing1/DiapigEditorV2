<script lang="ts">
  // 任务页的主区：未打开任务链时的占位卡片，或任务列表（拖动排序）与任务编辑框。
  // 标题处直接编辑任务链名称：点击变为输入框，Enter / 失焦提交，Esc 取消；提交可撤销。
  import { tick } from "svelte";
  import { requestNew } from "../lib/home.svelte";
  import { importTaskFile, moveTaskTo, saveTask, setChainName, taskRowAction, tsk } from "../lib/task.svelte";
  import DropLine from "../ui/DropLine.svelte";
  import Icon from "../ui/Icon.svelte";
  import TaskEditor from "../ui/TaskEditor.svelte";
  import TaskRow from "../ui/TaskRow.svelte";
  import { RowDrag } from "../ui/rowDrag.svelte";

  let {
    scroller,
    enterCls = "",
  }: {
    scroller?: HTMLElement;
    enterCls?: string;
  } = $props();

  let doc = $derived(tsk.doc);

  let listEl = $state<HTMLUListElement>();
  const rowDrag = new RowDrag({
    list: () => listEl,
    scroller: () => scroller,
    canStart: () => tsk.edit != null && tsk.editingIndex < 0,
    onmove: moveTaskTo,
  });
  let drag = $derived(rowDrag.state);

  // —— 任务链名称 ——
  let naming = $state(false);
  let nameText = $state("");
  let nameInput = $state<HTMLInputElement>();
  async function startNaming() {
    if (!doc) return;
    nameText = doc.name;
    naming = true;
    await tick();
    nameInput?.select();
  }
  function commitName() {
    if (!naming) return;
    naming = false;
    setChainName(nameText.trim());
  }
</script>

{#if !doc}
  <div class="empty-wrap">
    <div class="empty card {enterCls}">
      <h1 class="empty-title">还没有打开任务链</h1>
      <p class="empty-text">新建一条任务链，或导入游戏导出的任务链结构体 JSON。</p>
      <div class="pair">
        <button class="btn accent" onclick={() => requestNew("task")} disabled={tsk.busy}><Icon name="file" />新建任务链</button>
        <button class="btn" data-tip="导入文件（Ctrl + O）" onclick={importTaskFile} disabled={tsk.busy}><Icon name="import" />导入文件</button>
      </div>
    </div>
  </div>
{:else}
  <div class="list-head {enterCls}">
    {#if naming}
      <input
        bind:this={nameInput}
        class="input name-input"
        aria-label="任务链名称"
        bind:value={nameText}
        onblur={commitName}
        onkeydown={(e) => {
          if (e.key === "Enter") commitName();
          else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            naming = false;
          }
        }}
      />
    {:else}
      <button class="name" data-tip="修改任务链名称" onclick={() => void startNaming()}>
        <h1 class:muted={!doc.name}>{doc.name || "未命名任务链"}</h1>
        <Icon name="edit" size={16} />
      </button>
    {/if}
    <span class="hint">共 {doc.tasks.length} 个任务</span>
    <span class="grow"></span>
    <button class="icon-btn" data-tip="撤销（Ctrl + Z）" aria-label="撤销" onclick={() => tsk.undo()} disabled={!tsk.canUndo}>
      <Icon name="undo" />
    </button>
    <button class="icon-btn" data-tip="重做（Ctrl + Y / Ctrl + Shift + Z）" aria-label="重做" onclick={() => tsk.redo()} disabled={!tsk.canRedo}>
      <Icon name="redo" />
    </button>
  </div>
  <ul class="list" bind:this={listEl}>
    {#if drag && rowDrag.showLine}
      <DropLine top={drag.lineY} />
    {/if}
    {#each doc.tasks as task, i (task.uid)}
      <TaskRow
        {task}
        index={i}
        count={doc.tasks.length}
        selected={tsk.selectedUid === task.uid}
        canPaste={tsk.edit?.clipboard != null}
        enterDelay={tsk.stagger ? Math.min(i, 6) * 25 : 0}
        dragging={drag?.from === i}
        onedit={() => {
          tsk.selectedUid = task.uid;
          tsk.editingIndex = i;
        }}
        onaction={(action) => taskRowAction(i, action)}
        ongrip={(e) => rowDrag.start(i, e)}
      />
    {/each}
  </ul>
{/if}

{#if doc && tsk.editingIndex >= 0 && doc.tasks[tsk.editingIndex]}
  {@const editing = doc.tasks[tsk.editingIndex]}
  {#key editing.uid}
    <TaskEditor
      task={editing}
      index={tsk.editingIndex}
      onsave={saveTask}
      oncancel={() => (tsk.editingIndex = -1)}
    />
  {/key}
{/if}

<style>
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s2);
  }
  .list-head {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-height: 36px;
    margin-bottom: var(--s2);
  }
  .grow {
    flex: 1;
  }
  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }
  h1.muted {
    color: var(--text-3);
  }
  /* 标题按钮：外观同标题，悬停时出现浅底与编辑图标。编辑图标平时不占宽度，标题到「共几个」的间距与
     对话页相同（文字后 padding s2 + 右外边距 s1 - s2 + 间距 s2 = s1 + s2）；悬停时图标展开 */
  .name {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    min-width: 0;
    max-width: 50%;
    margin: 0 calc(var(--s1) - var(--s2)) 0 calc(-1 * var(--s2));
    padding: 2px var(--s2);
    border: 0;
    border-radius: var(--r-btn);
    background: transparent;
    color: var(--text);
    cursor: text;
    transition: background-color var(--t-hover-out) var(--ease-out);
  }
  .name h1 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name :global(svg) {
    flex: none;
    width: 0;
    margin-left: calc(-1 * var(--s1));
    color: var(--text-3);
    opacity: 0;
    transition:
      opacity var(--t-hover-out) var(--ease-out),
      width var(--t-hover-out) var(--ease-out),
      margin-left var(--t-hover-out) var(--ease-out);
  }
  .name:hover,
  .name:focus-visible {
    background: var(--hover-bg);
    transition-duration: var(--t-hover-in);
  }
  .name:hover :global(svg),
  .name:focus-visible :global(svg) {
    width: 16px;
    margin-left: 0;
    opacity: 1;
    transition-duration: var(--t-hover-in);
  }
  .name-input {
    width: min(360px, 50%);
    height: 32px;
    margin-right: var(--s1);
    font-size: 16px;
    font-weight: 700;
  }
  .list {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .empty-wrap {
    min-height: calc(100vh - var(--topbar-h) - 2 * var(--s5));
    display: grid;
    place-items: center;
  }
  .empty {
    width: 100%;
    max-width: 440px;
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    padding-top: var(--s2);
  }
  .empty-title {
    margin: 0;
    padding-bottom: var(--s3);
    border-bottom: 3px solid var(--theme);
    color: var(--theme);
    font-size: 20px;
    font-weight: 700;
    line-height: 1.3;
    text-align: center;
  }
  .empty-text {
    margin: 0;
    color: var(--text);
  }
  @media (max-width: 900px) {
    .empty-wrap {
      min-height: 0;
      padding: var(--s6) 0;
    }
  }
</style>
