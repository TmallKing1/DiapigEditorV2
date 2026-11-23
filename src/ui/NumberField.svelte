<script lang="ts">
  // 整数输入框：只把范围内的整数交给 onchange；非法输入标红、不写入，失焦后恢复为当前有效值。
  import { parseIntIn } from "../model/prefs";

  let {
    id,
    value,
    min,
    max,
    onchange,
    ariaLabel,
    tip,
    disabled = false,
    suffix = "",
    width = 72,
  }: {
    id?: string;
    value: number;
    min: number;
    max: number;
    onchange: (value: number) => void;
    ariaLabel?: string;
    tip?: string;
    disabled?: boolean;
    /** 框后的单位文字，如「秒」 */
    suffix?: string;
    width?: number;
  } = $props();

  let text = $state("");
  let invalid = $state(false);
  let focused = false;

  // 外部改了值（重置、联动）且不在输入中时同步显示
  $effect.pre(() => {
    const v = value;
    if (!focused) {
      text = String(v);
      invalid = false;
    }
  });

  function oninput(e: Event & { currentTarget: HTMLInputElement }) {
    text = e.currentTarget.value;
    const n = parseIntIn(text, { min, max });
    invalid = n == null;
    if (n != null && n !== value) onchange(n);
  }

  function onblur() {
    focused = false;
    text = String(value);
    invalid = false;
  }
</script>

<span class="num">
  <input
    {id}
    {disabled}
    class="input"
    class:invalid
    style:width="{width}px"
    inputmode="numeric"
    maxlength="6"
    aria-label={ariaLabel}
    aria-invalid={invalid}
    data-tip={`${min}～${max} 的整数${suffix ? `（${suffix}）` : ""}${tip ? `\n${tip}` : ""}`}
    value={text}
    {oninput}
    onfocus={() => (focused = true)}
    {onblur}
    onkeydown={(e) => {
      if (e.key === "Enter") e.currentTarget.blur();
    }}
  />
  {#if suffix}<span class="suffix">{suffix}</span>{/if}
</span>

<style>
  .num {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
  }
  .input {
    text-align: center;
  }
  .suffix {
    color: var(--text-2);
    white-space: nowrap;
  }
</style>
