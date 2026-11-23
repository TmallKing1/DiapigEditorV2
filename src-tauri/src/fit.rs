//! 图元拟合的 Tauri 命令：载入图片、开始拟合（逐个图元推送给界面）、停止。
//! 只读用户选的图片，不写任何文件；导出 Lua 由界面走保存对话框。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use image::RgbaImage;
use primfit::{prepare_target, prepare_target_alpha, prepare_weights, run_fit, run_refine, FitOptions, Fitter, Shape, BUDGET_FAST, BUDGET_FINE, BUDGET_NORMAL};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, Response};
use tauri::State;

/// 原图单边上限（像素）
const MAX_SIDE: u32 = 8192;
/// 原图预览的最长边（像素）
const PREVIEW_SIDE: usize = 512;
const MAX_THREADS: u32 = 64;
/// 精修轮数上限
const MAX_REFINE: u32 = 8;

#[derive(Default)]
pub struct FitState {
    /// 最近载入的图片（路径 + 解码结果），开始拟合时不用再解码一次
    image: Mutex<Option<(String, Arc<RgbaImage>)>>,
    /// 正在跑的任务：任务号 → 停止标记
    jobs: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    next_job: AtomicU64,
}

pub(crate) fn decode_image(path: &str) -> Result<RgbaImage, String> {
    let reader = image::ImageReader::open(path)
        .map_err(|e| format!("无法打开图片：{e}"))?
        .with_guessed_format()
        .map_err(|e| format!("无法读取图片：{e}"))?;
    let (width, height) = reader.into_dimensions().map_err(|_| "无法识别图片格式（支持 PNG、JPEG、WebP）".to_string())?;
    if width == 0 || height == 0 {
        return Err("图片尺寸为 0".into());
    }
    if width > MAX_SIDE || height > MAX_SIDE {
        return Err(format!("图片太大（{width}×{height}），单边不能超过 {MAX_SIDE} 像素"));
    }
    let img = image::ImageReader::open(path)
        .and_then(|r| r.with_guessed_format())
        .map_err(|e| format!("无法打开图片：{e}"))?
        .decode()
        .map_err(|e| format!("图片解码失败：{e}"))?;
    Ok(img.to_rgba8())
}

fn load(state: &FitState, path: &str) -> Result<Arc<RgbaImage>, String> {
    if let Some((cached, img)) = state.image.lock().unwrap().as_ref() {
        if cached == path {
            return Ok(img.clone());
        }
    }
    let img = Arc::new(decode_image(path)?);
    *state.image.lock().unwrap() = Some((path.to_string(), img.clone()));
    Ok(img)
}

/// 载入图片，返回二进制：16 字节头（原图宽、原图高、预览宽、预览高，u32 小端）+ 预览 RGBA（行自上而下）。
/// 默认按 matte（0xRRGGBB）合成；preserve_alpha 为真时返回保留透明度的非预乘 RGBA。
#[tauri::command]
pub async fn primfit_load(state: State<'_, Arc<FitState>>, path: String, matte: u32, preserve_alpha: Option<bool>) -> Result<Response, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let img = load(&state, &path)?;
        let (sw, sh) = (img.width() as usize, img.height() as usize);
        let (pw, ph, data, alpha) = if preserve_alpha.unwrap_or(false) {
            let preview = prepare_target_alpha(img.as_raw(), sw, sh, PREVIEW_SIDE);
            (preview.width, preview.height, preview.data, Some(preview.alpha))
        } else {
            let preview = prepare_target(img.as_raw(), sw, sh, PREVIEW_SIDE, matte & 0xFF_FFFF);
            (preview.width, preview.height, preview.data, None)
        };
        let mut out = Vec::with_capacity(16 + pw * ph * 4);
        for v in [sw, sh, pw, ph] {
            out.extend_from_slice(&(v as u32).to_le_bytes());
        }
        // 预览数据行自下而上，翻回自上而下
        for y in (0..ph).rev() {
            for (x, px) in data[y * pw * 3..(y + 1) * pw * 3].chunks_exact(3).enumerate() {
                let a = alpha.as_ref().map_or(255, |values| values[y * pw + x]);
                // RGB 已预乘；预览采用普通 RGBA，零 Alpha 必须同时清零 RGB。
                let straight = |v: u8| -> u8 {
                    if a == 0 { 0 } else { ((v as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8 }
                };
                out.extend_from_slice(&[straight(px[0]), straight(px[1]), straight(px[2]), a]);
            }
        }
        Ok(Response::new(out))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FitRequest {
    /// 图元数上限 1–5000
    count: u32,
    /// 工作分辨率（最长边）32–512
    size: u32,
    /// 图元类型：1 矩形 / 2 椭圆 / 3 三角形 / 4 径向 / 5 单向 / 6 对称光带
    kinds: Vec<u8>,
    /// 不透明度：0 自动，否则固定 1–255
    alpha: u32,
    /// 搜索强度：fast / normal / fine
    quality: String,
    seed: u32,
    /// 搜索线程数；0 取默认（CPU 核数 − 1）
    threads: u32,
    /// 透明像素的合成底色 0xRRGGBB
    matte: u32,
    /// 保留透明度；省略时继续使用原来的底色合成路径。
    #[serde(default)]
    preserve_alpha: bool,
    /// 贪心拟合结束后的精修轮数；0 不精修
    refine: u32,
    /// 硬边图元按面积覆盖率评分（与预览、游戏的抗锯齿绘制一致）；省略时开启
    #[serde(default = "default_antialias")]
    antialias: bool,
    /// 重点区域蒙版（与原图预览同尺寸）；省略时不加权
    #[serde(default)]
    mask: Option<FitMask>,
    /// 蒙版满强度处的额外误差权重：ω = 1 + maskGain × m / 255；省略时取 DEFAULT_MASK_GAIN
    #[serde(default)]
    mask_gain: Option<f32>,
}

fn default_antialias() -> bool {
    true
}

/// 重点区域蒙版：行自上而下，每像素 0–255
#[derive(Deserialize)]
pub struct FitMask {
    width: usize,
    height: usize,
    data: Vec<u8>,
}

/// 蒙版边长上限：与原图预览的最长边相同
const MAX_MASK_SIDE: usize = PREVIEW_SIDE;
/// 蒙版满强度处误差权重为 1 + 8 = 9 倍
const DEFAULT_MASK_GAIN: f32 = 8.0;
const MAX_MASK_GAIN: f32 = 64.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FitStarted {
    job_id: u64,
    width: usize,
    height: usize,
    bg: u32,
    bg_alpha: u8,
    threads: usize,
    /// 还没有图元时的相似度
    similarity: f64,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FitEvent {
    Shape {
        index: usize,
        /// k, x, y, w, h, r, a, c（c = 0xRRGGBB）
        shape: [u32; 8],
        similarity: f64,
        elapsed_ms: u64,
    },
    /// 精修进度：第 pass 轮（从 1 起，共 passes 轮）已处理 index 个图元
    Refining { pass: u32, passes: u32, index: usize, total: usize, elapsed_ms: u64 },
    /// 一轮精修做完（或中途停止）：全部图元和背景色的新值，以及前 k 个图元各自的相似度
    Refined { bg: u32, bg_alpha: u8, shapes: Vec<[u32; 8]>, similarities: Vec<f64>, elapsed_ms: u64 },
    /// 结束：stopped 为真表示被用户停止；否则是数量已满，或再也找不到能降低误差的图元
    Done { stopped: bool, count: usize, similarity: f64, elapsed_ms: u64 },
}

/// 开始拟合。立即返回任务号与画面尺寸；之后每加一个图元经 channel 推送一次，最后推送 done。
#[tauri::command]
pub async fn primfit_start(
    state: State<'_, Arc<FitState>>,
    path: String,
    options: FitRequest,
    channel: Channel<FitEvent>,
) -> Result<FitStarted, String> {
    if !(1..=5000).contains(&options.count) {
        return Err("图元数量必须在 1–5000 之间".into());
    }
    if !(32..=512).contains(&options.size) {
        return Err("工作分辨率必须在 32–512 之间".into());
    }
    let mut kinds = Vec::new();
    for k in &options.kinds {
        if !(1..=6).contains(k) {
            return Err(format!("未知的图元类型：{k}"));
        }
        if !kinds.contains(k) {
            kinds.push(*k);
        }
    }
    if kinds.is_empty() {
        return Err("至少选择一种图元".into());
    }
    if options.alpha > 255 {
        return Err("不透明度必须在 0–255 之间（0 为自动）".into());
    }
    let budget = match options.quality.as_str() {
        "fast" => BUDGET_FAST,
        "normal" => BUDGET_NORMAL,
        "fine" => BUDGET_FINE,
        other => return Err(format!("未知的搜索强度：{other}")),
    };
    if options.threads > MAX_THREADS {
        return Err(format!("线程数不能超过 {MAX_THREADS}"));
    }
    if options.refine > MAX_REFINE {
        return Err(format!("精修轮数不能超过 {MAX_REFINE}"));
    }
    let threads = if options.threads == 0 { primfit::default_threads() } else { options.threads as usize };
    if let Some(mask) = &options.mask {
        if !(1..=MAX_MASK_SIDE).contains(&mask.width) || !(1..=MAX_MASK_SIDE).contains(&mask.height) {
            return Err(format!("重点区域蒙版的边长必须在 1–{MAX_MASK_SIDE} 之间（收到 {}×{}）", mask.width, mask.height));
        }
        if mask.data.len() != mask.width * mask.height {
            return Err(format!("重点区域蒙版的数据长度（{}）与尺寸 {}×{} 不符", mask.data.len(), mask.width, mask.height));
        }
    }
    let mask_gain = options.mask_gain.unwrap_or(DEFAULT_MASK_GAIN);
    if !(0.0..=MAX_MASK_GAIN).contains(&mask_gain) {
        return Err(format!("重点区域权重必须在 0–{MAX_MASK_GAIN} 之间"));
    }

    let state = state.inner().clone();
    let prepare_state = state.clone();
    let (size, matte, alpha) = (options.size as usize, options.matte & 0xFF_FFFF, options.alpha as i32);
    let preserve_alpha = options.preserve_alpha;
    let antialias = options.antialias;
    let mask = options.mask;
    let mut fitter = tauri::async_runtime::spawn_blocking(move || -> Result<Fitter, String> {
        let img = load(&prepare_state, &path)?;
        // 候选图元的中心全部按当前误差加权抽取；硬边图元按面积覆盖率评分（预览与游戏都抗锯齿绘制，
        // 只按像素中心采样会留下穿过黑底的细线，2026-11-19）
        let mut fit_options = FitOptions { kinds, alpha, guided: 1.0, antialias, ..FitOptions::default() };
        // 蒙版按面积平均缩放到工作分辨率；全为 0 时不加权
        let weights = |width: usize, height: usize| mask.as_ref().and_then(|m| prepare_weights(&m.data, m.width, m.height, width, height, mask_gain));
        if preserve_alpha {
            let target = prepare_target_alpha(img.as_raw(), img.width() as usize, img.height() as usize, size);
            fit_options.weights = weights(target.width, target.height);
            Ok(Fitter::new_alpha(target.data, target.width, target.height, target.alpha, &fit_options))
        } else {
            let target = prepare_target(img.as_raw(), img.width() as usize, img.height() as usize, size, matte);
            fit_options.weights = weights(target.width, target.height);
            Ok(Fitter::new(target.data, target.width, target.height, &fit_options))
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    let job_id = state.next_job.fetch_add(1, Ordering::Relaxed) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    state.jobs.lock().unwrap().insert(job_id, stop.clone());
    let started = FitStarted {
        job_id,
        width: fitter.width(),
        height: fitter.height(),
        bg: fitter.bg(),
        bg_alpha: fitter.bg_alpha(),
        threads,
        similarity: 1.0 - fitter.rmse(),
    };

    let (count, seed, passes) = (options.count as usize, options.seed, options.refine);
    tauri::async_runtime::spawn_blocking(move || {
        let start = Instant::now();
        let pack = |s: &Shape| [s.k as u32, s.x as u32, s.y as u32, s.w as u32, s.h as u32, s.r as u32, s.a as u32, s.c];
        let mut shapes = run_fit(
            &mut fitter,
            count,
            budget,
            seed,
            threads,
            |s, index, f| {
                let event = FitEvent::Shape {
                    index,
                    shape: pack(s),
                    similarity: 1.0 - f.rmse(),
                    elapsed_ms: start.elapsed().as_millis() as u64,
                };
                // 界面已经不在了（窗口关闭、页面刷新）：停止
                if channel.send(event).is_err() {
                    stop.store(true, Ordering::Relaxed);
                }
            },
            || stop.load(Ordering::Relaxed),
        );
        // 精修：被停止的拟合不再精修
        for pass in 1..=passes {
            if stop.load(Ordering::Relaxed) || shapes.is_empty() {
                break;
            }
            let total = shapes.len();
            let step = (total / 50).max(1);
            run_refine(
                &mut fitter,
                &mut shapes,
                1,
                budget,
                seed.wrapping_add(pass),
                threads,
                |_, index| {
                    if index % step == 0 || index == total {
                        let event = FitEvent::Refining { pass, passes, index, total, elapsed_ms: start.elapsed().as_millis() as u64 };
                        if channel.send(event).is_err() {
                            stop.store(true, Ordering::Relaxed);
                        }
                    }
                },
                || stop.load(Ordering::Relaxed),
            );
            let _ = channel.send(FitEvent::Refined {
                bg: fitter.bg(),
                bg_alpha: fitter.bg_alpha(),
                shapes: shapes.iter().map(pack).collect(),
                similarities: fitter.prefix_rmse(&shapes).into_iter().map(|e| 1.0 - e).collect(),
                elapsed_ms: start.elapsed().as_millis() as u64,
            });
        }
        let _ = channel.send(FitEvent::Done {
            stopped: stop.load(Ordering::Relaxed),
            count: shapes.len(),
            similarity: 1.0 - fitter.rmse(),
            elapsed_ms: start.elapsed().as_millis() as u64,
        });
        state.jobs.lock().unwrap().remove(&job_id);
    });
    Ok(started)
}

/// 停止拟合：候选和爬山循环检查停止标记，已有图元保留。
#[tauri::command]
pub fn primfit_stop(state: State<'_, Arc<FitState>>, job_id: u64) {
    if let Some(stop) = state.jobs.lock().unwrap().get(&job_id) {
        stop.store(true, Ordering::Relaxed);
    }
}
