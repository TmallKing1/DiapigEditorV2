//! The original PowerShell safety checks run in a hidden, noninteractive child.
//! No registry changes occur in inspect; commit re-reads and compares the snapshot.
use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

pub struct JoypadState(pub Mutex<()>);

fn run(request: Value) -> Result<Value, String> {
    #[cfg(not(windows))]
    { let _ = request; return Err("原神输入设备切换仅支持 Windows。".into()); }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let system_root = std::env::var_os("SystemRoot").ok_or("找不到 Windows 系统目录。")?;
        let powershell = std::path::PathBuf::from(system_root)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut child = Command::new(powershell)
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", include_str!("joypad.ps1")])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|e| format!("无法启动原神配置检查：{e}"))?;
        let input = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        if let Err(e) = child.stdin.take().ok_or("无法发送检查参数。")?.write_all(&input) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("无法发送检查参数：{e}"));
        }
        let output = child.wait_with_output().map_err(|e| format!("原神配置检查失败：{e}"))?;
        let result: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "原神配置检查未返回有效结果，请检查 PowerShell 是否被安全软件拦截。".to_string())?;
        if let Some(error) = result.get("error").and_then(Value::as_str) {
            return Err(error.into());
        }
        if !output.status.success() { return Err("原神配置操作失败。".into()); }
        Ok(result)
    }
}

#[tauri::command]
pub async fn joypad_list_uids(window: tauri::WebviewWindow) -> Result<Value, String> {
    if window.label() != "main" { return Err("仅主窗口可读取原神账号。".into()); }
    tauri::async_runtime::spawn_blocking(move || run(json!({"mode": "list"})))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn joypad_inspect(window: tauri::WebviewWindow, uid: String) -> Result<Value, String> {
    if window.label() != "main" { return Err("仅主窗口可切换原神输入设备。".into()); }
    tauri::async_runtime::spawn_blocking(move || run(json!({"mode": "inspect", "uid": uid})))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn joypad_commit(window: tauri::WebviewWindow, app: tauri::AppHandle,
    uid: String, snapshot: String, target: String,
) -> Result<Value, String> {
    if window.label() != "main" { return Err("仅主窗口可切换原神输入设备。".into()); }
    // Serialize writes even if a second IPC request bypasses the disabled UI button.
    let backup_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("joypad-backup");
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<JoypadState>();
        let _guard = state.0.try_lock().map_err(|_| "正在切换输入设备，请稍候。")?;
        run(json!({"mode": "commit", "uid": uid, "snapshot": snapshot,
            "target": target, "backupDir": backup_dir}))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn child_returns_utf8_errors_without_accessing_registry() {
        let error = run(json!({"mode": "inspect", "uid": "invalid"})).unwrap_err();
        assert_eq!(error, "UID 必须为非零的纯数字。");
    }
}
