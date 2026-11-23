//! 按路径读写本机文件的命令。
//!
//! fs 插件只放行本次运行中由系统对话框选过的路径；历史对话、启动时重新打开上次的文件、
//! 自动保存和自定义字体都要用到之前保存下来的路径，所以另给这几条命令。
//! 路径只来自用户自己选过的文件 / 文件夹（由前端保存在本机）。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::Response;

/// 单次导入文件夹最多收集的文件数与向下查找的层数
const MAX_LISTED: usize = 2000;
const MAX_DEPTH: usize = 8;
/// 文本文件大小上限（对话 JSON 远小于此）
const MAX_TEXT_BYTES: u64 = 32 * 1024 * 1024;
/// 字体文件大小上限
const MAX_BINARY_BYTES: u64 = 64 * 1024 * 1024;

fn err(action: &str, path: &str, e: impl std::fmt::Display) -> String {
    format!("{action}失败（{path}）：{e}")
}

fn check_size(path: &str, limit: u64) -> Result<(), String> {
    let meta = fs::metadata(path).map_err(|e| err("读取", path, e))?;
    if !meta.is_file() {
        return Err(format!("不是文件：{path}"));
    }
    if meta.len() > limit {
        return Err(format!("文件过大：{path}"));
    }
    Ok(())
}

#[tauri::command]
pub fn file_read_text(path: String) -> Result<String, String> {
    check_size(&path, MAX_TEXT_BYTES)?;
    fs::read_to_string(&path).map_err(|e| err("读取", &path, e))
}

#[tauri::command]
pub fn file_write_text(path: String, text: String) -> Result<(), String> {
    fs::write(&path, text).map_err(|e| err("写入", &path, e))
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

/// 只在原目录内修改文件名，保留原来的 JSON 后缀。
#[tauri::command]
pub fn file_rename_json(path: String, stem: String) -> Result<String, String> {
    let source = Path::new(&path);
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| ext.eq_ignore_ascii_case("json"))
        .ok_or("只能重命名 JSON 文件")?;
    let stem = stem.trim();
    if stem.is_empty() {
        return Err("文件名不能为空".into());
    }
    if stem == "." || stem == ".." || stem.chars().any(|ch| ch.is_control() || r#"<>:"/\|?*"#.contains(ch)) {
        return Err("文件名包含不可用的字符".into());
    }
    let device = stem.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
    if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || ["COM", "LPT"].iter().any(|prefix| {
            device.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")
            })
        })
    {
        return Err("该名称为系统保留名称".into());
    }
    if !source.is_file() {
        return Err(format!("文件不存在：{path}"));
    }
    let target = source.with_file_name(format!("{stem}.{extension}"));
    if source.file_name() != target.file_name() {
        rename_without_overwrite(source, &target).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                "同目录下已有同名文件".into()
            } else {
                err("重命名", &path, e)
            }
        })?;
    }
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn rename_without_overwrite(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    let dir = source.parent().filter(|dir| !dir.as_os_str().is_empty());
    let dir = fs::canonicalize(dir.unwrap_or(Path::new(".")))?;
    let source = dir.join(source.file_name().unwrap());
    let target = dir.join(target.file_name().unwrap());
    let source: Vec<_> = source.as_os_str().encode_wide().chain([0]).collect();
    let target: Vec<_> = target.as_os_str().encode_wide().chain([0]).collect();
    // 两个缓冲区均以 NUL 结尾，且在系统调用期间有效。标志为 0，目标已存在时系统拒绝覆盖。
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn rename_without_overwrite(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::hard_link(source, target)?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(target);
        return Err(error);
    }
    Ok(())
}

/// 读取二进制文件（字体），前端收到 ArrayBuffer
#[tauri::command]
pub fn file_read_binary(path: String) -> Result<Response, String> {
    check_size(&path, MAX_BINARY_BYTES)?;
    fs::read(&path).map(Response::new).map_err(|e| err("读取", &path, e))
}

/// 永久删除一个文件（不进回收站）
#[tauri::command]
pub fn file_delete(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| err("删除", &path, e))
}

#[derive(Serialize)]
pub struct ListedFile {
    pub path: String,
    pub name: String,
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_DEPTH || out.len() >= MAX_LISTED {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        if out.len() >= MAX_LISTED {
            return;
        }
        if path.is_dir() {
            walk(&path, depth + 1, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("json"))
        {
            out.push(path);
        }
    }
}

/// 列出文件夹（含子文件夹）下的 .json 文件，按路径排序
#[tauri::command]
pub async fn file_list_json(dir: String) -> Result<Vec<ListedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&dir);
        if !root.is_dir() {
            return Err(format!("不是文件夹：{dir}"));
        }
        let mut found = Vec::new();
        walk(root, 0, &mut found);
        Ok(found
            .into_iter()
            .map(|p| ListedFile {
                name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                path: p.to_string_lossy().into_owned(),
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rename_json_keeps_suffix_and_refuses_overwrite() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("diapig-rename-{}-{nonce}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        let source = dir.join("旧文件.JSON");
        let occupied = dir.join("已有.JSON");
        let target = dir.join("新文件.JSON");
        fs::write(&source, "old").unwrap();
        fs::write(&occupied, "other").unwrap();
        let rename = |stem: &str| {
            file_rename_json(source.to_string_lossy().into_owned(), stem.into())
        };
        assert!(rename("../其余文件").is_err());
        assert!(rename("NUL").is_err());
        assert_eq!(rename("已有").unwrap_err(), "同目录下已有同名文件");
        assert_eq!(fs::read_to_string(&occupied).unwrap(), "other");
        assert_eq!(rename(" 新文件 ").unwrap(), target.to_string_lossy());
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(&target).unwrap(), "old");
        fs::remove_file(target).unwrap();
        fs::remove_file(occupied).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
