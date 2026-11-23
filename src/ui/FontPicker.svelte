<script lang="ts">
  // 字体选择器下拉框：系统已安装的字体，注册的自定义字体置顶。
  // value 为字体家族名；空串是第一项（「系统默认」，或传了 followLabel 时的「跟随界面字体」）。
  import { type FontFamily, customFontState, fontLabel, listFonts, settings } from "../lib/settings.svelte";
  import Dropdown, { type DropdownOption } from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";

  let {
    id,
    value,
    onchange,
    followLabel = "",
    tip = "",
    ariaLabel,
    disabled = false,
  }: {
    id: string;
    value: string;
    onchange: (value: string) => void;
    /** 传了就把空串那一项显示成这段文字（如「跟随界面字体」）；不传为「系统默认」 */
    followLabel?: string;
    tip?: string;
    ariaLabel?: string;
    disabled?: boolean;
  } = $props();

  let fonts = $state<FontFamily[] | null>(null);
  let error = $state("");
  /** 读取超过 150 ms 才显示加载文字，避免一闪而过（动效规范 5.4） */
  let showLoading = $state(false);

  async function load() {
    error = "";
    fonts = null;
    const timer = setTimeout(() => (showLoading = true), 150);
    try {
      fonts = await listFonts();
    } catch (e) {
      error = String(e);
    } finally {
      clearTimeout(timer);
      showLoading = false;
    }
  }
  load();

  let options = $derived.by<DropdownOption[]>(() => {
    if (!fonts) return [];
    const list: DropdownOption[] = [
      followLabel
        ? { value: "", label: followLabel, font: "var(--font-ui, var(--font-default))" }
        : { value: "", label: "系统默认（微软雅黑 UI）", font: "var(--font-default)" },
    ];
    const custom = settings.customFonts;
    for (const f of custom) {
      // 文件丢失或读不了的自定义字体仍列出（设置里可能还引用着），标明失效
      const bad = customFontState[f.family]?.status === "error";
      list.push({ value: f.family, label: `${f.family}（${bad ? "自定义，失效" : "自定义"}）`, font: `"${f.family.replaceAll('"', '\\"')}", var(--font-default)` });
    }
    // 已保存的字体不在列表里（被卸载）时仍显示出来，避免跳回第一项
    if (value && !fonts.some((f) => f.name === value) && !custom.some((f) => f.family === value)) {
      list.push({ value, label: `${value}（未找到）` });
    }
    for (const f of fonts) list.push({ value: f.name, label: fontLabel(f), font: `"${f.name}", var(--font-default)` });
    return list;
  });
</script>

{#if error}
  <span class="error" data-tip={error}>读取系统字体失败</span>
  <button class="btn" onclick={load}><Icon name="refresh" />重试</button>
{:else}
  <Dropdown
    {id}
    {options}
    {value}
    {onchange}
    {ariaLabel}
    disabled={disabled || fonts == null}
    placeholder={showLoading ? "正在读取系统字体…" : ""}
    tip={tip && fonts ? `${tip}\n共 ${fonts.length} 种字体。` : tip}
  />
{/if}

<style>
  .error {
    flex: 1;
    min-width: 0;
    color: var(--danger);
    font-size: 12.5px;
  }
</style>
