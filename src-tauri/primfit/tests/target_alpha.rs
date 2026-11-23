use primfit::{prepare_target, prepare_target_alpha, run_fit, FitOptions, Fitter, BUDGET_FAST};

#[test]
fn transparent_rgb_is_ignored() {
    let garbage = [
        255, 0, 127, 0, 0, 255, 255, 0, 17, 33, 91, 0, 255, 255, 255, 0,
    ];
    for size in [1, 2, 16] {
        let target = prepare_target_alpha(&garbage, 2, 2, size);
        let clean = prepare_target_alpha(&[0; 16], 2, 2, size);
        assert_eq!(target.data, clean.data);
        assert_eq!(target.alpha, clean.alpha);
        assert!(target.data.iter().chain(&target.alpha).all(|&v| v == 0));
    }
}

#[test]
fn area_average_matches_exact_fractional_pixel_coverage() {
    // Integer overlaps provide an independent reference, including source rows shared by outputs.
    for (sw, sh, size, width, height) in [(7, 5, 3, 3, 2), (19, 17, 5, 5, 4), (5, 7, 3, 2, 3)] {
        let rgba: Vec<u8> = (0..sw * sh * 4)
            .map(|i| ((i * 73 + i / 4 * 29) % 256) as u8)
            .collect();
        let target = prepare_target_alpha(&rgba, sw, sh, size);
        assert_eq!((target.width, target.height), (width, height));
        for y in 0..height {
            for x in 0..width {
                let mut sums = [0u64; 4];
                for sy in 0..sh {
                    let dy = ((y + 1) * sh)
                        .min((sy + 1) * height)
                        .saturating_sub((y * sh).max(sy * height));
                    for sx in 0..sw {
                        let dx = ((x + 1) * sw)
                            .min((sx + 1) * width)
                            .saturating_sub((x * sw).max(sx * width));
                        let px = &rgba[(sy * sw + sx) * 4..][..4];
                        let weighted_alpha = px[3] as u64 * dx as u64 * dy as u64;
                        for c in 0..3 {
                            sums[c] += px[c] as u64 * weighted_alpha;
                        }
                        sums[3] += weighted_alpha;
                    }
                }
                let dst = (height - 1 - y) * width + x;
                let area = (sw * sh) as u64;
                for c in 0..3 {
                    assert_eq!(
                        target.data[dst * 3 + c],
                        ((sums[c] + 255 * area / 2) / (255 * area)) as u8
                    );
                    assert!(target.data[dst * 3 + c] <= target.alpha[dst]);
                }
                assert_eq!(target.alpha[dst], ((sums[3] + area / 2) / area) as u8);
            }
        }
    }
}

#[test]
fn premultiplication_and_both_average_passes_round_only_once() {
    // Rounding each premultiplied source pixel first would incorrectly produce RGB = 1.
    let rgba = [
        1, 1, 1, 128, 1, 1, 1, 128, 255, 255, 255, 0, 255, 255, 255, 0,
    ];
    let target = prepare_target_alpha(&rgba, 2, 2, 1);
    assert_eq!(target.data, [0, 0, 0]);
    assert_eq!(target.alpha, [64]);

    // Rounding the horizontal pass first would incorrectly retain a pixel with Alpha = 1.
    let rgba = [255, 255, 255, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let target = prepare_target_alpha(&rgba, 2, 2, 1);
    assert_eq!(target.data, [0, 0, 0]);
    assert_eq!(target.alpha, [0]);
}

#[test]
fn colored_edge_keeps_coverage_without_hidden_color_bleeding() {
    let target = prepare_target_alpha(&[255, 0, 0, 255, 0, 255, 255, 0], 2, 1, 1);
    assert_eq!((target.width, target.height), (1, 1));
    assert_eq!(target.data, [128, 0, 0]);
    assert_eq!(target.alpha, [128]);
    // Unpremultiplication for preview recovers full red, not a dark or cyan edge.
    assert_eq!(target.data[0] as u32 * 255 / target.alpha[0] as u32, 255);
}

#[test]
fn antialiased_white_edge_has_no_dark_halo() {
    let rgba = [
        255, 255, 255, 255, 255, 255, 255, 128, 255, 255, 255, 64, 0, 79, 255, 0,
    ];
    let target = prepare_target_alpha(&rgba, 4, 1, 1);
    assert_eq!(target.alpha, [112]);
    assert_eq!(target.data, [112, 112, 112]);
    for &v in &target.data {
        assert_eq!(v as u32 * 255 / target.alpha[0] as u32, 255);
    }
}

#[test]
fn alpha_and_rgb_share_bottom_up_rows_without_upscaling() {
    let target = prepare_target_alpha(&[255, 0, 0, 128, 0, 255, 0, 64], 1, 2, 512);
    assert_eq!((target.width, target.height), (1, 2));
    assert_eq!(target.data, [0, 64, 0, 128, 0, 0]);
    assert_eq!(target.alpha, [64, 128]);
}

#[test]
fn opaque_target_matches_existing_path_for_every_matte() {
    let rgba: Vec<u8> = (0..35)
        .flat_map(|i| [(i * 7) as u8, (i * 13) as u8, (i * 19) as u8, 255])
        .collect();
    for size in [1, 3, 7, 512] {
        let target = prepare_target_alpha(&rgba, 7, 5, size);
        assert!(target.alpha.iter().all(|&v| v == 255));
        for matte in [0, 0xFF_FFFF, 0x123456] {
            let opaque = prepare_target(&rgba, 7, 5, size, matte);
            assert_eq!((target.width, target.height), (opaque.width, opaque.height));
            assert_eq!(target.data, opaque.data);
        }
    }
}

#[test]
fn existing_translucent_target_still_composites_matte() {
    let rgba = [255, 0, 0, 128, 0, 255, 0, 0];
    assert_eq!(prepare_target(&rgba, 2, 1, 1, 0).data, [64, 0, 0]);
    assert_eq!(
        prepare_target(&rgba, 2, 1, 1, 0xFF_FFFF).data,
        [255, 191, 191]
    );
    assert_eq!(prepare_target(&rgba, 2, 1, 1, 0x123456).data, [77, 39, 64]);
}

#[test]
fn fully_transparent_target_finishes_with_zero_shapes_and_perfect_similarity() {
    let target = prepare_target_alpha(&[255, 17, 93, 0].repeat(16), 4, 4, 4);
    let options = FitOptions::default();
    let mut fitter = Fitter::new_alpha(
        target.data,
        target.width,
        target.height,
        target.alpha,
        &options,
    );
    assert_eq!(fitter.bg_alpha(), 0);
    assert_eq!(1.0 - fitter.rmse(), 1.0);
    let shapes = run_fit(
        &mut fitter,
        10,
        BUDGET_FAST,
        1,
        1,
        |_, _, _| panic!("transparent target needs no shapes"),
        || false,
    );
    assert!(shapes.is_empty());
    assert_eq!(1.0 - fitter.rmse(), 1.0);
    let opaque = Fitter::new(vec![0; 4 * 4 * 3], 4, 4, &options);
    assert_eq!(opaque.bg_alpha(), 255);
}
