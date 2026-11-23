//! 整体基准（默认不跑）：
//!   PRIMFIT_IMAGE=<图片> cargo test -p primfit --release --test bench -- --ignored --nocapture
//! 可选 PRIMFIT_THREADS（默认 8）、PRIMFIT_SIZE（默认 200）、PRIMFIT_GUIDED（按误差取样的比例，默认 0）、
//! PRIMFIT_REFINE（精修轮数，默认 0）。

use std::time::Instant;

use primfit::{prepare_target, run_fit, run_refine, FitOptions, Fitter, BUDGET_NORMAL};

fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

#[test]
#[ignore]
fn bench() {
    let path = std::env::var("PRIMFIT_IMAGE").expect("请用环境变量 PRIMFIT_IMAGE 指定图片");
    let img = image::open(&path).expect("图片无法解码").to_rgba8();
    let threads = env_usize("PRIMFIT_THREADS", 8);
    let size = env_usize("PRIMFIT_SIZE", 200);
    let (sw, sh) = (img.width() as usize, img.height() as usize);
    for count in [300, 500, 1000] {
        let start = Instant::now();
        let target = prepare_target(img.as_raw(), sw, sh, size, 0);
        let guided = std::env::var("PRIMFIT_GUIDED").ok().and_then(|v| v.parse().ok()).unwrap_or(0.0);
        let options = FitOptions { kinds: vec![2, 1, 3], guided, ..FitOptions::default() };
        let mut fitter = Fitter::new(target.data, target.width, target.height, &options);
        let mut shapes = run_fit(&mut fitter, count, BUDGET_NORMAL, 1, threads, |_, _, _| {}, || false);
        let half = |f: &Fitter, shapes: &[primfit::Shape]| (1.0 - f.prefix_rmse(shapes)[shapes.len() / 2 - 1]) * 100.0;
        let half_before = half(&fitter, &shapes);
        for pass in 0..env_usize("PRIMFIT_REFINE", 0) {
            let greedy = (start.elapsed().as_secs_f64(), (1.0 - fitter.rmse()) * 100.0);
            run_refine(&mut fitter, &mut shapes[..], 1, BUDGET_NORMAL, 1 + pass as u32, threads, |_, _| {}, || false);
            println!("  精修第 {} 轮：{:.2} 秒 → {:.2} 秒，相似度 {:.2}% → {:.2}%", pass + 1, greedy.0, start.elapsed().as_secs_f64(), greedy.1, (1.0 - fitter.rmse()) * 100.0);
        }
        println!("  只取前一半图元时的相似度：精修前 {half_before:.2}%，精修后 {:.2}%", half(&fitter, &shapes));
        println!(
            "{count} 个图元（实际 {}），{threads} 线程，{}×{}：{:.2} 秒，相似度 {:.2}%",
            shapes.len(),
            target.width,
            target.height,
            start.elapsed().as_secs_f64(),
            (1.0 - fitter.rmse()) * 100.0
        );
    }
}
