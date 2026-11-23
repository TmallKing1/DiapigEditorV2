import { describe, expect, it } from "vitest";
import {
  CSV_HEADER,
  CommentError,
  STOCK_NOT_RECOMMEND,
  STOCK_RECOMMEND,
  commentsCsv,
  csvCell,
  filterComments,
  formatTime,
  parseReplyPage,
  type PlayerComment,
} from "./comment";

const reply = (nickname: string, content: string, is_recommend: boolean) => ({
  user_info: { uid: "100", nickname },
  client_ip: "广东",
  content,
  created_at: 1_700_000_000,
  is_recommend,
});

describe("parseReplyPage", () => {
  it("reads cursor and replies", () => {
    const page = parseReplyPage(
      JSON.stringify({
        retcode: 0,
        message: "OK",
        data: { cursor: { has_more: true, next: "abc", sort_type: "SORT_TYPE_HOT" }, reply_list: [reply("甲", "好玩", true)] },
      }),
    );
    expect(page).toEqual({
      hasMore: true,
      next: "abc",
      sortType: "SORT_TYPE_HOT",
      comments: [{ uid: "100", name: "甲", ip: "广东", text: "好玩", time: 1_700_000_000, recommend: true }],
    });
  });
  it("reports server errors and bad shapes", () => {
    expect(() => parseReplyPage('{"retcode":-1,"message":"关卡不存在"}')).toThrow("关卡不存在");
    expect(() => parseReplyPage("<html>")).toThrow(CommentError);
    expect(() => parseReplyPage('{"retcode":0,"data":{}}')).toThrow("data.cursor");
    expect(() =>
      parseReplyPage('{"retcode":0,"data":{"cursor":{"has_more":false},"reply_list":[{"content":"x"}]}}'),
    ).toThrow("user_info");
  });
  it("treats a missing reply list as empty", () => {
    expect(parseReplyPage('{"retcode":0,"data":{"cursor":{"has_more":false,"next":""}}}').comments).toEqual([]);
  });
});

describe("filterComments", () => {
  const c = (text: string, recommend: boolean): PlayerComment => ({ uid: "", name: "", ip: "", text, time: 0, recommend });
  const list = [c("赞", true), c(STOCK_RECOMMEND, true), c("差", false), c(STOCK_NOT_RECOMMEND, false), c(STOCK_NOT_RECOMMEND, true)];
  const texts = (l: PlayerComment[]) => l.map((x) => x.text);
  it("filters by recommendation and stock text", () => {
    expect(filterComments(list, { filter: "all", filterDefault: false })).toHaveLength(5);
    // 默认评价只在推荐状态与文字对应时算作默认（与旧版相同）
    expect(texts(filterComments(list, { filter: "all", filterDefault: true }))).toEqual(["赞", "差", STOCK_NOT_RECOMMEND]);
    expect(texts(filterComments(list, { filter: "recommend", filterDefault: true }))).toEqual(["赞", STOCK_NOT_RECOMMEND]);
    expect(texts(filterComments(list, { filter: "notRecommend", filterDefault: false }))).toEqual(["差", STOCK_NOT_RECOMMEND]);
  });
});

describe("csv", () => {
  it("escapes cells", () => {
    expect(csvCell("abc")).toBe("abc");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(" lead")).toBe('" lead"');
  });
  it("writes BOM, header and rows", () => {
    const csv = commentsCsv([
      { uid: "1", name: "甲,乙", ip: "上海", text: "不错\n很好", time: formatBack(), recommend: false },
    ]);
    expect(csv.startsWith("﻿" + CSV_HEADER + "\n")).toBe(true);
    expect(csv).toContain('"甲,乙",上海,2024/03/05 07:08:09,否,"不错\n很好"\n');
  });
  it("formats local time", () => {
    expect(formatTime(formatBack(), "发布于yyyy年MM月dd日 HH:mm:ss")).toBe("发布于2024年03月05日 07:08:09");
  });
});

/** 本地时间 2024-03-05 07:08:09 对应的 Unix 秒（与运行环境时区无关） */
function formatBack() {
  return new Date(2024, 2, 5, 7, 8, 9).getTime() / 1000;
}

describe("startFetch", async () => {
  const { cmt, startFetch } = await import("../lib/comment.svelte");
  const page = (n: number, hasMore: boolean) =>
    JSON.stringify({
      retcode: 0,
      data: { cursor: { has_more: hasMore, next: `p${n + 1}`, sort_type: "SORT_TYPE_HOT" }, reply_list: [reply(`玩家${n}`, `评论${n}`, n % 2 === 0)] },
    });
  it("follows the cursor until the page limit or has_more is false", async () => {
    const seen: string[] = [];
    const toasts: string[] = [];
    const fetcher = async (_g: string, next: string) => (seen.push(next), page(seen.length, seen.length < 3));
    await startFetch({ guid: "1", filter: "all", maxPage: 5, filterDefault: true }, (t) => toasts.push(t), fetcher);
    expect(seen).toEqual(["", "p2", "p3"]);
    expect(cmt.comments.map((c) => c.name)).toEqual(["玩家1", "玩家2", "玩家3"]);
    expect(toasts).toEqual(["获取成功，共 1 条好评，2 条差评"]);
    seen.length = 0;
    await startFetch({ guid: "1", filter: "all", maxPage: 2, filterDefault: true }, () => {}, fetcher);
    expect(seen).toHaveLength(2);
  });
  it("drops results on error and ignores a superseded run", async () => {
    const toasts: string[] = [];
    let release!: () => void;
    const slow = () => new Promise<string>((r) => (release = () => r(page(1, false))));
    const first = startFetch({ guid: "1", filter: "all", maxPage: 1, filterDefault: true }, (t) => toasts.push(t), slow);
    await startFetch({ guid: "2", filter: "all", maxPage: 1, filterDefault: true }, (t) => toasts.push(t), async () => '{"retcode":-1,"message":"关卡不存在"}');
    release();
    await first;
    expect(cmt.comments).toEqual([]);
    expect(cmt.running).toBe(false);
    expect(toasts).toEqual(["接口返回错误（-1）：关卡不存在"]);
  });
});

describe("paginationDisabled", async () => {
  const { paginationDisabled } = await import("../ui/Pagination.svelte");
  it("disables first on pages 1-2, prev on page 1, next on last, last on last two pages", () => {
    expect(paginationDisabled(1, 1)).toEqual({ first: true, prev: true, next: true, last: true });
    expect(paginationDisabled(1, 2)).toEqual({ first: true, prev: true, next: false, last: true });
    expect(paginationDisabled(2, 2)).toEqual({ first: true, prev: false, next: true, last: true });
    expect(paginationDisabled(1, 5)).toEqual({ first: true, prev: true, next: false, last: false });
    expect(paginationDisabled(2, 5)).toEqual({ first: true, prev: false, next: false, last: false });
    expect(paginationDisabled(3, 5)).toEqual({ first: false, prev: false, next: false, last: false });
    expect(paginationDisabled(4, 5)).toEqual({ first: false, prev: false, next: false, last: true });
    expect(paginationDisabled(5, 5)).toEqual({ first: false, prev: false, next: true, last: true });
  });
});
