// 发布版不弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod about;
mod comment;
mod files;
mod fit;
mod joypad;
mod pixel_art;

use std::collections::BTreeMap;
use std::sync::Arc;

use fontdb::Language;
use serde::Serialize;

/// 一个已安装的字体家族
#[derive(Serialize)]
struct FontFamily {
    /// 英文家族名，作为 CSS font-family 的值
    name: String,
    /// 中文本地化名称（如“微软雅黑”）；没有时为 None
    local: Option<String>,
}

fn is_chinese(lang: Language) -> bool {
    matches!(
        lang,
        Language::Chinese_PeoplesRepublicOfChina
            | Language::Chinese_Singapore
            | Language::Chinese_Taiwan
            | Language::Chinese_HongKongSAR
            | Language::Chinese_MacaoSAR
    )
}

/// 列出系统已安装的字体家族（按英文名去重、排序）。扫描字体文件较慢，放到阻塞线程里执行。
#[tauri::command]
async fn list_fonts() -> Result<Vec<FontFamily>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut families: BTreeMap<String, FontFamily> = BTreeMap::new();
        for face in db.faces() {
            let Some((name, _)) = face
                .families
                .iter()
                .find(|(_, lang)| *lang == Language::English_UnitedStates)
                .or_else(|| face.families.first())
            else {
                continue;
            };
            // 以点开头的是系统内部字体（如 .SF NS），不给用户选
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let local = face
                .families
                .iter()
                .find(|(n, lang)| is_chinese(*lang) && n != name)
                .map(|(n, _)| n.clone());
            let entry = families
                .entry(name.to_lowercase())
                .or_insert_with(|| FontFamily { name: name.clone(), local: None });
            if entry.local.is_none() {
                entry.local = local;
            }
        }
        families.into_values().collect()
    })
    .await
    .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(fit::FitState::default()))
        .manage(Arc::new(pixel_art::PixelArtState::default()))
        .manage(joypad::JoypadState(std::sync::Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            about::open_external_url,
            about::github_latest_release,
            list_fonts,
            comment::comment_fetch,
            joypad::joypad_inspect,
            joypad::joypad_list_uids,
            joypad::joypad_commit,
            files::file_read_text,
            files::file_write_text,
            files::file_exists,
            files::file_rename_json,
            files::file_read_binary,
            files::file_delete,
            files::file_list_json,
            fit::primfit_load,
            fit::primfit_start,
            fit::primfit_stop,
            pixel_art::pixelart_load,
            pixel_art::pixelart_clear,
            pixel_art::pixelart_generate
        ])
        // 主窗口关闭时（前端用 destroy() 关，不经过前端的卸载事件）一并关掉对话预览窗口，
        // 否则剩下的预览窗口会让应用继续运行
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                use tauri::Manager;
                if let Some(preview) = window.app_handle().get_webview_window("preview") {
                    let _ = preview.destroy();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Diapig Editor");
}
