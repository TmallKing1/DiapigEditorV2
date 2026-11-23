//! 评论抓取：向米游社千星奇域评论接口请求一页玩家评价。
//!
//! 网页端直接请求会被跨域拦下，所以由这里代发。只返回原始响应文本，
//! 字段解析、retcode 判断与筛选都在前端 src/model/comment.ts 中完成（便于测试）。

use std::time::Duration;

const REPLY_LIST_URL: &str =
    "https://bbs-api.miyoushe.com/community/ugc_community/web/api/reply/list?lang=zh-cn";
/// 每页条数与旧版一致
const PAGE_SIZE: u32 = 15;
/// 只支持国服官服
const REGION: &str = "cn_gf01";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT: Duration = Duration::from_secs(15);
/// 单页响应大小上限
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

#[tauri::command]
pub async fn comment_fetch(guid: String, next: String, sort_type: String) -> Result<String, String> {
    let body = serde_json::json!({
        "cursor": { "next": next, "size": PAGE_SIZE, "sort_type": sort_type },
        "level_id": guid,
        "region": REGION,
        "uid": "",
    });
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("网络初始化失败：{e}"))?;
    let resp = client
        .post(REPLY_LIST_URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "请求超时，请检查网络后重试".to_string()
            } else {
                format!("请求失败：{e}")
            }
        })?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| format!("读取响应失败：{e}"))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err("响应过大".to_string());
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if !status.is_success() {
        return Err(format!("服务器返回 HTTP {}", status.as_u16()));
    }
    Ok(text)
}
