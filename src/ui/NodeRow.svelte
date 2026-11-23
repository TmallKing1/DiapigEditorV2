<script lang="ts">
  import { nodeLabel, titleText } from "../lib/labels";
  import {
    type DialogNode,
    OP_BRANCH,
    OP_END,
    OP_JUMP,
    OP_LABELS,
    NONLOCKED_MAX_BRANCHES,
    PLAYER_NAME,
    TEXT_MODE_LABELS,
  } from "../model/types";
  import Icon from "./Icon.svelte";
  import RichText from "./RichText.svelte";

  let {
    node,
    index,
    nodes,
    isStart,
    autoEnd = false,
    selected,
    canPaste,
    enterDelay,
    dragging,
    onedit,
    onaction,
    ongrip,
  }: {
    node: DialogNode;
    index: number;
    nodes: DialogNode[];
    isStart: boolean;
    /** 末尾的「跳转下个节点」按「结束对话」显示（设置「自动处理末尾结束」） */
    autoEnd?: boolean;
    selected: boolean;
    canPaste: boolean;
    enterDelay: number;
    /** 正被拖动：原位只留淡化的占位 */
    dragging: boolean;
    onedit: () => void;
    onaction: (action: "add" | "duplicate" | "copy" | "paste" | "up" | "down" | "remove") => void;
    /** 在拖动手柄上按下；拖动由列表统一处理 */
    ongrip: (e: PointerEvent) => void;
  } = $props();

  let target = (i: number) => (nodes[i] ? nodeLabel(nodes[i], i) : `#${i}（不存在）`);
  let events = $derived(
    [node.enterEvent && `进入：${node.enterEvent}`, node.leaveEvent && `离开：${node.leaveEvent}`]
      .filter(Boolean)
      .join("　"),
  );
</script>

<li
  class="row enter"
  class:selected
  class:dragging
  style:--enter-delay="{enterDelay}ms"
>
  <span class="grip" role="img" aria-label="拖动排序" data-tip="拖动排序" onpointerdown={ongrip}>
    <Icon name="grip" />
  </span>

  <button class="main" onclick={onedit} aria-label="编辑节点 {index}" data-tip="点击编辑节点">
    <span class="index">{index}</span>
    <span class="text">
      <span class="head">
        <span class="title" class:player={node.title === PLAYER_NAME && !node.inheritTitle} class:muted={node.inheritTitle}>
          {#if node.title === PLAYER_NAME && !node.inheritTitle}<Icon name="user" size={14} />{/if}
          {titleText(node)}
        </span>
        {#if node.subtitle && !node.inheritTitle}<span class="subtitle">{node.subtitle}</span>{/if}
        {#if isStart}<span class="badge"><Icon name="flag" size={12} />开始节点</span>{/if}
        {#if node.textMode !== 0}<span class="badge plain">{TEXT_MODE_LABELS[node.textMode]}</span>{/if}
        {#if node.duration > 0}<span class="badge plain">{node.duration} 秒</span>{/if}
      </span>
      <span class="content">{#if node.content}<RichText text={node.content} />{:else}<span class="muted">（无内容）</span>{/if}</span>
      <span class="meta">
        <span class="op" class:end={node.op === OP_END} data-tip={autoEnd ? "末尾节点，按「结束对话」导出" : undefined}>{OP_LABELS[autoEnd ? OP_END : node.op]}</span>
        {#if node.op === OP_JUMP}
          <span>→ {target(node.jump)}</span>
        {:else if node.op === OP_BRANCH}
          {#if node.branches.length === 0}
            <span class="warn"><Icon name="warn" size={12} />暂无分支</span>
          {:else}
            {#each node.branches as branch, i}
              <span class="branch">
                {i === node.defaultBranch ? "★" : ""}{branch.title || "（空）"} → #{branch.jump}
              </span>
            {/each}
            {#if node.branches.length > NONLOCKED_MAX_BRANCHES}
              <span class="warn" data-tip="非锁定对话只显示前 {NONLOCKED_MAX_BRANCHES} 个"
                ><Icon name="warn" size={12} />非锁定只显示前 {NONLOCKED_MAX_BRANCHES} 个</span
              >
            {/if}
          {/if}
        {/if}
        {#if events}<span class="events">{events}</span>{/if}
      </span>
    </span>
  </button>

  <span class="actions">
    <button class="icon-btn" data-tip="在此节点后添加新节点" aria-label="在此节点后添加新节点" onclick={() => onaction("add")}><Icon name="plus" /></button>
    <button class="icon-btn" data-tip="在此节点后添加一份副本" aria-label="在此节点后添加一份副本" onclick={() => onaction("duplicate")}><Icon name="duplicate" /></button>
    <button class="icon-btn" data-tip="复制到剪贴板" aria-label="复制到剪贴板" onclick={() => onaction("copy")}><Icon name="copy" /></button>
    <button class="icon-btn" data-tip="用剪贴板内容覆盖此节点" aria-label="用剪贴板内容覆盖此节点" disabled={!canPaste} onclick={() => onaction("paste")}><Icon name="paste" /></button>
    <button class="icon-btn" data-tip="上移" aria-label="上移" disabled={index === 0} onclick={() => onaction("up")}><Icon name="up" /></button>
    <button class="icon-btn" data-tip="下移" aria-label="下移" disabled={index === nodes.length - 1} onclick={() => onaction("down")}><Icon name="down" /></button>
    <button class="icon-btn danger" data-tip="删除此节点" aria-label="删除此节点" disabled={nodes.length <= 1} onclick={() => onaction("remove")}><Icon name="trash" /></button>
  </span>
</li>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: stretch;
    background: var(--surface);
    border-radius: var(--r-card);
    box-shadow: var(--shadow);
    transition:
      box-shadow var(--t-hover-out) var(--ease-out),
      background-color var(--t-hover-out) var(--ease-out);
  }
  .row:hover {
    box-shadow: var(--shadow-hover);
    transition-duration: var(--t-hover-in);
  }
  /* 选中：主题色竖条 + 浅底（7.3） */
  .row::before {
    content: "";
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 2px;
    background: var(--theme);
    opacity: 0;
    transition: opacity var(--t-hover-out) var(--ease-out);
  }
  .row.selected {
    background: var(--tint-bg);
  }
  .row.selected::before {
    opacity: 1;
  }
  .row.dragging {
    opacity: 0.35;
    box-shadow: none;
  }
  .grip {
    display: flex;
    align-items: center;
    padding: 0 2px 0 8px;
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
    transition: color var(--t-hover-out) var(--ease-out);
  }
  .grip:hover {
    color: var(--theme);
    transition-duration: var(--t-hover-in);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: var(--s3);
    align-items: flex-start;
    padding: var(--s3) var(--s2);
    border: 0;
    border-radius: var(--r-card);
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .index {
    flex: none;
    min-width: 28px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid var(--theme-light);
    border-radius: 3px;
    color: var(--theme-deep);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
    text-align: center;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2);
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 700;
  }
  .title.player {
    color: #8a5a00;
  }
  .subtitle {
    color: var(--text-2);
    font-size: 12.5px;
  }
  .muted {
    color: var(--text-3);
    font-weight: 400;
  }
  .content {
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px var(--s3);
    font-size: 12.5px;
    color: var(--text-2);
  }
  .op {
    color: var(--theme-deep);
  }
  .op.end {
    color: var(--text-2);
  }
  .warn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #8a5a00;
  }
  .events {
    color: var(--text-3);
  }
  .actions {
    flex: none;
    display: flex;
    align-items: center;
    padding-right: var(--s2);
  }
  @media (max-width: 760px) {
    .row {
      flex-wrap: wrap;
    }
    .actions {
      width: 100%;
      justify-content: flex-end;
      padding-bottom: var(--s1);
    }
  }
</style>
