// 「关于」页的数据常量、版本号比较与 GitHub Release 解析。
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "2.0.1";
export const AUTHOR_URL = "https://space.bilibili.com/381671770";
export const GUIDE_URL = "https://www.pigest.top/2026/11/20/diapig-v2-guide/";
export const GITHUB_REPO = "TmallKing1/DiapigEditorV2";
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

export interface ReleaseInfo {
  tag: string;
  version: string;
  name: string;
  url: string;
  notes: string;
}

interface ParsedSemver {
  core: number[];
  pre: string[];
}

function parseSemver(raw: string): ParsedSemver {
  const clean = raw.trim().replace(/^[vV]/, "").split("+")[0];
  const dash = clean.indexOf("-");
  const coreStr = dash >= 0 ? clean.slice(0, dash) : clean;
  const preStr = dash >= 0 ? clean.slice(dash + 1) : "";
  const core = coreStr.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : 0));
  const pre = preStr ? preStr.split(".") : [];
  return { core, pre };
}

/** 比较两个语义化版本号：a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  const len = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < len; i++) {
    const da = pa.core[i] ?? 0;
    const db = pb.core[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const plen = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < plen; i++) {
    const ia = pa.pre[i];
    const ib = pb.pre[i];
    if (ia === undefined) return -1;
    if (ib === undefined) return 1;
    const na = /^\d+$/.test(ia);
    const nb = /^\d+$/.test(ib);
    if (na && nb) {
      const diff = Number(ia) - Number(ib);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (ia !== ib) {
      return ia > ib ? 1 : -1;
    }
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/** 解析 GitHub Release API 响应文本；空响应或缺少 tag_name 时返回 null */
export function parseLatestRelease(raw: string | null): ReleaseInfo | null {
  if (!raw) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("无法解析 GitHub Release 响应");
  }
  const tag = typeof data.tag_name === "string" ? data.tag_name.trim() : "";
  if (!tag) return null;
  const version = tag.replace(/^[vV]/, "");
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : tag;
  const htmlUrl = typeof data.html_url === "string" ? data.html_url.trim() : "";
  const url = /^https:\/\//i.test(htmlUrl) ? htmlUrl : GITHUB_RELEASES_URL;
  const notes = typeof data.body === "string" ? data.body.trim() : "";
  return { tag, version, name, url, notes };
}

export function formatUpdateMessage(current: string, release: ReleaseInfo): string {
  const head = `发现新版本 ${release.tag}（当前版本 ${current}）`;
  const title = release.name && release.name !== release.tag ? `\n${release.name}` : "";
  return `${head}${title}\n\n是否前往 GitHub 查看并下载更新？`;
}
