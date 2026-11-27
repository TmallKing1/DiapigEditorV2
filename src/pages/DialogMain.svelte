<script lang="ts">
  // 对话页的主区：未打开对话时的占位卡片，或节点列表（拖动排序）与节点编辑框
  import { dlg, importFile, moveTo, redo, rowAction, saveNode, undo } from "../lib/dialog.svelte";
  import { requestNew } from "../lib/home.svelte";
  import { settings } from "../lib/settings.svelte";
  import { isAutoEnd } from "../model/ops";
  import Icon from "../ui/Icon.svelte";
  import NodeEditor from "../ui/NodeEditor.svelte";
  import NodeRow from "../ui/NodeRow.svelte";
  import DropLine from "../ui/DropLine.svelte";
  import { RowDrag } from "../ui/rowDrag.svelte";

  let {
    scroller,
    enterCls = "",
  }: {
    /** 主区的滚动容器：拖动到上下边缘时滚动它 */
    scroller?: HTMLElement;
    /** 内容入场用的类名；首次显示随主窗口入场时为空 */
    enterCls?: string;
  } = $props();

  let doc = $derived(dlg.doc);
  let listEl = $state<HTMLUListElement>();
  const rowDrag = new RowDrag({
    list: () => listEl,
    scroller: () => scroller,
    canStart: () => dlg.edit != null && dlg.editingIndex < 0,
    onmove: moveTo,
  });
  let drag = $derived(rowDrag.state);
</script>

      {#if !doc}
        <!-- 占满主区可见高度，卡片在其中横向、纵向居中 -->
        <div class="empty-wrap">
          <div class="empty card {enterCls}">
            <h1 class="empty-title">还没有打开对话</h1>
            <p class="empty-text">新建一份对话，或导入游戏导出的对话结构体 JSON（旧版格式会自动转换）。</p>
            <div class="pair">
              <button class="btn accent" onclick={() => requestNew("dialog")} disabled={dlg.busy}><Icon name="file" />新建对话</button>
              <button class="btn" data-tip="导入文件（Ctrl + O）" onclick={importFile} disabled={dlg.busy}><Icon name="import" />导入文件</button>
            </div>
          </div>
        </div>
      {:else}
        <div class="list-head {enterCls}">
          <h1>节点</h1>
          <span class="hint">共 {doc.nodes.length} 个</span>
          <span class="grow"></span>
          <!-- 撤销 / 重做：快捷键在 App.svelte 里绑定 -->
          <button class="icon-btn" data-tip="撤销（Ctrl + Z）" aria-label="撤销" onclick={undo} disabled={!dlg.canUndo}>
            <Icon name="undo" />
          </button>
          <button class="icon-btn" data-tip="重做（Ctrl + Y / Ctrl + Shift + Z）" aria-label="重做" onclick={redo} disabled={!dlg.canRedo}>
            <Icon name="redo" />
          </button>
        </div>
        <ul class="list" bind:this={listEl}>
          {#if drag && rowDrag.showLine}
            <DropLine top={drag.lineY} />
          {/if}
          {#each doc.nodes as node, i (node.uid)}
            <NodeRow
              {node}
              index={i}
              nodes={doc.nodes}
              isStart={doc.startNode === i}
              autoEnd={settings.autoEnd && isAutoEnd(doc.nodes, i)}
              selected={dlg.selectedUid === node.uid}
              canPaste={dlg.edit?.clipboard != null}
              enterDelay={dlg.stagger ? Math.min(i, 6) * 25 : 0}
              dragging={drag?.from === i}
              onedit={() => {
                dlg.selectedUid = node.uid;
                dlg.editingIndex = i;
              }}
              onaction={(action) => rowAction(i, action)}
              ongrip={(e) => rowDrag.start(i, e)}
            />
          {/each}
        </ul>
      {/if}

  {#if doc && dlg.editingIndex >= 0 && doc.nodes[dlg.editingIndex]}
    {#key doc.nodes[dlg.editingIndex].uid}
      <NodeEditor
        node={doc.nodes[dlg.editingIndex]}
        index={dlg.editingIndex}
        nodes={doc.nodes}
        isStart={doc.startNode === dlg.editingIndex}
        onsave={saveNode}
        oncancel={() => (dlg.editingIndex = -1)}
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
    margin-bottom: var(--s2);
  }
  .list-head h1 {
    margin-right: var(--s1);
  }
  .grow {
    flex: 1;
  }

  h1 {
    margin: 0;
    font-size: 18px;
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

  /* 主区（App.svelte 的 .main）上下各有 --s5 内边距：减去后正好是可见高度 */
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
  /* 标题居中、主题色，下方 3px 主题色分割线（同简单选择对话框的标题） */
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
