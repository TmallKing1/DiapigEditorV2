//! 抗锯齿评分（FitOptions::antialias）：评估、增量绘制、精修与独立的逐像素渲染一致。
//! 渲染器只用 Cover（已在 raster.rs 里与超采样面积对拍），按 Cover 的覆盖率逐像素混合。

use primfit::{prepare_weights, run_fit, run_refine, Budget, Cover, FitOptions, Fitter, Rng, Shape};

const W: usize = 40;
const H: usize = 30;
const QUICK: Budget = Budget { candidates: 40, restarts: 1, age: 20 };

fn close(a: f64, b: f64, what: &str) {
    assert!((a - b).abs() <= 1e-7 * a.abs().max(b.abs()).max(1.0), "{what}: {a} != {b}");
}

/// 逐像素渲染（RGB，或预乘 RGB + Alpha），返回整图加权平方误差
fn render_error(shapes: &[Shape], bg: u32, data: &[u8], alpha: Option<&[u8]>, omega: &[f64]) -> f64 {
    let mut rgb: Vec<[f64; 4]> = vec![[((bg >> 16) & 255) as f64, ((bg >> 8) & 255) as f64, (bg & 255) as f64, 0.0]; W * H];
    let mut cover = Cover::default();
    for s in shapes {
        cover.compute(s, W, H, true);
        let col = [((s.c >> 16) & 255) as f64, ((s.c >> 8) & 255) as f64, (s.c & 255) as f64, 255.0];
        for (p, m) in cover.pixels(s, W) {
            let q = s.a as f64 / 255.0 * m;
            for c in 0..4 {
                rgb[p][c] += (col[c] - rgb[p][c]) * q;
            }
        }
    }
    (0..W * H)
        .map(|p| {
            let mut e: f64 = (0..3).map(|c| (rgb[p][c] - data[p * 3 + c] as f64).powi(2)).sum();
            if let Some(a) = alpha {
                e += (rgb[p][3] - a[p] as f64).powi(2);
            }
            e * omega[p]
        })
        .sum()
}

/// 白色细线笔画在黑底上（类似 Logo）
fn target(transparent: bool) -> (Vec<u8>, Vec<u8>) {
    let mut rng = Rng::new(5);
    let mut data = vec![0u8; W * H * 3];
    let mut alpha = vec![0u8; W * H];
    for p in 0..W * H {
        let (x, y) = (p % W, p / W);
        let stroke = x % 9 == 4 || y % 11 == 5 || (x + y) % 17 == 0;
        let v = if stroke { 255 } else { rng.int(20) as u8 };
        let a = if transparent { if stroke { 255 } else { rng.int(256) as u8 } } else { 255 };
        alpha[p] = a;
        for c in 0..3 {
            data[p * 3 + c] = (v as u32 * a as u32 / 255) as u8;
        }
    }
    (data, alpha)
}

fn fitter(transparent: bool, weighted: bool) -> (Fitter, Vec<u8>, Vec<u8>, Vec<f64>) {
    let (data, alpha) = target(transparent);
    let mut opts = FitOptions { kinds: vec![1, 2, 3], antialias: true, guided: 0.5, ..FitOptions::default() };
    if weighted {
        let mask: Vec<u8> = (0..W * H).map(|p| if p % W < W / 2 { 255 } else { 0 }).collect();
        opts.weights = prepare_weights(&mask, W, H, W, H, 4.0);
    }
    // 权重行自下而上，蒙版行自上而下
    let omega: Vec<f64> = match &opts.weights {
        Some(w) => w.iter().map(|v| (*v as f64).max(1.0)).collect(),
        None => vec![1.0; W * H],
    };
    let f = if transparent {
        Fitter::new_alpha(data.clone(), W, H, alpha.clone(), &opts)
    } else {
        Fitter::new(data.clone(), W, H, &opts)
    };
    (f, data, alpha, omega)
}

fn random_shape(rng: &mut Rng) -> Shape {
    Shape {
        k: 1 + rng.int(3) as u8,
        x: rng.int(W + 1) as i32,
        y: rng.int(H + 1) as i32,
        w: 1 + rng.int(25) as i32,
        h: 1 + rng.int(25) as i32,
        r: rng.int(360) as i32,
        a: 1 + rng.int(255) as i32,
        c: 0,
        delta: 0.0,
    }
}

#[test]
fn evaluate_add_and_rebuild_agree_with_direct_render() {
    for (transparent, weighted) in [(false, false), (false, true), (true, false), (true, true)] {
        let (mut f, data, alpha, omega) = fitter(transparent, weighted);
        let alpha_ref = transparent.then_some(&alpha[..]);
        let mut rng = Rng::new(11);
        let mut shapes = Vec::new();
        let mut scratch = f.scratch();
        for _ in 0..60 {
            let mut s = random_shape(&mut rng);
            let before = f.error();
            let delta = f.evaluate(&mut s, &mut scratch);
            if !delta.is_finite() {
                continue;
            }
            // 最优颜色：任何一个通道 ±1 都不更好
            for channel in 0..3 {
                for step in [-1i32, 1] {
                    let shift = 16 - channel * 8;
                    let v = ((s.c >> shift) & 255) as i32 + step;
                    if !(0..=255).contains(&v) {
                        continue;
                    }
                    let mut other = s;
                    other.c = (s.c & !(255 << shift)) | ((v as u32) << shift);
                    let mut with = shapes.clone();
                    with.push(other);
                    let e = render_error(&with, f.bg(), &data, alpha_ref, &omega);
                    let mut best = shapes.clone();
                    best.push(s);
                    assert!(e + 1e-6 >= render_error(&best, f.bg(), &data, alpha_ref, &omega), "颜色不是最优");
                }
            }
            f.add(&s);
            shapes.push(s);
            close(f.error() - before, delta, "evaluate 与 add 的误差变化量");
            close(f.error(), render_error(&shapes, f.bg(), &data, alpha_ref, &omega), "增量误差与逐像素渲染");
        }
        let incremental = f.error();
        f.rebuild(&shapes);
        close(f.error(), incremental, "rebuild");
        let plain = render_error(&shapes, f.bg(), &data, alpha_ref, &vec![1.0; W * H]);
        let n = if transparent { 4 } else { 3 };
        close(*f.prefix_rmse(&shapes).last().unwrap(), (plain / (W * H * n) as f64).sqrt() / 255.0, "prefix_rmse");
    }
}

#[test]
fn refine_never_increases_the_rendered_error() {
    for transparent in [false, true] {
        let (mut f, data, alpha, omega) = fitter(transparent, false);
        let alpha_ref = transparent.then_some(&alpha[..]);
        let mut shapes = run_fit(&mut f, 40, QUICK, 3, 2, |_, _, _| {}, || false);
        assert!(!shapes.is_empty());
        close(f.error(), render_error(&shapes, f.bg(), &data, alpha_ref, &omega), "贪心后");
        let before = f.error();
        run_refine(&mut f, &mut shapes, 2, QUICK, 3, 2, |_, _| {}, || false);
        assert!(f.error() <= before + 1e-6, "精修后误差变大：{before} → {}", f.error());
        close(f.error(), render_error(&shapes, f.bg(), &data, alpha_ref, &omega), "精修后");
    }
}

#[test]
fn needles_do_not_pay_off() {
    // 只有一条水平白线的黑图：沿白线的细长三角形若伸进黑区，按面积覆盖要付出代价
    let mut data = vec![0u8; W * H * 3];
    for x in 0..W {
        for c in 0..3 {
            data[(15 * W + x) * 3 + c] = 255;
        }
    }
    let fit = |aa: bool| {
        let opts = FitOptions { kinds: vec![1, 2, 3], antialias: aa, bg: Some(0), ..FitOptions::default() };
        let mut f = Fitter::new(data.clone(), W, H, &opts);
        let shapes = run_fit(&mut f, 30, QUICK, 9, 2, |_, _, _| {}, || false);
        render_error(&shapes, 0, &data, None, &vec![1.0; W * H])
    };
    let (center, area) = (fit(false), fit(true));
    assert!(area <= center, "抗锯齿评分的结果按面积覆盖渲染反而更差：{area} > {center}");
}
