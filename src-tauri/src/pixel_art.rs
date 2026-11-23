use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder, RgbaImage};
use primfit::resize_rgba;
use tauri::{ipc::Response, State};

use crate::fit::decode_image;

const MAX_SIDE: u32 = 512;
const PREVIEW_SIDE: u32 = 512;
const COLOR_TOLERANCE: u8 = 3;

#[derive(Default)]
pub struct PixelArtState {
    selection: Mutex<Selection>,
}

#[derive(Default)]
struct Selection {
    revision: u32,
    source: Option<(u32, Arc<RgbaImage>)>,
}

fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(rgba, width, height, ExtendedColorType::Rgba8)
        .map_err(|e| format!("无法生成 PNG：{e}"))?;
    Ok(png)
}

/// 响应为原图宽、高（u32 小端）及预览 PNG。
#[tauri::command]
pub async fn pixelart_load(
    state: State<'_, Arc<PixelArtState>>,
    path: String,
    revision: u32,
) -> Result<Response, String> {
    let state = state.inner().clone();
    {
        let mut selection = state.selection.lock().unwrap();
        if revision <= selection.revision {
            return Err("选图请求已失效".into());
        }
        selection.revision = revision;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let source = Arc::new(decode_image(&path)?);
        let (width, height) = source.dimensions();
        let scale = (f64::from(PREVIEW_SIDE) / f64::from(width.max(height))).min(1.0);
        let pw = (f64::from(width) * scale).round().max(1.0) as u32;
        let ph = (f64::from(height) * scale).round().max(1.0) as u32;
        let png = if (pw, ph) == (width, height) {
            encode_png(source.as_raw(), width, height)?
        } else {
            let pixels = resize_rgba(
                source.as_raw(),
                width as usize,
                height as usize,
                pw as usize,
                ph as usize,
            );
            encode_png(&pixels, pw, ph)?
        };
        let mut selection = state.selection.lock().unwrap();
        if selection.revision != revision {
            return Err("选图请求已失效".into());
        }
        selection.source = Some((revision, source));
        drop(selection);
        let mut result = Vec::with_capacity(8 + png.len());
        result.extend(width.to_le_bytes());
        result.extend(height.to_le_bytes());
        result.extend(png);
        Ok(Response::new(result))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn pixelart_clear(state: State<'_, Arc<PixelArtState>>, revision: u32) {
    let mut selection = state.selection.lock().unwrap();
    if revision >= selection.revision {
        selection.revision = revision;
        selection.source = None;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: usize,
    y: usize,
    w: usize,
    h: usize,
    argb: u32,
}

fn pack_rgba(rgba: &[u8]) -> u32 {
    u32::from_be_bytes([rgba[3], rgba[0], rgba[1], rgba[2]])
}

fn unpack_argb(argb: u32) -> [u8; 4] {
    let [a, r, g, b] = argb.to_be_bytes();
    [r, g, b, a]
}

/// 只搜索相邻 RGB 分桶，并与已经确定的代表色直接比较。Alpha 是分桶键的一部分。
fn merge_colors(pixels: &mut [u32]) {
    let mut counts = HashMap::<u32, usize>::new();
    for &color in pixels.iter().filter(|&&color| color != 0) {
        *counts.entry(color).or_default() += 1;
    }
    let mut colors: Vec<_> = counts.into_iter().collect();
    colors.sort_unstable_by_key(|&(color, count)| (std::cmp::Reverse(count), color));
    let mut buckets = HashMap::<[u8; 4], Vec<(u32, usize)>>::new();
    let mut replacements = HashMap::new();
    for (color, count) in colors {
        let [a, r, g, b] = color.to_be_bytes();
        let step = COLOR_TOLERANCE + 1;
        let [br, bg, bb] = [r / step, g / step, b / step];
        let nearby = |v: u8| v.saturating_sub(1)..=(v + 1).min(u8::MAX / step);
        let mut best = None;
        for x in nearby(br) {
            for y in nearby(bg) {
                for z in nearby(bb) {
                    let Some(candidates) = buckets.get(&[a, x, y, z]) else {
                        continue;
                    };
                    for &(candidate, uses) in candidates {
                        let [_, cr, cg, cb] = candidate.to_be_bytes();
                        let differences = [r.abs_diff(cr), g.abs_diff(cg), b.abs_diff(cb)];
                        let max = *differences.iter().max().unwrap();
                        if max <= COLOR_TOLERANCE {
                            let squared: u32 =
                                differences.into_iter().map(|v| u32::from(v).pow(2)).sum();
                            let score = (max, squared, std::cmp::Reverse(uses), candidate);
                            if best.is_none_or(|old| score < old) {
                                best = Some(score);
                            }
                        }
                    }
                }
            }
        }
        if let Some((_, _, _, representative)) = best {
            replacements.insert(color, representative);
        } else {
            buckets
                .entry([a, br, bg, bb])
                .or_default()
                .push((color, count));
        }
    }
    for pixel in pixels {
        if let Some(&replacement) = replacements.get(pixel) {
            *pixel = replacement;
        }
    }
}

fn scan_rects(pixels: &[u32], width: usize, height: usize, transpose: bool) -> Vec<Rect> {
    let (columns, rows) = if transpose {
        (height, width)
    } else {
        (width, height)
    };
    let at = |x, y| {
        pixels[if transpose {
            x * width + y
        } else {
            y * width + x
        }]
    };
    let mut rects: Vec<Rect> = Vec::new();
    let mut previous = HashMap::new();
    let mut current = HashMap::new();
    for y in 0..rows {
        let mut x = 0;
        while x < columns {
            let color = at(x, y);
            let mut end = x + 1;
            while end < columns && at(end, y) == color {
                end += 1;
            }
            if color != 0 {
                let run = (x, end - x, color);
                let index = if let Some(&index) = previous.get(&run) {
                    let rect: &mut Rect = &mut rects[index];
                    if transpose {
                        rect.w += 1
                    } else {
                        rect.h += 1
                    }
                    index
                } else {
                    let rect = if transpose {
                        Rect {
                            x: y,
                            y: x,
                            w: 1,
                            h: end - x,
                            argb: color,
                        }
                    } else {
                        Rect {
                            x,
                            y,
                            w: end - x,
                            h: 1,
                            argb: color,
                        }
                    };
                    rects.push(rect);
                    rects.len() - 1
                };
                current.insert(run, index);
            }
            x = end;
        }
        std::mem::swap(&mut previous, &mut current);
        current.clear();
    }
    rects
}

fn build_art(rgba: &[u8], width: usize, height: usize, merge: bool) -> (Vec<u8>, Vec<Rect>) {
    let mut pixels: Vec<_> = rgba
        .chunks_exact(4)
        .map(|pixel| if pixel[3] == 0 { 0 } else { pack_rgba(pixel) })
        .collect();
    if merge {
        merge_colors(&mut pixels);
    }
    let horizontal = scan_rects(&pixels, width, height, false);
    let mut vertical = scan_rects(&pixels, width, height, true);
    let rects = if vertical.len() < horizontal.len() {
        vertical.sort_unstable_by_key(|rect| (rect.y, rect.x));
        vertical
    } else {
        horizontal
    };
    let output = pixels.into_iter().flat_map(unpack_argb).collect();
    (output, rects)
}

/// 响应为矩形数、逐条 (x, y, w, h, ARGB)（u32 小端），最后是成品 PNG。
#[tauri::command]
pub async fn pixelart_generate(
    state: State<'_, Arc<PixelArtState>>,
    source_id: u32,
    width: u32,
    height: u32,
    merge: bool,
) -> Result<Response, String> {
    if !(1..=MAX_SIDE).contains(&width) || !(1..=MAX_SIDE).contains(&height) {
        return Err(format!("宽和高都必须在 1～{MAX_SIDE} 像素之间"));
    }
    let source = state
        .selection
        .lock()
        .unwrap()
        .source
        .as_ref()
        .filter(|(id, _)| *id == source_id)
        .map(|(_, source)| source.clone())
        .ok_or("原图已失效，请重新选图")?;
    tauri::async_runtime::spawn_blocking(move || {
        let resized = resize_rgba(
            source.as_raw(),
            source.width() as usize,
            source.height() as usize,
            width as usize,
            height as usize,
        );
        let (rgba, rects) = build_art(&resized, width as usize, height as usize, merge);
        let png = encode_png(&rgba, width, height)?;
        let mut result = Vec::with_capacity(4 + rects.len() * 20 + png.len());
        result.extend((rects.len() as u32).to_le_bytes());
        for rect in rects {
            for value in [
                rect.x as u32,
                rect.y as u32,
                rect.w as u32,
                rect.h as u32,
                rect.argb,
            ] {
                result.extend(value.to_le_bytes());
            }
        }
        result.extend(png);
        Ok(Response::new(result))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [u8; 4] = [240, 5, 10, 255];
    const SEMI: [u8; 4] = [30, 60, 90, 32];
    const CLEAR: [u8; 4] = [0; 4];

    fn raster(rects: &[Rect], width: usize, height: usize) -> Vec<u8> {
        let mut output = vec![0; width * height * 4];
        for rect in rects {
            for y in rect.y..rect.y + rect.h {
                for x in rect.x..rect.x + rect.w {
                    let offset = (y * width + x) * 4;
                    assert_eq!(output[offset + 3], 0, "rectangles overlap at ({x}, {y})");
                    output[offset..offset + 4].copy_from_slice(&unpack_argb(rect.argb));
                }
            }
        }
        output
    }

    fn report_error(label: &str, source: &[u8], output: &[u8]) -> u8 {
        assert_eq!(source.len(), output.len());
        let mut different = 0;
        let mut max = 0;
        let mut absolute = 0u64;
        let mut squared = 0u64;
        for (a, b) in source.chunks_exact(4).zip(output.chunks_exact(4)) {
            different += usize::from(a != b);
            for (&a, &b) in a.iter().zip(b) {
                let error = a.abs_diff(b);
                max = max.max(error);
                absolute += u64::from(error);
                squared += u64::from(error).pow(2);
            }
        }
        let channels = source.len() as f64;
        println!(
            "{label}: pixels={different}, max={max}, MAE={:.3}, RMSE={:.3}",
            absolute as f64 / channels,
            (squared as f64 / channels).sqrt()
        );
        max
    }

    #[test]
    fn resamples_both_axes_and_preserves_straight_alpha() {
        let original = [RED, [0, 255, 0, 0], SEMI, SEMI].concat();
        let sampled = resize_rgba(&original, 2, 2, 1, 4);
        let red_edge = [240, 5, 10, 128];
        assert_eq!(sampled, [red_edge, red_edge, SEMI, SEMI].concat());
        let restored = [red_edge, red_edge, SEMI, SEMI].concat();
        assert_eq!(
            report_error(
                "source -> resampled (restored at 2x2)",
                &original,
                &restored
            ),
            250
        );
        let (output, rects) = build_art(&sampled, 1, 4, false);
        assert_eq!(
            report_error("resampled -> original colors", &sampled, &output),
            0
        );
        assert_eq!(
            report_error("output -> rectangles", &output, &raster(&rects, 1, 4)),
            0
        );
        assert_eq!(rects.len(), 2);
        let png = encode_png(&output, 1, 4).unwrap();
        let image = image::load_from_memory(&png).unwrap().into_rgba8();
        assert_eq!(image.dimensions(), (1, 4));
        assert_eq!(image.into_raw(), output);
    }

    #[test]
    fn merges_solid_areas_and_chooses_the_smaller_exact_scan() {
        let block = [RED; 12].concat();
        let (output, rects) = build_art(&block, 4, 3, false);
        assert_eq!(
            rects,
            [Rect {
                x: 0,
                y: 0,
                w: 4,
                h: 3,
                argb: pack_rgba(&RED)
            }]
        );
        assert_eq!(raster(&rects, 4, 3), output);

        let shape = [RED, CLEAR, RED, RED, RED, CLEAR].concat();
        let (output, rects) = build_art(&shape, 2, 3, false);
        assert_eq!(rects.len(), 2);
        assert_eq!(rects[0].h, 3);
        assert_eq!(raster(&rects, 2, 3), output);

        let hole = [SEMI, SEMI, SEMI, SEMI, CLEAR, SEMI, SEMI, SEMI, SEMI].concat();
        let (output, rects) = build_art(&hole, 3, 3, false);
        assert_eq!(output, hole);
        assert_eq!(raster(&rects, 3, 3), output);

        let (output, rects) = build_art(&[10, 20, 30, 0], 1, 1, true);
        assert_eq!(output, CLEAR);
        assert!(rects.is_empty());
    }

    #[test]
    fn merge_is_bounded_and_does_not_chain_or_change_alpha() {
        let most = [20, 120, 220, 128];
        let near = [17, 117, 217, 128];
        let far = [14, 114, 214, 128];
        let other_alpha = [17, 117, 217, 129];
        let sampled = [most, most, most, near, near, far, other_alpha].concat();
        let (merged, rects) = build_art(&sampled, 7, 1, true);
        assert_eq!(
            merged,
            [most, most, most, most, most, far, other_alpha].concat()
        );
        assert_eq!(report_error("resampled -> merged", &sampled, &merged), 3);
        assert_eq!(
            report_error("merged -> rectangles", &merged, &raster(&rects, 7, 1)),
            0
        );
        assert_eq!(rects.len(), 3);
    }
}
