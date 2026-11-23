//! 精修：误差只降不升；增量更新的画面与从头重画一致；提前停止后状态仍然一致。

use primfit::{run_fit, run_refine, FitOptions, Fitter, Rng, Shape, BUDGET_FAST};

fn target(w: usize, h: usize) -> Vec<u8> {
    let mut rng = Rng::new(2026);
    let mut data = vec![0u8; w * h * 3];
    for y in 0..h {
        for x in 0..w {
            let o = (y * w + x) * 3;
            let inside = ((x as f64 - 40.0).hypot(y as f64 - 30.0)) < 18.0;
            data[o] = (x * 3 + rng.int(20)).min(255) as u8;
            data[o + 1] = (y * 4 + rng.int(20)).min(255) as u8;
            data[o + 2] = if inside { 220 } else { 40 } + rng.int(20) as u8;
        }
    }
    data
}

/// 用同一组图元和背景色从头画一遍，得到的误差。
fn replay(data: &[u8], w: usize, h: usize, bg: u32, shapes: &[Shape]) -> f64 {
    let mut fresh = Fitter::new(data.to_vec(), w, h, &FitOptions { bg: Some(bg), ..FitOptions::default() });
    for s in shapes {
        fresh.add(s);
    }
    fresh.error()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-6 * a.abs().max(b.abs()).max(1.0)
}

fn check(alpha: i32, threads: usize) {
    let (w, h) = (80, 60);
    let data = target(w, h);
    let options = FitOptions { kinds: vec![2, 1, 3], alpha, guided: 1.0, ..FitOptions::default() };
    let mut fitter = Fitter::new(data.clone(), w, h, &options);
    let mut shapes = run_fit(&mut fitter, 120, BUDGET_FAST, 7, threads, |_, _, _| {}, || false);
    assert!(shapes.len() > 50);
    let before = fitter.error();

    // 第一轮中途停止：已做的调整保留，状态一致
    let seen = std::sync::atomic::AtomicUsize::new(0);
    let passes = run_refine(&mut fitter, &mut shapes, 1, BUDGET_FAST, 7, threads, |_, n| seen.store(n, std::sync::atomic::Ordering::Relaxed), || seen.load(std::sync::atomic::Ordering::Relaxed) >= 30);
    assert_eq!(passes, 0);
    let partial = fitter.error();
    assert!(partial <= before + 1e-6, "中途停止后误差上升：{before} → {partial}");
    assert!(close(partial, replay(&data, w, h, fitter.bg(), &shapes)));

    let passes = run_refine(&mut fitter, &mut shapes, 2, BUDGET_FAST, 7, threads, |_, _| {}, || false);
    assert_eq!(passes, 2);
    let after = fitter.error();
    assert!(after < before, "精修没有降低误差：{before} → {after}");
    assert!(close(after, replay(&data, w, h, fitter.bg(), &shapes)), "增量画面与重画不一致");
    let rmse = fitter.prefix_rmse(&shapes);
    assert_eq!(rmse.len(), shapes.len());
    assert!(close(*rmse.last().unwrap(), fitter.rmse()));
    for s in &shapes {
        assert!(s.w >= 1 && s.h >= 1 && s.x >= 0 && s.x <= w as i32 && s.y >= 0 && s.y <= h as i32);
        assert!((1..=255).contains(&s.a) && s.c <= 0xFF_FFFF);
        if alpha > 0 {
            assert_eq!(s.a, alpha);
        }
    }
    // 精修后还能接着加图元
    let more = run_fit(&mut fitter, 5, BUDGET_FAST, 9, threads, |_, _, _| {}, || false);
    assert!(fitter.error() <= after && more.len() <= 5);
    println!("alpha={alpha} threads={threads}: {before:.0} → {after:.0}（{:.2}%）", (1.0 - after / before) * 100.0);
}

#[test]
fn refine_auto_alpha() {
    check(0, 1);
    check(0, 4);
}

#[test]
fn refine_fixed_and_opaque() {
    check(128, 2);
    check(255, 2);
}

/// 纯色底上画若干个轴对齐的纯色矩形：[x0, x1) × [y0, y1)，颜色 0xRRGGBB。
fn blocks(w: usize, h: usize, bg: u32, rects: &[(usize, usize, usize, usize, u32)]) -> Vec<u8> {
    let rgb = |c: u32| [(c >> 16) as u8, (c >> 8) as u8, c as u8];
    let mut data = rgb(bg).repeat(w * h);
    for &(x0, x1, y0, y1, c) in rects {
        for y in y0..y1 {
            for x in x0..x1 {
                data[(y * w + x) * 3..(y * w + x) * 3 + 3].copy_from_slice(&rgb(c));
            }
        }
    }
    data
}

fn place(fitter: &mut Fitter, k: u8, x: i32, y: i32, w: i32, h: i32) -> Shape {
    let mut s = Shape { k, x, y, w, h, r: 0, a: 255, c: 0, delta: 0.0 };
    s.delta = fitter.evaluate(&mut s, &mut fitter.scratch());
    fitter.add(&s);
    s
}

/// 换类型：目标是一个矩形，起初用椭圆去盖；精修应当把它换成矩形。
#[test]
fn refine_switches_to_a_better_kind() {
    let (w, h, bg) = (64, 48, 0x202020);
    let data = blocks(w, h, bg, &[(20, 44, 14, 34, 0xE63C3C)]);
    let options = FitOptions { kinds: vec![2, 1], alpha: 255, bg: Some(bg), ..FitOptions::default() };
    let mut fitter = Fitter::new(data.clone(), w, h, &options);
    let mut shapes = vec![place(&mut fitter, 2, 32, 24, 24, 20)];
    let before = fitter.error();
    assert!(before > 0.0);
    // 两轮：背景色在每轮开头重算，第一轮算的时候图元还是椭圆
    assert_eq!(run_refine(&mut fitter, &mut shapes, 2, BUDGET_FAST, 3, 2, |_, _| {}, || false), 2);
    assert_eq!(shapes[0].k, 1, "{:?}", shapes[0]);
    assert!(fitter.error() < before * 0.01, "{before} -> {}", fitter.error());
    assert!(close(fitter.error(), replay(&data, w, h, fitter.bg(), &shapes)));

    // 只有一种可用类型时不换
    let options = FitOptions { kinds: vec![2], alpha: 255, bg: Some(bg), ..FitOptions::default() };
    let mut fitter = Fitter::new(data, w, h, &options);
    let mut shapes = vec![place(&mut fitter, 2, 32, 24, 24, 20)];
    run_refine(&mut fitter, &mut shapes, 1, BUDGET_FAST, 3, 2, |_, _| {}, || false);
    assert_eq!(shapes[0].k, 2);
}

/// 搬家：一个色块没人管，另有一批图元落在与底色相同的地方、毫无贡献，而且离色块太远、逐个调整够不着。
/// 精修应当把其中一个搬到色块上：图元总数不变，新图元在最上层，误差明显下降。
#[test]
fn refine_relocates_a_useless_shape() {
    let (w, h, bg) = (80, 60, 0x202020);
    let data = blocks(w, h, bg, &[(6, 26, 30, 50, 0x3C78E6), (50, 72, 30, 46, 0xE6C83C)]);
    let options = FitOptions { kinds: vec![1], alpha: 255, bg: Some(bg), guided: 1.0, ..FitOptions::default() };
    let mut fitter = Fitter::new(data.clone(), w, h, &options);
    // 左边的色块已经盖好；右边的没有
    let mut shapes = vec![place(&mut fitter, 1, 16, 40, 20, 20)];
    for i in 0..9 {
        shapes.push(place(&mut fitter, 1, 6 + 8 * i, 3, 4, 2));
    }
    let before = fitter.error();
    assert_eq!(run_refine(&mut fitter, &mut shapes, 1, BUDGET_FAST, 5, 2, |_, _| {}, || false), 1);
    assert_eq!(shapes.len(), 10);
    assert!(fitter.error() < before * 0.5, "{before} -> {}", fitter.error());
    let top = shapes[9];
    assert!((50..=72).contains(&top.x) && (30..=46).contains(&top.y), "{top:?}");
    // 左边那个仍在最底层，没被动过位置
    assert!((shapes[0].x - 16).abs() <= 2 && (shapes[0].y - 40).abs() <= 2, "{:?}", shapes[0]);
    assert!(close(fitter.error(), replay(&data, w, h, fitter.bg(), &shapes)));

    // 相同输入得到相同结果
    let mut again = Fitter::new(data.clone(), w, h, &options);
    let mut repeated = vec![place(&mut again, 1, 16, 40, 20, 20)];
    for i in 0..9 {
        repeated.push(place(&mut again, 1, 6 + 8 * i, 3, 4, 2));
    }
    run_refine(&mut again, &mut repeated, 1, BUDGET_FAST, 5, 2, |_, _| {}, || false);
    assert_eq!(shapes, repeated);
}
