//! 关于页：在系统默认浏览器打开外链、从 GitHub 查询最新 Release。

use std::process::Command;
use std::time::Duration;

const USER_AGENT: &str = concat!("DiapigEditor/", env!("CARGO_PKG_VERSION"));
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

fn validate_http_url(raw: &str) -> Result<&str, String> {
    let url = raw.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只允许打开 http 或 https 链接".to_string());
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"') {
        return Err("链接包含非法字符".to_string());
    }
    Ok(url)
}

fn validate_repo(raw: &str) -> Result<&str, String> {
    let repo = raw.trim();
    let Some((owner, name)) = repo.split_once('/') else {
        return Err("仓库名称格式无效".to_string());
    };
    let valid_part = |s: &str| {
        !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if !valid_part(owner) || !valid_part(name) || name.contains('/') {
        return Err("仓库名称格式无效".to_string());
    }
    Ok(repo)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let clean = validate_http_url(&url)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", clean])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("无法启动浏览器：{e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(clean)
            .spawn()
            .map_err(|e| format!("无法启动浏览器：{e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(clean)
            .spawn()
            .map_err(|e| format!("无法启动浏览器：{e}"))?;
    }
    Ok(())
}

async fn fetch_github_json(client: &reqwest::Client, url: &str) -> Result<(u16, String), String> {
    let resp = client.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            "请求超时，请检查网络后重试".to_string()
        } else {
            format!("网络请求失败：{e}")
        }
    })?;
    let status = resp.status().as_u16();
    let bytes = resp.bytes().await.map_err(|e| format!("读取响应失败：{e}"))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err("响应过大".to_string());
    }
    Ok((status, String::from_utf8_lossy(&bytes).into_owned()))
}

#[tauri::command]
pub async fn github_latest_release(repo: String) -> Result<Option<String>, String> {
    let clean_repo = validate_repo(&repo)?;
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT)
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::ACCEPT,
                reqwest::header::HeaderValue::from_static("application/vnd.github+json"),
            );
            h
        })
        .build()
        .map_err(|e| format!("网络初始化失败：{e}"))?;

    let latest_url = format!("https://api.github.com/repos/{clean_repo}/releases/latest");
    let (status, body) = fetch_github_json(&client, &latest_url).await?;
    if (200..300).contains(&status) {
        return Ok(Some(body));
    }
    if status == 404 {
        let list_url = format!("https://api.github.com/repos/{clean_repo}/releases?per_page=1");
        let (list_status, _) = fetch_github_json(&client, &list_url).await?;
        if (200..300).contains(&list_status) {
            return Ok(None);
        }
        return Err("未找到仓库或发布信息（HTTP 404）".to_string());
    }
    if status == 403 {
        return Err("GitHub API 请求受限，请稍后再试（HTTP 403）".to_string());
    }
    Err(format!("GitHub 返回 HTTP {status}"))
}
