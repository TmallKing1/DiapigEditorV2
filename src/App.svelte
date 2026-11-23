<script lang="ts">
  import { isTauri, isWindowMaximized, minimizeWindow, onWindowResized, requestClose, toggleMaximizeWindow } from "./lib/files";
  import { dlg } from "./lib/dialog.svelte";
  import { importFileFor } from "./lib/fileSession.svelte";
  import { finishNew, initHomeSession, newDocument, sessionFor } from "./lib/home.svelte";
  import { tsk } from "./lib/task.svelte";
  import { type Page, SUB_PAGES, closeAllSubs, closeSub, nav } from "./lib/nav.svelte";
  import { removeCornerAction, upsertCornerAction } from "./lib/cornerActions.svelte";
  import { fit } from "./lib/primfit.svelte";
  import { primfitProgress } from "./model/primfit";
  import { resetPage } from "./lib/reset";
  import { titleBarText } from "./lib/settings.svelte";
  import { closeAsk, confirm, runAsk, toast, ui } from "./lib/ui.svelte";
  import { answerPath, pathAsk } from "./lib/pathPrompt.svelte";
  import { JOYPAD_DISCLAIMER, acceptJoypadDisclaimer, cancelJoypadDisclaimer, joypad, submitJoypadUid } from "./lib/joypad.svelte";
  import RadioGroup from "./ui/RadioGroup.svelte";
  import Icon from "./ui/Icon.svelte";
  import Modal from "./ui/Modal.svelte";
  import NewDocumentTabDialog from "./ui/NewDocumentTabDialog.svelte";
  import HomeMain from "./pages/HomeMain.svelte";
  import HomeSide from "./pages/HomeSide.svelte";
  import HistoryMain from "./pages/HistoryMain.svelte";
  import HistorySide from "./pages/HistorySide.svelte";
  import DialogMetaMain from "./pages/DialogMetaMain.svelte";
  import TaskMetaMain from "./pages/TaskMetaMain.svelte";
  import SettingsMain from "./pages/SettingsMain.svelte";
  import SettingsSide from "./pages/SettingsSide.svelte";
  import SideTabs, { type SideTab } from "./pages/SideTabs.svelte";
  import RichTextPage from "./pages/RichTextPage.svelte";
  import GrowthPage from "./pages/GrowthPage.svelte";
  import PrimFitPage from "./pages/PrimFitPage.svelte";
  import PixelArtPage from "./pages/PixelArtPage.svelte";
  import CommentPage from "./pages/CommentPage.svelte";
  import CapsuleHost from "./ui/CapsuleHost.svelte";
  import CornerActionsHost from "./ui/CornerActionsHost.svelte";
  import PreviewHost from "./ui/PreviewHost.svelte";
  import TooltipHost from "./ui/TooltipHost.svelte";
  import ContextMenu from "./ui/ContextMenu.svelte";
  import { tick, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import { toastIn, toastOut } from "./ui/motion";
  import { flip } from "svelte/animate";

  let mainEl = $state<HTMLElement>();

  // —— 顶栏页签与页面切换（动效规范 5.1 / 5.2） ——
  // 页签选中立即反馈；内容按“旧内容退出 → 左侧栏宽度变化 → 新内容进入”三段进行。
  // 快速连点只完成最后一次目标：每次切换带代次号，旧流程在下一个等待点自行放弃。
  // 子页面（nav.subs）与页签用同一套切换：视图键为页签 id 或 "sub:<子页面 id>"。
  const PAGES: { id: Page; label: string; icon: string; sideWidth: number }[] = [
    { id: "home", label: "主页", icon: "doc", sideWidth: 288 },
    // 多页签侧栏：最长子页签（12 + 图标 18 + 8 + 文字 + 12）再加右侧「重置」按钮的位置
    { id: "more", label: "更多", icon: "grid", sideWidth: 168 },
    { id: "settings", label: "设置", icon: "settings", sideWidth: 140 },
  ];
  const MORE_TABS: SideTab[] = [
    { id: "richtext", label: "富文本编辑", icon: "type" },
    { id: "growth", label: "成长曲线", icon: "chart" },
    { id: "primfit", label: "图元拟合", icon: "shapes" },
    { id: "pixelart", label: "像素画生成", icon: "image" },
    { id: "comment", label: "评论抓取", icon: "chat" },
  ];
  /** 主区实际显示的「更多」子页：切页时旧内容先上移淡出，再换成 nav.moreTab 入场 */
  let moreShown = $state(nav.moreTab);
  let moreKey = $state(0);
  let moreLeaving = $state(false);
  let moreTimer: ReturnType<typeof setTimeout> | undefined;
  const SUB_LEAVE_MS = 150;
  function pickMore(id: string) {
    nav.moreTab = id;
    moreLeaving = true;
    clearTimeout(moreTimer);
    moreTimer = setTimeout(() => {
      if (mainEl) mainEl.scrollTop = 0;
      moreShown = nav.moreTab;
      moreKey++;
      moreLeaving = false;
    }, SUB_LEAVE_MS);
  }
  /** 跨页面快捷跳转到「更多」下的指定子页（如右下角进度按钮跳到图元拟合） */
  function jumpToMore(id: string) {
    const inSub = nav.subs.length > 0;
    if (inSub) closeAllSubs();
    if (!inSub && nav.tab === "more") {
      if (nav.moreTab !== id) pickMore(id);
      return;
    }
    clearTimeout(moreTimer);
    moreLeaving = false;
    nav.moreTab = id;
    moreShown = id;
    nav.tab = "more";
  }

  // 右下角「图元拟合」进度按钮：有正在运行的拟合任务且当前不在图元拟合页面时显示
  $effect(() => {
    const onPrimFit = nav.subs.length === 0 && nav.tab === "more" && nav.moreTab === "primfit";
    if (fit.running && !onPrimFit) {
      const info = primfitProgress({
        done: fit.done,
        goal: fit.goal,
        refineGoal: fit.refineGoal,
        stopping: fit.stopping,
        refining: fit.refining,
      });
      upsertCornerAction({
        id: "primfit-progress",
        icon: "shapes",
        label: `图元拟合进度 ${info.percent}%`,
        detail: info.detail,
        progress: info.progress,
        onclick: () => jumpToMore("primfit"),
      });
    } else {
      removeCornerAction("primfit-progress");
    }
  });
  /** 设置页同样的子页签切换 */
  let settingsShown = $state(nav.settingsTab);
  let settingsKey = $state(0);
  let settingsLeaving = $state(false);
  let settingsTimer: ReturnType<typeof setTimeout> | undefined;
  function pickSettings(id: string) {
    nav.settingsTab = id;
    settingsLeaving = true;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      if (mainEl) mainEl.scrollTop = 0;
      settingsShown = nav.settingsTab;
      settingsKey++;
      settingsLeaving = false;
    }, SUB_LEAVE_MS);
  }

  /** 页签右侧的「重置」：确认后把该页面的参数恢复默认，并重新挂载正在显示的页面 */
  function askReset(t: SideTab) {
    confirm({
      title: "重置确认",
      message: `是否要重置『${t.label}』页面的所有设置？\n该操作不可撤销`,
      action: "重置",
      danger: true,
      run: () => {
        resetPage(t.id);
        if (moreShown === t.id) moreKey++;
        if (settingsShown === t.id) settingsKey++;
        toast(`已重置『${t.label}』页面`);
      },
    });
  }

  const LEAVE_MS = 90;
  const RESIZE_MS = 220;
  const sideWidthOf = (view: string) =>
    view.startsWith("sub:") ? (SUB_PAGES[view.slice(4)]?.sideWidth ?? 0) : PAGES.find((p) => p.id === view)!.sideWidth;
  /** 目标视图：有子页面时是最上面的子页面，否则是当前页签 */
  let target = $derived(nav.subs.length ? `sub:${nav.subs.at(-1)!.id}` : nav.tab);
  /** 当前渲染内容的视图；null = 两段内容之间（左侧栏正在变宽 / 变窄） */
  let shown = $state<string | null>("home");
  let leaving = $state(false);
  let sideW = $state(PAGES[0].sideWidth);
  /** 首次显示随主窗口入场，不再叠加内容入场 */
  let firstShow = $state(true);
  let enterCls = $derived(firstShow ? "" : "enter");
  let current = "home";
  let switchGen = 0;
  const scrollMemo: Record<string, number> = {};

  async function switchTo(next: string) {
    if (next === current) return; // 再次点击当前页签不重播
    // 离开主页时自动保存一次当前页签的文件（开启了编辑过程中自动保存时）
    if (current === "home") void sessionFor(nav.homeTab).autoSave();
    current = next;
    firstShow = false;
    const gen = ++switchGen;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = (ms: number) => new Promise<boolean>((r) => setTimeout(() => r(gen === switchGen), reduce ? 0 : ms));
    if (shown) {
      scrollMemo[shown] = mainEl?.scrollTop ?? 0;
      leaving = true;
      if (!(await wait(LEAVE_MS))) return;
    }
    shown = null;
    leaving = false;
    const width = sideWidthOf(next);
    if (sideW !== width) {
      sideW = width;
      if (!(await wait(RESIZE_MS))) return;
    }
    if (next === "home") sessionFor(nav.homeTab).playStagger();
    shown = next;
    await tick();
    if (mainEl) mainEl.scrollTop = scrollMemo[next] ?? 0;
  }
  $effect(() => {
    const next = target;
    untrack(() => void switchTo(next));
  });

  // 顶栏：子页面标题在退场期间保持最后一次的文字。文件设置页标题后接文件名
  let subOpen = $derived(nav.subs.length > 0);
  let subTitle = $state("");
  $effect(() => {
    const top = nav.subs.at(-1);
    if (!top) return;
    const file = top.id === "dialogMeta" ? dlg.fileName || "未命名对话" : top.id === "taskMeta" ? tsk.fileName || "未命名任务链" : "";
    subTitle = file ? `${top.title} - ${file}` : top.title;
  });

  $effect(() => initHomeSession());

  let maximized = $state(false);
  async function toggleMaximize() {
    maximized = await toggleMaximizeWindow();
  }
  $effect(() => {
    if (!isTauri) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void isWindowMaximized().then((m) => {
      if (!cancelled) maximized = m;
    });
    onWindowResized(() => {
      void isWindowMaximized().then((m) => {
        if (!cancelled) maximized = m;
      });
    }).then((fn) => (cancelled ? fn() : (off = fn)));
    return () => {
      cancelled = true;
      off?.();
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (ui.ask || newDocument.kind || pathAsk.current || joypad.prompting || joypad.disclaimer || dlg.editingIndex >= 0 || tsk.editingIndex >= 0 || e.defaultPrevented) return;
    // Esc：从子页面返回上一层（对话框、下拉菜单各自处理并拦下自己的 Esc）
    if (e.key === "Escape" && subOpen && !document.querySelector('[role="dialog"], [role="listbox"]')) {
      e.preventDefault();
      closeSub();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || shown !== "home") return;
    const s = sessionFor(nav.homeTab);
    const key = e.key.toLowerCase();
    // 输入框里的撤销 / 重做交给输入框自己
    const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]") != null;
    if (key === "s") {
      e.preventDefault();
      // 结构体 ID 没填时 saveFile 会聚焦侧栏里的替身，转到元数据视图
      if (s.edit) void s.saveFile(e.shiftKey || !s.filePath);
    } else if (key === "o") {
      e.preventDefault();
      void importFileFor(nav.homeTab);
    } else if (key === "z" && !typing) {
      e.preventDefault();
      if (e.shiftKey) s.redo();
      else s.undo();
    } else if (key === "y" && !typing) {
      e.preventDefault();
      s.redo();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="app">
  <!-- 桌面端没有系统标题栏：整条顶部栏可拖动窗口，右侧是自绘的最小化 / 关闭 -->
  <header class="topbar" class:desktop={isTauri} class:sub={subOpen} data-tauri-drag-region>
    <div class="bar-main" inert={subOpen} data-tauri-drag-region>
      {#if titleBarText()}<span class="brand">{titleBarText()}</span>{/if}
      <nav class="tabs" aria-label="页面">
        {#each PAGES as p (p.id)}
          <button class="tab" class:active={nav.tab === p.id} aria-current={nav.tab === p.id ? "page" : undefined} onclick={() => (nav.tab = p.id)}>
            <Icon name={p.icon} size={18} />{p.label}
          </button>
        {/each}
      </nav>
    </div>
    <div class="bar-sub" inert={!subOpen} data-tauri-drag-region>
      <button class="win-btn" data-tip="返回（Esc）" aria-label="返回" onclick={closeSub}>
        <Icon name="back" size={24} />
      </button>
      <span class="sub-title-box">
        {#key subTitle}
          <span class="sub-title" in:fade={{ duration: 150, delay: 100 }} out:fade={{ duration: 100 }}>{subTitle}</span>
        {/key}
      </span>
    </div>
    <span class="spacer"></span>
    {#if isTauri}
      <div class="win">
        <button class="win-btn" data-tip="最小化" aria-label="最小化" onclick={() => void minimizeWindow()}>
          <Icon name="minimize" size={24} />
        </button>
        <button
          class="win-btn"
          data-tip={maximized ? "向下还原" : "最大化"}
          aria-label={maximized ? "向下还原" : "最大化"}
          onclick={() => void toggleMaximize()}
        >
          <Icon name={maximized ? "restore" : "maximize"} size={24} />
        </button>
        <button class="win-btn" data-tip="关闭" aria-label="关闭" onclick={() => void requestClose()}>
          <Icon name="close" size={24} />
        </button>
      </div>
    {/if}
  </header>

  <div class="body window-enter">
    <!-- 共用左侧栏：整块白色面板，宽度随页面平滑变化；本身没有悬停反馈。宽度为 0 的页面没有左侧栏 -->
    <aside class="side" class:none={sideW === 0} style:--side-w="{sideW}px">
      {#if shown === "settings"}
        <!-- 多页签侧栏：页签逐个从左侧滑入（错峰），同步向左滑出 -->
        <div class="side-inner">
          <SettingsSide current={nav.settingsTab} onpick={pickSettings} onreset={askReset} entering={!firstShow} {leaving} />
        </div>
      {:else if shown === "more"}
        <div class="side-inner">
          <SideTabs
            tabs={MORE_TABS}
            current={nav.moreTab}
            label="更多功能"
            onpick={pickMore}
            onreset={askReset}
            entering={!firstShow}
            {leaving}
          />
        </div>
      {:else if shown === "home"}
        <!-- 主页侧栏：从侧栏中心轻回弹放大进入，直接缩小淡出离开 -->
        <div class="side-inner" class:pop-in={!firstShow} class:pop-out={leaving}>
          <HomeSide />
        </div>
      {:else if shown === "sub:history"}
        <div class="side-inner">
          <HistorySide entering={!firstShow} {leaving} />
        </div>
      {/if}
    </aside>

    <div class="main-wrap">
      <main class="main" bind:this={mainEl}>
        {#if shown === "settings"}
          <div class="page" class:leave={leaving}>
            {#key settingsKey}
              <div class="sub-page" class:sub-leave={settingsLeaving}>
                <SettingsMain tab={settingsShown} />
              </div>
            {/key}
          </div>
        {:else if shown === "more"}
          <div class="page" class:leave={leaving}>
            {#key moreKey}
              <div class="sub-page" class:sub-leave={moreLeaving}>
                {#if moreShown === "richtext"}
                  <RichTextPage {toast} />
                {:else if moreShown === "primfit"}
                  <PrimFitPage {toast} />
                {:else if moreShown === "pixelart"}
                  <PixelArtPage {toast} />
                {:else if moreShown === "comment"}
                  <CommentPage {toast} scroller={mainEl} active={target === "more" && nav.moreTab === "comment"} />
                {:else}
                  <GrowthPage {toast} />
                {/if}
              </div>
            {/key}
          </div>
        {:else if shown === "home"}
          <!-- 主容器内容各自入场（标题、卡片），外层只负责退场 -->
          <div class="page" class:leave={leaving}>
            <HomeMain scroller={mainEl} {enterCls} />
          </div>
        {:else if shown === "sub:history"}
          <div class="page" class:leave={leaving}>
            <HistoryMain />
          </div>
        {:else if shown === "sub:dialogMeta"}
          <div class="page" class:leave={leaving}>
            <DialogMetaMain />
          </div>
        {:else if shown === "sub:taskMeta"}
          <div class="page" class:leave={leaving}>
            <TaskMetaMain />
          </div>
        {/if}
      </main>
      <CapsuleHost leaving={leaving || moreLeaving || settingsLeaving} />
    </div>
  </div>

  <!-- 跨整个 Editor 的右下角操作按钮（z-index 低于对话框遮罩，被覆盖时无法操作） -->
  <CornerActionsHost />

  <!-- 对话预览的询问对话框等 -->
  <PreviewHost />
  <TooltipHost />
  <ContextMenu />

  {#if newDocument.kind}
    {@const session = sessionFor(newDocument.kind)}
    <NewDocumentTabDialog
      kind={newDocument.kind}
      dirty={session.dirty}
      busy={session.busy}
      onconfirm={finishNew}
      oncancel={() => (newDocument.kind = null)}
    />
  {/if}

  {#if ui.ask}
    {@const a = ui.ask}
    {@const marked = a.actions.findIndex((x) => x.focus)}
    {@const focusAt = marked >= 0 ? marked : a.actions.findIndex((x) => !x.run)}
    <Modal title={a.title} width={a.width ?? 440} tone={a.tone ?? "info"} onclose={closeAsk}>
      <p class="confirm-text">{a.message}</p>
      {#snippet footer()}
        {#each a.actions as action, i}
          <button
            class="btn"
            class:danger={action.style === "danger"}
            class:accent={action.style === "accent"}
            data-autofocus={i === focusAt ? "" : undefined}
            onclick={() => runAsk(action)}
          >
            {action.label}
          </button>
        {/each}
      {/snippet}
    </Modal>
  {/if}

  <!-- 调试选项「手动输入文件路径」：代替系统的打开 / 保存对话框 -->
  {#if pathAsk.current}
    {@const p = pathAsk.current}
    <Modal title="输入打开/保存的文件/文件夹路径" width={520} tone="info" onclose={() => answerPath(null)}>
      <input
        class="input path-input"
        aria-label={p.title}
        placeholder={p.title}
        spellcheck="false"
        data-autofocus
        bind:value={p.value}
        onkeydown={(e) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            answerPath(p.value);
          }
        }}
      />
      {#snippet footer()}
        <button class="btn" onclick={() => answerPath(null)}>取消</button>
        <button class="btn accent" onclick={() => answerPath(p.value)}>确定</button>
      {/snippet}
    </Modal>
  {/if}

  {#if joypad.disclaimer}
    <Modal title="免责声明" width={560} tone="danger" onclose={cancelJoypadDisclaimer}>
      <p class="confirm-text">{JOYPAD_DISCLAIMER}</p>
      {#snippet footer()}
        <button class="btn" data-autofocus onclick={cancelJoypadDisclaimer}>取消</button>
        <button class="btn danger" disabled={joypad.seconds > 0} onclick={() => { void acceptJoypadDisclaimer(); }}>
          {joypad.seconds > 0 ? `仍然继续（${joypad.seconds} 秒）` : "仍然继续"}
        </button>
      {/snippet}
    </Modal>
  {/if}

  {#if joypad.prompting}
    <Modal title="选择原神 UID" width={440} tone="info" onclose={() => { joypad.prompting = false; }}>
      <RadioGroup name="joypad-uid" ariaLabel="原神 UID" columns={1}
        options={joypad.uids.map((uid) => ({ value: uid, label: uid }))}
        value={joypad.uid} onchange={(uid) => { joypad.uid = uid; }} />
      {#snippet footer()}
        <button class="btn" onclick={() => { joypad.prompting = false; }}>取消</button>
        <button class="btn accent" onclick={() => { void submitJoypadUid(); }}>确定</button>
      {/snippet}
    </Modal>
  {/if}

  <!-- 提示条：紧靠窗口左边缘，自下而上堆叠 -->
  <div class="toasts" aria-live="polite">
    {#each ui.toasts as t (t.id)}
      <!-- 外层只负责补位动画；退场时 Svelte 会把外层改为绝对定位并用 transform 固定在原处，
           所以进出场过渡放在内层，避免覆盖外层的 transform 而跳位 -->
      <div class="toast-slot" animate:flip={{ duration: 200 }}>
        <div class="toast {t.kind}" role={t.kind === "error" ? "alert" : "status"} in:toastIn out:toastOut>
          {t.text}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .path-input {
    width: 100%;
  }
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .topbar {
    flex: none;
    height: var(--topbar-h);
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: 0 var(--s6);
    color: #fff;
    background: var(--theme);
  }
  .topbar.desktop {
    padding-right: var(--s3);
    user-select: none;
  }
  /* 文字不拦截鼠标，按在上面也能拖动窗口 */
  .topbar.desktop .brand,
  .topbar.desktop .sub-title {
    pointer-events: none;
  }
  .win {
    position: relative;
    z-index: 1;
    display: flex;
    gap: 6px;
    margin-left: var(--s2);
  }
  .win-btn {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #fff;
    cursor: pointer;
    transition:
      background-color var(--t-hover-out) var(--ease-out),
      transform var(--t-release) var(--ease-back);
  }
  .win-btn:hover {
    background: rgba(255, 255, 255, 0.24);
    transition-duration: var(--t-hover-in), var(--t-release);
  }
  .win-btn:active {
    transform: scale(0.84);
    transition:
      background-color var(--t-hover-in) var(--ease-out),
      transform 120ms var(--ease-out);
  }
  .win-btn:focus-visible {
    outline-color: #fff;
    outline-offset: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .win-btn:active {
      transform: none;
    }
  }
  .brand {
    /* 自定文本过长时省略，不压到居中的页签 */
    max-width: 26%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .spacer {
    flex: 1;
  }
  /* 顶栏导航页签：横向胶囊，图标 + 文字；未选中为透明底白字，选中为白底主题色字（动效规范 5.1） */
  /* 页签组在整条顶栏内居中，不随左侧品牌名和右侧窗口按钮偏移 */
  .topbar {
    position: relative;
  }
  .tabs {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    gap: var(--s2);
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 14px 0 11px;
    border: 0;
    border-radius: 14px;
    background: transparent;
    color: rgba(255, 255, 255, 0.92);
    cursor: pointer;
    transition:
      background-color var(--t-hover-out) var(--ease-out),
      color 120ms var(--ease-out),
      transform var(--t-release) var(--ease-back);
  }
  .tab:hover {
    background: rgba(255, 255, 255, 0.18);
    transition-duration: var(--t-hover-in), 120ms, var(--t-release);
  }
  .tab:active {
    transform: scale(0.96);
    transition-duration: var(--t-hover-in), 120ms, var(--t-press);
    transition-timing-function: var(--ease-out);
  }
  .tab.active {
    background: #fff;
    color: var(--theme-deep);
    font-weight: 600;
    transition-duration: 120ms;
  }
  .tab:focus-visible {
    outline-color: #fff;
  }
  @media (prefers-reduced-motion: reduce) {
    .tab:active {
      transform: none;
    }
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  /* 共用左侧栏：整块白色面板，右边界投影；宽度由页面决定并平滑过渡 */
  /* 没有左侧栏的页面：宽度收到 0，阴影也不画 */
  .side.none {
    box-shadow: none;
  }
  .side {
    position: relative;
    z-index: 1;
    flex: none;
    width: var(--side-w);
    background: var(--surface);
    box-shadow: var(--shadow-side);
    overflow-x: hidden;
    overflow-y: auto;
    transition:
      width 220ms var(--ease-out),
      box-shadow 220ms var(--ease-out);
  }
  /* 内容按目标宽度排版，宽度过渡期间不重新折行 */
  .side-inner {
    width: var(--side-w);
    /* 缩放支点取侧栏可见区域的中心，而不是内容块的中心 */
    transform-origin: 50% calc((100vh - var(--topbar-h)) / 2);
  }
  @keyframes side-pop-in {
    from {
      transform: scale(0.9);
    }
  }
  @keyframes side-pop-out {
    to {
      opacity: 0;
      transform: scale(0.94);
    }
  }
  .side-inner.pop-in {
    animation:
      enter-fade 120ms var(--ease-out) backwards,
      side-pop-in 300ms var(--ease-back) backwards;
  }
  /* 子页签切页：旧内容上移 12 并淡出（150 ms 缓入），结束后新内容按卡片入场动效进入 */
  @keyframes sub-leave {
    to {
      opacity: 0;
      transform: translateY(-12px);
    }
  }
  .sub-leave {
    animation: sub-leave 150ms cubic-bezier(0.4, 0, 1, 1) forwards;
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .sub-leave {
      animation: enter-fade 150ms linear reverse forwards;
    }
  }
  .side-inner.pop-out {
    animation: side-pop-out 90ms cubic-bezier(0.4, 0, 1, 1) forwards;
    pointer-events: none;
  }
  .main-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .main {
    flex: 1;
    min-width: 0;
    padding: var(--s5) var(--s6);
    overflow-y: auto;
    background: var(--main-bg);
  }
  .page {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
  .sub-page {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .confirm-text {
    margin: 0;
    white-space: pre-line;
  }
  /* 提示条：字号同正文；上下 0.3em、右 0.5em、左 0.8em 内边距；条与条之间无缝；
     与窗口下边缘相隔一条提示条的高度（行高 1.5em + 上下边距 0.6em） */
  .toasts {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 2.1em;
    z-index: 30;
    /* 提示条不接收指针事件：整条横跨窗口底部，不能挡住下面的按钮和光标 */
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    font-size: 14px;
    line-height: 1.5;
    pointer-events: none;
  }
  .toast-slot {
    width: max-content;
    max-width: calc(100vw - 48px);
  }
  .toast {
    /* 底版向窗口左侧外多延伸 12px（屏外不可见），进场回弹越过原位时左侧不露缝 */
    --bleed: 12px;
    margin-left: calc(-1 * var(--bleed));
    padding: 0.3em 0.5em 0.3em calc(0.8em + var(--bleed));
    border-radius: 0 var(--r-card) var(--r-card) 0;
    color: #fff;
    /* 覆盖 .toasts 的 none 会把光标挡在提示条上，这里也要保持穿透 */
    pointer-events: none;
  }
  /* 轻微渐变：上浅下深；高饱和色，底版不透明度 88% */
  .toast.success {
    background: linear-gradient(180deg, rgba(24, 196, 98, 0.88) 0%, rgba(0, 166, 72, 0.88) 100%);
  }
  .toast.info {
    background: linear-gradient(180deg, rgba(40, 132, 255, 0.88) 0%, rgba(0, 98, 245, 0.88) 100%);
  }
  .toast.error {
    background: linear-gradient(180deg, rgba(255, 64, 48, 0.88) 0%, rgba(228, 24, 12, 0.88) 100%);
  }
  /* 窄屏：侧栏收到内容上方，改为单列（5.3） */
  @media (max-width: 900px) {
    .body {
      flex-direction: column;
      overflow-y: auto;
    }
    .side,
    .side-inner {
      width: auto;
      overflow: visible;
      transition: none;
    }
    .main {
      padding: var(--s4);
      overflow: visible;
    }
    .topbar {
      padding: 0 var(--s4);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .side {
      transition: none;
    }
    .side-inner.pop-in {
      animation: none;
    }
    .side-inner.pop-out {
      animation: none;
      opacity: 0;
    }
  }

  /* —— 顶栏的两组控件：主界面（标题 + 页签）与子页面（返回 + 子页面标题） ——
     进入子页面：主界面一组向右移动并淡出（幅度比卡片移动大），随后子页面一组从左侧向右淡入；
     返回：子页面一组向左淡出，主界面一组从淡出的位置向左回到原位。
     带位移的淡入有回弹，淡出没有。子页面里再进子页面时只有标题原地淡入淡出。 */
  .bar-main,
  .bar-sub {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: 0 var(--s6);
    --bar-shift: 56px;
  }
  .bar-main {
    transition:
      opacity 150ms var(--ease-out) 140ms,
      transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1) 140ms;
  }
  .topbar.sub .bar-main {
    opacity: 0;
    transform: translateX(var(--bar-shift));
    transition:
      opacity 140ms cubic-bezier(0.4, 0, 1, 1),
      transform 140ms cubic-bezier(0.4, 0, 1, 1);
  }
  .bar-sub {
    padding-left: var(--s3);
    opacity: 0;
    transform: translateX(calc(-1 * var(--bar-shift)));
    transition:
      opacity 140ms cubic-bezier(0.4, 0, 1, 1),
      transform 140ms cubic-bezier(0.4, 0, 1, 1);
  }
  .topbar.sub .bar-sub {
    opacity: 1;
    transform: none;
    transition:
      opacity 150ms var(--ease-out) 140ms,
      transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1) 140ms;
  }
  /* 新旧标题叠在同一格里交替 */
  .sub-title-box {
    display: grid;
    min-width: 0;
  }
  .sub-title {
    grid-area: 1 / 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 16px;
    font-weight: 700;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar-main,
    .bar-sub,
    .topbar.sub .bar-main,
    .topbar.sub .bar-sub {
      transform: none;
      transition: opacity 100ms linear;
    }
  }
  @media (max-width: 900px) {
    .bar-main {
      padding: 0 var(--s4);
    }
  }
</style>
