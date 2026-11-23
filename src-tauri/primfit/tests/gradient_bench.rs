//! cargo test --manifest-path src-tauri/Cargo.toml -p primfit
//!   --release --test gradient_bench -- --ignored --nocapture --test-threads=1
//! Defaults: PRIMFIT_COUNT=100 PRIMFIT_SIZE=200 PRIMFIT_THREADS=8 PRIMFIT_REFINE=2.
//! Optional PRIMFIT_IMAGE points to an existing photo. PRIMFIT_GUIDED defaults to 1.
//! The seed (1) and BUDGET_NORMAL are identical across all three kind groups.
//!
//! Observed on this Windows desktop, 2026-11-15: defaults above, guided=1.
//! Every case produced 100 shapes, completed 2 passes, and passed replay checks.
//! Synthetic dimensions 200x160; tairitsu_grievous_lady.png photo 200x200.
//! source         kinds  similarity before -> after refine (%)   total seconds
//! smooth-field   1-3    98.75614 -> 98.93583                      0.499
//! smooth-field   1-4    99.77992 -> 99.82649                     12.190
//! smooth-field   1-6    99.75678 -> 99.80341                     22.241
//! sharp-pattern  1-3    92.95160 -> 95.78378                      0.351
//! sharp-pattern  1-4    92.18110 -> 94.84389                      5.696
//! sharp-pattern  1-6    92.37331 -> 94.75361                     10.231
//! photo          1-3    89.22352 -> 89.86004                      0.422
//! photo          1-4    89.35144 -> 89.85621                      5.728
//! photo          1-6    89.51450 -> 90.00417                      9.606
//! All 9 cases: 67.13s excluding compilation. Measured OS process lifetime peak
//! working set: 19,865,600 bytes (18.95 MiB), including all cases/runtime/sources.
//! This is neither a per-case peak nor an allocation estimate. Full log, including
//! greedy/refine times, per-kind counts and memory snapshots, is under the ignored
//! src-tauri/target/gradient-bench-100-200-guided1.log directory location.
use std::time::Instant;

use primfit::{
    prepare_target, run_fit, run_refine, FitOptions, Fitter, Shape, Target, BUDGET_NORMAL,
};

fn env_usize(name: &str, default: usize, allow_zero: bool) -> usize {
    let value = match std::env::var(name) {
        Ok(value) => value
            .parse::<usize>()
            .unwrap_or_else(|_| panic!("invalid {name}={value}")),
        Err(std::env::VarError::NotPresent) => default,
        Err(e) => panic!("invalid {name}: {e}"),
    };
    assert!(allow_zero || value > 0, "{name} must be positive");
    value
}

// These are generated directly as bottom-up RGB arrays, without primitive rasterization.
fn synthetic(size: usize, sharp: bool) -> Target {
    let (width, height) = (size, (size * 4 / 5).max(1));
    let mut data = Vec::with_capacity(width * height * 3);
    for y in 0..height {
        for x in 0..width {
            let u = (x as f64 + 0.5) / width as f64;
            let v = (y as f64 + 0.5) / height as f64;
            let color = if sharp {
                let checker = ((x * 9 / width) + (y * 7 / height)) % 2 == 0;
                let disk = (u - 0.61).hypot(v - 0.58) < 0.23;
                if disk {
                    [236.0, 54.0, 33.0]
                } else if u + 0.7 * v > 0.93 {
                    [19.0, 209.0, 173.0]
                } else if checker {
                    [241.0, 219.0, 177.0]
                } else {
                    [17.0, 35.0, 82.0]
                }
            } else {
                let glow = (-12.0 * ((u - 0.32).powi(2) + (v - 0.62).powi(2))).exp();
                let wave = (std::f64::consts::PI * (u + 0.55 * v)).sin();
                [
                    22.0 + 165.0 * glow + 47.0 * u,
                    31.0 + 132.0 * v + 62.0 * glow,
                    46.0 + 105.0 * (1.0 - u) + 58.0 * wave,
                ]
            };
            data.extend(color.map(|c| c.round().clamp(0.0, 255.0) as u8));
        }
    }
    Target {
        width,
        height,
        data,
    }
}

#[derive(Debug)]
struct Memory {
    working_set_bytes: usize,
    lifetime_peak_working_set_bytes: usize,
}

// OS measurements of this test process, including runtime/allocator/thread overhead.
// PeakWorkingSetSize is cumulative for the whole process; it is NOT a per-case peak.
#[cfg(windows)]
fn memory() -> Option<Memory> {
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Counters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
    }
    #[link(name = "psapi")]
    extern "system" {
        fn GetProcessMemoryInfo(process: *mut c_void, counters: *mut Counters, size: u32) -> i32;
    }
    let size = std::mem::size_of::<Counters>() as u32;
    let mut counters = Counters {
        cb: size,
        ..Counters::default()
    };
    // SAFETY: pseudo-handle belongs to this process; writable buffer matches the ABI
    // and the exact byte count passed to the OS. No handle needs to be closed.
    let ok = unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size) };
    (ok != 0).then_some(Memory {
        working_set_bytes: counters.working_set_size,
        lifetime_peak_working_set_bytes: counters.peak_working_set_size,
    })
}

#[cfg(target_os = "linux")]
fn memory() -> Option<Memory> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let bytes = |key: &str| -> Option<usize> {
        status
            .lines()
            .find(|l| l.starts_with(key))?
            .split_whitespace()
            .nth(1)?
            .parse::<usize>()
            .ok()?
            .checked_mul(1024)
    };
    Some(Memory {
        working_set_bytes: bytes("VmRSS:")?,
        lifetime_peak_working_set_bytes: bytes("VmHWM:")?,
    })
}

#[cfg(not(any(windows, target_os = "linux")))]
fn memory() -> Option<Memory> {
    None
}

fn memory_report(stage: &str) {
    match memory() {
        Some(m) => println!("memory stage={stage} measured_process_working_set_bytes={} measured_process_lifetime_peak_working_set_bytes={} (OS resident memory; cumulative process peak, not per-group allocation)", m.working_set_bytes, m.lifetime_peak_working_set_bytes),
        None => println!("memory stage={stage} unavailable (no estimate substituted)"),
    }
}

fn replay(data: &[u8], w: usize, h: usize, bg: u32, shapes: &[Shape]) -> f64 {
    let mut fitter = Fitter::new(
        data.to_vec(),
        w,
        h,
        &FitOptions {
            bg: Some(bg),
            ..FitOptions::default()
        },
    );
    for s in shapes {
        fitter.add(s);
    }
    fitter.error()
}

#[test]
#[ignore = "release benchmark: 3 kind groups, two synthetic sources, optional photo"]
fn gradient_groups() {
    assert!(!cfg!(debug_assertions), "run this benchmark with --release");
    let size = env_usize("PRIMFIT_SIZE", 200, false);
    let count = env_usize("PRIMFIT_COUNT", 100, false);
    let threads = env_usize("PRIMFIT_THREADS", 8, false);
    let passes = env_usize("PRIMFIT_REFINE", 2, true);
    let guided: f64 = std::env::var("PRIMFIT_GUIDED")
        .map(|v| v.parse().expect("invalid PRIMFIT_GUIDED"))
        .unwrap_or(1.0);
    assert!(guided.is_finite() && (0.0..=1.0).contains(&guided));
    println!("gradient benchmark seed=1 threads={threads} size={size} requested_count={count} refine_passes={passes} guided={guided} budget=NORMAL({BUDGET_NORMAL:?}); similarity=100*(1-rmse)");
    memory_report("start");
    let mut sources = vec![
        ("smooth-field".to_owned(), synthetic(size, false)),
        ("sharp-pattern".to_owned(), synthetic(size, true)),
    ];
    if let Some(path) = std::env::var_os("PRIMFIT_IMAGE") {
        let path = std::path::PathBuf::from(path);
        assert!(
            path.is_file(),
            "PRIMFIT_IMAGE must be an existing file: {}",
            path.display()
        );
        println!("photo source={}", path.display());
        let image = image::open(&path)
            .expect("cannot decode PRIMFIT_IMAGE")
            .to_rgba8();
        let target = prepare_target(
            image.as_raw(),
            image.width() as usize,
            image.height() as usize,
            size,
            0,
        );
        sources.push(("photo".into(), target));
    } else {
        println!("photo skipped: set PRIMFIT_IMAGE to an existing photo path");
    }
    for (name, target) in &sources {
        for kinds in [vec![1, 2, 3], vec![1, 2, 3, 4], vec![1, 2, 3, 4, 5, 6]] {
            println!(
                "BEGIN source={name} kinds={kinds:?} dimensions={}x{}",
                target.width, target.height
            );
            memory_report("before-fit");
            let start = Instant::now();
            let mut fitter = Fitter::new(
                target.data.clone(),
                target.width,
                target.height,
                &FitOptions {
                    kinds: kinds.clone(),
                    guided,
                    ..FitOptions::default()
                },
            );
            let initial = 100.0 * (1.0 - fitter.rmse());
            let mut last_error = fitter.error();
            let mut shapes = run_fit(
                &mut fitter,
                count,
                BUDGET_NORMAL,
                1,
                threads,
                |s, i, f| {
                    assert!(s.delta.is_finite() && s.delta < 0.0 && f.error() <= last_error + 1e-6);
                    last_error = f.error();
                    if (i + 1) % 25 == 0 {
                        println!("progress source={name} kinds={kinds:?} count={} similarity={:.5}% elapsed_s={:.3}", i + 1, 100.0 * (1.0 - f.rmse()), start.elapsed().as_secs_f64());
                    }
                },
                || false,
            );
            let greedy_time = start.elapsed().as_secs_f64();
            let greedy = 100.0 * (1.0 - fitter.rmse());
            memory_report("after-greedy");
            let refine_start = Instant::now();
            let before_error = fitter.error();
            let completed = run_refine(
                &mut fitter,
                &mut shapes,
                passes,
                BUDGET_NORMAL,
                1,
                threads,
                |pass, n| {
                    if n == count {
                        println!("refine source={name} kinds={kinds:?} completed_pass={} elapsed_s={:.3}", pass + 1, refine_start.elapsed().as_secs_f64());
                    }
                },
                || false,
            );
            let refine_time = refine_start.elapsed().as_secs_f64();
            let total_time = start.elapsed().as_secs_f64();
            assert_eq!(completed, passes);
            assert!(fitter.error().is_finite() && fitter.error() <= before_error + 1e-6);
            let mut counts = [0usize; 6];
            for s in &shapes {
                counts[(s.k - 1) as usize] += 1;
            }
            println!("RESULT source={name} kinds={kinds:?} dimensions={}x{} requested={count} actual={} counts_k1_to_k6={counts:?} similarity_initial={initial:.5}% similarity_before_refine={greedy:.5}% similarity_after_refine={:.5}% greedy_s={greedy_time:.3} refine_s={refine_time:.3} total_s={total_time:.3} completed_passes={completed}", target.width, target.height, shapes.len(), 100.0 * (1.0 - fitter.rmse()));
            memory_report("after-refine");
            let replayed = replay(
                &target.data,
                target.width,
                target.height,
                fitter.bg(),
                &shapes,
            );
            assert!(
                (fitter.error() - replayed).abs() <= 1e-8 * replayed.abs().max(1.0),
                "benchmark replay inconsistency"
            );
        }
    }
}
