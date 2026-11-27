<script lang="ts">
  import { untrack } from "svelte";
  import { nodeLabel } from "../lib/labels";
  import { parseRichText, visibleLength } from "../model/richtext";
  import {
    type DialogNode,
    NONLOCKED_MAX_BRANCHES,
    OP_BRANCH,
    OP_JUMP,
    OP_LABELS,
    PLAYER_NAME,
    TEXT_MODE_LABELS,
  } from "../model/types";
  import CollapsibleCard from "./CollapsibleCard.svelte";
  import Dropdown, { type DropdownOption } from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import RichEditor, { newHistory } from "./RichEditor.svelte";
  import RichText from "./RichText.svelte";

  // 对话内容的编辑方式：预览（类 Word 直接编辑）或源码（文本框 + 只读预览），跨会话记住
  const KEY_MODE = "diapig.contentMode";
  type ContentMode = "preview" | "source";
  function readMode(): ContentMode {
    try {
      return localStorage.getItem(KEY_MODE) === "source" ? "source" : "preview";
    } catch {
      return "preview";
    }
  }

  let {
    node,
    index,
    nodes,
    isStart,
    onsave,
    oncancel,
  }: {
    node: DialogNode;
    index: number;
    nodes: DialogNode[];
    isStart: boolean;
    onsave: (node: DialogNode) => void;
    oncancel: () => void;
  } = $props();

  // 编辑的是副本，保存时才写回
  const initial = untrack(() => node);
  let draft = $state<DialogNode>({ ...initial, branches: initial.branches.map((b) => ({ ...b })) });
  const inheritTitle = $derived(!isStart && draft.inheritTitle);
  let hasSubtitle = $state(initial.subtitle !== "");
  let mode = $state<ContentMode>(readMode());
  /** 两种模式共用一份撤销记录，切换后仍可撤销 */
  const contentHistory = newHistory(initial.content);

  let richEditor = $state<RichEditor>();
  let contentTa = $state<HTMLTextAreaElement>();

  /** 插入玩家名：预览模式插入整块；源码模式在光标处直接写 <PLAYER_NAME>（之后可逐字删改） */
  function insertPlayer() {
    if (mode === "preview") {
      richEditor?.insertPlayer();
      return;
    }
    const ta = contentTa;
    if (!ta) return;
    ta.focus();
    // execCommand 走浏览器自身的输入流程：保留文本框的撤销记录，并触发 input 更新草稿
    if (!document.execCommand("insertText", false, PLAYER_NAME)) {
      const s = ta.selectionStart;
      ta.setRangeText(PLAYER_NAME, s, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function toggleMode() {
    // 源码框里的真实换行先统一成字面量 \n，预览才能按换行显示
    draft.content = draft.content.replace(/\r?\n/g, "\\n");
    mode = mode === "preview" ? "source" : "preview";
    try {
      localStorage.setItem(KEY_MODE, mode);
    } catch {
      // 存不下：只影响下次打开时的默认模式
    }
  }

  let warnings = $derived(parseRichText(draft.content).warnings);
  let count = $derived(visibleLength(draft.content));
  const labelOptions = (labels: readonly string[]): DropdownOption[] =>
    labels.map((label, i) => ({ value: String(i), label }));
  let nodeOptions = $derived(nodes.map((n, i) => ({ value: String(i), label: nodeLabel(n, i) })));
  let clampIndex = (i: number) => Math.min(Math.max(i, 0), nodes.length - 1);

  function save() {
    const out = $state.snapshot(draft) as DialogNode;
    // 文本框里的真实换行统一存成字面量 \n
    out.content = out.content.replace(/\r?\n/g, "\\n");
    out.inheritTitle = inheritTitle;
    if (!hasSubtitle) out.subtitle = "";
    out.duration = Math.min(Math.max(Number(out.duration) || 0, 0), 999);
    out.jump = clampIndex(out.jump);
    out.branches = out.branches.map((b) => ({ ...b, jump: clampIndex(b.jump) }));
    out.defaultBranch = Math.min(Math.max(out.defaultBranch, 0), Math.max(out.branches.length - 1, 0));
    onsave(out);
  }

  function addBranch() {
    draft.branches.push({ title: "", jump: index });
  }

  function removeBranch(i: number) {
    draft.branches.splice(i, 1);
    if (draft.defaultBranch > i) draft.defaultBranch -= 1;
    draft.defaultBranch = Math.min(draft.defaultBranch, Math.max(draft.branches.length - 1, 0));
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div {onkeydown}>
  <Modal title="编辑节点 {index}" width={720} onclose={oncancel}>
    <!-- Modal 的内容区上内边距为 0 且会滚动：留出一条缝，第一张卡片的上阴影才不被裁掉 -->
    <div class="cards">
      <CollapsibleCard title="文本" open enter={false} unclip>
        <div class="grid">
          <label class="check wide inherit-check" data-tip={isStart ? "开始节点没有标题可继承。" : undefined}>
            <input type="checkbox" checked={inheritTitle} disabled={isStart} onchange={(e) => (draft.inheritTitle = e.currentTarget.checked)} />
            继承上一段对话的标题（不覆写标题）
          </label>

          <div class="field">
            <label class="label" for="ne-title">标题（说话人）</label>
            <div class="inline">
              <input id="ne-title" class="input" data-autofocus bind:value={draft.title} disabled={inheritTitle} />
              <button class="btn" disabled={inheritTitle} onclick={() => (draft.title = PLAYER_NAME)}>
                <Icon name="user" />使用玩家名
              </button>
            </div>
          </div>

          <div class="field">
            <label class="check label-check">
              <input type="checkbox" bind:checked={hasSubtitle} disabled={inheritTitle} />
              副标题（身份）
            </label>
            <input
              class="input"
              aria-label="副标题"
              bind:value={draft.subtitle}
              disabled={inheritTitle || !hasSubtitle}
            />
          </div>

          <div class="field wide">
            <div class="label-row">
              <label class="label" for="ne-content">对话内容</label>
              <span class="grow"></span>
              <span class="hint">{count} 字</span>
              <button
                class="btn mode"
                data-tip="插入玩家名"
                onmousedown={(e) => e.preventDefault()}
                onclick={insertPlayer}
              >
                <Icon name="user" />插入玩家名
              </button>
              <button
                class="btn mode"
                data-tip={mode === "preview" ? "切换到源码" : "切换到预览"}
                onclick={toggleMode}
              >
                {#if mode === "preview"}
                  <Icon name="code" />源码模式
                {:else}
                  <Icon name="doc" />预览模式
                {/if}
              </button>
            </div>
            {#if mode === "preview"}
              <RichEditor
                bind:this={richEditor}
                id="ne-content"
                value={draft.content}
                onchange={(v) => (draft.content = v)}
                history={contentHistory}
                ariaLabel="对话内容"
                placeholder="输入对话内容，框选后可加粗、斜体或上色"
                minHeight={96}
              />
            {:else}
              <textarea bind:this={contentTa} id="ne-content" class="textarea" rows="4" bind:value={draft.content}></textarea>
            {/if}
            {#each warnings as w}
              <span class="hint warn"><Icon name="warn" size={12} /> {w}</span>
            {/each}
            {#if mode === "source" && draft.content}
              <div class="preview" aria-label="预览"><RichText text={draft.content} /></div>
            {/if}
          </div>

          <div class="field">
            <label class="label" for="ne-mode">内容显示模式</label>
            <Dropdown
              id="ne-mode"
              options={labelOptions(TEXT_MODE_LABELS)}
              value={String(draft.textMode)}
              onchange={(v) => (draft.textMode = Number(v))}
            />
          </div>

          <div class="field">
            <label class="label" for="ne-duration">持续时间（秒）</label>
            <input id="ne-duration" class="input" data-tip={"锁定对话：继续按钮的出现延迟。\n其他：自动推进的时间。"} type="number" min="0" max="999" step="0.1" bind:value={draft.duration} />
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="逻辑" open enter={false} unclip>
        <div class="grid">
          <div class="field">
            <label class="label" for="ne-enter">节点进入事件（留空则无）</label>
            <input id="ne-enter" class="input" bind:value={draft.enterEvent} />
          </div>
          <div class="field">
            <label class="label" for="ne-leave">节点离开事件（留空则无）</label>
            <input id="ne-leave" class="input" bind:value={draft.leaveEvent} />
          </div>

          <div class="field">
            <label class="label" for="ne-op">操作类型</label>
            <Dropdown
              id="ne-op"
              options={labelOptions(OP_LABELS)}
              value={String(draft.op)}
              onchange={(v) => (draft.op = Number(v))}
            />
          </div>

          {#if draft.op === OP_JUMP}
            <div class="field">
              <label class="label" for="ne-jump">跳转节点</label>
              <Dropdown
                id="ne-jump"
                options={nodeOptions}
                value={String(draft.jump)}
                onchange={(v) => (draft.jump = Number(v))}
              />
            </div>
          {/if}

          {#if draft.op === OP_BRANCH}
            <div class="field wide">
              <div class="label-row">
                <span class="label">分支列表（非锁定对话只显示前 {NONLOCKED_MAX_BRANCHES} 个，超时后选默认分支）</span>
                <button class="btn" onclick={addBranch}>
                  <Icon name="plus" />添加分支
                </button>
              </div>
              {#if draft.branches.length === 0}
                <span class="hint warn"><Icon name="warn" size={12} /> 还没有分支，游戏中这个节点将没有可选项</span>
              {:else if draft.branches.length > NONLOCKED_MAX_BRANCHES}
                <span class="hint warn">
                  <Icon name="warn" size={12} /> 共 {draft.branches.length} 个分支：锁定对话全部显示；用于非锁定对话时只显示前 {NONLOCKED_MAX_BRANCHES} 个{#if draft.defaultBranch >= NONLOCKED_MAX_BRANCHES}，且默认分支不在其中{/if}
                </span>
              {/if}
              {#each draft.branches as branch, i}
                <div class="branch">
                  <label class="check" data-tip="设为默认分支">
                    <input type="radio" name="default-branch" value={i} bind:group={draft.defaultBranch} />
                    默认
                  </label>
                  <input class="input" placeholder="分支文本" aria-label="分支 {i} 文本" bind:value={branch.title} />
                  <Dropdown
                    id="ne-branch-{i}"
                    ariaLabel="分支 {i} 跳转节点"
                    options={nodeOptions}
                    value={String(branch.jump)}
                    onchange={(v) => (branch.jump = Number(v))}
                  />
                  <button class="btn icon danger" data-tip="删除分支" aria-label="删除分支 {i}" onclick={() => removeBranch(i)}>
                    <Icon name="trash" />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </CollapsibleCard>
    </div>

    {#snippet footer()}
      <span class="hint grow">Ctrl + Enter 保存，Esc 取消</span>
      <button class="btn" onclick={oncancel}>取消</button>
      <button class="btn accent" onclick={save}><Icon name="check" />保存</button>
    {/snippet}
  </Modal>
</div>

<style>
  .inherit-check > input:disabled {
    pointer-events: none;
  }
  /* 代替 Modal 内容区的纵向排列；上方 6px 给卡片阴影（向上约 4px 外扩加 1px 描边）留位置 */
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    padding-top: 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s3) var(--s4);
  }
  .wide {
    grid-column: 1 / -1;
  }
  .inline {
    display: flex;
    gap: var(--s2);
    align-items: center;
  }
  /* The 100%-wide input must not squeeze the button (icon collapsed, label clipped). */
  .inline > .btn {
    flex: none;
  }
  .label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--s2);
  }
  .mode {
    height: 28px;
    padding: 0 var(--s2);
    font-size: 12.5px;
  }
  .label-check {
    min-height: 0;
    font-size: 12.5px;
    color: var(--text-2);
  }
  .preview {
    padding: var(--s2) var(--s3);
    border-radius: var(--r-btn);
    background: var(--tint-bg);
    overflow-wrap: anywhere;
  }
  .branch {
    display: grid;
    grid-template-columns: auto 1fr 1fr auto;
    gap: var(--s2);
    align-items: center;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .grow {
    flex: 1;
  }
  @media (max-width: 640px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .branch {
      grid-template-columns: auto 1fr auto;
    }
    .branch :global(.select) {
      grid-column: 2;
    }
  }
</style>
