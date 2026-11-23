<script lang="ts">
  // 任务列表的一行：编号、名称、提示与标点 / 范围徽标；操作按钮同对话节点行
  import type { RowAction } from "../lib/dialog.svelte";
  import { MARKER_NONE, type TaskItem, markerText } from "../model/task";
  import Icon from "./Icon.svelte";

  let {
    task,
    index,
    count,
    duplicate,
    selected,
    canPaste,
    enterDelay,
    dragging,
    onedit,
    onaction,
    ongrip,
  }: {
    task: TaskItem;
    index: number;
    count: number;
    /** 编号与别的任务重复 */
    duplicate: boolean;
    selected: boolean;
    canPaste: boolean;
    enterDelay: number;
    dragging: boolean;
    onedit: () => void;
    onaction: (action: RowAction) => void;
    ongrip: (e: PointerEvent) => void;
  } = $props();
</script>

<li class="row enter" class:selected class:dragging style:--enter-delay="{enterDelay}ms">
  <span class="grip" role="img" aria-label="拖动排序" data-tip="拖动排序" onpointerdown={ongrip}>
    <Icon name="grip" />
  </span>

  <button class="main" onclick={onedit} aria-label="编辑任务 {task.id}" data-tip="点击编辑任务。任务按列表顺序推进。">
    <span class="index" class:dup={duplicate} data-tip="任务编号">{task.id}</span>
    <span class="text">
      <span class="head">
        <span class="title">{task.name || "（未命名任务）"}</span>
        {#if duplicate}<span class="warn"><Icon name="warn" size={12} />编号重复</span>{/if}
      </span>
      <span class="content">{#if task.hint}{task.hint}{:else}<span class="muted">（无提示）</span>{/if}</span>
      <span class="meta">
        <span class="marker" class:none={task.marker === MARKER_NONE}>{markerText(task)}</span>
        {#if task.marker !== MARKER_NONE}<span>点位 {task.point}</span>{/if}
        {#if task.detect > 0}<span>检测 {task.detect} m</span>{/if}
        <span>{task.auto > 0 ? `自动推进 ${task.auto} m` : "由玩法推进"}</span>
        {#if task.optional}<span class="optional">可选：{task.optional}</span>{/if}
        {#if task.enterEvent}<span class="event">进入事件：{task.enterEvent}</span>{/if}
      </span>
    </span>
  </button>

  <span class="actions">
    <button class="icon-btn" data-tip="在此任务后添加新任务" aria-label="在此任务后添加新任务" onclick={() => onaction("add")}><Icon name="plus" /></button>
    <button class="icon-btn" data-tip="在此任务后添加一份副本" aria-label="在此任务后添加一份副本" onclick={() => onaction("duplicate")}><Icon name="duplicate" /></button>
    <button class="icon-btn" data-tip="复制到剪贴板" aria-label="复制到剪贴板" onclick={() => onaction("copy")}><Icon name="copy" /></button>
    <button class="icon-btn" data-tip="用剪贴板内容覆盖此任务" aria-label="用剪贴板内容覆盖此任务" disabled={!canPaste} onclick={() => onaction("paste")}><Icon name="paste" /></button>
    <button class="icon-btn" data-tip="上移" aria-label="上移" disabled={index === 0} onclick={() => onaction("up")}><Icon name="up" /></button>
    <button class="icon-btn" data-tip="下移" aria-label="下移" disabled={index === count - 1} onclick={() => onaction("down")}><Icon name="down" /></button>
    <button class="icon-btn danger" data-tip="删除此任务" aria-label="删除此任务" disabled={count <= 1} onclick={() => onaction("remove")}><Icon name="trash" /></button>
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
  .index.dup {
    border-color: var(--danger);
    color: var(--danger);
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
    font-weight: 700;
  }
  .muted {
    color: var(--text-3);
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
  .marker {
    color: var(--theme-deep);
  }
  .marker.none {
    color: var(--text-2);
  }
  .optional,
  .event {
    color: var(--text-3);
  }
  .warn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--danger);
    font-size: 12.5px;
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
