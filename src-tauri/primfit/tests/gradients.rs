//! Independent pixel oracle: never uses rasterize/coverage_row/gradient_kernel to render.
use std::sync::atomic::{AtomicUsize, Ordering};

use primfit::{
    coverage_row, gradient_kernel, rasterize, run_fit, run_refine, Budget, FitOptions, Fitter, Rng,
    Shape, KIND_BAND, KIND_LINEAR, KIND_RADIAL,
};

const W: usize = 24;
const H: usize = 20;
const QUICK: Budget = Budget {
    candidates: 16,
    restarts: 1,
    age: 8,
};

fn kernel(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    (1.0 - t) * (1.0 + t * (0.5 - t))
}

fn shape(k: u8, a: i32) -> Shape {
    Shape {
        k,
        x: 12,
        y: 10,
        w: 18,
        h: 14,
        r: 23,
        a,
        c: 0x438fcb,
        delta: 0.0,
    }
}

fn rgb(c: u32) -> [f64; 3] {
    [
        ((c >> 16) & 255) as f64,
        ((c >> 8) & 255) as f64,
        (c & 255) as f64,
    ]
}

// Pixel centers, inverse CCW rotation, then analytic local-space containment and alpha.
fn direct_mask(s: &Shape, x: usize, y: usize) -> f64 {
    let theta = (s.r.rem_euclid(360) as f64).to_radians();
    let (sin, cos) = theta.sin_cos();
    let dx = x as f64 + 0.5 - s.x as f64;
    let dy = y as f64 + 0.5 - s.y as f64;
    let u = (dx * cos + dy * sin) / s.w as f64;
    let v = (-dx * sin + dy * cos) / s.h as f64;
    match s.k {
        1 => f64::from(u.abs() <= 0.5 && v.abs() <= 0.5),
        2 => f64::from(4.0 * (u * u + v * v) <= 1.0),
        3 => f64::from(v >= -0.5 && v <= 0.5 && u.abs() <= (0.5 - v) / 2.0),
        KIND_RADIAL => kernel(2.0 * u.hypot(v)),
        KIND_LINEAR if u.abs() <= 0.5 && v.abs() <= 0.5 => kernel((u + 0.38) / 0.86),
        KIND_BAND if u.abs() <= 0.5 && v.abs() <= 0.5 => kernel((2.0 * u.abs() - 0.145) / 0.83),
        KIND_LINEAR | KIND_BAND => 0.0,
        _ => panic!("unsupported kind {}", s.k),
    }
}

fn canvas(bg: u32) -> Vec<f64> {
    rgb(bg).repeat(W * H)
}

fn draw(pixels: &mut [f64], s: &Shape) {
    let color = rgb(s.c);
    for y in 0..H {
        for x in 0..W {
            let alpha = direct_mask(s, x, y) * s.a as f64 / 255.0;
            for c in 0..3 {
                let p = &mut pixels[(y * W + x) * 3 + c];
                *p = *p * (1.0 - alpha) + color[c] * alpha;
            }
        }
    }
}

fn error(pixels: &[f64], target: &[u8]) -> f64 {
    pixels
        .iter()
        .zip(target)
        .map(|(p, t)| (p - *t as f64).powi(2))
        .sum()
}

fn close(a: f64, b: f64, why: &str) {
    assert!(
        a.is_finite() && b.is_finite(),
        "{why}: nonfinite {a} vs {b}"
    );
    assert!(
        (a - b).abs() <= 2e-8 * a.abs().max(b.abs()).max(1.0),
        "{why}: {a} vs {b}"
    );
}

fn target() -> Vec<u8> {
    let mut rng = Rng::new(0xdecaf);
    (0..W * H * 3).map(|_| rng.int(256) as u8).collect()
}

fn options(alpha: i32) -> FitOptions {
    FitOptions {
        kinds: vec![1, 2, 3, 4, 5, 6],
        alpha,
        bg: Some(0x518fc3),
        ..FitOptions::default()
    }
}

fn random_shape(rng: &mut Rng, k: u8) -> Shape {
    let mut r = rng.int(1441) as i32 - 720;
    // Exact polygon-boundary ties are tested separately with even axis-aligned sides.
    if r.rem_euclid(45) == 0 {
        r += 1;
    }
    Shape {
        k,
        x: rng.int(W + 24) as i32 - 12,
        y: rng.int(H + 24) as i32 - 12,
        w: 2 + rng.int(46) as i32,
        h: 2 + rng.int(38) as i32,
        r,
        a: [1, 24, 128, 254, 255][rng.int(5)],
        c: rng.int(0x1000000) as u32,
        delta: 0.0,
    }
}

fn check_replay(fitter: &Fitter, target: &[u8], shapes: &[Shape]) {
    let mut pixels = canvas(fitter.bg());
    let mut fresh = Fitter::new(
        target.to_vec(),
        W,
        H,
        &FitOptions {
            bg: Some(fitter.bg()),
            ..options(0)
        },
    );
    let prefixes = fitter.prefix_rmse(shapes);
    assert_eq!(prefixes.len(), shapes.len());
    // At multiples of 45 degrees pixel centers can lie exactly on a polygon
    // edge, where direct_mask and the scanline rasterizer may legitimately
    // disagree (see random_shape). Once such a shape is drawn, the independent
    // pixel reference no longer applies; the Fitter replay checks still do.
    let mut direct = true;
    for (i, s) in shapes.iter().enumerate() {
        draw(&mut pixels, s);
        fresh.add(s);
        direct &= s.r.rem_euclid(45) != 0;
        if direct {
            close(
                fresh.error(),
                error(&pixels, target),
                &format!("direct replay prefix {i}: {s:?}"),
            );
        }
        close(prefixes[i], fresh.rmse(), "prefix_rmse");
    }
    close(fitter.error(), fresh.error(), "Fitter replay");
    if direct {
        close(fitter.error(), error(&pixels, target), "direct replay");
        close(
            fitter.rmse(),
            (error(&pixels, target) / (W * H * 3) as f64).sqrt() / 255.0,
            "rmse",
        );
    }
}

#[test]
fn kernel_endpoints_range_monotonicity_and_independent_polynomial() {
    assert_eq!((KIND_RADIAL, KIND_LINEAR, KIND_BAND), (4, 5, 6));
    assert_eq!(gradient_kernel(-100.0), 1.0);
    assert_eq!(gradient_kernel(0.0), 1.0);
    assert_eq!(gradient_kernel(1.0), 0.0);
    assert_eq!(gradient_kernel(100.0), 0.0);
    let mut previous = 1.0;
    for i in 0..=4096 {
        let t = i as f64 / 4096.0;
        let got = gradient_kernel(t);
        assert!((0.0..=1.0).contains(&got));
        assert!(got <= previous);
        assert!((got - kernel(t)).abs() < 1e-14);
        previous = got;
    }
}

#[test]
fn rotated_clipped_raster_and_coverage_match_direct_pixels() {
    let mut rng = Rng::new(917);
    let mut samples = 0;
    for k in [4, 5, 6] {
        let mut cases: Vec<_> = (0..100).map(|_| random_shape(&mut rng, k)).collect();
        cases.extend([
            shape(k, 255),
            Shape {
                x: -100,
                ..shape(k, 128)
            },
            Shape {
                r: 0,
                ..shape(k, 128)
            },
        ]);
        for s in cases {
            let mut lines = vec![-777; H * 3 + 3];
            let rows = rasterize(&s, W, H, &mut lines);
            assert!(rows <= H);
            assert_eq!(&lines[rows * 3..], vec![-777; lines.len() - rows * 3]);
            let mut actual = vec![0.0; W * H];
            let mut seen = vec![false; W * H];
            let mut previous_y = None;
            for line in lines[..rows * 3].chunks_exact(3) {
                let (y, x1, x2) = (line[0] as usize, line[1] as usize, line[2] as usize);
                assert!(y < H && x1 <= x2 && x2 < W, "bad span {line:?}, {s:?}");
                assert!(previous_y.is_none_or(|p| y > p));
                previous_y = Some(y);
                let coverage: Vec<_> = coverage_row(&s, y, x1, x2, W).collect();
                assert_eq!(coverage.len(), x2 - x1 + 1);
                for (offset, (p, mask)) in coverage.into_iter().enumerate() {
                    assert_eq!(p, y * W + x1 + offset);
                    assert!(!seen[p] && mask.is_finite() && (0.0..=1.0).contains(&mask));
                    seen[p] = true;
                    actual[p] = mask;
                    // A nonzero x1 checks that each call starts at the requested pixel.
                    let single = coverage_row(&s, y, p % W, p % W, W).next().unwrap();
                    assert_eq!(single.0, p);
                    assert!((single.1 - mask).abs() < 2e-12);
                    samples += 1;
                }
            }
            for y in 0..H {
                for x in 0..W {
                    let expected = direct_mask(&s, x, y);
                    assert!(
                        (actual[y * W + x] - expected).abs() < 2e-12,
                        "pixel ({x},{y}): {} vs {expected}; {s:?}",
                        actual[y * W + x]
                    );
                }
            }
        }
    }
    assert!(samples > 10_000);
}

#[test]
fn linear_rotation_is_directional_and_band_is_symmetric() {
    let base = Shape {
        x: 10,
        y: 10,
        w: 16,
        h: 16,
        r: 0,
        ..shape(5, 255)
    };
    let at = |s: &Shape, x, y| coverage_row(s, y, x, x, W).next().unwrap().1;
    let left = at(&base, 4, 9);
    let right = at(&base, 15, 9);
    assert!(left > right + 0.5);
    let reversed = Shape { r: 180, ..base };
    close(at(&reversed, 4, 9), right, "180 degrees reverses linear");
    close(at(&reversed, 15, 9), left, "180 degrees reverses linear");
    let ccw = Shape { r: 90, ..base };
    close(
        at(&ccw, 9, 4),
        left,
        "+90: opaque side faces down in Y-up coordinates",
    );
    close(at(&ccw, 9, 15), right, "+90: transparent side faces up");
    close(at(&Shape { r: -270, ..base }, 9, 4), left, "angle wrapping");
    let band = Shape {
        k: KIND_BAND,
        ..base
    };
    close(at(&band, 4, 9), at(&band, 15, 9), "band mirror symmetry");
    close(
        at(&band, 4, 9),
        at(&Shape { r: 180, ..band }, 4, 9),
        "band 180 periodicity",
    );

    // Search/mutation must preserve linear's 360-degree period, not fold it to 180.
    let fit = Fitter::new(
        target(),
        W,
        H,
        &FitOptions {
            kinds: vec![5],
            ..options(0)
        },
    );
    let mut rng = Rng::new(1);
    let mut upper_half = 0;
    for _ in 0..100 {
        let s = fit.random_shape(&mut rng);
        assert_eq!(s.k, 5);
        assert!((0..360).contains(&s.r));
        upper_half += usize::from(s.r >= 180);
    }
    assert!(upper_half > 20);
    let mut preserved = 0;
    for _ in 0..100 {
        let s = fit.mutate(&Shape { r: 270, ..base }, &mut rng);
        preserved += usize::from(s.r >= 180);
    }
    assert!(preserved > 50);
}

#[test]
fn evaluate_optimal_color_and_delta_match_bruteforce_each_channel() {
    let target = target();
    let mut fit = Fitter::new(target.clone(), W, H, &options(0));
    let mut pixels = canvas(fit.bg());
    let mut rng = Rng::new(301);
    for i in 0..12 {
        let s = random_shape(&mut rng, 4 + (i % 3) as u8);
        fit.add(&s);
        draw(&mut pixels, &s);
    }
    close(
        fit.error(),
        error(&pixels, &target),
        "preexisting soft layers",
    );
    let mut scratch = fit.scratch();
    let before = fit.error();
    let mut finite = [0; 3];
    for k in [4, 5, 6] {
        for i in 0..60 {
            let mut s = if i == 0 {
                shape(k, 255)
            } else {
                random_shape(&mut rng, k)
            };
            let weights: Vec<_> = (0..W * H)
                .map(|p| direct_mask(&s, p % W, p / W) * s.a as f64 / 255.0)
                .collect();
            let delta = fit.evaluate(&mut s, &mut scratch);
            let den: f64 = weights.iter().map(|a| a * a).sum();
            if den <= 1e-20 {
                assert_eq!(delta, f64::INFINITY, "empty coverage: {s:?}");
                continue;
            }
            finite[(k - 4) as usize] += 1;
            let mut optimum_delta = 0.0;
            for c in 0..3 {
                let channel_loss = |color: u32| -> f64 {
                    weights
                        .iter()
                        .enumerate()
                        .map(|(p, a)| {
                            let v = pixels[p * 3 + c] * (1.0 - a) + *a * color as f64;
                            (v - target[p * 3 + c] as f64).powi(2)
                        })
                        .sum()
                };
                let best = (0..=255).map(channel_loss).fold(f64::INFINITY, f64::min);
                let chosen = (s.c >> (16 - 8 * c)) & 255;
                assert!(
                    (channel_loss(chosen) - best).abs() < 1e-6,
                    "channel {c}: color {chosen} not brute-force optimum; {s:?}"
                );
                let old: f64 = (0..W * H)
                    .map(|p| (pixels[p * 3 + c] - target[p * 3 + c] as f64).powi(2))
                    .sum();
                optimum_delta += best - old;
            }
            close(delta, optimum_delta, &format!("brute-force delta {s:?}"));
            let mut painted = pixels.clone();
            draw(&mut painted, &s);
            close(
                delta,
                error(&painted, &target) - before,
                "direct painted delta",
            );
            close(fit.error(), before, "evaluate must be read-only");
        }
    }
    assert!(
        finite.iter().all(|&n| n >= 15),
        "not enough visible randomized cases: {finite:?}"
    );
}

#[test]
fn zero_alpha_and_offscreen_gradients_are_noops() {
    let data = target();
    let mut fit = Fitter::new(data.clone(), W, H, &options(0));
    let before = fit.error();
    let mut scratch = fit.scratch();
    for k in [4, 5, 6] {
        for mut s in [
            shape(k, 0),
            Shape {
                x: -100,
                ..shape(k, 255)
            },
        ] {
            assert_eq!(fit.evaluate(&mut s, &mut scratch), f64::INFINITY);
            fit.add(&s);
            close(fit.error(), before, "zero influence");
        }
    }
}

#[test]
fn refine_auto_fixed_and_opaque_alpha_is_monotone_and_replayable() {
    let data = target();
    for alpha in [0, 128, 255] {
        let mut fit = Fitter::new(data.clone(), W, H, &options(alpha));
        let mut shapes = Vec::new();
        // alpha=0 means automatic search. Also include literal transparent layers below.
        for (i, k) in [1, 2, 3, 4, 5, 6, 4, 5, 6].into_iter().enumerate() {
            let s = Shape {
                x: 6 + (i % 4) as i32 * 4,
                y: 7 + (i % 3) as i32 * 3,
                r: 17 + i as i32 * 13,
                a: if alpha == 0 {
                    [0, 128, 255][i % 3]
                } else {
                    alpha
                },
                ..shape(k, 128)
            };
            fit.add(&s);
            shapes.push(s);
        }
        let seen = AtomicUsize::new(0);
        let before = fit.error();
        let untouched_tail = shapes[4..].to_vec();
        let passes = run_refine(
            &mut fit,
            &mut shapes,
            2,
            QUICK,
            7,
            2,
            |pass, n| {
                assert_eq!(pass, 0);
                seen.store(n, Ordering::Relaxed);
            },
            || seen.load(Ordering::Relaxed) >= 4,
        );
        assert_eq!(passes, 0);
        assert_eq!(seen.load(Ordering::Relaxed), 4);
        assert_eq!(&shapes[4..], untouched_tail);
        assert!(
            fit.error() <= before + 1e-6,
            "partial refine: alpha={alpha}: {before} -> {}",
            fit.error()
        );
        check_replay(&fit, &data, &shapes);
        for pass in 0..2 {
            let before = fit.error();
            assert_eq!(
                run_refine(
                    &mut fit,
                    &mut shapes,
                    1,
                    QUICK,
                    9 + pass,
                    2,
                    |_, _| {},
                    || false
                ),
                1
            );
            assert!(
                fit.error() <= before + 1e-6,
                "refine alpha={alpha} pass={pass}: {before} -> {}",
                fit.error()
            );
            assert!(shapes
                .iter()
                .all(|s| s.delta.is_finite() && s.c <= 0xffffff));
            if alpha > 0 {
                assert!(shapes.iter().all(|s| s.a == alpha));
            }
            check_replay(&fit, &data, &shapes);
        }
    }
}

#[test]
fn opaque_occlusion_and_600_repeated_alpha_overlaps_remain_finite() {
    let data = target();
    for opaque_cap in [false, true] {
        let mut fit = Fitter::new(data.clone(), W, H, &options(0));
        let mut shapes = Vec::new();
        for i in 0..600 {
            // All 600 masks are exactly 1 in the central plateau. (127/255)^600
            // underflows when squared, exercising recovery from tiny transmittance.
            let s = Shape {
                k: [1, 6][i % 2],
                w: 96,
                h: 80,
                r: 19,
                c: if i % 2 == 0 { 0xe01030 } else { 0x20b0f0 },
                ..shape(4, 128)
            };
            fit.add(&s);
            shapes.push(s);
        }
        if opaque_cap {
            for _ in 0..2 {
                let s = Shape {
                    w: 96,
                    h: 80,
                    r: 0,
                    ..shape(1, 255)
                };
                fit.add(&s);
                shapes.push(s);
            }
        }
        check_replay(&fit, &data, &shapes);
        let before = fit.error();
        let colors_only = Budget { age: 0, ..QUICK };
        assert_eq!(
            run_refine(
                &mut fit,
                &mut shapes,
                2,
                colors_only,
                11,
                2,
                |_, _| {},
                || false
            ),
            2
        );
        assert!(fit.error().is_finite() && fit.rmse().is_finite());
        assert!(
            fit.error() <= before + 1e-6,
            "opaque_cap={opaque_cap}: {before} -> {}",
            fit.error()
        );
        assert!(shapes
            .iter()
            .all(|s| s.delta.is_finite() && s.c <= 0xffffff));
        check_replay(&fit, &data, &shapes);
    }
}

#[test]
fn run_fit_gradient_groups_determinism_progress_and_midstream_stop() {
    let data = target();
    for kinds in [vec![4], vec![5], vec![6], vec![1, 2, 3, 4, 5, 6]] {
        let opts = FitOptions {
            kinds: kinds.clone(),
            ..options(0)
        };
        let mut fit = Fitter::new(data.clone(), W, H, &opts);
        let mut last = fit.error();
        let seen = AtomicUsize::new(0);
        let shapes = run_fit(
            &mut fit,
            8,
            QUICK,
            1,
            2,
            |s, i, state| {
                assert_eq!(i, seen.load(Ordering::Relaxed));
                assert!(kinds.contains(&s.k) && s.delta.is_finite() && s.delta < 0.0);
                close(state.error() - last, s.delta, "accepted delta");
                assert!(state.error() < last);
                last = state.error();
                seen.store(i + 1, Ordering::Relaxed);
            },
            || seen.load(Ordering::Relaxed) >= 4,
        );
        assert_eq!(shapes.len(), 4);
        check_replay(&fit, &data, &shapes);
        let mut second = Fitter::new(data.clone(), W, H, &opts);
        let repeated = run_fit(&mut second, 4, QUICK, 1, 2, |_, _, _| {}, || false);
        assert_eq!(shapes, repeated, "same seed/threads: {kinds:?}");
        assert_eq!(fit.error(), second.error());
        let before = fit.error();
        assert!(run_fit(
            &mut fit,
            4,
            QUICK,
            1,
            2,
            |_, _, _| panic!("stopped callback"),
            || true
        )
        .is_empty());
        assert_eq!(fit.error(), before);
        let mut all = shapes;
        all.extend(run_fit(&mut fit, 2, QUICK, 2, 2, |_, _, _| {}, || false));
        check_replay(&fit, &data, &all);
    }
}

#[test]
fn measured_fixture_reports_actual_kernel_errors() {
    // Recomputed 2026-11-15 from 9 x 65 alpha_255 samples, in alpha-byte units:
    // asset    actual max  actual RMSE
    // 106055   2.500000    0.867359
    // 106056   1.688967    0.638509
    // 106057   1.500000    0.346756
    // 106091   0.981670    0.376367
    // 106092   0.952366    0.420124
    // 106093   0.945550    0.418551
    // 106094   1.389875    0.501609
    // 106095   1.505941    0.544466
    // 106096   0.770571    0.307194
    // These bounds apply to the supplied body-profile series, not raw atlas edges.
    // Raw edge max: 106091=3.344178, 106094=2.967805; 106092/3/5=255,
    // 106096=120. Radial raw-edge series are null. Always recompute below.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/gradient_primitives.json");
    // Runtime read permits independent fixture copying without a compile-time dependency.
    let text =
        std::fs::read_to_string(&path).expect("gradient measurement fixture must be present");
    let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();
    let mut count = 0;
    for id in [
        "106055", "106056", "106057", "106091", "106092", "106093", "106094", "106095", "106096",
    ] {
        let asset = &fixture["assets"][id];
        let samples = &asset["samples_65"];
        let us = samples["u"].as_array().unwrap();
        let measured = samples["alpha_255"].as_array().unwrap();
        let normalized = samples["alpha_norm"].as_array().unwrap();
        // Radial probes have no separate raw edge series (JSON null).
        let raw = samples["raw_edge_alpha_255"].as_array();
        assert_eq!(us.len(), 65);
        assert_eq!(samples["sample_count"].as_u64(), Some(65));
        assert_eq!((measured.len(), normalized.len()), (65, 65));
        if let Some(raw) = raw {
            assert_eq!(raw.len(), 65);
        }
        let mut max = 0.0_f64;
        let mut sum_sq = 0.0;
        let mut raw_max = 0.0_f64;
        let mut worst_u = 0.0;
        for i in 0..us.len() {
            let u = us[i].as_f64().unwrap();
            assert_eq!(u, i as f64 / 64.0);
            let s = match id {
                "106091" | "106094" => ((2.0 * u - 1.0).abs() - 0.145) / 0.83,
                "106092" | "106095" => (1.0 - u - 0.12) / 0.86,
                "106093" | "106096" => (u - 0.12) / 0.86,
                _ => u,
            };
            let predicted = 255.0 * gradient_kernel(s);
            let measured = measured[i].as_f64().unwrap();
            assert!((0.0..=255.0).contains(&measured));
            assert!((normalized[i].as_f64().unwrap() * 255.0 - measured).abs() <= 0.01);
            let e = (predicted - measured).abs();
            if e > max {
                max = e;
                worst_u = u;
            }
            sum_sq += e * e;
            if let Some(raw) = raw {
                raw_max = raw_max.max((predicted - raw[i].as_f64().unwrap()).abs());
            }
        }
        let declared = asset["fit_formula"]["max_abs_error_alpha255"]
            .as_f64()
            .unwrap();
        let raw_report = raw
            .map(|_| format!("{raw_max:.6}"))
            .unwrap_or_else(|| "unavailable".into());
        println!("asset={id} n=65 actual_max_alpha255={max:.6} at_u={worst_u:.6} actual_rmse_alpha255={:.6} declared_max_alpha255={declared:.6} actual_minus_declared={:.6} raw_edge_max_alpha255={raw_report}", (sum_sq / 65.0).sqrt(), max - declared);
        // Independent acceptance limits, NOT thresholds copied from the declared maxima.
        assert!(
            max <= if id <= "106057" { 3.0 } else { 2.0 },
            "measured kernel regression asset={id}: actual max {max}"
        );
        // Declared maxima are rounded to 0.01 alpha; fail genuine underreporting.
        assert!(
            max <= declared + 0.0051,
            "underreported bound asset={id}: actual={max}, declared={declared}"
        );
        count += us.len();
    }
    assert_eq!(count, 585);
}
