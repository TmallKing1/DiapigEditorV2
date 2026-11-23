<script lang="ts" module>
  import { clearCommentPrefs } from "../model/comment";
  import { clearComments } from "../lib/comment.svelte";

  /** 左侧栏「重置」：清掉保存的参数与已抓取的结果 */
  export function resetComment() {
    clearCommentPrefs();
    clearComments();
  }
</script>

<script lang="ts">
  // 评论抓取：按关卡 GUID 抓取米游社千星奇域的玩家评价，筛选后列出并导出 CSV（与旧版评论抓取页一致）。
  // 参数保存在 localStorage（COMMENT_KEY），结果保存在 lib/comment.svelte.ts，切页后仍在。
  import { untrack } from "svelte";
  import { isTauri, saveText } from "../lib/files";
  import { cmt, startFetch } from "../lib/comment.svelte";
  import { removeCornerAction, upsertCornerAction } from "../lib/cornerActions.svelte";
  import { MAX_PAGES, commentsCsv, formatTime, loadCommentPrefs, saveCommentPrefs, type CommentFilter } from "../model/comment";
  import CapsuleButton from "../ui/CapsuleButton.svelte";
  import Icon from "../ui/Icon.svelte";
  import NumberField from "../ui/NumberField.svelte";
  import Pagination from "../ui/Pagination.svelte";
  import RadioGroup from "../ui/RadioGroup.svelte";

  const PAGE_SIZE = 15;
  const BACK_TO_TOP = "comment-back-to-top";

  let { toast, scroller, active }: {
    toast: (text: string, kind?: "success" | "info" | "error") => void;
    scroller?: HTMLElement;
    active: boolean;
  } = $props();

  const prefs = $state(loadCommentPrefs());
  $effect(() => {
    saveCommentPrefs({ guid: prefs.guid, filter: prefs.filter, maxPage: prefs.maxPage, filterDefault: prefs.filterDefault });
  });

  const FILTERS = [
    { value: "all", label: "全部" },
    { value: "recommend", label: "仅推荐" },
    { value: "notRecommend", label: "仅欠佳" },
  ];

  let exporting = $state(false);
  let guidOk = $derived(prefs.guid.trim() !== "");

  function start() {
    if (!guidOk || !isTauri) return;
    void startFetch({ ...prefs, guid: prefs.guid.trim() }, toast);
  }

  async function exportCsv() {
    if (!cmt.comments.length || exporting) return;
    exporting = true;
    try {
      const saved = await saveText(commentsCsv(cmt.comments), "comments.csv", {
        title: "导出评论为 CSV",
        filterName: "CSV 文件",
        extension: "csv",
        mime: "text/csv",
      });
      if (saved) toast(`已导出 ${saved.name}`);
    } catch (e) {
      toast(`导出失败：${String(e)}`, "error");
    } finally {
      exporting = false;
    }
  }

  let good = $derived(cmt.comments.reduce((n, c) => n + (c.recommend ? 1 : 0), 0));
  let recommendationRate = $derived(cmt.comments.length ? (good / cmt.comments.length * 100).toFixed(2) : "");
  let totalPages = $derived(Math.max(1, Math.ceil(cmt.comments.length / PAGE_SIZE)));
  let currentPage = $derived(Math.max(1, Math.min(cmt.page, totalPages)));
  let pageStart = $derived((currentPage - 1) * PAGE_SIZE);
  let pageComments = $derived(cmt.comments.slice(pageStart, pageStart + PAGE_SIZE));
  let settingsCard = $state<HTMLElement>();

  function backToTop() {
    scroller?.scrollTo({ top: 0, behavior: "instant" });
    removeCornerAction(BACK_TO_TOP);
  }

  $effect(() => {
    const root = scroller;
    const card = settingsCard;
    if (!active || !root || !card) return;

    const update = () => {
      if (root.scrollTop > 0 && card.getBoundingClientRect().bottom <= root.getBoundingClientRect().top) {
        upsertCornerAction({ id: BACK_TO_TOP, icon: "back-to-top", label: "返回顶部", detail: "返回顶部", onclick: backToTop });
      } else {
        removeCornerAction(BACK_TO_TOP);
      }
    };

    root.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(root);
    resize.observe(card);
    untrack(update);
    return () => {
      root.removeEventListener("scroll", update);
      resize.disconnect();
      removeCornerAction(BACK_TO_TOP);
    };
  });

  function setPage(next: number) {
    cmt.page = next;
    backToTop();
  }
</script>

{#snippet metric(icon: string, text: string)}
  <li><Icon name={icon} size={15} />{text}</li>
{/snippet}

<div class="page-stack">
  <section class="card setting enter" bind:this={settingsCard}>
    <h2 class="card-title">抓取设置</h2>
    <div class="setting-body">
      <div class="row">
        <label class="name" for="comment-guid">关卡 GUID</label>
        <input
          id="comment-guid"
          class="input grow-input"
          inputmode="numeric"
          spellcheck="false"
          placeholder="填写要抓取评论的关卡 GUID"
          bind:value={prefs.guid}
          onkeydown={(e) => {
            if (e.key === "Enter") start();
          }}
        />
      </div>
      <div class="row">
        <span class="name" id="comment-filter">评价类型</span>
        <RadioGroup
          name="comment-filter"
          ariaLabelledby="comment-filter"
          options={FILTERS}
          value={prefs.filter}
          onchange={(v) => (prefs.filter = v as CommentFilter)}
        />
      </div>
      <div class="row">
        <label class="name" for="comment-pages">最大页数</label>
        <NumberField id="comment-pages" value={prefs.maxPage} min={1} max={MAX_PAGES} suffix="页" onchange={(v) => (prefs.maxPage = v)} />
        <span class="hint">每页 15 条</span>
      </div>
      <div class="row">
        <label class="check" data-tip={"去掉玩家未填写内容时的默认评价：\n推荐：非常优秀的奇域，推荐大家游玩~\n欠佳：奇域仍有待打磨，期待作者的更新~"}>
          <input type="checkbox" bind:checked={prefs.filterDefault} />过滤默认评价
        </label>
      </div>
      <div class="actions">
        {#if !isTauri}
          <span class="hint warn desktop-hint"><Icon name="warn" size={14} />评论抓取仅支持桌面版</span>
        {/if}
        {#if cmt.comments.length}
          <ul class="metrics hint" aria-label="抓取结果">
            {@render metric("chat", `${cmt.comments.length} 条`)}
            {@render metric("check", `推荐 ${good}`)}
            {@render metric("close", `欠佳 ${cmt.comments.length - good}`)}
            {@render metric("chart", `推荐率 ${recommendationRate}%`)}
          </ul>
        {/if}
        <button class="btn accent" onclick={start} disabled={!guidOk || !isTauri || cmt.running}>
          <Icon name={cmt.running ? "clock" : "play"} />{cmt.running ? `抓取中（第 ${cmt.pages + 1} 页）` : "开始抓取"}
        </button>
      </div>
    </div>
  </section>

  <section class="card setting enter" style:--enter-delay="40ms">
    <h2 class="card-title">评论</h2>
    <div class="setting-body">
      {#if cmt.comments.length}
        <ul class="list">
          {#each pageComments as c, i (pageStart + i)}
            <li class="item">
              <div class="meta">
                <span class="badge" class:good={c.recommend}>
                  <Icon name={c.recommend ? "check" : "close"} size={14} />{c.recommend ? "推荐" : "欠佳"}
                </span>
                <span class="sender">{c.name}</span>
                <span class="sub">IP属地：{c.ip}</span>
                <span class="sub">{formatTime(c.time, "发布于yyyy年MM月dd日 HH:mm:ss")}</span>
              </div>
              <p class="text">{c.text.replace(/\t+/g, "\n")}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">{cmt.running ? "正在抓取…" : "还没有评论。填写关卡 GUID 后点击「开始抓取」。"}</p>
      {/if}
    </div>
  </section>

  {#if cmt.comments.length}
    <Pagination page={currentPage} total={totalPages} onchange={setPage} />
  {/if}

  <CapsuleButton
    show={cmt.comments.length > 0}
    icon="export"
    label="导出为 CSV"
    disabled={exporting || cmt.running}
    tip={cmt.running ? "抓取完成后才能导出" : undefined}
    onclick={exportCsv}
  />
</div>

<style>
  .page-stack {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-height: var(--ctl-h);
  }
  .name {
    flex: none;
    width: 72px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .grow-input {
    flex: 1;
    max-width: 360px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s2) var(--s4);
    min-height: var(--ctl-h);
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .desktop-hint { margin-right: auto; }
  .metrics {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s2) 0;
    margin: 0;
    padding: 0;
    list-style: none;
    font-variant-numeric: tabular-nums;
  }
  .metrics li { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .metrics li + li { margin-left: var(--s2); padding-left: var(--s2); border-left: 1px solid var(--border); }
  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    padding: var(--s3) 0;
    border-top: 1px solid #edf0f4;
    /* 上千条评论时只排版可见的部分 */
    content-visibility: auto;
    contain-intrinsic-size: auto 72px;
  }
  .item:first-child {
    border-top: none;
    padding-top: 0;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: var(--s3);
    row-gap: 2px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-weight: 700;
    color: var(--text-3);
  }
  .badge.good {
    color: #00a896;
  }
  .sender {
    font-weight: 700;
  }
  .sub {
    font-size: 12.5px;
    color: var(--text-2);
  }
  .text {
    margin: var(--s1) 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .empty {
    margin: 0;
    color: var(--text-2);
  }
</style>
