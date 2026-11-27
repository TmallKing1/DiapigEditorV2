// 「关于」页交互：在系统默认浏览器打开外链、检查 GitHub 最新 Release。
import {
  APP_VERSION,
  GITHUB_REPO,
  formatUpdateMessage,
  isNewerVersion,
  parseLatestRelease,
} from "../model/about";
import { isTauri } from "./files";
import { ask, toast } from "./ui.svelte";

export const aboutState = $state({ checking: false });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 在系统默认浏览器打开 http/https 链接 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    if (isTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch (error) {
    toast(`打开链接失败：${errorMessage(error)}`, "error");
  }
}

async function currentAppVersion(): Promise<string> {
  if (!isTauri) return APP_VERSION;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return (await getVersion()) || APP_VERSION;
  } catch {
    return APP_VERSION;
  }
}

async function fetchLatestReleaseRaw(): Promise<string | null> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("github_latest_release", { repo: GITHUB_REPO });
  }
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (resp.status === 404) {
    const listResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (listResp.ok) return null;
    throw new Error("未找到仓库或发布信息（HTTP 404）");
  }
  if (!resp.ok) throw new Error(`GitHub 返回 HTTP ${resp.status}`);
  return await resp.text();
}

/** 查询 GitHub 最新 Release；有更新时弹窗提示跳转，无更新时左下角 Toast 提示 */
export async function checkForUpdates(): Promise<void> {
  if (aboutState.checking) return;
  aboutState.checking = true;
  try {
    const [current, raw] = await Promise.all([currentAppVersion(), fetchLatestReleaseRaw()]);
    const release = parseLatestRelease(raw);
    if (release && isNewerVersion(release.version, current)) {
      ask({
        title: "发现新版本",
        message: formatUpdateMessage(current, release),
        actions: [
          { label: "稍后再说" },
          {
            label: "前往 GitHub 更新",
            style: "accent",
            focus: true,
            run: () => void openExternalUrl(release.url),
          },
        ],
      });
    } else {
      toast("当前 Diapig Editor 已是最新版本!", "success");
    }
  } catch (error) {
    toast(`检查更新失败：${errorMessage(error)}`, "error");
  } finally {
    aboutState.checking = false;
  }
}
