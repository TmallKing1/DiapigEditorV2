import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  GITHUB_RELEASES_URL,
  compareVersions,
  formatUpdateMessage,
  isNewerVersion,
  parseLatestRelease,
} from "./about";

describe("版本与更新检查", () => {
  it("读取 package.json 注入的当前版本号 2.0.1", () => {
    expect(APP_VERSION).toBe("2.0.1");
  });

  it("语义化版本比较", () => {
    expect(compareVersions("2.0.2", "2.0.1")).toBe(1);
    expect(compareVersions("v2.1.0", "2.0.1")).toBe(1);
    expect(compareVersions("v2.0.1", "2.0.1")).toBe(0);
    expect(compareVersions("2.0.0", "2.0.1")).toBe(-1);
    expect(compareVersions("2.0.2", "2.0.2-beta.1")).toBe(1);
    expect(compareVersions("2.0.2-beta.1", "2.0.1")).toBe(1);
    expect(isNewerVersion("v2.0.2", "2.0.1")).toBe(true);
    expect(isNewerVersion("v2.0.1", "2.0.1")).toBe(false);
    expect(isNewerVersion("2.0.1-rc.1", "2.0.1")).toBe(false);
  });

  it("解析 GitHub Release 响应与空发布", () => {
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease(JSON.stringify({ name: "empty" }))).toBeNull();

    const ok = parseLatestRelease(
      JSON.stringify({
        tag_name: "v2.0.2",
        name: "Diapig Editor v2.0.2",
        html_url: "https://github.com/TmallKing1/DiapigEditorV2/releases/tag/v2.0.2",
        body: "修复问题",
      }),
    );
    expect(ok).toEqual({
      tag: "v2.0.2",
      version: "2.0.2",
      name: "Diapig Editor v2.0.2",
      url: "https://github.com/TmallKing1/DiapigEditorV2/releases/tag/v2.0.2",
      notes: "修复问题",
    });

    const fallbackUrl = parseLatestRelease(
      JSON.stringify({
        tag_name: "v2.0.2",
        html_url: "javascript:alert(1)",
      }),
    );
    expect(fallbackUrl?.url).toBe(GITHUB_RELEASES_URL);
  });

  it("格式化更新提示包含新旧版本号", () => {
    const msg = formatUpdateMessage("2.0.1", {
      tag: "v2.0.2",
      version: "2.0.2",
      name: "功能更新",
      url: GITHUB_RELEASES_URL,
      notes: "",
    });
    expect(msg).toContain("v2.0.2");
    expect(msg).toContain("2.0.1");
    expect(msg).toContain("功能更新");
  });
});
