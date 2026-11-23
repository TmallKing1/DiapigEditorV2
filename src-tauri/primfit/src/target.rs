//! 目标图：RGBA 原图 → 工作分辨率 RGB，或预乘 RGB + Alpha。

/// 工作分辨率的 RGB 图，行自下而上（与引擎 Y 向上一致）。
pub struct Target {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

/// 保留透明度的目标图，行自下而上；data 是预乘 RGB，alpha 是逐像素透明度。
pub struct AlphaTarget {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
    pub alpha: Vec<u8>,
}

/// 与 JS 的 Math.round 一致：.5 向正无穷取整。
#[inline]
pub(crate) fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// 把 from 个源像素按面积平均分到 to 个目标像素：每个目标像素一组（源下标，权重）。
fn spans(from: usize, to: usize) -> Vec<Vec<(usize, f64)>> {
    let ratio = from as f64 / to as f64;
    (0..to)
        .map(|i| {
            let a = i as f64 * ratio;
            let b = (i + 1) as f64 * ratio;
            let end = from.min(b.ceil() as usize);
            let mut parts = Vec::new();
            for k in a.floor() as usize..end {
                let w = b.min((k + 1) as f64) - a.max(k as f64);
                if w > 0.0 {
                    parts.push((k, w / ratio));
                }
            }
            parts
        })
        .collect()
}

/// RGBA（行自上而下）→ 工作分辨率 RGB（行自下而上）。透明像素先按 matte（0xRRGGBB）合成，
/// 再按面积平均缩小；最长边不超过 size，不放大。
pub fn prepare_target(rgba: &[u8], src_width: usize, src_height: usize, size: usize, matte: u32) -> Target {
    let scale = (size as f64 / src_width.max(src_height) as f64).min(1.0);
    let width = (js_round(src_width as f64 * scale) as usize).max(1);
    let height = (js_round(src_height as f64 * scale) as usize).max(1);
    let matte_rgb = [((matte >> 16) & 255) as f64, ((matte >> 8) & 255) as f64, (matte & 255) as f64];
    let xs = spans(src_width, width);
    let ys = spans(src_height, height);

    // 相邻两个目标行最多共用一个源行，所以横向缩小后的源行只缓存两行，不为整张原图分配缓冲。
    let mut cache: [(usize, Vec<f64>); 2] = [(usize::MAX, vec![0.0; width * 3]), (usize::MAX, vec![0.0; width * 3])];
    let mut turn = 0;
    let mut data = vec![0u8; width * height * 3];
    let mut acc = vec![0.0f64; width * 3];
    for (y, parts) in ys.iter().enumerate() {
        acc.fill(0.0);
        for &(sy, wy) in parts {
            let slot = match cache.iter().position(|(row, _)| *row == sy) {
                Some(slot) => slot,
                None => {
                    turn ^= 1;
                    let (row, buf) = &mut cache[turn];
                    *row = sy;
                    for (x, xparts) in xs.iter().enumerate() {
                        let mut sum = [0.0f64; 3];
                        for &(sx, wx) in xparts {
                            let s = (sy * src_width + sx) * 4;
                            let a = rgba[s + 3] as f64 / 255.0;
                            for c in 0..3 {
                                sum[c] += (rgba[s + c] as f64 * a + matte_rgb[c] * (1.0 - a)) * wx;
                            }
                        }
                        buf[x * 3..x * 3 + 3].copy_from_slice(&sum);
                    }
                    turn
                }
            };
            let row = &cache[slot].1;
            for (sum, v) in acc.iter_mut().zip(row) {
                *sum += v * wy;
            }
        }
        let up = height - 1 - y;
        for (out, v) in data[up * width * 3..(up + 1) * width * 3].iter_mut().zip(&acc) {
            *out = js_round(*v).clamp(0.0, 255.0) as u8;
        }
    }
    Target { width, height, data }
}

/// RGBA（行自上而下）→ 预乘 RGB + Alpha（行自下而上），不合成底色。
/// 按面积平均缩小，最长边不超过 size，不放大；预乘、横向和纵向平均后只取整一次。
pub fn prepare_target_alpha(rgba: &[u8], src_width: usize, src_height: usize, size: usize) -> AlphaTarget {
    let scale = (size as f64 / src_width.max(src_height) as f64).min(1.0);
    let width = (js_round(src_width as f64 * scale) as usize).max(1);
    let height = (js_round(src_height as f64 * scale) as usize).max(1);
    let mut data = vec![0u8; width * height * 3];
    let mut alpha = vec![0u8; width * height];
    sample_alpha_rows(rgba, src_width, src_height, width, height, |y, row| {
        let up = height - 1 - y;
        for (x, px) in row.chunks_exact(4).enumerate() {
            let dst = up * width + x;
            for c in 0..3 {
                data[dst * 3 + c] = byte(px[c]);
            }
            alpha[dst] = byte(px[3]);
        }
    });
    AlphaTarget { width, height, data, alpha }
}

fn byte(value: f64) -> u8 {
    js_round(value).clamp(0.0, 255.0) as u8
}

/// 按指定宽高独立做面积采样，输出自上而下的非预乘 RGBA。
pub fn resize_rgba(rgba: &[u8], src_width: usize, src_height: usize, width: usize, height: usize) -> Vec<u8> {
    let mut data = Vec::with_capacity(width * height * 4);
    sample_alpha_rows(rgba, src_width, src_height, width, height, |_, row| {
        for px in row.chunks_exact(4) {
            let alpha = byte(px[3]);
            let rgb = if alpha == 0 {
                [0; 3]
            } else {
                [byte(px[0] * 255.0 / px[3]), byte(px[1] * 255.0 / px[3]), byte(px[2] * 255.0 / px[3])]
            };
            data.extend_from_slice(&[rgb[0], rgb[1], rgb[2], alpha]);
        }
    });
    data
}

fn sample_alpha_rows(
    rgba: &[u8], src_width: usize, src_height: usize, width: usize, height: usize,
    mut write_row: impl FnMut(usize, &[f64]),
) {
    let xs = spans(src_width, width);
    let ys = spans(src_height, height);
    let mut cache: [(usize, Vec<f64>); 2] = [(usize::MAX, vec![0.0; width * 4]), (usize::MAX, vec![0.0; width * 4])];
    let mut turn = 0;
    let mut acc = vec![0.0f64; width * 4];
    for (y, parts) in ys.iter().enumerate() {
        acc.fill(0.0);
        for &(sy, wy) in parts {
            let slot = match cache.iter().position(|(row, _)| *row == sy) {
                Some(slot) => slot,
                None => {
                    turn ^= 1;
                    let (row, buf) = &mut cache[turn];
                    *row = sy;
                    for (x, xparts) in xs.iter().enumerate() {
                        let mut sum = [0.0f64; 4];
                        for &(sx, wx) in xparts {
                            let s = (sy * src_width + sx) * 4;
                            let a = rgba[s + 3] as f64;
                            for c in 0..3 {
                                sum[c] += rgba[s + c] as f64 * (a / 255.0) * wx;
                            }
                            sum[3] += a * wx;
                        }
                        buf[x * 4..x * 4 + 4].copy_from_slice(&sum);
                    }
                    turn
                }
            };
            for (sum, v) in acc.iter_mut().zip(&cache[slot].1) {
                *sum += v * wy;
            }
        }
        write_row(y, &acc);
    }
}

/// 重点区域蒙版（0–255，行自上而下，任意尺寸）→ 工作分辨率的逐像素误差权重（行自下而上）。
/// 按面积平均缩放到 width × height，ω = 1 + gain × m / 255；蒙版全为 0（或 gain ≤ 0）时返回 None，
/// 即不加权，结果与没有蒙版时逐位相同。
pub fn prepare_weights(mask: &[u8], mask_width: usize, mask_height: usize, width: usize, height: usize, gain: f32) -> Option<Vec<f32>> {
    assert_eq!(mask.len(), mask_width * mask_height, "蒙版尺寸与数据长度不符");
    if !(gain > 0.0) || mask.iter().all(|v| *v == 0) || width == 0 || height == 0 {
        return None;
    }
    let xs = spans(mask_width, width);
    let ys = spans(mask_height, height);
    let mut out = vec![1.0f32; width * height];
    for (y, yparts) in ys.iter().enumerate() {
        let up = height - 1 - y;
        for (x, xparts) in xs.iter().enumerate() {
            let mut sum = 0.0f64;
            for &(sy, wy) in yparts {
                for &(sx, wx) in xparts {
                    sum += mask[sy * mask_width + sx] as f64 * wx * wy;
                }
            }
            out[up * width + x] = (1.0 + gain as f64 * (sum / 255.0).clamp(0.0, 1.0)) as f32;
        }
    }
    Some(out)
}

/// 平均色 0xRRGGBB。
pub fn average_color(data: &[u8]) -> u32 {
    let n = (data.len() / 3) as f64;
    let mut sum = [0.0f64; 3];
    for px in data.chunks_exact(3) {
        for c in 0..3 {
            sum[c] += px[c] as f64;
        }
    }
    let ch = |v: f64| js_round(v / n) as u32;
    (ch(sum[0]) << 16) | (ch(sum[1]) << 8) | ch(sum[2])
}
