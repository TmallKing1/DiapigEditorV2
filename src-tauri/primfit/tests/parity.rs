//! 与 In Falsus 制谱器 primfit.js 对拍。fixtures/parity.json 由那份 JS 生成：
//! 随机数序列、目标图缩小结果，以及约 2000 个图元的扫描线、误差变化量和最优颜色。

use primfit::{average_color, prepare_target, rasterize, seed_for, FitOptions, Fitter, Rng, Shape};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/parity.json")).expect("fixture 不是合法 JSON")
}

fn ints(v: &Value) -> Vec<i64> {
    v.as_array().unwrap().iter().map(|x| x.as_i64().unwrap()).collect()
}

fn close(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol * a.abs().max(b.abs()).max(1.0)
}

#[test]
fn rng_matches_js() {
    let f = fixture();
    let r = &f["rng"];
    let mut rng = Rng::new(r["seed"].as_u64().unwrap() as u32);
    for v in r["next"].as_array().unwrap() {
        assert_eq!(rng.next(), v.as_f64().unwrap());
    }
    for v in ints(&r["ints"]) {
        assert_eq!(rng.int(361) as i64, v);
    }
    for v in r["normal"].as_array().unwrap() {
        assert!(close(rng.normal(), v.as_f64().unwrap(), 1e-12));
    }
    for row in r["seeds"].as_array().unwrap() {
        let row = ints(row);
        assert_eq!(seed_for(row[0] as u32, row[1] as u32, row[2] as u32) as i64, row[3]);
    }
}

#[test]
fn target_matches_js() {
    let f = fixture();
    let t = &f["target"];
    let rgba: Vec<u8> = ints(&t["rgba"]).into_iter().map(|v| v as u8).collect();
    let (sw, sh) = (t["width"].as_u64().unwrap() as usize, t["height"].as_u64().unwrap() as usize);
    for case in t["cases"].as_array().unwrap() {
        let got = prepare_target(&rgba, sw, sh, case["size"].as_u64().unwrap() as usize, case["matte"].as_u64().unwrap() as u32);
        assert_eq!(got.width as u64, case["width"].as_u64().unwrap());
        assert_eq!(got.height as u64, case["height"].as_u64().unwrap());
        let want: Vec<u8> = ints(&case["data"]).into_iter().map(|v| v as u8).collect();
        assert_eq!(got.data, want);
        assert_eq!(average_color(&got.data) as u64, case["average"].as_u64().unwrap());
    }
}

#[test]
fn raster_and_evaluate_match_js() {
    let f = fixture();
    let fit = &f["fit"];
    let (w, h) = (fit["width"].as_u64().unwrap() as usize, fit["height"].as_u64().unwrap() as usize);
    let target: Vec<u8> = ints(&fit["target"]).into_iter().map(|v| v as u8).collect();
    let options = FitOptions { kinds: vec![1, 2, 3], ..FitOptions::default() };
    let mut fitter = Fitter::new(target, w, h, &options);
    assert_eq!(fitter.bg() as u64, fit["bg"].as_u64().unwrap());
    assert!(close(fitter.error(), fit["initialError"].as_f64().unwrap(), 1e-12));

    for row in fit["added"].as_array().unwrap() {
        let v = ints(row);
        fitter.add(&Shape {
            k: v[0] as u8,
            x: v[1] as i32,
            y: v[2] as i32,
            w: v[3] as i32,
            h: v[4] as i32,
            r: v[5] as i32,
            a: v[6] as i32,
            c: v[7] as u32,
            delta: 0.0,
        });
    }
    assert!(close(fitter.error(), fit["errorAfter"].as_f64().unwrap(), 1e-9));
    assert!(close(fitter.rmse(), fit["rmse"].as_f64().unwrap(), 1e-9));

    let mut scratch = fitter.scratch();
    let mut lines = vec![0i32; h * 3];
    let probes = fit["probes"].as_array().unwrap();
    assert!(probes.len() >= 2000);
    for (i, p) in probes.iter().enumerate() {
        let v = ints(&p["s"]);
        let mut s = Shape {
            k: v[0] as u8,
            x: v[1] as i32,
            y: v[2] as i32,
            w: v[3] as i32,
            h: v[4] as i32,
            r: v[5] as i32,
            a: v[6] as i32,
            c: 0,
            delta: 0.0,
        };
        let n = rasterize(&s, w, h, &mut lines);
        let want: Vec<i32> = ints(&p["lines"]).into_iter().map(|v| v as i32).collect();
        assert_eq!(&lines[..n * 3], &want[..], "第 {i} 个图元的扫描线不一致：{s:?}");
        let delta = fitter.evaluate(&mut s, &mut scratch);
        match p["delta"].as_f64() {
            Some(want) => {
                assert!(close(delta, want, 1e-9), "第 {i} 个图元的误差变化量不一致：{delta} / {want}，{s:?}");
                assert_eq!(s.c as u64, p["c"].as_u64().unwrap(), "第 {i} 个图元的颜色不一致：{s:?}");
            }
            None => assert!(delta.is_infinite(), "第 {i} 个图元应当不覆盖任何像素：{s:?}"),
        }
    }
}
