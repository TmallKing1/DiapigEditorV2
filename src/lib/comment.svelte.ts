// 评论抓取的运行状态：结果保存在模块里，切到其他页签再回来仍在。
// 每次开始抓取递增代次号；旧一轮的页面或结束回调发现代次已变就直接丢弃。
import { isTauri } from "./files";
import {
  FIRST_CURSOR,
  filterComments,
  parseReplyPage,
  type CommentFilter,
  type PlayerComment,
} from "../model/comment";

export interface FetchOptions {
  guid: string;
  filter: CommentFilter;
  maxPage: number;
  filterDefault: boolean;
}

type Toast = (text: string, kind?: "success" | "info" | "error") => void;

export const cmt = $state<{
  running: boolean;
  /** 已显示的评论（筛选后） */
  comments: PlayerComment[];
  /** 已请求的页数（抓取中显示进度） */
  pages: number;
  /** 列表当前页码（1-based），切页回来保持 */
  page: number;
}>({ running: false, comments: [], pages: 0, page: 1 });

let gen = 0;

async function fetchPage(guid: string, next: string, sortType: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("comment_fetch", { guid, next, sortType });
}

/** 开始抓取；正在进行的上一轮会被放弃 */
export async function startFetch(opt: FetchOptions, toast: Toast, fetcher = fetchPage): Promise<void> {
  const my = ++gen;
  cmt.running = true;
  cmt.comments = [];
  cmt.pages = 0;
  cmt.page = 1;
  const all: PlayerComment[] = [];
  try {
    if (!isTauri && fetcher === fetchPage) throw new Error("评论抓取仅支持桌面版");
    let cursor: { hasMore: boolean; next: string; sortType: string } = { hasMore: true, ...FIRST_CURSOR };
    for (let i = 1; i <= opt.maxPage && cursor.hasMore; i++) {
      const page = parseReplyPage(await fetcher(opt.guid, cursor.next, cursor.sortType));
      if (my !== gen) return;
      cursor = page;
      const kept = filterComments(page.comments, opt);
      all.push(...kept);
      cmt.pages = i;
      if (kept.length) cmt.comments.push(...kept);
    }
  } catch (e) {
    if (my !== gen) return;
    cmt.running = false;
    cmt.comments = [];
    const msg = e instanceof Error ? e.message : String(e);
    toast(msg, "error");
    return;
  }
  if (my !== gen) return;
  cmt.running = false;
  if (opt.filter === "all") {
    const good = all.filter((c) => c.recommend).length;
    toast(`获取成功，共 ${good} 条好评，${all.length - good} 条差评`, "success");
  } else {
    toast(`获取成功，共 ${all.length} 条评论`, "success");
  }
}

/** 清空结果并放弃正在进行的抓取（左侧栏「重置」） */
export function clearComments() {
  gen++;
  cmt.running = false;
  cmt.comments = [];
  cmt.pages = 0;
  cmt.page = 1;
}
