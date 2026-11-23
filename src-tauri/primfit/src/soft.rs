//! 软边候选的快速评估。
//!
//! 软边图元的覆盖率 m 逐像素不同，误差变化量要用到按 m² 和按 m 加权的逐像素求和，不能像硬边那样用
//! 按行前缀和；直接逐像素求和的开销与图元面积成正比。
//!
//! 这里把逐像素的量预先算好，并逐级 2×2 求和成一组缩小的画面。m 在图元内部变化平缓，所以大图元可以在
//! 缩小的画面上、按每格中心的 m 近似求和：格内各量的和是精确的，只有 m 取了格中心的值。选哪一级由图元的
//! 短边决定，保证短边上至少有 MIN_SAMPLES_* 格，于是一个候选的开销大致不随面积增长。
//! 近似值只用来在搜索里比较候选；选定的图元要在第 0 级（逐像素，精确）复算。
//!
//! 贪心搜索与精修共用同一种格子。记上面图元的透过率为 g（贪心时为 1）、下面的画面为 B、
//! r = 去掉该图元后的最终画面 − 目标：
//! - 按 m² 加权的 8 个：g²、g²B（3 通道）、g²B²（3 通道）、g²(255 − A)²；
//! - 按 m 加权的 7 个：r·g（3 通道）、r·g·B（3 通道）、rA·g·(255 − A)。
//! 不保留透明度时两个 Alpha 项为 0。

use crate::raster::{gradient_kernel, rasterize_scaled, trig, Shape, KIND_LINEAR, KIND_RADIAL};

pub(crate) const CELL: usize = 15;
pub(crate) const QUAD: usize = 8;
pub(crate) const LIN: usize = CELL - QUAD;
/// 图元短边上至少要有这么多格。单向渐变与光带的外框是硬边（格中心只有「在内 / 在外」两种），
/// 近似偏差比径向大，所以多取一倍。
const MIN_SAMPLES_RADIAL: i32 = 8;
const MIN_SAMPLES_RECT: i32 = 16;

struct Level {
    w: usize,
    h: usize,
    data: Vec<f64>,
}

pub(crate) struct SoftPyramid {
    /// levels[0] 是原尺寸，之后每级宽高减半（向上取整）
    levels: Vec<Level>,
}

impl SoftPyramid {
    pub(crate) fn new(width: usize, height: usize) -> Self {
        let mut levels = vec![Level { w: width, h: height, data: vec![0.0; width * height * CELL] }];
        let (mut w, mut h) = (width, height);
        while w.min(h) >= 16 {
            w = (w + 1) / 2;
            h = (h + 1) / 2;
            levels.push(Level { w, h, data: vec![0.0; w * h * CELL] });
        }
        SoftPyramid { levels }
    }

    /// 把行范围向外扩到最粗一级的格子边界：刷新这个范围后，范围内每一级的格子都只含刷新过的行。
    pub(crate) fn aligned(&self, y0: usize, y1: usize) -> (usize, usize) {
        let block = 1usize << (self.levels.len() - 1);
        (y0 / block * block, ((y1 / block + 1) * block - 1).min(self.levels[0].h - 1))
    }

    /// 第 y0–y1 行（闭区间）的逐像素量变了：fill(像素下标, 格子) 写出第 0 级的 15 个数，再逐级求和。
    pub(crate) fn refresh(&mut self, y0: usize, y1: usize, fill: impl Fn(usize, &mut [f64])) {
        let w = self.levels[0].w;
        for (i, cell) in self.levels[0].data[y0 * w * CELL..(y1 + 1) * w * CELL].chunks_exact_mut(CELL).enumerate() {
            fill(y0 * w + i, cell);
        }
        for l in 1..self.levels.len() {
            let (lower, upper) = self.levels.split_at_mut(l);
            let (src, dst) = (&lower[l - 1], &mut upper[0]);
            for y in (y0 >> l)..=(y1 >> l) {
                for x in 0..dst.w {
                    let mut sum = [0.0f64; CELL];
                    for sy in (y * 2)..(y * 2 + 2).min(src.h) {
                        for sx in (x * 2)..(x * 2 + 2).min(src.w) {
                            let o = (sy * src.w + sx) * CELL;
                            for (acc, v) in sum.iter_mut().zip(&src.data[o..o + CELL]) {
                                *acc += v;
                            }
                        }
                    }
                    let o = (y * dst.w + x) * CELL;
                    dst.data[o..o + CELL].copy_from_slice(&sum);
                }
            }
        }
    }

    /// 图元 s 该用哪一级
    fn level_for(&self, s: &Shape) -> usize {
        let side = s.w.min(s.h);
        let min = if s.k == KIND_RADIAL { MIN_SAMPLES_RADIAL } else { MIN_SAMPLES_RECT };
        let mut level = 0;
        while level + 1 < self.levels.len() && (side >> (level + 1)) >= min {
            level += 1;
        }
        level
    }

    /// 图元覆盖范围内的加权和：（按 m² 加权的 8 个，按 m 加权的 7 个）。
    /// exact 为真时在第 0 级逐像素求和，与逐像素公式一致；否则按图元大小选一级近似。
    /// lines 至少要有 画面高 × 3 个元素。
    pub(crate) fn sums(&self, s: &Shape, lines: &mut [i32], exact: bool) -> ([f64; QUAD], [f64; LIN]) {
        let l = if exact { 0 } else { self.level_for(s) };
        let level = &self.levels[l];
        let step = (1usize << l) as f64;
        let rows = rasterize_scaled(s, 1.0 / step, level.w, level.h, lines);
        let (cos, sin) = trig(s.r);
        let (inv_w, inv_h) = (1.0 / s.w as f64, 1.0 / s.h as f64);
        let (step_x, step_y) = (cos * step, -sin * step);
        let kind = s.k;
        let mut quad = [0.0f64; QUAD];
        let mut lin = [0.0f64; LIN];
        for line in lines[..rows * 3].chunks_exact(3) {
            let (y, x1, x2) = (line[0] as usize, line[1] as usize, line[2] as usize);
            // 格中心在原尺寸画面里的位置，转到图元的局部坐标
            let dx = (x1 as f64 + 0.5) * step - s.x as f64;
            let dy = (y as f64 + 0.5) * step - s.y as f64;
            let mut lx = dx * cos + dy * sin;
            let mut ly = -dx * sin + dy * cos;
            let o = (y * level.w + x1) * CELL;
            for cell in level.data[o..o + (x2 - x1 + 1) * CELL].chunks_exact(CELL) {
                let m = if kind == KIND_RADIAL {
                    let (u, v) = (2.0 * lx * inv_w, 2.0 * ly * inv_h);
                    gradient_kernel((u * u + v * v).sqrt())
                } else if kind == KIND_LINEAR {
                    gradient_kernel((lx * inv_w + 0.5 - 0.120) / 0.860)
                } else {
                    gradient_kernel(((2.0 * lx * inv_w).abs() - 0.145) / 0.830)
                };
                lx += step_x;
                ly += step_y;
                let m2 = m * m;
                for (acc, v) in quad.iter_mut().zip(&cell[..QUAD]) {
                    *acc += m2 * v;
                }
                for (acc, v) in lin.iter_mut().zip(&cell[QUAD..]) {
                    *acc += m * v;
                }
            }
        }
        (quad, lin)
    }
}

#[cfg(test)]
mod tests {
    use crate::fitter::{FitOptions, Fitter};
    use crate::raster::Shape;
    use crate::rng::Rng;

    const W: usize = 96;
    const H: usize = 72;

    /// 平缓的底色加噪声
    fn target(rng: &mut Rng) -> Vec<u8> {
        let mut data = vec![0u8; W * H * 3];
        for y in 0..H {
            for x in 0..W {
                for c in 0..3 {
                    let smooth = 40.0 + 150.0 * (x as f64 / W as f64) * (c as f64 + 1.0) / 3.0 + 40.0 * (y as f64 / H as f64);
                    data[(y * W + x) * 3 + c] = (smooth + rng.next() * 30.0) as u8;
                }
            }
        }
        data
    }

    fn fitter(transparent: bool) -> Fitter {
        let mut rng = Rng::new(7);
        let options = FitOptions { kinds: vec![1, 2, 3, 4, 5, 6], ..FitOptions::default() };
        let data = target(&mut rng);
        let mut fit = if transparent {
            let alpha = (0..W * H).map(|p| if (p % W) < W / 3 { 0 } else { 200 + (p % 50) as u8 }).collect();
            Fitter::new_alpha(data, W, H, alpha, &options)
        } else {
            Fitter::new(data, W, H, &options)
        };
        // 先叠几个图元，让画面不是一片纯色
        let mut scratch = fit.scratch();
        for (i, k) in [2u8, 4, 1, 5, 6, 3, 4].into_iter().enumerate() {
            let mut s = Shape { k, x: 10 + 12 * i as i32, y: 8 + 9 * i as i32, w: 50 - 4 * i as i32, h: 20 + 5 * i as i32, r: 25 * i as i32, a: 90 + 20 * i as i32, c: 0, delta: 0.0 };
            fit.evaluate(&mut s, &mut scratch);
            fit.add(&s);
        }
        fit
    }

    fn soft_shape(rng: &mut Rng, min: i32, max: i32) -> Shape {
        let size = |rng: &mut Rng| min + rng.int((max - min + 1) as usize) as i32;
        Shape {
            k: 4 + rng.int(3) as u8,
            x: rng.int(W + 1) as i32,
            y: rng.int(H + 1) as i32,
            w: size(rng),
            h: size(rng),
            r: rng.int(360) as i32,
            a: 20 + rng.int(236) as i32,
            c: 0,
            delta: 0.0,
        }
    }

    #[test]
    fn small_shapes_match_the_per_pixel_formula() {
        for transparent in [false, true] {
            let fit = fitter(transparent);
            let mut scratch = fit.scratch();
            let mut rng = Rng::new(11);
            let mut checked = 0;
            for _ in 0..400 {
                // 短边不到 16：一定落在第 0 级
                let mut fast = soft_shape(&mut rng, 1, 15);
                let mut exact = fast;
                let a = fit.evaluate_search(&mut fast, &mut scratch);
                let b = fit.evaluate(&mut exact, &mut scratch);
                if !b.is_finite() {
                    assert!(!a.is_finite(), "{fast:?}");
                    continue;
                }
                assert!((a - b).abs() <= 1e-9 * b.abs().max(1.0) + 1e-6, "{a} vs {b}: {fast:?}");
                assert_eq!(fast.c, exact.c, "{fast:?}");
                checked += 1;
            }
            assert!(checked > 300);
        }
    }

    #[test]
    fn large_shapes_are_close_to_the_per_pixel_formula() {
        for transparent in [false, true] {
            let fit = fitter(transparent);
            let mut scratch = fit.scratch();
            let mut rng = Rng::new(13);
            let (mut worst, mut checked) = (0.0f64, 0);
            for _ in 0..400 {
                let mut fast = soft_shape(&mut rng, 16, 90);
                let mut exact = fast;
                let a = fit.evaluate_search(&mut fast, &mut scratch);
                let b = fit.evaluate(&mut exact, &mut scratch);
                assert!(a.is_finite() && b.is_finite(), "{fast:?}");
                // 相对「不放这个图元也不换颜色」的尺度：用目标图总误差作参照
                worst = worst.max((a - b).abs() / fit.error());
                checked += 1;
            }
            assert_eq!(checked, 400);
            assert!(worst < 0.02, "近似偏差占整图误差的比例过大：{worst}");
        }
    }

    #[test]
    fn incremental_refresh_matches_a_full_rebuild() {
        for transparent in [false, true] {
            let mut fit = fitter(transparent);
            let mut scratch = fit.scratch();
            let mut rng = Rng::new(17);
            let shapes: Vec<Shape> = (0..300).map(|_| soft_shape(&mut rng, 1, 90)).collect();
            let before: Vec<f64> = shapes.iter().map(|s| fit.evaluate_search(&mut s.clone(), &mut scratch)).collect();
            // 整体重算一遍评估数据：结果应与逐次 add 时增量刷新的一致
            fit.refresh_all();
            for (s, old) in shapes.iter().zip(&before) {
                let new = fit.evaluate_search(&mut s.clone(), &mut scratch);
                assert!((new - old).abs() <= 1e-9 * old.abs().max(1.0) + 1e-6 || (!new.is_finite() && !old.is_finite()), "{new} vs {old}: {s:?}");
            }
        }
    }
}
