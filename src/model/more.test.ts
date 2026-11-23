import { describe, expect, it } from "vitest";
import { CURVES, ExprError, MAX_LEVEL, formatNumber, growthCsv, parseExpr } from "./growth";
import { PLAYER_CHAR, diffApply, fromSource, mapStyles, normalizeColor, toSource } from "./richdoc";
import { parseRichText, visibleLength } from "./richtext";

describe("growth expression", () => {
  const ev = (s: string, x = 2) => parseExpr(s)(x);
  it("evaluates like the Java parser", () => {
    expect(ev("0.1x")).toBeCloseTo(0.2);
    expect(ev("y = 2x^2 + 1", 3)).toBe(19);
    expect(ev("2^3^2")).toBe(512); // 右结合
    expect(ev("-x^2", 3)).toBe(9); // 一元负号先结合（与旧版相同）
    expect(ev("3(x+1)")).toBe(9);
    expect(ev("max(x, 5)")).toBe(5);
    expect(ev("log(100)+ln(e)")).toBeCloseTo(3);
    expect(ev("1e2x")).toBe(200);
    expect(ev("2pi")).toBeCloseTo(2 * Math.PI);
  });
  it("reports errors with positions", () => {
    expect(() => parseExpr("")).toThrow("函数不能为空");
    expect(() => parseExpr("(x+1")).toThrow("缺少 ')'（位置 5）");
    expect(() => parseExpr("x$")).toThrow("无法识别的字符（位置 2）");
    expect(() => parseExpr("foo(x)")).toThrow("不支持的函数：foo");
    expect(() => parseExpr("2e")).toThrow(ExprError);
  });
});

describe("formatNumber (DecimalFormat 0.####)", () => {
  it("matches Java output", () => {
    expect(formatNumber(5.3938)).toBe("5.3938");
    expect(formatNumber(1.01)).toBe("1.01");
    expect(formatNumber(3)).toBe("3");
    expect(formatNumber(0.1 * 3)).toBe("0.3");
    expect(formatNumber(19249.6)).toBe("19249.6");
    expect(formatNumber(0.03125)).toBe("0.0312"); // 恰好一半 → 偶数
    expect(formatNumber(0.03135)).toBe("0.0314"); // 二进制值略大于一半
    expect(formatNumber(-1.5)).toBe("-1.5");
    expect(formatNumber(-0.00001)).toBe("-0");
    expect(formatNumber(1e21)).toBe("1000000000000000000000");
    expect(() => formatNumber(NaN)).toThrow("函数结果不是有效数字");
  });
});

describe("growthCsv", () => {
  it("keeps the old layout", () => {
    const csv = growthCsv(CURVES.map((c) => parseExpr(c.fallback)));
    const lines = csv.split("\n");
    expect(csv.startsWith("﻿等级,生命值倍率,攻击力倍率,防御力倍率\n")).toBe(true);
    expect(lines).toHaveLength(MAX_LEVEL + 2);
    expect(lines[1]).toBe("1,0.1,0.05,0.02");
    expect(lines[MAX_LEVEL]).toBe("200,20,10,4");
    expect(lines[MAX_LEVEL + 1]).toBe("");
  });
});

describe("richdoc", () => {
  it("round-trips normalized source", () => {
    for (const s of [
      "普通文本",
      "<b>粗</b>和<i>斜</i>",
      "<color=#FF0000>红<b>红粗</b></color>",
      "第一行\\n<b>第二行</b>",
      "<color=#11223344><b><i>全</i></b></color>",
    ]) {
      expect(toSource(fromSource(s))).toBe(s);
    }
  });
  it("closes unclosed tags and expands short colors", () => {
    expect(toSource(fromSource("<b>abc"))).toBe("<b>abc</b>");
    expect(toSource(fromSource("<color=#f00>x</color>"))).toBe("<color=#ff0000>x</color>");
  });
  it("turns literal \\n into newlines", () => {
    expect(fromSource("a\\nb").text).toBe("a\nb");
  });
  it("nests minimal tags", () => {
    const doc = mapStyles(fromSource("abc"), 1, 3, (s) => ({ ...s, b: true }));
    expect(toSource(mapStyles(doc, 2, 3, (s) => ({ ...s, i: true })))).toBe("a<b>b<i>c</i></b>");
  });
  it("inherits the previous character style when typing", () => {
    const doc = fromSource("<b>ab</b>cd");
    const r = diffApply(doc, "abXcd", 3);
    expect(toSource(r.doc)).toBe("<b>abX</b>cd");
    // 重复字符：光标位置决定插入点
    const d2 = fromSource("<b>a</b>a");
    expect(toSource(diffApply(d2, "aaa", 1).doc)).toBe("<b>aa</b>a");
    expect(toSource(diffApply(d2, "aaa", 3).doc)).toBe("<b>a</b>aa");
  });
  it("treats <PLAYER_NAME> as one block unless split by tags", () => {
    // 完整的玩家名：一个占位字符，整块套样式
    const doc = fromSource("你好<PLAYER_NAME>！");
    expect(doc.text).toBe("你好" + PLAYER_CHAR + "！");
    expect(toSource(mapStyles(doc, 2, 3, (s) => ({ ...s, b: true })))).toBe("你好<b><PLAYER_NAME></b>！");
    expect(toSource(fromSource("<color=#FF0000><PLAYER_NAME></color>"))).toBe("<color=#FF0000><PLAYER_NAME></color>");
    // 整块删除
    expect(toSource(diffApply(doc, "你好！", 2).doc)).toBe("你好！");
    // 被标签切开：按原字符串，生成源码时不会合并成玩家名
    const split = fromSource("<b><PLAYER_</b>NAME>");
    expect(split.text).toBe("<PLAYER_NAME>");
    expect(toSource(split)).toBe("<b><PLAYER_</b>NAME>");
    const same = fromSource("<b><PLAYER_</b><b>NAME></b>");
    expect(same.text).toBe("<PLAYER_NAME>");
    expect(fromSource(toSource(same)).text).toBe("<PLAYER_NAME>");
    expect(visibleLength("a<PLAYER_NAME>b")).toBe(3);
    expect(parseRichText("<b><PLAYER_</b>NAME>").segments.some((s) => s.player)).toBe(false);
  });
  it("normalizes colors", () => {
    expect(normalizeColor("f00")).toBe("#FF0000");
    expect(normalizeColor("#1a8bcc80")).toBe("#1A8BCC80");
    expect(normalizeColor("#12345")).toBeNull();
  });
});
