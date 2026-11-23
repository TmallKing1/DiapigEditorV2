//! 逐像素误差权重（重点区域）：
//! - 权重全为 1 与不传权重的结果逐位相同（贪心 + 精修；硬边、软边、透明各一组）；
//! - 随机权重下，评估给出的误差变化量与逐像素暴力计算的加权误差之差一致，精修后的误差与从头计算一致、且不升；
//! - 重点区域内的不加权误差确实下降；
//! - 蒙版缩放到工作分辨率（prepare_weights）。

use primfit::{coverage_row, prepare_weights, rasterize, run_fit, run_refine, Budget, FitOptions, Fitter, Rng, Shape, BUDGET_FAST};

const W: usize = 48;
const H: usize = 36;
const QUICK: Budget = Budget { candidates: 40, restarts: 1, age: 20 };

/// 平缓的渐变加噪声，中间偏左上有一块高对比的条纹
fn target(w: usize, h: usize, seed: u32) -> Vec<u8> {
    let mut rng = Rng::new(seed);
    let mut data = vec![0u8; w * h * 3];
    for y in 0..h {
        for x in 0..w {
            let o = (y * w + x) * 3;
            let stripe = x > w / 4 && x < w / 2 && y > h / 4 && y < h / 2;
            for c in 0..3 {
                let base = 40.0 + 120.0 * x as f64 / w as f64 + 30.0 * c as f64 + 20.0 * y as f64 / h as f64;
                let v = if stripe { if (x + y + c) % 4 < 2 { 230.0 } else { 20.0 } } else { base + rng.next() * 20.0 };
                data[o + c] = v.clamp(0.0, 255.0) as u8;
            }
        }
    }
    data
}

fn alpha(w: usize, h: usize) -> Vec<u8> {
    (0..w * h).map(|p| if p % w < w / 5 { 0 } else { (120 + (p * 7) % 136) as u8 }).collect()
}

/// 预乘：RGB 不超过 Alpha
fn premultiply(data: &[u8], alpha: &[u8]) -> Vec<u8> {
    data.iter().enumerate().map(|(i, v)| ((*v as u32 * alpha[i / 3] as u32) / 255) as u8).collect()
}

fn random_weights(n: usize, seed: u32) -> Vec<f32> {
    let mut rng = Rng::new(seed);
    (0..n).map(|_| 1.0 + 8.0 * rng.next() as f32).collect()
}

/// 从背景色开始逐个叠上图元（与拟合器的合成规则相同），返回 RGB 与 Alpha（0–255）。
fn render(w: usize, h: usize, bg: u32, bg_alpha: f64, shapes: &[Shape]) -> (Vec<f64>, Vec<f64>) {
    let bg_rgb = [((bg >> 16) & 255) as f64, ((bg >> 8) & 255) as f64, (bg & 255) as f64];
    let mut rgb: Vec<f64> = (0..w * h * 3).map(|i| bg_rgb[i % 3]).collect();
    let mut a = vec![bg_alpha; w * h];
    let mut lines = vec![0; h * 3];
    for s in shapes {
        let rows = rasterize(s, w, h, &mut lines);
        let col = [((s.c >> 16) & 255) as f64, ((s.c >> 8) & 255) as f64, (s.c & 255) as f64];
        for l in lines[..rows * 3].chunks_exact(3) {
            for (p, m) in coverage_row(s, l[0] as usize, l[1] as usize, l[2] as usize, w) {
                let q = s.a as f64 / 255.0 * m;
                for c in 0..3 {
                    rgb[p * 3 + c] += (col[c] - rgb[p * 3 + c]) * q;
                }
                a[p] += (255.0 - a[p]) * q;
            }
        }
    }
    (rgb, a)
}

/// 加权平方误差；weights 为 None 时不加权。target_alpha 为 None 时不计 Alpha。
fn weighted_error(target: &[u8], target_alpha: Option<&[u8]>, rgb: &[f64], a: &[f64], weights: Option<&[f32]>, region: Option<&[bool]>) -> f64 {
    let mut e = 0.0;
    for p in 0..target.len() / 3 {
        if region.is_some_and(|r| !r[p]) {
            continue;
        }
        let wt = weights.map_or(1.0, |v| (v[p] as f64).max(1.0));
        let mut d = 0.0;
        for c in 0..3 {
            d += (rgb[p * 3 + c] - target[p * 3 + c] as f64).powi(2);
        }
        if let Some(ta) = target_alpha {
            d += (a[p] - ta[p] as f64).powi(2);
        }
        e += d * wt;
    }
    e
}

fn close(a: f64, b: f64, what: &str) {
    assert!((a - b).abs() <= 1e-7 * a.abs().max(b.abs()).max(1.0), "{what}: {a} != {b}");
}

/// 三组配置：（名称，可用类型，是否透明）
const CASES: [(&str, &[u8], bool); 3] = [("硬边", &[2, 1, 3], false), ("软边", &[1, 2, 3, 4, 5, 6], false), ("透明", &[2, 1, 4, 5], true)];

fn make(kinds: &[u8], transparent: bool, weights: Option<Vec<f32>>) -> (Fitter, Vec<u8>, Option<Vec<u8>>) {
    let options = FitOptions { kinds: kinds.to_vec(), guided: 1.0, weights, ..FitOptions::default() };
    let data = target(W, H, 2026);
    if transparent {
        let a = alpha(W, H);
        let data = premultiply(&data, &a);
        (Fitter::new_alpha(data.clone(), W, H, a.clone(), &options), data, Some(a))
    } else {
        (Fitter::new(data.clone(), W, H, &options), data, None)
    }
}

#[test]
fn unit_weights_are_bit_identical_to_no_weights() {
    for (name, kinds, transparent) in CASES {
        let (mut plain, _, _) = make(kinds, transparent, None);
        let (mut ones, _, _) = make(kinds, transparent, Some(vec![1.0; W * H]));
        assert!(ones.is_weighted() && !plain.is_weighted());
        assert_eq!(plain.error().to_bits(), ones.error().to_bits(), "{name}: 初始误差");
        let mut a = run_fit(&mut plain, 40, QUICK, 5, 2, |_, _, _| {}, || false);
        let mut b = run_fit(&mut ones, 40, QUICK, 5, 2, |_, _, _| {}, || false);
        assert!(a.len() > 10, "{name}");
        assert_eq!(a, b, "{name}: 贪心结果不同");
        assert_eq!(plain.error().to_bits(), ones.error().to_bits(), "{name}: 贪心后误差");
        run_refine(&mut plain, &mut a, 2, QUICK, 5, 2, |_, _| {}, || false);
        run_refine(&mut ones, &mut b, 2, QUICK, 5, 2, |_, _| {}, || false);
        assert_eq!(a, b, "{name}: 精修结果不同");
        assert_eq!(plain.bg(), ones.bg(), "{name}: 背景色");
        assert_eq!(plain.error().to_bits(), ones.error().to_bits(), "{name}: 精修后误差");
        // 有权重时相似度逐像素重算，与由 error 得出的只差舍入
        assert!((plain.rmse() - ones.rmse()).abs() < 1e-12, "{name}: 相似度");
    }
}

#[test]
fn evaluate_matches_brute_force_weighted_delta() {
    for (name, kinds, transparent) in CASES {
        let weights = random_weights(W * H, 99);
        let (mut fit, data, ta) = make(kinds, transparent, Some(weights.clone()));
        let bg_alpha = if transparent { 0.0 } else { 255.0 };
        let mut history = Vec::new();
        let mut rng = Rng::new(31);
        let mut scratch = fit.scratch();
        let mut checked = 0;
        for i in 0..60 {
            let mut s = fit.random_shape(&mut rng);
            // 混入几个大图元和不透明图元
            if i % 5 == 0 {
                s.w = 10 + rng.int(30) as i32;
                s.h = 8 + rng.int(25) as i32;
                s.a = 255;
            }
            let (rgb, a) = render(W, H, fit.bg(), bg_alpha, &history);
            let before = weighted_error(&data, ta.as_deref(), &rgb, &a, Some(&weights), None);
            close(fit.error(), before, &format!("{name}: 第 {i} 个图元之前的误差"));
            let delta = fit.evaluate(&mut s, &mut scratch);
            if !delta.is_finite() {
                continue;
            }
            history.push(s);
            let (rgb, a) = render(W, H, fit.bg(), bg_alpha, &history);
            let after = weighted_error(&data, ta.as_deref(), &rgb, &a, Some(&weights), None);
            close(delta, after - before, &format!("{name}: 第 {i} 个图元 {s:?}"));
            fit.add(&s);
            close(fit.error(), after, &format!("{name}: add 之后"));
            // 相似度按不加权误差
            let plain = weighted_error(&data, ta.as_deref(), &rgb, &a, None, None);
            let scale = (W * H * if transparent { 4 } else { 3 }) as f64;
            close(fit.rmse(), (plain / scale).sqrt() / 255.0, &format!("{name}: rmse"));
            checked += 1;
        }
        assert!(checked > 40, "{name}: {checked}");
        // 最优颜色：任一通道改一点，加权误差都不会更小
        let (rgb, a) = render(W, H, fit.bg(), bg_alpha, &history[..history.len() - 1]);
        let base = weighted_error(&data, ta.as_deref(), &rgb, &a, Some(&weights), None);
        let last = *history.last().unwrap();
        let (rgb, a) = render(W, H, fit.bg(), bg_alpha, &history);
        let best = weighted_error(&data, ta.as_deref(), &rgb, &a, Some(&weights), None) - base;
        for channel in 0..3 {
            for step in [-1i32, 1] {
                let shift = 16 - channel * 8;
                let v = ((last.c >> shift) & 255) as i32 + step;
                if !(0..=255).contains(&v) {
                    continue;
                }
                let mut other = last;
                other.c = (last.c & !(0xFF << shift)) | ((v as u32) << shift);
                let mut h = history.clone();
                *h.last_mut().unwrap() = other;
                let (rgb, a) = render(W, H, fit.bg(), bg_alpha, &h);
                let e = weighted_error(&data, ta.as_deref(), &rgb, &a, Some(&weights), None) - base;
                assert!(e + 1e-6 >= best, "{name}: 通道 {channel} 改 {step} 后更好：{e} < {best}");
            }
        }
    }
}

#[test]
fn weighted_refine_is_consistent_and_never_worse() {
    for (name, kinds, transparent) in CASES {
        let weights = random_weights(W * H, 7);
        let (mut fit, data, ta) = make(kinds, transparent, Some(weights.clone()));
        let bg_alpha = if transparent { 0.0 } else { 255.0 };
        let mut shapes = run_fit(&mut fit, 50, QUICK, 3, 2, |_, _, _| {}, || false);
        let mut last = fit.error();
        for pass in 0..3 {
            run_refine(&mut fit, &mut shapes, 1, QUICK, 10 + pass, 2, |_, _| {}, || false);
            let (rgb, a) = render(W, H, fit.bg(), bg_alpha, &shapes);
            let brute = weighted_error(&data, ta.as_deref(), &rgb, &a, Some(&weights), None);
            close(fit.error(), brute, &format!("{name}: 第 {pass} 轮精修后的误差"));
            assert!(fit.error() <= last * (1.0 + 1e-9) + 1e-6, "{name}: 精修让加权误差上升：{last} → {}", fit.error());
            last = fit.error();
            // 前 k 个图元的相似度不加权
            let plain = weighted_error(&data, ta.as_deref(), &rgb, &a, None, None);
            let scale = (W * H * if transparent { 4 } else { 3 }) as f64;
            close(*fit.prefix_rmse(&shapes).last().unwrap(), (plain / scale).sqrt() / 255.0, &format!("{name}: prefix_rmse"));
        }
    }
}

/// 精修重算背景色时按权重加权：左半边权重 9、右半边 1，没有图元时背景色就是加权平均色。
#[test]
fn refine_recomputes_background_with_weights() {
    let (w, h) = (20, 10);
    let mut data = vec![0u8; w * h * 3];
    let mut weights = vec![1.0f32; w * h];
    for p in 0..w * h {
        let left = p % w < w / 2;
        data[p * 3..p * 3 + 3].copy_from_slice(if left { &[200, 100, 0] } else { &[0, 100, 200] });
        if left {
            weights[p] = 9.0;
        }
    }
    let mut fit = Fitter::new(data, w, h, &FitOptions { kinds: vec![1], weights: Some(weights), ..FitOptions::default() });
    // 初始背景色是不加权的平均色
    assert_eq!(fit.bg(), 0x646464);
    let mut shapes: Vec<Shape> = Vec::new();
    fit.refine_pass(&mut shapes, 1, 1, None, 1, |_| {}, || false);
    // (9 × 200 + 0) / 10 = 180，(9 × 0 + 200) / 10 = 20
    assert_eq!(fit.bg(), (180 << 16) | (100 << 8) | 20, "{:06x}", fit.bg());
}

/// 重点区域：同样的图元数，带权重拟合后区域内的不加权误差更低。
#[test]
fn weights_improve_the_focus_region() {
    let (w, h) = (80, 60);
    let data = target(w, h, 11);
    let region: Vec<bool> = (0..w * h).map(|p| {
        let (x, y) = (p % w, p / w);
        x > w / 4 && x < w / 2 && y > h / 4 && y < h / 2
    }).collect();
    let weights: Vec<f32> = region.iter().map(|r| if *r { 9.0 } else { 1.0 }).collect();
    let mut results = Vec::new();
    for weights in [None, Some(weights)] {
        let options = FitOptions { kinds: vec![2, 1, 3], guided: 1.0, weights, ..FitOptions::default() };
        let mut fit = Fitter::new(data.clone(), w, h, &options);
        let mut shapes = run_fit(&mut fit, 60, BUDGET_FAST, 4, 2, |_, _, _| {}, || false);
        run_refine(&mut fit, &mut shapes, 1, BUDGET_FAST, 4, 2, |_, _| {}, || false);
        let (rgb, a) = render(w, h, fit.bg(), 255.0, &shapes);
        let inside = weighted_error(&data, None, &rgb, &a, None, Some(&region));
        let total = weighted_error(&data, None, &rgb, &a, None, None);
        results.push((inside, total));
    }
    let ((plain_in, plain_all), (weighted_in, weighted_all)) = (results[0], results[1]);
    println!("区域内误差 {plain_in:.0} → {weighted_in:.0}，整图误差 {plain_all:.0} → {weighted_all:.0}");
    assert!(weighted_in < plain_in * 0.9, "重点区域内误差没有明显下降：{plain_in} → {weighted_in}");
}

#[test]
fn mask_is_scaled_to_the_working_resolution() {
    // 全 0：不加权
    assert!(prepare_weights(&[0; 12], 4, 3, 4, 3, 8.0).is_none());
    // gain ≤ 0：不加权
    assert!(prepare_weights(&[255; 12], 4, 3, 4, 3, 0.0).is_none());
    // 满强度：ω = 1 + gain
    assert!(prepare_weights(&[255; 12], 4, 3, 2, 2, 8.0).unwrap().iter().all(|v| *v == 9.0));
    // 行自上而下 → 自下而上：蒙版第一行在输出的最后一行
    let mut mask = vec![0u8; 3 * 2];
    mask[..3].fill(255);
    assert_eq!(prepare_weights(&mask, 3, 2, 3, 2, 4.0).unwrap(), vec![1.0, 1.0, 1.0, 5.0, 5.0, 5.0]);
    // 面积平均缩小：4×4 的左上 2×2 为 255 → 2×2 的左上（输出最后一行的第一个）为 1 + gain
    let mut mask = vec![0u8; 16];
    for (x, y) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
        mask[y * 4 + x] = 255;
    }
    assert_eq!(prepare_weights(&mask, 4, 4, 2, 2, 8.0).unwrap(), vec![1.0, 1.0, 9.0, 1.0]);
    // 左上只有一个像素为 255 → 平均 1/4
    let mut mask = vec![0u8; 16];
    mask[0] = 255;
    assert_eq!(prepare_weights(&mask, 4, 4, 2, 2, 8.0).unwrap(), vec![1.0, 1.0, 3.0, 1.0]);
    // 放大：2×1 → 4×1
    assert_eq!(prepare_weights(&[255, 0], 2, 1, 4, 1, 2.0).unwrap(), vec![3.0, 3.0, 1.0, 1.0]);
}
