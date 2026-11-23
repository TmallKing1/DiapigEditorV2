<script lang="ts">
  // 拖动排序的插入分界线，以及拖动虚影的全局样式（见 rowDrag.svelte.ts）
  let { top }: { top: number } = $props();
</script>

<li class="drop-line" aria-hidden="true" style:top="{top}px"></li>

<style>
  .drop-line {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2;
    height: 3px;
    margin-top: -1.5px;
    border-radius: 2px;
    background: var(--theme);
    pointer-events: none;
    transition: top 90ms var(--ease-out);
  }
  .drop-line::before,
  .drop-line::after {
    content: "";
    position: absolute;
    top: -3px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--theme);
  }
  .drop-line::before {
    left: -4px;
  }
  .drop-line::after {
    right: -4px;
  }

  :global(.drag-ghost) {
    position: fixed !important;
    z-index: 40;
    margin: 0;
    opacity: 0.88;
    box-shadow: var(--shadow-float) !important;
    pointer-events: none;
    rotate: 0.6deg;
  }
  :global(body.dragging-row),
  :global(body.dragging-row *) {
    cursor: grabbing !important;
    user-select: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .drop-line {
      transition: none;
    }
    :global(.drag-ghost) {
      rotate: none;
    }
  }
</style>
