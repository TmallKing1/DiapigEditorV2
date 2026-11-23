<script lang="ts" module>
  import type { HomeTab } from "../lib/nav.svelte";

  const KIND_LABELS = { ask: "每次询问", locked: "锁定对话", nonlocked: "非锁定对话", black: "黑屏文字" } as const;
</script>

<script lang="ts">
  // 主页的左侧栏。顶部「对话 / 任务」两个页签，切换时中间区域和底部按钮原地淡入淡出。
  // 未打开文件：中间是「新建」，底部是导入与历史文件；
  // 打开文件：中间是文件信息（悬停出现新建 / 导入 / 清理 / 设置），「设置」进入对话 / 任务设置子页面；
  // 底部按钮：对话是预览、保存 / 另存为、历史文件；任务是保存（大按钮）、另存为 / 历史文件。
  import { tick } from "svelte";
  import { fade } from "svelte/transition";
  import { clean, dlg, importFile } from "../lib/dialog.svelte";
  import { renameBlockReason, renameFile } from "../lib/fileSession.svelte";
  import { jsonFileStem } from "../lib/files";
  import { requestNew } from "../lib/home.svelte";
  import { nav, openSub } from "../lib/nav.svelte";
  import { startPreview } from "../lib/preview.svelte";
  import { settings } from "../lib/settings.svelte";
  import { importTaskFile, tsk } from "../lib/task.svelte";
  import { toast } from "../lib/ui.svelte";
  import Icon from "../ui/Icon.svelte";

  let tab = $derived(nav.homeTab);
  let session = $derived(tab === "dialog" ? dlg : tsk);
  let tdoc = $derived(tsk.doc);
  let hasDoc = $derived(session.edit != null);

  const NOUN: Record<HomeTab, string> = { dialog: "对话", task: "任务链" };
  const ICON: Record<HomeTab, string> = { dialog: "chat", task: "target" };
  const IDS_HINT: Record<HomeTab, string> = { dialog: "结构体 ID", task: "两个结构体 ID" };

  const fadeIn = { duration: 150, delay: 100 };
  const fadeOut = { duration: 100 };

  function pick(next: HomeTab) {
    if (next === nav.homeTab) return;
    void session.autoSave();
    nav.homeTab = next;
  }

  /** 进入「对话设置」/「任务设置」子页面；结构体 ID 没填时子页面自己聚焦第一个空的 ID */
  function gotoMeta() {
    openSub(tab === "dialog" ? "dialogMeta" : "taskMeta");
  }

  /** 结构体 ID 没填时不能保存：直接带用户去元数据填写 */
  function save(asNew: boolean) {
    if (!session.ready) {
      toast(`保存前请先填写${IDS_HINT[tab]}`, "error");
      gotoMeta();
      return;
    }
    void session.saveFile(asNew || !session.filePath);
  }

  let saveTip = $derived(
    !session.ready
      ? `填写${IDS_HINT[tab]}后才能保存`
      : session.filePath
        ? "保存（Ctrl + S）"
        : "还没有对应的文件，将另存为（Ctrl + S）",
  );
  let saveAsTip = $derived(session.ready ? "另存为（Ctrl + Shift + S）" : `填写${IDS_HINT[tab]}后才能保存`);

  let nameInput = $state<HTMLInputElement>();
  let renamePath = $state("");
  let nameDraft = $state("");
  let needsSave = $derived(session.showUnsaved || !session.filePath);
  let nameBlock = $derived(needsSave ? "" : renameBlockReason(session.filePath));

  async function activateName() {
    if (session.busy) return;
    if (needsSave) {
      save(false);
      return;
    }
    if (nameBlock) return;
    renamePath = session.filePath;
    nameDraft = jsonFileStem(renamePath);
    await tick();
    nameInput?.focus();
    nameInput?.select();
  }

  async function commitName() {
    const path = renamePath;
    renamePath = "";
    if (!path || path !== session.filePath) return;
    const name = nameDraft.trim();
    if (name === jsonFileStem(path)) return;
    try {
      await renameFile(path, name);
    } catch (e) {
      toast(`重命名失败：${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  let other = $derived<HomeTab>(tab === "dialog" ? "task" : "dialog");
  let otherDirty = $derived((other === "dialog" ? dlg : tsk).showUnsaved);
</script>

<div class="hside">
  <div class="tabs" role="tablist" aria-label="主页">
    {#each ["dialog", "task"] as const as t (t)}
      <button
        class="tab"
        class:active={tab === t}
        role="tab"
        aria-selected={tab === t}
        data-tip={t === other && otherDirty ? "有未保存的修改" : undefined}
        onclick={() => pick(t)}
      >
        <Icon name={ICON[t]} size={18} />{t === "dialog" ? "对话" : "任务"}
        {#if t === other && otherDirty}<span class="todo" aria-label="有未保存的修改"></span>{/if}
      </button>
    {/each}
  </div>

  <div class="stage middle">
    {#key `${tab}:${hasDoc}`}
      <!-- 过渡放在 {#key} 的直接子元素上：Svelte 的过渡默认只在所属块增删时播放 -->
      <div class="pane" in:fade={fadeIn} out:fade={fadeOut}>
      {#if !hasDoc}
        <div class="center">
          <button class="new-big" onclick={() => requestNew(tab)} disabled={session.busy}>
            <Icon name="file" size={64} />
            <span>新建{NOUN[tab]}</span>
          </button>
        </div>
      {:else}
        <div class="center">
          <!-- 鼠标移到图标附近（整块区域）或键盘聚焦到按钮时，文件名下方显示文件操作 -->
          <div class="file-zone">
            <span class="file-icon"><Icon name={ICON[tab]} size={72} /></span>
            {#if renamePath && renamePath === session.filePath}
              <div class="rename-field">
                <input
                  class="input"
                  aria-label="文件名称"
                  bind:this={nameInput}
                  bind:value={nameDraft}
                  autocomplete="off"
                  spellcheck="false"
                  onblur={() => void commitName()}
                  onkeydown={(e) => {
                    if (e.isComposing) return;
                    if (e.key === "Enter" || e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.key === "Enter") void commitName();
                      else renamePath = "";
                    }
                  }}
                />
                <span class="hint" aria-hidden="true">{renamePath.slice(-5)}</span>
              </div>
            {:else}
              <div class="file-name" class:insert-save={session.filePath && session.showUnsaved}>
                <button
                  class="name-action"
                  aria-label={needsSave ? "保存文件" : "重命名文件"}
                  data-tip={needsSave ? saveTip : nameBlock || `重命名文件 · ${session.filePath}`}
                  disabled={session.busy || !!nameBlock}
                  onclick={() => void activateName()}
                >
                  <span class="name">{session.fileName || `未命名${NOUN[tab]}`}</span>
                  <Icon name={needsSave ? "save" : "edit"} size={16} />
                </button>
                {#if session.showUnsaved}<span class="badge">未保存</span>{/if}
              </div>
            {/if}
            <div class="tools" role="toolbar" aria-label="文件操作">
              <button class="icon-btn" data-tip="新建{NOUN[tab]}" aria-label="新建{NOUN[tab]}" onclick={() => requestNew(tab)} disabled={session.busy}>
                <Icon name="file" /><span>新建</span>
              </button>
              <button
                class="icon-btn"
                data-tip="导入文件（Ctrl + O）"
                aria-label="导入文件"
                onclick={tab === "dialog" ? importFile : importTaskFile}
                disabled={session.busy}
              >
                <Icon name="import" /><span>导入</span>
              </button>
              {#if tab === "dialog"}
                <button class="icon-btn" data-tip="清理未使用的数据" aria-label="清理未使用的数据" onclick={clean}>
                  <Icon name="clean" /><span>清理</span>
                </button>
              {/if}
              <button
                class="icon-btn has-dot"
                data-tip={session.ready ? undefined : "还有结构体 ID 没填"}
                aria-label="设置"
                onclick={gotoMeta}
              >
                <Icon name="settings" /><span>设置</span>
                {#if !session.ready}<span class="todo" aria-label="有未填写的项"></span>{/if}
              </button>
            </div>
          </div>
          <!-- saveFile() 在结构体 ID 没填时会聚焦 #id-dialog / #id-chain：文件视图里没有输入框，
               放一个不可见的替身接住焦点，转到设置子页面（快捷键、关闭确认框里的保存都走这条路） -->
          <span
            id={tab === "dialog" ? "id-dialog" : "id-chain"}
            class="focus-proxy"
            tabindex="-1"
            aria-hidden="true"
            onfocus={gotoMeta}
          ></span>
        </div>
      {/if}
      </div>
    {/key}
  </div>

  <div class="stage">
    {#key `${tab}:${hasDoc}`}
      <!-- 过渡放在 {#key} 的直接子元素上：Svelte 的过渡默认只在所属块增删时播放 -->
      <div class="pane" in:fade={fadeIn} out:fade={fadeOut}>
      {#if !hasDoc}
        <div class="actions">
          <button class="btn primary" data-tip="导入文件（Ctrl + O）" onclick={tab === "dialog" ? importFile : importTaskFile} disabled={session.busy}>
            <Icon name="import" size={18} />导入文件
          </button>
          <button class="btn block plain" onclick={() => openSub("history")}><Icon name="history" />历史文件</button>
        </div>
      {:else if tab === "dialog"}
        <div class="actions">
          <button class="btn accent block plain big" onclick={() => startPreview()}>
            <Icon name="play" size={18} />
            <span class="two">
              <span>预览对话</span>
              <span class="kind">{KIND_LABELS[settings.previewKind] ?? KIND_LABELS.ask}</span>
            </span>
          </button>
          <div class="pair">
            <button class="btn accent plain" data-tip={saveTip} onclick={() => save(false)} disabled={dlg.busy}>
              <Icon name="save" />保存
            </button>
            <button class="btn accent plain" data-tip={saveAsTip} onclick={() => save(true)} disabled={dlg.busy}>
              <Icon name="save-as" />另存为
            </button>
          </div>
          <button class="btn block plain" onclick={() => openSub("history")}><Icon name="history" />历史文件</button>
        </div>
      {:else}
        <div class="actions">
          <button class="btn accent block plain big" data-tip={saveTip} onclick={() => save(false)} disabled={tsk.busy}>
            <Icon name="save" size={18} />
            <span class="two">
              <span>保存</span>
              <span class="kind">{tdoc?.name || "未命名任务链"}</span>
            </span>
          </button>
          <div class="pair">
            <button class="btn accent plain" data-tip={saveAsTip} onclick={() => save(true)} disabled={tsk.busy}>
              <Icon name="save-as" />另存为
            </button>
            <button class="btn plain" onclick={() => openSub("history")}><Icon name="history" />历史文件</button>
          </div>
        </div>
      {/if}
      </div>
    {/key}
  </div>
</div>

<style>
  /* 撑满侧栏可见高度：中间内容才能居中、按钮才能靠下；内容更高时整栏由外层滚动 */
  .hside {
    min-height: calc(100vh - var(--topbar-h));
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    padding: var(--s5) var(--s5) var(--s5) var(--s6);
  }

  /* 新旧内容叠在同一格里交替淡入淡出 */
  .stage {
    display: grid;
    grid-template: auto / minmax(0, 1fr);
  }
  .stage > .pane {
    grid-area: 1 / 1;
    min-width: 0;
    display: grid;
    grid-template: 1fr / minmax(0, 1fr);
  }
  .middle {
    flex: 1;
    grid-template-rows: 1fr;
  }
  .center {
    align-self: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* —— 顶部页签：与标题栏页签同形，颜色反过来（未选中透明底深色字，选中主题色底白字） —— */
  .tabs {
    display: flex;
    justify-content: center;
    gap: var(--s2);
  }
  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 14px 0 11px;
    border: 0;
    border-radius: 14px;
    background: transparent;
    color: var(--theme);
    cursor: pointer;
    transition:
      background-color var(--t-hover-out) var(--ease-out),
      color 120ms var(--ease-out),
      transform var(--t-release) var(--ease-back);
  }
  .tab:hover {
    background: var(--hover-bg);
    transition-duration: var(--t-hover-in), 120ms, var(--t-release);
  }
  .tab:active {
    transform: scale(0.96);
    transition-duration: var(--t-hover-in), 120ms, var(--t-press);
    transition-timing-function: var(--ease-out);
  }
  .tab.active {
    background: var(--theme);
    color: #fff;
    font-weight: 600;
    transition-duration: 120ms;
  }
  /* 红点：另一个页签有未保存的修改 / 还有结构体 ID 没填 */
  .todo {
    position: absolute;
    top: 3px;
    right: 7px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--danger);
  }
  .has-dot {
    position: relative;
  }
  .has-dot .todo {
    top: 4px;
    right: 8px;
  }

  /* —— 未打开文件：中间的大「新建」，反馈同通用图标按钮 —— */
  .new-big {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s3);
    padding: var(--s4) var(--s6);
    border: 0;
    border-radius: var(--r-card);
    background: transparent;
    color: var(--theme);
    font-size: 15px;
    cursor: pointer;
    transition: color var(--t-hover-out) var(--ease-out);
  }
  .new-big :global(svg) {
    transition: transform var(--t-release) var(--ease-back);
  }
  .new-big:hover {
    color: color-mix(in srgb, var(--theme) 68%, #000);
    transition-duration: var(--t-hover-in);
  }
  .new-big:active :global(svg) {
    transform: scale(0.86);
    transition: transform 120ms var(--ease-out);
  }

  /* —— 文件视图 —— */
  .file-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s2);
    width: 100%;
    padding: var(--s4) var(--s2);
  }
  .file-icon {
    display: grid;
    color: var(--theme);
  }
  .file-name {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s2);
    max-width: 100%;
    min-width: 0;
  }
  .file-name .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-size: 15px;
    font-weight: 600;
  }
  .file-name .badge {
    flex: none;
  }
  .name-action {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s1);
    min-width: 0;
    padding: 2px var(--s1);
    border: 0;
    border-radius: var(--r-btn);
    background: transparent;
    color: var(--theme);
    cursor: pointer;
  }
  .name-action:disabled {
    cursor: default;
  }
  .name-action :global(svg) {
    flex: none;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--t-hover-out) var(--ease-out);
  }
  .name-action:is(:not(:disabled):hover, :focus-visible) {
    background: var(--hover-bg);
  }
  .name-action:is(:not(:disabled):hover, :focus-visible) :global(svg) {
    opacity: 1;
    pointer-events: auto;
    transition-duration: var(--t-hover-in);
  }
  /* 普通状态下图标贴在名称右侧，不参与居中。 */
  .file-name:not(.insert-save) .name-action :global(svg) {
    position: absolute;
    top: 50%;
    left: 100%;
    translate: 0 -50%;
  }
  .file-name:not(.insert-save) .badge {
    transition: translate var(--t-hover-out) var(--ease-out);
  }
  .file-name:not(.insert-save) .name-action:is(:not(:disabled):hover, :focus-visible) + .badge {
    translate: calc(16px + var(--s1)) 0;
    transition-duration: var(--t-hover-in);
  }
  /* 已有文件且被修改时，保存图标随名称和未保存标记一起重排。 */
  .insert-save .name-action :global(svg) {
    width: 0;
    margin-left: calc(-1 * var(--s1));
    transition:
      opacity var(--t-hover-out) var(--ease-out),
      width var(--t-hover-out) var(--ease-out),
      margin-left var(--t-hover-out) var(--ease-out);
  }
  .insert-save .name-action:is(:not(:disabled):hover, :focus-visible) :global(svg) {
    width: 16px;
    margin-left: 0;
    transition-duration: var(--t-hover-in);
  }
  .rename-field {
    display: flex;
    align-items: center;
    gap: var(--s1);
    width: 100%;
    min-width: 0;
  }
  /* 文件操作：平时透明且不接收鼠标（仍占位，不让文件名跳动），悬停区域或键盘聚焦时原地淡入；
     「设置」在结构体 ID 没填时带红点，这时工具栏常显，提示用户去填 */
  .tools .icon-btn {
    width: auto;
    height: auto;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 10px 4px;
    font-size: 12px;
    line-height: 1;
  }
  .tools {
    display: flex;
    gap: var(--s1);
    padding: 2px;
    border-radius: var(--r-card);
    background: var(--tint-bg);
    opacity: 0;
    pointer-events: none;
    transition: opacity 150ms var(--ease-out);
  }
  .file-zone:hover .tools,
  .tools:focus-within,
  .tools:has(.todo) {
    opacity: 1;
    pointer-events: auto;
    transition-duration: var(--t-hover-in);
  }
  .focus-proxy {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  /* —— 底部按钮 —— */
  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s2);
  }
  .plain {
    font-weight: 400;
  }
  .big {
    height: auto;
    min-height: 56px;
    padding-block: var(--s2);
  }
  .two {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    line-height: 1.35;
  }
  .two > span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 第二行用灰色小字，悬停时也不跟着变蓝 */
  .kind {
    color: var(--text-2);
    font-size: 12.5px;
  }

  @media (prefers-reduced-motion: reduce) {
    .tab:active,
    .new-big:active :global(svg) {
      transform: none;
    }
    .tools {
      transition: none;
    }
  }
  @media (max-width: 900px) {
    .hside {
      min-height: 0;
      padding: var(--s4);
    }
  }
</style>
