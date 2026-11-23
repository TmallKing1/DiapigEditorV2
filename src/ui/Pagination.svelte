<script lang="ts" module>
  /** 四个翻页按钮的可用状态（1-based）：首页在第 1、2 页不可用，上一页在第 1 页不可用，末页与下一页同理 */
  export function paginationDisabled(page: number, total: number) {
    return {
      first: page <= 2,
      prev: page <= 1,
      next: page >= total,
      last: page >= total - 1,
    };
  }
</script>

<script lang="ts">
  // 翻页控件：白色圆角条，居中显示当前页码与四个操作按钮（第一页 / 上一页 / 下一页 / 最后一页）。
  import Icon from "./Icon.svelte";

  let {
    page,
    total,
    onchange,
  }: {
    /** 当前页码（从 1 开始） */
    page: number;
    /** 总页数（至少为 1） */
    total: number;
    onchange: (nextPage: number) => void;
  } = $props();

  let dis = $derived(paginationDisabled(page, total));

  function go(next: number) {
    const clamped = Math.max(1, Math.min(total, next));
    if (clamped !== page) onchange(clamped);
  }
</script>

<nav class="pager-wrap" aria-label="分页导航">
  <div class="card setting pager">
    <button type="button" class="icon-btn" disabled={dis.first} data-tip="第一页" aria-label="第一页" onclick={() => go(1)}>
      <Icon name="chevs-left" />
    </button>
    <button type="button" class="icon-btn" disabled={dis.prev} data-tip="上一页" aria-label="上一页" onclick={() => go(page - 1)}>
      <Icon name="chev-left" />
    </button>
    <span class="pg-num" data-tip="第 {page} / {total} 页" aria-current="page">{page}</span>
    <button type="button" class="icon-btn" disabled={dis.next} data-tip="下一页" aria-label="下一页" onclick={() => go(page + 1)}>
      <Icon name="chev-right" />
    </button>
    <button type="button" class="icon-btn" disabled={dis.last} data-tip="最后一页" aria-label="最后一页" onclick={() => go(total)}>
      <Icon name="chevs-right" />
    </button>
  </div>
</nav>

<style>
  .pager-wrap {
    display: flex;
    justify-content: center;
    margin-top: var(--s3);
  }
  .pager {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
  }
  .pg-num {
    min-width: 32px;
    padding: 0 4px;
    text-align: center;
    font-size: 16px;
    font-weight: 600;
    color: var(--theme);
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
</style>
