<script lang="ts">
  // 对话预览窗口：没有原生标题栏。窗口里裁出与逻辑画布等比的最大居中框（框外全黑），框内是透明棋盘 +
  // 按 Lua 渲染的对话界面，整体按 k = min(宽 / 画布宽, 高 / 画布高) 等比缩放。
  // 键盘一律按键鼠键位（DialogRuntime.bindKeys）：F 确认、空格 / 左键继续、W / S 移动、1–4 选择；
  // Lua 没用到的 Esc 关闭预览，R 重新开始。接上手柄时（Gamepad API，标准布局）：A 确认、B 返回、X 自动、
  // Y 对话回顾、RB 隐藏 UI、十字键上下移动、LB + 十字键选非锁定选项、左摇杆移动锁定选项 / 摇杆滚动回顾。
  // 预览的设备（设置「设备预设」）决定工具栏样式、按键提示与选项卡尺寸，不限制用哪种输入。
  import { onMount, tick } from "svelte";
  import { isTauri } from "../lib/files";
  import { applyTheme, applyUiFont, loadCustomFonts } from "../lib/settings.svelte";
  import Icon from "../ui/Icon.svelte";
  import { PREVIEW_PLAYER_NAME, REVIEW } from "../model/previewConfig";
  import { fitBox, luaStage } from "../model/previewLayout";
  import { fontStack } from "../model/prefs";
  import { isPayload, KIND_LABEL, KIND_TYPE, PAYLOAD_EVENT, PAYLOAD_KEY, PREVIEW_READY_EVENT, simDevice, type PreviewPayload } from "../model/previewPayload";
  import { DialogSim, type Action, type Snapshot } from "../model/previewSim";
  import TooltipHost from "../ui/TooltipHost.svelte";
  import Stage from "./Stage.svelte";

  let payload = $state.raw<PreviewPayload | null>(null);
  let snap = $state.raw<Snapshot | null>(null);
  // 状态机本身不是响应式的：每帧把快照写进 snap 驱动渲染
  let sim = $state.raw<DialogSim | null>(null);
  let winW = $state(window.innerWidth);
  let winH = $state(window.innerHeight);
  /** 鼠标在右上角：显示阴影与关闭按钮 */
  let corner = $state(false);
  // 回顾页打开时右上角热区被移除，收不到 pointerleave：手动复位
  $effect(() => {
    if (snap?.review) corner = false;
  });

  const canvas = $derived(payload?.canvas ?? { w: 1600, h: 900 });
  const box = $derived(fitBox(winW, winH, canvas));
  // Lua 的舞台：框与画布等比，舞台恰好等于画布（luaStage 保留以便将来改为铺满窗口）
  const stage = $derived(luaStage(box.w || canvas.w, box.h || canvas.h, canvas));
  const device = $derived(payload ? simDevice(payload.device, payload.keyHint, payload.canvas.w) : "pc");
  // 预览字体在前，后面接主窗口的界面字体回退链（系统默认时为默认字体栈）
  const uiStack = $derived(fontStack(payload?.uiFonts ?? []) || "var(--font-default)");
  const fontFamily = $derived(payload?.font ? `"${payload.font.replaceAll('"', '\\"')}", ${uiStack}` : uiStack);

  let requestedSeq = -1;
  let loading = Promise.resolve();
  function load(p: PreviewPayload) {
    if (p.seq <= requestedSeq) return;
    requestedSeq = p.seq;
    // 字体注册是窗口级的。串行处理可防止较早的加载覆盖当前选用的字体。
    loading = loading.then(async () => {
      if (p.seq !== requestedSeq) return;
      await loadCustomFonts(p.customFonts);
      if (p.seq !== requestedSeq) return;
      applyTheme(p.themeColor);
      applyUiFont(p.uiFonts);
      payload = p;
      restart();
      if (isTauri) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await tick();
        if (p.seq !== requestedSeq) return;
        const win = getCurrentWindow();
        await win.show();
        await win.unminimize().catch(() => {});
        await win.setFocus().catch(() => {});
      }
    }).catch(console.error);
  }
  function restart() {
    if (!payload) return;
    sim = new DialogSim({
      nodes: payload.nodes,
      startNode: payload.startNode,
      type: KIND_TYPE[payload.kind],
      canvas: payload.canvas,
      playerName: PREVIEW_PLAYER_NAME,
      device: simDevice(payload.device, payload.keyHint, payload.canvas.w),
    });
    sim.start();
    snap = sim.snapshot();
  }
  function readStored() {
    try {
      const raw = localStorage.getItem(PAYLOAD_KEY);
      const p = raw ? JSON.parse(raw) : null;
      if (isPayload(p)) load(p);
    } catch {
      // 数据损坏：保持空白状态
    }
  }

  onMount(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PAYLOAD_KEY) readStored();
    };
    let unlisten: (() => void) | null = null;
    let disposed = false;
    if (isTauri) {
      void import("@tauri-apps/api/event").then(async ({ listen, emit }) => {
        const stop = await listen<unknown>(PAYLOAD_EVENT, (e) => {
          if (isPayload(e.payload)) load(e.payload);
        });
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        // 监听装好后再向主窗口请求首份数据，避免窗口还在加载时错过事件。
        await emit(PREVIEW_READY_EVENT);
      }).catch(console.error);
    } else {
      window.addEventListener("storage", onStorage);
      readStored();
    }
    // 逐帧推进：与游戏一样按真实经过时间（单帧最多 0.25 s，见 DialogSim.update）
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (sim) {
        pollPad(dt);
        sim.update(dt);
        snap = sim.snapshot();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      requestedSeq = -1;
      cancelAnimationFrame(raf);
      window.removeEventListener("storage", onStorage);
      unlisten?.();
    };
  });

  async function closePreview() {
    if (isTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().destroy();
    } else window.close();
  }

  const KEYS: Record<string, Action> = {
    KeyF: "confirm",
    Space: "continue",
    KeyW: "up",
    KeyS: "down",
    Digit1: "pick1",
    Digit2: "pick2",
    Digit3: "pick3",
    Digit4: "pick4",
    Numpad1: "pick1",
    Numpad2: "pick2",
    Numpad3: "pick3",
    Numpad4: "pick4",
  };
  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === "Escape") {
      e.preventDefault();
      void closePreview();
      return;
    }
    if (e.repeat) return; // 按住不重复（DialogRuntime 的 held 表）
    if (e.code === "KeyR") {
      restart();
      return;
    }
    // 结束后：继续键也能重新开始
    if (snap?.ended?.kind === "end" && (e.code === "KeyF" || e.code === "Space" || e.code === "Enter")) {
      e.preventDefault();
      restart();
      return;
    }
    const a = KEYS[e.code];
    if (a && sim) {
      e.preventDefault();
      sim.action(a);
    }
  }

  // 手柄（Gamepad API 标准布局）：按下沿触发一次，按住不重复
  let padPrev: boolean[] = [];
  function pollPad(dt: number) {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p) => p && p.connected);
    if (!gp || !sim) {
      sim?.setStick(0);
      padPrev = [];
      return;
    }
    const down = (i: number) => !!gp.buttons[i]?.pressed;
    const edge = (i: number) => down(i) && !padPrev[i];
    const act = (a: Action) => sim!.action(a);
    if (snap?.ended?.kind === "end" && edge(0)) restart();
    else {
      if (edge(0)) act("confirm");
      if (edge(1)) act("back");
      if (edge(2)) act("auto");
      if (edge(3)) act("review");
      if (edge(5)) act("hide");
      const lb = down(4);
      // 十字键：12 上、13 下、14 左、15 右；LB + 上 / 右 / 左 / 下 = 选项 1–4
      if (lb) {
        if (edge(12)) act("pick1");
        if (edge(15)) act("pick2");
        if (edge(14)) act("pick3");
        if (edge(13)) act("pick4");
      } else {
        if (edge(12)) act("up");
        if (edge(13)) act("down");
      }
    }
    // 摇杆纵轴：浏览器里向下为正，Lua 里向上为正
    const ly = -(gp.axes[1] ?? 0);
    const ry = -(gp.axes[3] ?? 0);
    sim.setStick(ly);
    if (snap?.review) {
      const v = Math.abs(ry) > Math.abs(ly) ? ry : ly;
      const view = document.querySelector<HTMLElement>(".rv-view");
      if (view && Math.abs(v) > REVIEW.stickDead) view.scrollTop -= v * REVIEW.stick * dt;
    }
    padPrev = gp.buttons.map((b) => b.pressed);
  }

  // 拖动窗口：在空白处按下后移动超过几个像素才开始拖，短按仍然算「点击继续」
  let downAt: { x: number; y: number } | null = null;
  let dragged = false;
  function onpointerdown(e: PointerEvent) {
    dragged = false;
    downAt = e.button === 0 && e.target instanceof Element && !e.target.closest("button, .live, .panel-review") ? { x: e.clientX, y: e.clientY } : null;
  }
  function onpointermove(e: PointerEvent) {
    if (!downAt || !(e.buttons & 1) || !isTauri) return;
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) return;
    downAt = null;
    dragged = true;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startDragging());
  }
  function onpointerup() {
    downAt = null;
    sim?.cardUp();
  }
  function onclick(e: MouseEvent) {
    if (dragged || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("button, .panel")) return;
    sim?.click();
  }
</script>

<svelte:window {onkeydown} bind:innerWidth={winW} bind:innerHeight={winH} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="root" {onpointerdown} {onpointermove} {onpointerup} {onclick}>
  <div class="frame" style:left="{box.x}px" style:top="{box.y}px" style:width="{box.w}px" style:height="{box.h}px">
    {#if snap && payload}
      <div
        class="stage"
        style:width="{stage.w}px"
        style:height="{stage.h}px"
        style:transform="scale({stage.k})"
        style:font-family={fontFamily}
      >
        <Stage {snap} canvas={payload.canvas} sim={sim!} keyHint={payload.keyHint} {device} />
      </div>
    {/if}
  </div>

  {#if !payload}
    <div class="panel enter center-panel">
      <span class="head"><Icon name="chat" size={20} />没有可预览的对话</span>
    </div>
  {:else if snap?.ended}
    {@const end = snap.ended}
    <div class="panel enter" class:center-panel={end.kind === "end"} class:top-panel={end.kind === "stall"}>
      {#if end.kind === "end"}
        <span class="head"><Icon name="check" size={20} />对话结束</span>
      {:else}
        <span class="head" data-tip={end.reason}><Icon name="warn" size={20} />停在节点 {end.node}</span>
      {/if}
      <span class="sep"></span>
      <span class="head kind"><Icon name="play" size={18} />{KIND_LABEL[payload.kind]}</span>
      <button class="btn accent" data-tip="重新开始（R）" onclick={restart}><Icon name="refresh" size={18} />重新开始</button>
      <button class="btn" data-tip="关闭预览（Esc）" onclick={() => void closePreview()}><Icon name="close" size={18} />关闭预览</button>
    </div>
  {/if}

  <!-- 右上角：鼠标移过来时出现阴影与关闭按钮；对话回顾打开时让位给回顾页自己的关闭叉（Esc 仍可关闭预览） -->
  {#if !snap?.review}
    <div class="corner" class:on={corner} onpointerenter={() => (corner = true)} onpointerleave={() => (corner = false)}>
      <div class="shade"></div>
      <button class="close" data-tip="关闭预览（Esc）" aria-label="关闭预览" tabindex={corner ? 0 : -1} onclick={() => void closePreview()}>
        <Icon name="close" size={22} />
      </button>
    </div>
  {/if}
  <TooltipHost />
</div>

<style>
  :global(body) {
    background: #000;
  }
  .root {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #000;
    user-select: none;
  }
  /* 等比框：透明棋盘表示「游戏场景不画」 */
  .frame {
    position: absolute;
    overflow: hidden;
    background-color: #c4c4c4;
    background-image:
      linear-gradient(45deg, #a6a6a6 25%, transparent 25%, transparent 75%, #a6a6a6 75%),
      linear-gradient(45deg, #a6a6a6 25%, transparent 25%, transparent 75%, #a6a6a6 75%);
    background-size: 24px 24px;
    background-position:
      0 0,
      12px 12px;
  }
  .stage {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    font-weight: 400;
    line-height: 1.2;
  }

  .panel {
    position: absolute;
    left: 50%;
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s3) var(--s4);
    border-radius: var(--r-panel);
    background: var(--surface);
    box-shadow: var(--shadow-float);
    color: var(--text);
    white-space: nowrap;
  }
  .center-panel {
    top: 50%;
    translate: -50% -50%;
  }
  .top-panel {
    top: var(--s6);
    translate: -50% 0;
  }
  .head {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    font-weight: 600;
    color: var(--theme-deep);
  }
  .head.kind {
    font-weight: 400;
    color: var(--text-2);
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--border);
  }

  .corner {
    position: absolute;
    top: 0;
    right: 0;
    width: 160px;
    height: 100px;
  }
  .shade {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 100% 100% at 100% 0, rgba(0, 0, 0, 0.5), transparent 70%);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--t-hover-out) var(--ease-out);
  }
  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #fff;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--t-hover-out) var(--ease-out),
      background-color var(--t-hover-out) var(--ease-out),
      transform var(--t-release) var(--ease-back);
  }
  .corner.on .shade,
  .corner.on .close {
    opacity: 1;
    transition-duration: 150ms;
  }
  .corner.on .close {
    pointer-events: auto;
  }
  .close:hover {
    background: rgba(255, 255, 255, 0.24);
  }
  .close:active {
    transform: scale(0.84);
    transition:
      background-color var(--t-hover-in) var(--ease-out),
      transform 120ms var(--ease-out);
  }
  @media (prefers-reduced-motion: reduce) {
    .close:active {
      transform: none;
    }
  }
</style>
