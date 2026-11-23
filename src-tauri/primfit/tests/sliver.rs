//! 细线伪影诊断（默认不跑）：评分模型与面积覆盖绘制之间的差距。
//!   PRIMFIT_IMAGE=<图片> cargo test -p primfit --release --test sliver -- --ignored --nocapture
//! 可选 PRIMFIT_SIZE（默认 500）、PRIMFIT_COUNT（默认 2000）、PRIMFIT_REFINE（默认 0）、PRIMFIT_AA（1 = 抗锯齿评分）、
//! PRIMFIT_THREADS（默认 CPU 核数 − 1）。
//! 输出：模型相似度；同一组图元按 8×8 超采样面积覆盖重画后的相似度（编辑器预览与游戏都按面积覆盖绘制）；
//! 采样像素数不到面积覆盖 60% 的「细针」图元个数；目标为黑（< 16）却被画亮（> 48）的像素数。

use std::time::Instant;

use primfit::{default_threads, prepare_target, rasterize, run_fit, run_refine, FitOptions, Fitter, Shape, BUDGET_FINE};

fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

const SS: usize = 8;

/// 点 (px, py)（引擎坐标，Y 向上）是否在图元内
fn inside(s: &Shape, px: f64, py: f64) -> bool {
    let th = s.r as f64 * std::f64::consts::PI / 180.0;
    let (cos, sin) = (th.cos(), th.sin());
    let (dx, dy) = (px - s.x as f64, py - s.y as f64);
    let lx = dx * cos + dy * sin;
    let ly = -dx * sin + dy * cos;
    let (w, h) = (s.w as f64, s.h as f64);
    match s.k {
        1 => lx.abs() <= w / 2.0 && ly.abs() <= h / 2.0,
        2 => (2.0 * lx / w).powi(2) + (2.0 * ly / h).powi(2) <= 1.0,
        3 => ly >= -h / 2.0 && ly <= h / 2.0 && lx.abs() <= w * (h / 2.0 - ly) / (2.0 * h),
        _ => panic!("只诊断硬边图元"),
    }
}

/// 面积覆盖率（行自下而上，长度 w × h）
fn area_coverage(s: &Shape, w: usize, h: usize, out: &mut Vec<f64>) {
    out.clear();
    out.resize(w * h, 0.0);
    let r = (s.w.max(s.h) as f64) * 0.75 + 2.0;
    let x0 = ((s.x as f64 - r).floor().max(0.0)) as usize;
    let x1 = ((s.x as f64 + r).ceil().min(w as f64)) as usize;
    let y0 = ((s.y as f64 - r).floor().max(0.0)) as usize;
    let y1 = ((s.y as f64 + r).ceil().min(h as f64)) as usize;
    for y in y0..y1 {
        for x in x0..x1 {
            let mut n = 0;
            for j in 0..SS {
                for i in 0..SS {
                    if inside(s, x as f64 + (i as f64 + 0.5) / SS as f64, y as f64 + (j as f64 + 0.5) / SS as f64) {
                        n += 1;
                    }
                }
            }
            out[y * w + x] = n as f64 / (SS * SS) as f64;
        }
    }
}

/// 单次评估的开销：中心采样、只算抗锯齿覆盖、抗锯齿评估（随机图元，尺寸分布同 random_shape + 爬山）。
#[test]
#[ignore]
fn eval_cost() {
    use primfit::{Cover, Rng};
    let (w, h) = (env_usize("PRIMFIT_W", 500), env_usize("PRIMFIT_H", 150));
    let data: Vec<u8> = (0..w * h * 3).map(|i| (i * 7 % 256) as u8).collect();
    let mk = |aa| Fitter::new(data.clone(), w, h, &FitOptions { kinds: vec![2, 1, 3], antialias: aa, ..FitOptions::default() });
    let (plain, aa) = (mk(false), mk(true));
    let mut rng = Rng::new(3);
    let shapes: Vec<Shape> = (0..200_000)
        .map(|_| {
            let mut s = plain.random_shape(&mut rng);
            for _ in 0..rng.int(20) {
                s = plain.mutate(&s, &mut rng);
            }
            s
        })
        .collect();
    let time = |name: &str, f: &mut dyn FnMut(&mut Shape)| {
        let start = Instant::now();
        for s in &shapes {
            let mut s = *s;
            f(&mut s);
        }
        println!("{name}: {:.0} ns/次", start.elapsed().as_nanos() as f64 / shapes.len() as f64);
    };
    let mut scratch = plain.scratch();
    time("中心采样评估", &mut |s| { plain.evaluate(s, &mut scratch); });
    let mut cover = Cover::default();
    let (mut spans, mut n) = (0usize, 0usize);
    time("抗锯齿覆盖", &mut |s| { cover.compute(s, w, h, true); spans += cover.spans.len(); n += 1; });
    println!("  平均每个图元 {:.1} 段", spans as f64 / n as f64);
    let mut scratch = aa.scratch();
    time("抗锯齿评估", &mut |s| { aa.evaluate(s, &mut scratch); });
}

#[test]
#[ignore]
fn sliver() {
    let path = std::env::var("PRIMFIT_IMAGE").expect("请用环境变量 PRIMFIT_IMAGE 指定图片");
    let img = image::open(&path).expect("图片无法解码").to_rgba8();
    let size = env_usize("PRIMFIT_SIZE", 500);
    let count = env_usize("PRIMFIT_COUNT", 2000);
    let threads = env_usize("PRIMFIT_THREADS", default_threads());
    let aa = env_usize("PRIMFIT_AA", 0) != 0;
    let target = prepare_target(img.as_raw(), img.width() as usize, img.height() as usize, size, 0);
    let (w, h) = (target.width, target.height);
    let options = FitOptions { kinds: vec![2, 1, 3], guided: 1.0, antialias: aa, ..FitOptions::default() };
    let mut fitter = Fitter::new(target.data.clone(), w, h, &options);
    let start = Instant::now();
    let mut shapes = run_fit(&mut fitter, count, BUDGET_FINE, 1, threads, |_, _, _| {}, || false);
    let greedy = start.elapsed().as_secs_f64();
    let passes = env_usize("PRIMFIT_REFINE", 0);
    if passes > 0 {
        run_refine(&mut fitter, &mut shapes[..], passes, BUDGET_FINE, 1, threads, |_, _| {}, || false);
    }
    let total = start.elapsed().as_secs_f64();

    // 面积覆盖重画
    let bg = fitter.bg();
    let mut canvas: Vec<f64> = (0..w * h).flat_map(|_| [((bg >> 16) & 255) as f64, ((bg >> 8) & 255) as f64, (bg & 255) as f64]).collect();
    let mut cov = Vec::new();
    let mut lines = vec![0i32; h * 3];
    let mut slivers = 0;
    for s in &shapes {
        area_coverage(s, w, h, &mut cov);
        let area: f64 = cov.iter().sum();
        let rows = rasterize(s, w, h, &mut lines);
        let sampled: usize = lines[..rows * 3].chunks_exact(3).map(|l| (l[2] - l[1] + 1) as usize).sum();
        if area > 0.5 && (sampled as f64) < 0.6 * area {
            slivers += 1;
        }
        let al = s.a as f64 / 255.0;
        let col = [((s.c >> 16) & 255) as f64, ((s.c >> 8) & 255) as f64, (s.c & 255) as f64];
        for (p, m) in cov.iter().enumerate() {
            if *m > 0.0 {
                for c in 0..3 {
                    let v = &mut canvas[p * 3 + c];
                    *v += (col[c] - *v) * al * m;
                }
            }
        }
    }
    let mut err = 0.0;
    let mut lit = 0;
    for p in 0..w * h {
        let t: f64 = (0..3).map(|c| target.data[p * 3 + c] as f64).sum::<f64>() / 3.0;
        let v: f64 = (0..3).map(|c| canvas[p * 3 + c]).sum::<f64>() / 3.0;
        if t < 16.0 && v > 48.0 {
            lit += 1;
        }
        for c in 0..3 {
            err += (canvas[p * 3 + c] - target.data[p * 3 + c] as f64).powi(2);
        }
    }
    if let Ok(out) = std::env::var("PRIMFIT_PNG") {
        // 面积覆盖重画的结果（行自下而上 → 图片自上而下）
        let mut img = image::RgbImage::new(w as u32, h as u32);
        for y in 0..h {
            for x in 0..w {
                let p = (h - 1 - y) * w + x;
                let px = |c: usize| canvas[p * 3 + c].round().clamp(0.0, 255.0) as u8;
                img.put_pixel(x as u32, y as u32, image::Rgb([px(0), px(1), px(2)]));
            }
        }
        img.save(&out).expect("PNG 写入失败");
    }
    let area_sim = (1.0 - (err / (w * h * 3) as f64).sqrt() / 255.0) * 100.0;
    println!(
        "{}×{}，{} 个图元（抗锯齿评分 {}），精修 {passes} 轮：贪心 {greedy:.1} 秒，共 {total:.1} 秒",
        w, h, shapes.len(), if aa { "开" } else { "关" }
    );
    println!("  模型相似度 {:.2}%，面积覆盖重画相似度 {area_sim:.2}%", (1.0 - fitter.rmse()) * 100.0);
    println!("  细针图元 {slivers} 个（{:.1}%），黑区被画亮的像素 {lit} 个", slivers as f64 * 100.0 / shapes.len().max(1) as f64);
}
