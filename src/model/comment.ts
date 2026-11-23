// 评论抓取：解析米游社千星奇域评论接口的一页响应、筛选、导出 CSV，以及页面参数的保存。
// 接口、筛选规则与 CSV 格式与旧版 CommentApi.java / CommentGetterPage.java 保持一致；
// 网络请求由 Tauri 命令 comment_fetch（src-tauri/src/comment.rs）代发，这里只处理文本。

export interface PlayerComment {
  uid: string;
  name: string;
  /** IP 属地 */
  ip: string;
  text: string;
  /** 发布时间，Unix 秒 */
  time: number;
  /** 推荐（好评）/ 欠佳（差评） */
  recommend: boolean;
}

export interface ReplyPage {
  hasMore: boolean;
  next: string;
  sortType: string;
  comments: PlayerComment[];
}

/** 第一页的游标与排序（旧版固定按热度） */
export const FIRST_CURSOR = { next: "", sortType: "SORT_TYPE_HOT" } as const;
export const MAX_PAGES = 1000;

/** 玩家未填写内容时的默认评价 */
export const STOCK_RECOMMEND = "非常优秀的奇域，推荐大家游玩~";
export const STOCK_NOT_RECOMMEND = "奇域仍有待打磨，期待作者的更新~";

export type CommentFilter = "all" | "recommend" | "notRecommend";

export class CommentError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function field<T>(o: Obj, key: string, type: "string" | "number" | "boolean", path: string): T {
  const v = o[key];
  if (typeof v !== type) throw new CommentError(`响应格式有误：缺少 ${path}${key}`);
  return v as T;
}

function parseComment(o: unknown, i: number): PlayerComment {
  const at = `reply_list[${i}].`;
  if (!isObj(o) || !isObj(o.user_info)) throw new CommentError(`响应格式有误：缺少 ${at}user_info`);
  const user = o.user_info;
  return {
    uid: String(user.uid ?? ""),
    name: field<string>(user, "nickname", "string", `${at}user_info.`),
    ip: typeof o.client_ip === "string" ? o.client_ip : "",
    text: field<string>(o, "content", "string", at),
    time: Number(o.created_at) || 0,
    recommend: field<boolean>(o, "is_recommend", "boolean", at),
  };
}

/** 解析一页响应；retcode 非 0 时抛出服务器给的说明 */
export function parseReplyPage(text: string): ReplyPage {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CommentError("响应不是有效的 JSON");
  }
  if (!isObj(json)) throw new CommentError("响应格式有误");
  if (json.retcode !== 0) {
    const msg = typeof json.message === "string" && json.message ? json.message : "未知错误";
    throw new CommentError(`接口返回错误（${String(json.retcode)}）：${msg}`);
  }
  const data = json.data;
  if (!isObj(data) || !isObj(data.cursor)) throw new CommentError("响应格式有误：缺少 data.cursor");
  const list = data.reply_list ?? [];
  if (!Array.isArray(list)) throw new CommentError("响应格式有误：reply_list 不是列表");
  return {
    hasMore: field<boolean>(data.cursor, "has_more", "boolean", "data.cursor."),
    next: String(data.cursor.next ?? ""),
    sortType: String(data.cursor.sort_type ?? FIRST_CURSOR.sortType),
    comments: list.map(parseComment),
  };
}

const isStock = (c: PlayerComment) => (c.recommend ? c.text === STOCK_RECOMMEND : c.text === STOCK_NOT_RECOMMEND);

/** 按好评 / 差评筛选，可选去掉默认评价 */
export function filterComments(list: readonly PlayerComment[], opt: { filter: CommentFilter; filterDefault: boolean }): PlayerComment[] {
  return list.filter(
    (c) =>
      (opt.filter === "all" || (opt.filter === "recommend") === c.recommend) && !(opt.filterDefault && isStock(c)),
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 本地时间；pattern 中的 yyyy MM dd HH mm ss 会被替换 */
export function formatTime(seconds: number, pattern: string): string {
  const d = new Date(seconds * 1000);
  return pattern
    .replace("yyyy", String(d.getFullYear()))
    .replace("MM", pad(d.getMonth() + 1))
    .replace("dd", pad(d.getDate()))
    .replace("HH", pad(d.getHours()))
    .replace("mm", pad(d.getMinutes()))
    .replace("ss", pad(d.getSeconds()));
}

/** CSV 单元格：含逗号、引号、换行或首尾空白时加引号，内部引号加倍 */
export function csvCell(cell: string): string {
  return /[",\r\n]|^[ \t]|[ \t]$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export const CSV_HEADER = "发送者,IP属地,发送时间,是否推荐,评论内容";

/** 导出 CSV：UTF-8 带 BOM（Excel 直接打开不乱码） */
export function commentsCsv(list: readonly PlayerComment[]): string {
  let csv = "﻿" + CSV_HEADER + "\n";
  for (const c of list) {
    csv +=
      [c.name, c.ip, formatTime(c.time, "yyyy/MM/dd HH:mm:ss"), c.recommend ? "是" : "否", c.text].map(csvCell).join(",") +
      "\n";
  }
  return csv;
}

// —— 页面参数（localStorage） ——
export const COMMENT_KEY = "diapig.comment";

export interface CommentPrefs {
  guid: string;
  filter: CommentFilter;
  maxPage: number;
  filterDefault: boolean;
}

export const DEFAULT_COMMENT_PREFS: CommentPrefs = { guid: "", filter: "all", maxPage: 5, filterDefault: true };

export function loadCommentPrefs(): CommentPrefs {
  const d = DEFAULT_COMMENT_PREFS;
  try {
    const v = JSON.parse(localStorage.getItem(COMMENT_KEY) ?? "null");
    if (!isObj(v)) return { ...d };
    const page = Number(v.maxPage);
    return {
      guid: typeof v.guid === "string" ? v.guid : d.guid,
      filter: v.filter === "recommend" || v.filter === "notRecommend" ? v.filter : "all",
      maxPage: Number.isInteger(page) && page >= 1 && page <= MAX_PAGES ? page : d.maxPage,
      filterDefault: typeof v.filterDefault === "boolean" ? v.filterDefault : d.filterDefault,
    };
  } catch {
    return { ...d };
  }
}

export function saveCommentPrefs(p: CommentPrefs) {
  try {
    localStorage.setItem(COMMENT_KEY, JSON.stringify(p));
  } catch {
    // 忽略
  }
}

export function clearCommentPrefs() {
  try {
    localStorage.removeItem(COMMENT_KEY);
  } catch {
    // 忽略
  }
}
