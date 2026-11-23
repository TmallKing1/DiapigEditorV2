<script lang="ts">
  // 尺寸输入框组：宽 × 高，各自校验范围，只有合法的那一边写入
  import { SIZE_H, SIZE_W } from "../model/prefs";
  import NumberField from "./NumberField.svelte";

  let {
    id,
    w,
    h,
    onchange,
    label,
  }: {
    id: string;
    w: number;
    h: number;
    onchange: (w: number, h: number) => void;
    /** 无障碍名称的前缀，如「逻辑画布」 */
    label: string;
  } = $props();
</script>

<span class="size">
  <NumberField id="{id}-w" value={w} min={SIZE_W.min} max={SIZE_W.max} ariaLabel="{label}宽度" onchange={(v) => onchange(v, h)} />
  <span class="times" aria-hidden="true">×</span>
  <NumberField id="{id}-h" value={h} min={SIZE_H.min} max={SIZE_H.max} ariaLabel="{label}高度" onchange={(v) => onchange(w, v)} />
</span>

<style>
  .size {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
  }
  .times {
    color: var(--text-2);
    font-size: 16px;
  }
</style>
