//! 重点区域基准（默认不跑）：同一张图、同样参数，对比不加权与 gain = 4 / 8 / 16 的加权拟合。
//!   cargo test -p primfit --release --test weights_bench -- --ignored --nocapture
//! 默认用程序合成的图（平缓背景 + 左侧一块布满小色点、细节密集的「脸」），蒙版是那块圆形区域。
//! 可选 PRIMFIT_IMAGE=<图片>：改用这张图，蒙版取画面中心的椭圆（半宽、半高各 35%）。
//! 可选 PRIMFIT_THREADS（默认 8）、PRIMFIT_SIZE（默认 200）、PRIMFIT_COUNT（默认 200）、PRIMFIT_REFINE（默认 2）、PRIMFIT_SEEDS（取平均的种子数，默认 3）。

use std::time::Instant;

use primfit::{coverage_row, prepare_target, prepare_weights, rasterize, run_fit, run_refine, FitOptions, Fitter, Rng, Shape, BUDGET_NORMAL};

fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// 合成图（RGBA，行自上而下）与蒙版（0–255，行自上而下）
fn synthetic() -> (Vec<u8>, Vec<u8>, usize, usize) {
    let (w, h) = (400usize, 300usize);
    let mut rng = Rng::new(424242);
    let (fx, fy, fr) = (130.0, 150.0, 72.0);
    // 脸上几十个小色点（半径 3–8 像素），像五官、文字那样需要很多小图元才能还原
    let dots: Vec<(f64, f64, f64, [f64; 3])> = (0..60)
        .map(|_| {
            let (ang, rad) = (rng.next() * std::f64::consts::TAU, rng.next().sqrt() * (fr - 8.0));
            let color = [rng.next() * 255.0, rng.next() * 255.0, rng.next() * 255.0];
            (fx + rad * ang.cos(), fy + rad * ang.sin(), 3.0 + rng.next() * 5.0, color)
        })
        .collect();
    let mut rgba = vec![0u8; w * h * 4];
    let mut mask = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let (xf, yf) = (x as f64 + 0.5, y as f64 + 0.5);
            // 背景：斜向渐变 + 几块柔和的色斑 + 少量噪声
            let t = (xf / w as f64 + yf / h as f64) / 2.0;
            let blob = (-((xf - 320.0).powi(2) + (yf - 80.0).powi(2)) / 4000.0).exp();
            let mut c = [40.0 + 120.0 * t + 80.0 * blob, 90.0 + 60.0 * t, 170.0 - 90.0 * t + 40.0 * blob];
            let d = (xf - fx).hypot(yf - fy);
            if d < fr {
                // 「脸」：肤色圆 + 眼睛 + 嘴 + 一条细条纹（像文字），细节密集
                c = [225.0, 180.0, 150.0];
                let eye = |ex: f64| (xf - ex).hypot(yf - (fy - 18.0));
                if eye(fx - 25.0) < 9.0 || eye(fx + 25.0) < 9.0 {
                    c = [30.0, 30.0, 40.0];
                }
                if eye(fx - 25.0) < 3.0 || eye(fx + 25.0) < 3.0 {
                    c = [250.0, 250.0, 250.0];
                }
                let mouth = (xf - fx).hypot(yf - (fy + 5.0));
                if (mouth - 32.0).abs() < 3.0 && yf > fy + 18.0 {
                    c = [170.0, 40.0, 50.0];
                }
                for (dx, dy, dr, color) in &dots {
                    if (xf - dx).hypot(yf - dy) < *dr {
                        c = *color;
                    }
                }
                if (yf - (fy + 50.0)).abs() < 6.0 && (xf - fx).abs() < 40.0 && (x / 4) % 2 == 0 {
                    c = [60.0, 30.0, 20.0];
                }
            }
            for k in 0..3 {
                // 噪声只加在背景上：不然整图都贴着噪声下限，看不出区域内的差别
                let noise = if d < fr { 0.0 } else { rng.next() * 12.0 };
                rgba[(y * w + x) * 4 + k] = (c[k] + noise).clamp(0.0, 255.0) as u8;
            }
            rgba[(y * w + x) * 4 + 3] = 255;
            // 蒙版：比脸略大的圆，边缘 10 像素羽化
            mask[y * w + x] = (((fr + 10.0 - d) / 10.0).clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
    (rgba, mask, w, h)
}

fn center_mask(w: usize, h: usize) -> Vec<u8> {
    (0..w * h)
        .map(|p| {
            let dx = ((p % w) as f64 + 0.5 - w as f64 / 2.0) / (w as f64 * 0.35);
            let dy = ((p / w) as f64 + 0.5 - h as f64 / 2.0) / (h as f64 * 0.35);
            if dx * dx + dy * dy <= 1.0 { 255 } else { 0 }
        })
        .collect()
}

fn render(w: usize, h: usize, bg: u32, shapes: &[Shape]) -> Vec<f64> {
    let bg_rgb = [((bg >> 16) & 255) as f64, ((bg >> 8) & 255) as f64, (bg & 255) as f64];
    let mut rgb: Vec<f64> = (0..w * h * 3).map(|i| bg_rgb[i % 3]).collect();
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
            }
        }
    }
    rgb
}

/// 不加权相似度（1 − rmse）：整图，以及 region 为真的像素
fn similarity(target: &[u8], rgb: &[f64], region: Option<&[bool]>) -> f64 {
    let (mut e, mut n) = (0.0, 0usize);
    for p in 0..target.len() / 3 {
        if region.is_some_and(|r| !r[p]) {
            continue;
        }
        for c in 0..3 {
            e += (rgb[p * 3 + c] - target[p * 3 + c] as f64).powi(2);
        }
        n += 3;
    }
    1.0 - (e / n as f64).sqrt() / 255.0
}

#[test]
#[ignore]
fn weights_bench() {
    let (rgba, mask, sw, sh) = match std::env::var("PRIMFIT_IMAGE") {
        Ok(path) => {
            let img = image::open(&path).expect("图片无法解码").to_rgba8();
            let (w, h) = (img.width() as usize, img.height() as usize);
            (img.into_raw(), center_mask(w, h), w, h)
        }
        Err(_) => {
            let (rgba, mask, w, h) = synthetic();
            (rgba, mask, w, h)
        }
    };
    let threads = env_usize("PRIMFIT_THREADS", 8);
    let size = env_usize("PRIMFIT_SIZE", 200);
    let count = env_usize("PRIMFIT_COUNT", 200);
    let passes = env_usize("PRIMFIT_REFINE", 2);
    let target = prepare_target(&rgba, sw, sh, size, 0);
    let (w, h) = (target.width, target.height);
    // 重点区域：缩放后的蒙版过半的像素（行自下而上，与目标图一致）
    let region: Vec<bool> = prepare_weights(&mask, sw, sh, w, h, 1.0).expect("蒙版为空").iter().map(|v| *v >= 1.5).collect();
    println!(
        "{w}×{h}，{count} 个图元，精修 {passes} 轮，{threads} 线程；重点区域占 {:.1}%",
        region.iter().filter(|r| **r).count() as f64 * 100.0 / region.len() as f64
    );
    println!("| 设置 | 整图相似度 | 重点区域相似度 | 区域外相似度 | 平均耗时 |");
    println!("| --- | --- | --- | --- | --- |");
    let outside: Vec<bool> = region.iter().map(|r| !r).collect();
    let seeds = env_usize("PRIMFIT_SEEDS", 3) as u32;
    for gain in [0.0f32, 4.0, 8.0, 16.0] {
        // 几个种子取平均：单次结果受随机搜索影响，差别不大时会来回跳
        let (mut all, mut inside, mut out, mut rmse_in, mut secs) = (0.0, 0.0, 0.0, 0.0, 0.0);
        for seed in 1..=seeds {
            let weights = prepare_weights(&mask, sw, sh, w, h, gain);
            let options = FitOptions { kinds: vec![2, 1, 3, 4], guided: 1.0, weights, ..FitOptions::default() };
            let start = Instant::now();
            let mut fitter = Fitter::new(target.data.clone(), w, h, &options);
            let mut shapes = run_fit(&mut fitter, count, BUDGET_NORMAL, seed, threads, |_, _, _| {}, || false);
            for pass in 1..=passes {
                run_refine(&mut fitter, &mut shapes, 1, BUDGET_NORMAL, seed + pass as u32, threads, |_, _| {}, || false);
            }
            secs += start.elapsed().as_secs_f64();
            let rgb = render(w, h, fitter.bg(), &shapes);
            let s = similarity(&target.data, &rgb, None);
            assert!((s - (1.0 - fitter.rmse())).abs() < 1e-9, "rmse 应为不加权相似度");
            all += s;
            let si = similarity(&target.data, &rgb, Some(&region));
            inside += si;
            rmse_in += (1.0 - si) * 255.0;
            out += similarity(&target.data, &rgb, Some(&outside));
        }
        let k = seeds as f64;
        println!(
            "| {} | {:.2}% | {:.2}%（RMSE {:.2}） | {:.2}% | {:.2} 秒 |",
            if gain == 0.0 { "无蒙版".to_string() } else { format!("gain = {gain}") },
            all / k * 100.0,
            inside / k * 100.0,
            rmse_in / k,
            out / k * 100.0,
            secs / k,
        );
    }
}
