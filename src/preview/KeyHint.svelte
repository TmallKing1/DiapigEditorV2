<script lang="ts">
  // 按键提示（原生按键提示控件的近似）。x、y 是中心点，坐标系与父元素相同（左、下）。
  // 键鼠：34×28 白色圆角矩形、圆角 2、外侧略带阴影，键名 #333333 居中。
  // 手柄：单键 34×34 的圆形（白描边、深色底、白色键名），LB 组合键 92×34 的胶囊；scale 是 SetLocalScale（绕中心）。
  // 游戏里手柄键位图标随玩家的手柄类型变化，这里统一画成 Xbox 的键名。
  import { KEY_HINT } from "../model/previewConfig";
  let { label, x, y, pad = false, wide = false, scale = 1 }: { label: string; x: number; y: number; pad?: boolean; wide?: boolean; scale?: number } = $props();
  const w = $derived(pad ? (wide ? 92 : 34) : KEY_HINT.w);
  const h = $derived(pad ? 34 : KEY_HINT.h);
</script>

<div
  class="key"
  class:pad
  class:wide
  style:left="{x - w / 2}px"
  style:bottom="{y - h / 2}px"
  style:width="{w}px"
  style:height="{h}px"
  style:border-radius={pad ? `${h / 2}px` : `${KEY_HINT.radius}px`}
  style:color={pad ? "#fff" : KEY_HINT.color}
  style:transform={scale !== 1 ? `scale(${scale})` : null}
>
  {label}
</div>

<style>
  .key {
    position: absolute;
    display: grid;
    place-items: center;
    background: #fff;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.35);
    font: 400 17px/1 var(--font-default);
    font-family: inherit;
    text-shadow: none;
    pointer-events: none;
    white-space: nowrap;
  }
  .key.pad {
    box-sizing: border-box;
    background: rgba(24, 28, 36, 0.78);
    border: 2px solid rgba(255, 255, 255, 0.92);
    font-size: 15px;
    font-weight: 600;
  }
  .key.wide {
    font-size: 14px;
  }
</style>
