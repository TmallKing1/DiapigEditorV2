<script lang="ts">
  // 历史文件子页面的主区：一张卡片列出选中页签下的对话与任务链文件，点击打开到主页对应的页签。
  // 文件是否还在由列表变化时异步检查，不阻塞渲染；检查前一律按存在显示。
  import { dlg } from "../lib/dialog.svelte";
  import { openPathAs, renameBlockReason, renameFile } from "../lib/fileSession.svelte";
  import { tsk } from "../lib/task.svelte";
  import { baseName, deleteFileAt, fileExists, isTauri } from "../lib/files";
  import { currentTab, forgetFile, hist, moveFile } from "../lib/history.svelte";
  import { closeAllSubs } from "../lib/nav.svelte";
  import { confirm, toast } from "../lib/ui.svelte";
  import { type HistoryEntry, UNSORTED, UNSORTED_NAME, dirName, entriesOf, pathKey, tabName } from "../model/history";
  import Icon from "../ui/Icon.svelte";
  import MoveTabDialog from "../ui/MoveTabDialog.svelte";
  import RenameFileDialog from "../ui/RenameFileDialog.svelte";

  let tab = $derived(currentTab());
  let files = $derived(tab ? entriesOf(hist.data, tab) : []);
  let anyHistory = $derived(hist.data.entries.length > 0 || hist.data.tabs.length > 0);

  /** 路径键 → 是否存在；没有记录 = 还没查（按存在显示） */
  let exists = $state<Record<string, boolean>>({});
  const missing = (e: HistoryEntry) => exists[pathKey(e.path)] === false;

  let checkGen = 0;
  $effect(() => {
    const t = tab;
    // 浏览器预览里 fileExists 恒为 false，查了也没有意义
    if (!isTauri || !t) return;
    const paths = files.map((e) => e.path);
    const gen = ++checkGen;
    void (async () => {
      for (const p of paths) {
        let ok = true;
        try {
          ok = await fileExists(p);
        } catch {
          // 查不了就当作还在，点开时由打开流程报错
        }
        // 已切到别的页签或离开页面：旧结果不再写入
        if (gen !== checkGen) return;
        exists[pathKey(p)] = ok;
      }
    })();
    return () => checkGen++;
  });

  async function open(e: HistoryEntry) {
    if (missing(e)) return;
    // 按读到的内容识别种类，打开到对应会话并切换主页页签；有未保存的修改时先确认，取消时不会返回，这里也就停在原页面
    if (await openPathAs(e.kind, e.path)) closeAllSubs();
    else if (isTauri && !(await fileExists(e.path).catch(() => true))) exists[pathKey(e.path)] = false;
  }

  function forget(e: HistoryEntry) {
    forgetFile(e.path);
    toast(`已从历史中移除 ${baseName(e.path)}`);
  }

  function purge(e: HistoryEntry) {
    const openIn = [dlg, tsk].find((s) => !!s.filePath && pathKey(s.filePath) === pathKey(e.path));
    confirm({
      title: "彻底删除",
      message:
        `将永久删除以下本地文件（不进回收站），无法恢复：\n${e.path}` +
        (openIn ? `\n\n这是当前打开的${openIn.spec.noun}：编辑器里的内容会保留，并变为未保存的${openIn.spec.noun}。` : ""),
      action: "彻底删除",
      danger: true,
      run: async () => {
        try {
          await deleteFileAt(e.path);
        } catch (err) {
          toast(`删除失败：${String(err)}`, "error");
          return;
        }
        dlg.detachFile(e.path);
        tsk.detachFile(e.path);
        forgetFile(e.path);
        toast(`已删除 ${baseName(e.path)}`);
      },
    });
  }

  // —— 移到其他页签 ——
  let moving = $state<HistoryEntry | null>(null);
  /** 目标页签：未分类（即使当前隐藏）+ 用户页签，去掉文件当前所在的页签 */
  let targets = $derived(
    [{ value: UNSORTED, label: UNSORTED_NAME }, ...hist.data.tabs.map((t) => ({ value: t.id, label: t.name }))].filter(
      (o) => o.value !== tab,
    ),
  );
  function move(to: string) {
    const e = moving;
    moving = null;
    if (!e) return;
    moveFile(e.path, to);
    toast(`已把 ${baseName(e.path)} 移到「${tabName(hist.data, to)}」`);
  }

  let naming = $state<HistoryEntry | null>(null);

  async function rename(stem: string) {
    if (!naming) return;
    const path = await renameFile(naming.path, stem);
    exists[pathKey(path)] = true;
    naming = null;
    toast(`已重命名为 ${baseName(path)}`);
  }
</script>

{#if !anyHistory}
  <div class="card enter empty">还没有打开过的文件</div>
{:else if tab}
  {#key tab}
    <section class="card enter list-card">
      <h2 class="card-title">
        <span class="title-text">{tabName(hist.data, tab)}</span>
        <span class="badge plain">{files.length} 个文件</span>
      </h2>
      {#if files.length === 0}
        <p class="none">这个页签里还没有文件</p>
      {:else}
        <ul class="files">
          {#each files as e (pathKey(e.path))}
            {@const gone = missing(e)}
            {@const name = baseName(e.path)}
            {@const renameBlocked = gone ? "文件不存在" : renameBlockReason(e.path)}
            <li class="file" class:gone>
              <button
                class="open"
                aria-disabled={gone}
                data-tip={gone ? `文件不存在：${e.path}` : e.path}
                onclick={() => void open(e)}
              >
                <span class="ficon"><Icon name={gone ? "file-blank" : e.kind === "task" ? "target" : "chat"} size={40} /></span>
                <span class="text">
                  <span class="name-row">
                    <span class="name">{name}</span>
                    {#if gone}<span class="badge plain"><Icon name="warn" size={12} />文件不存在</span>{/if}
                  </span>
                  <span class="dir">{dirName(e.path)}</span>
                </span>
              </button>
              <span class="actions">
                <button
                  class="icon-btn"
                  data-tip={renameBlocked || "重命名文件"}
                  aria-label="重命名文件"
                  disabled={!!renameBlocked}
                  onclick={() => (naming = e)}
                >
                  <Icon name="edit" />
                </button>
                <button
                  class="icon-btn"
                  data-tip={targets.length ? "移到其他页签" : "没有其他页签"}
                  aria-label="移到其他页签"
                  disabled={!targets.length}
                  onclick={() => (moving = e)}
                >
                  <Icon name="folder-move" />
                </button>
                <button class="icon-btn" data-tip="移出历史（保留本地文件）" aria-label="删除" onclick={() => forget(e)}>
                  <Icon name="trash" />
                </button>
                {#if !gone}
                  <button
                    class="icon-btn danger"
                    data-tip="彻底删除（同时删除本地文件）"
                    aria-label="彻底删除"
                    disabled={!isTauri}
                    onclick={() => purge(e)}
                  >
                    <Icon name="trash-x" />
                  </button>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/key}
{/if}

{#if moving}
  <MoveTabDialog fileName={baseName(moving.path)} options={targets} onconfirm={move} oncancel={() => (moving = null)} />
{/if}
{#if naming}
  <RenameFileDialog path={naming.path} onconfirm={rename} oncancel={() => (naming = null)} />
{/if}

<style>
  .empty {
    max-width: 440px;
    margin: 12vh auto 0;
    color: var(--text-2);
    text-align: center;
  }
  .list-card {
    width: 100%;
    max-width: none;
    padding-bottom: var(--s3);
  }
  .card-title {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-width: 0;
  }
  .title-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-title .badge {
    flex: none;
    font-weight: 400;
  }
  .none {
    margin: 0;
    padding: var(--s2) var(--s1) var(--s3);
    color: var(--text-2);
  }
  /* 文件列表：行与行之间一条细分割线；行的悬停底色向卡片内边距里略微外扩 */
  .files {
    margin: 0 calc(-1 * var(--s2));
    padding: 0;
    list-style: none;
  }
  .file {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: var(--r-btn);
    transition: background-color var(--t-hover-out) var(--ease-out);
  }
  .file + .file::before {
    content: "";
    position: absolute;
    left: var(--s2);
    right: var(--s2);
    top: 0;
    border-top: 1px solid var(--border);
    transition: opacity var(--t-hover-out) var(--ease-out);
  }
  .file:hover {
    background: var(--hover-bg);
    transition-duration: var(--t-hover-in);
  }
  /* 悬停行的上下分割线让给底色，不在浅蓝底上划一道灰线 */
  .file:hover::before,
  .file:hover + .file::before {
    opacity: 0;
    transition-duration: var(--t-hover-in);
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2);
    border: 0;
    border-radius: var(--r-btn);
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .open:focus-visible {
    outline-offset: -2px;
  }
  .ficon {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--theme);
    transition: transform var(--t-release) var(--ease-back);
  }
  /* 按下时文件图标略缩，松开回弹，与图标按钮的反馈一致 */
  .file:not(.gone) .open:active .ficon {
    transform: scale(0.9);
    transition: transform 120ms var(--ease-out);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-width: 0;
  }
  .name,
  .dir {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    color: var(--text);
    font-weight: 600;
  }
  .name-row .badge {
    flex: none;
  }
  .dir {
    color: var(--text-2);
    font-size: 12.5px;
  }
  /* 失效条目：整体变灰，点击不打开 */
  .gone .open {
    cursor: default;
  }
  .gone .ficon,
  .gone .name {
    color: var(--text-3);
  }
  .gone .dir {
    color: var(--text-3);
  }
  /* 操作按钮只在悬停或键盘聚焦到这一行时出现 */
  .actions {
    flex: none;
    display: flex;
    align-items: center;
    padding-right: var(--s1);
    opacity: 0;
    transition: opacity var(--t-hover-out) var(--ease-out);
  }
  .file:hover .actions,
  .file:focus-within .actions {
    opacity: 1;
    transition-duration: var(--t-hover-in);
  }
  @media (prefers-reduced-motion: reduce) {
    .ficon,
    .file:not(.gone) .open:active .ficon {
      transform: none;
      transition: none;
    }
  }
</style>
