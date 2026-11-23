<script lang="ts" module>
  export type RadioOption = {
    value: string;
    label: string;
    disabled?: boolean;
    /** 悬停说明（不可选时写原因） */
    title?: string;
    /** 这一项的颜色：选中圆点、外框和悬停色（主题色选择用） */
    color?: string;
  };
</script>

<script lang="ts">
  // 单选按钮组：选项排成等宽的格子，各自在格内左对齐；放不下时自动换行。
  // 同一张卡片里的几组用相同的最小列宽，列的左边界上下对齐。
  let {
    name,
    options,
    value,
    onchange,
    ariaLabelledby,
    ariaLabel,
    columns,
    minColumn = 104,
  }: {
    name: string;
    options: RadioOption[];
    value: string;
    onchange: (value: string) => void;
    ariaLabelledby?: string;
    ariaLabel?: string;
    /** 固定列数；不传时按 minColumn 自动排 */
    columns?: number;
    minColumn?: number;
  } = $props();

  let template = $derived(columns ? `repeat(${columns}, minmax(0, 1fr))` : `repeat(auto-fill, minmax(${minColumn}px, 1fr))`);
</script>

<div class="radios" role="radiogroup" aria-labelledby={ariaLabelledby} aria-label={ariaLabel} style:grid-template-columns={template}>
  {#each options as o (o.value)}
    <label class="check" data-tip={o.title} style:--check-color={o.color} style:--check-idle={o.color}>
      <input
        type="radio"
        {name}
        value={o.value}
        checked={value === o.value}
        disabled={o.disabled}
        onchange={() => onchange(o.value)}
      />{o.label}
    </label>
  {/each}
</div>

<style>
  .radios {
    flex: 1;
    min-width: 0;
    display: grid;
    column-gap: var(--s3);
  }
  .radios > .check {
    justify-self: start;
    min-width: 0;
    white-space: nowrap;
  }
</style>
