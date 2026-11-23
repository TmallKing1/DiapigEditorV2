<script lang="ts">
  // 全局悬停提示：代替原生 title 气泡（原生气泡有时不弹出）。
  // 带 data-tip="…" 的元素悬停约 0.5 秒后显示；移开、按下、滚动、缩放时收起。
  // 用委托监听 pointermove，禁用的按钮也能触发（它们不会收到 pointerenter 之类的事件）。
  import { tipIn, tipOut } from "./motion";

  const DELAY = 500;
  const MAX_W = 320;
  const GAP = 6;
  const MARGIN = 8;

  let tip = $state<{ text: string } | null>(null);
  let pos = $state<{ x: number; y: number } | null>(null);
  let bubble = $state<HTMLDivElement>();
  let anchor: DOMRect | null = null;
  let current: HTMLElement | null = null;
  let suppressed: HTMLElement | null = null;
  let timer = 0;

  function clearTimer() {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  }

  function hide() {
    clearTimer();
    current = null;
    tip = null;
    pos = null;
    anchor = null;
  }

  function show(el: HTMLElement) {
    const text = el.dataset.tip ?? "";
    if (!text || !el.isConnected) return;
    anchor = el.getBoundingClientRect();
    tip = { text };
    // 先放在锚点下方（宽度未知，最终位置由下面的 effect 修正）
    pos = { x: anchor.left, y: anchor.bottom + GAP };
  }

  // 拿到气泡实际尺寸后定位：与下拉框的说明气泡一致，左边对齐锚点；放不下就贴边，下方放不下则翻到上方
  $effect(() => {
    if (!tip || !bubble || !anchor) return;
    const w = bubble.offsetWidth;
    const h = bubble.offsetHeight;
    const x = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - w - MARGIN));
    const below = anchor.bottom + GAP;
    const y = below + h <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, anchor.top - GAP - h);
    if (!pos || pos.x !== x || pos.y !== y) pos = { x, y };
  });

  function onMove(e: PointerEvent) {
    const target = e.target instanceof Element ? e.target : null;
    const el = target?.closest<HTMLElement>("[data-tip]") ?? null;
    if (el === current) return;
    hide();
    if (!el || el === suppressed) return;
    current = el;
    timer = window.setTimeout(() => {
      timer = 0;
      if (current === el) show(el);
    }, DELAY);
  }

  function onOut(e: PointerEvent) {
    // 指针离开窗口
    if (!e.relatedTarget) hide();
  }

  function onDown() {
    // 点击后收起，直到指针移到别的提示元素上
    suppressed = current;
    hide();
  }

  $effect(() => {
    const move = (e: PointerEvent) => {
      // 指针移到了别的提示元素上，恢复显示
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-tip]") : null;
      if (suppressed && el !== suppressed) suppressed = null;
      onMove(e);
    };
    const hideNow = () => hide();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerout", onOut);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", hideNow, true);
    window.addEventListener("scroll", hideNow, true);
    window.addEventListener("resize", hideNow);
    window.addEventListener("blur", hideNow);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", hideNow, true);
      window.removeEventListener("scroll", hideNow, true);
      window.removeEventListener("resize", hideNow);
      window.removeEventListener("blur", hideNow);
      clearTimer();
    };
  });
</script>

{#if tip && pos}
  <div
    class="tip-bubble"
    style:max-width="{MAX_W}px"
    role="tooltip"
    bind:this={bubble}
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    in:tipIn
    out:tipOut
  >
    {tip.text}
  </div>
{/if}
