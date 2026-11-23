//! 扫描线光栅化：按像素中心采样，像素 (px, py) 的中心为 (px + 0.5, py + 0.5)，Y 向上。

use std::sync::OnceLock;

pub const KIND_RECT: u8 = 1;
pub const KIND_ELLIPSE: u8 = 2;
pub const KIND_TRIANGLE: u8 = 3;
pub const KIND_RADIAL: u8 = 4;
pub const KIND_LINEAR: u8 = 5;
pub const KIND_BAND: u8 = 6;

/// 实机标定的主体衰减核；线性素材的约 1px 图集保护边不在模型内。
pub fn gradient_kernel(s: f64) -> f64 {
    if s <= 0.0 { 1.0 } else if s >= 1.0 { 0.0 } else { 1.0 - 0.5*s - 1.5*s*s + s*s*s }
}

/// 扫描线上的覆盖率；只在起点做坐标变换，之后逐像素递增。
pub fn coverage_row(s: &Shape, y: usize, x1: usize, x2: usize, width: usize) -> impl Iterator<Item=(usize, f64)> {
    let (cos, sin) = trig(s.r);
    let dx = x1 as f64 + 0.5 - s.x as f64;
    let dy = y as f64 + 0.5 - s.y as f64;
    let mut lx = dx*cos + dy*sin;
    let mut ly = -dx*sin + dy*cos;
    let shape = *s;
    (x1..=x2).map(move |x| {
        let m = match shape.k {
            1..=3 => 1.0,
            KIND_RADIAL => gradient_kernel(((2.0*lx/shape.w as f64).powi(2) + (2.0*ly/shape.h as f64).powi(2)).sqrt()),
            KIND_LINEAR => gradient_kernel((lx/shape.w as f64 + 0.5 - 0.120)/0.860),
            KIND_BAND => gradient_kernel(((2.0*lx/shape.w as f64).abs() - 0.145)/0.830),
            _ => unreachable!("未知图元类型"),
        };
        lx += cos;
        ly -= sin;
        (y*width+x, m)
    })
}

/// 一个图元。坐标与引擎一致：(x, y) 是中心，w / h 是 sizeDelta（椭圆为两轴直径，三角形为底边宽与高，
/// 尖顶在局部 +Y），r 是旋转角（度，逆时针为正），a 是不透明度 1–255，c 是颜色 0xRRGGBB。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shape {
    pub k: u8,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub r: i32,
    pub a: i32,
    pub c: u32,
    /// 加上这个图元后整图平方误差的变化量（搜索时填写）
    pub delta: f64,
}

/// 旋转角总是整数度，正弦余弦查表，搜索循环里不再算三角函数。
pub(crate) fn trig(r: i32) -> (f64, f64) {
    static TABLE: OnceLock<Vec<(f64, f64)>> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        (0..360)
            .map(|d| {
                let th = d as f64 * std::f64::consts::PI / 180.0;
                (th.cos(), th.sin())
            })
            .collect()
    });
    table[r.rem_euclid(360) as usize]
}

/// 写入 out[3i..3i+3] = [行, 起始列, 结束列]（闭区间，已裁到画面内），返回行数。out 至少要有 height × 3 个元素。
pub fn rasterize(s: &Shape, width: usize, height: usize, out: &mut [i32]) -> usize {
    assert!(s.k <= KIND_BAND, "未知图元类型");
    rasterize_scaled(s, 1.0, width, height, out)
}

/// 同 rasterize，但图元的中心与宽高先乘 scale（在缩小 1/scale 倍的画面上取扫描线）。
/// 软边图元取外接形状：径向按椭圆，单向与光带按矩形。
pub(crate) fn rasterize_scaled(s: &Shape, scale: f64, width: usize, height: usize, out: &mut [i32]) -> usize {
    let kind = match s.k {
        KIND_RADIAL => KIND_ELLIPSE,
        KIND_LINEAR | KIND_BAND => KIND_RECT,
        k => k,
    };
    let mut n = 0;
    let (cos, sin) = trig(s.r);
    let (sx, sy) = (s.x as f64 * scale, s.y as f64 * scale);
    let (sw, sh) = (s.w as f64 * scale, s.h as f64 * scale);
    let last_col = width as f64 - 1.0;
    let last_row = height as f64 - 1.0;
    let mut emit = |y: i32, xl: f64, xr: f64| {
        let x1 = (xl - 0.5).ceil().max(0.0);
        let x2 = (xr - 0.5).floor().min(last_col);
        if x1 <= x2 {
            out[n * 3] = y;
            out[n * 3 + 1] = x1 as i32;
            out[n * 3 + 2] = x2 as i32;
            n += 1;
        }
    };

    if kind == KIND_ELLIPSE {
        let a = sw / 2.0;
        let b = sh / 2.0;
        let ia2 = 1.0 / (a * a);
        let ib2 = 1.0 / (b * b);
        let qa = cos * cos * ia2 + sin * sin * ib2;
        let bk = 2.0 * sin * cos * (ia2 - ib2);
        let ck = sin * sin * ia2 + cos * cos * ib2;
        let hy = (a * a * sin * sin + b * b * cos * cos).sqrt();
        let y0 = (sy - hy - 0.5).ceil().max(0.0) as i32;
        let y1 = (sy + hy - 0.5).floor().min(last_row) as i32;
        for y in y0..=y1 {
            let dy = y as f64 + 0.5 - sy;
            let qb = bk * dy;
            let qc = ck * dy * dy - 1.0;
            let disc = qb * qb - 4.0 * qa * qc;
            if disc < 0.0 {
                continue;
            }
            let q = disc.sqrt();
            emit(y, sx + (-qb - q) / (2.0 * qa), sx + (-qb + q) / (2.0 * qa));
        }
        drop(emit);
        return n;
    }

    // 矩形四角 / 三角形三顶点（局部坐标，尖顶在 +Y）→ 旋转后平移到中心。
    let hw = sw / 2.0;
    let hh = sh / 2.0;
    let mut corners = [0.0f64; 8];
    let count = if kind == KIND_RECT {
        corners = [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
        4
    } else {
        corners[..6].copy_from_slice(&[0.0, hh, -hw, -hh, hw, -hh]);
        3
    };
    let mut ymin = f64::INFINITY;
    let mut ymax = f64::NEG_INFINITY;
    for i in 0..count {
        let (lx, ly) = (corners[i * 2], corners[i * 2 + 1]);
        let x = sx + lx * cos - ly * sin;
        let y = sy + lx * sin + ly * cos;
        corners[i * 2] = x;
        corners[i * 2 + 1] = y;
        if y < ymin {
            ymin = y;
        }
        if y > ymax {
            ymax = y;
        }
    }
    let y0 = (ymin - 0.5).ceil().max(0.0) as i32;
    let y1 = (ymax - 0.5).floor().min(last_row) as i32;
    for y in y0..=y1 {
        let yc = y as f64 + 0.5;
        let mut xl = f64::INFINITY;
        let mut xr = f64::NEG_INFINITY;
        for i in 0..count {
            let j = (i + 1) % count;
            let (ax, ay, bx, by) = (corners[i * 2], corners[i * 2 + 1], corners[j * 2], corners[j * 2 + 1]);
            if (yc - ay) * (yc - by) > 0.0 || ay == by {
                continue;
            }
            let x = ax + (bx - ax) * (yc - ay) / (by - ay);
            if x < xl {
                xl = x;
            }
            if x > xr {
                xr = x;
            }
        }
        if xl <= xr {
            emit(y, xl, xr);
        }
    }
    drop(emit);
    n
}

/// 抗锯齿覆盖每个像素行取的子扫描线条数。
pub const AA_SUB: usize = 4;

/// 一段连续像素：第 y 行 x1..=x2（闭区间），每个像素的覆盖率都是 m（0 < m ≤ 1）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Span {
    pub y: usize,
    pub x1: usize,
    pub x2: usize,
    pub m: f64,
}

/// 一个图元覆盖到的像素，按行、按列递增排列。
///
/// 不开抗锯齿时（或软边图元）就是 rasterize 的扫描线，m = 1，软边的衰减由 coverage_row 给出。
/// 开抗锯齿时，硬边图元每个像素行取 AA_SUB 条子扫描线，每条子线在横向上与像素求精确的重叠长度，
/// 覆盖率 = 平均重叠长度：内部像素合成一段 m = 1，边缘像素各占一段（编辑器预览与游戏都按面积覆盖绘制，
/// 只按像素中心采样时细长图元可以从像素中心之间穿过去不被罚分）。
#[derive(Default)]
pub struct Cover {
    /// rasterize 的扫描线（软边图元或不开抗锯齿时有效），以及软边评估用的扫描线缓冲
    pub lines: Vec<i32>,
    pub spans: Vec<Span>,
}

impl Cover {
    /// 计算图元 s 的覆盖；返回是否覆盖到任何像素。
    pub fn compute(&mut self, s: &Shape, width: usize, height: usize, aa: bool) -> bool {
        if self.lines.len() < height * 3 {
            self.lines.resize(height * 3, 0);
        }
        self.spans.clear();
        if aa && s.k <= KIND_TRIANGLE {
            aa_spans(s, width, height, &mut self.spans);
        } else {
            let rows = rasterize(s, width, height, &mut self.lines);
            for l in self.lines[..rows * 3].chunks_exact(3) {
                self.spans.push(Span { y: l[0] as usize, x1: l[1] as usize, x2: l[2] as usize, m: 1.0 });
            }
        }
        !self.spans.is_empty()
    }

    /// 覆盖到的第一行与最后一行
    pub fn rows(&self) -> Option<(usize, usize)> {
        Some((self.spans.first()?.y, self.spans.last()?.y))
    }

    /// 逐像素 (像素下标, 覆盖率)，按像素下标递增。软边图元乘上 coverage_row 给出的衰减。
    pub fn pixels<'a>(&'a self, s: &'a Shape, width: usize) -> impl Iterator<Item = (usize, f64)> + 'a {
        self.spans.iter().flat_map(move |sp| coverage_row(s, sp.y, sp.x1, sp.x2, width).map(move |(p, k)| (p, k * sp.m)))
    }
}

/// 硬边图元在某条水平线上的横向区间
enum Outline {
    Ellipse { sx: f64, sy: f64, qa: f64, bk: f64, ck: f64 },
    /// 非水平的边：(端点 y 较小值, 较大值, 该端点处 x 的参考点 ax、ay, 斜率 dx/dy)
    Polygon { edges: [(f64, f64, f64, f64, f64); 4], count: usize },
}

impl Outline {
    fn new(s: &Shape) -> (Self, f64, f64) {
        let (cos, sin) = trig(s.r);
        let (sx, sy) = (s.x as f64, s.y as f64);
        let (sw, sh) = (s.w as f64, s.h as f64);
        if s.k == KIND_ELLIPSE {
            let a = sw / 2.0;
            let b = sh / 2.0;
            let (ia2, ib2) = (1.0 / (a * a), 1.0 / (b * b));
            let hy = (a * a * sin * sin + b * b * cos * cos).sqrt();
            let outline = Outline::Ellipse {
                sx,
                sy,
                qa: cos * cos * ia2 + sin * sin * ib2,
                bk: 2.0 * sin * cos * (ia2 - ib2),
                ck: sin * sin * ia2 + cos * cos * ib2,
            };
            return (outline, sy - hy, sy + hy);
        }
        let (hw, hh) = (sw / 2.0, sh / 2.0);
        let mut corners = [0.0f64; 8];
        let count = if s.k == KIND_RECT {
            corners = [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
            4
        } else {
            corners[..6].copy_from_slice(&[0.0, hh, -hw, -hh, hw, -hh]);
            3
        };
        let (mut ymin, mut ymax) = (f64::INFINITY, f64::NEG_INFINITY);
        for i in 0..count {
            let (lx, ly) = (corners[i * 2], corners[i * 2 + 1]);
            corners[i * 2] = sx + lx * cos - ly * sin;
            corners[i * 2 + 1] = sy + lx * sin + ly * cos;
            ymin = ymin.min(corners[i * 2 + 1]);
            ymax = ymax.max(corners[i * 2 + 1]);
        }
        let mut edges = [(0.0, 0.0, 0.0, 0.0, 0.0); 4];
        let mut n = 0;
        for i in 0..count {
            let j = (i + 1) % count;
            let (ax, ay, bx, by) = (corners[i * 2], corners[i * 2 + 1], corners[j * 2], corners[j * 2 + 1]);
            if ay != by {
                edges[n] = (ay.min(by), ay.max(by), ax, ay, (bx - ax) / (by - ay));
                n += 1;
            }
        }
        (Outline::Polygon { edges, count: n }, ymin, ymax)
    }

    fn span(&self, yc: f64) -> Option<(f64, f64)> {
        match *self {
            Outline::Ellipse { sx, sy, qa, bk, ck } => {
                let dy = yc - sy;
                let qb = bk * dy;
                let disc = qb * qb - 4.0 * qa * (ck * dy * dy - 1.0);
                if disc < 0.0 {
                    return None;
                }
                let q = disc.sqrt();
                Some((sx + (-qb - q) / (2.0 * qa), sx + (-qb + q) / (2.0 * qa)))
            }
            Outline::Polygon { edges, count } => {
                let (mut xl, mut xr) = (f64::INFINITY, f64::NEG_INFINITY);
                for &(lo, hi, ax, ay, k) in &edges[..count] {
                    if yc < lo || yc > hi {
                        continue;
                    }
                    let x = ax + k * (yc - ay);
                    xl = xl.min(x);
                    xr = xr.max(x);
                }
                (xl <= xr).then_some((xl, xr))
            }
        }
    }
}

/// 硬边图元的抗锯齿覆盖（见 Cover）。
fn aa_spans(s: &Shape, width: usize, height: usize, out: &mut Vec<Span>) {
    let (outline, ymin, ymax) = Outline::new(s);
    let wf = width as f64;
    let y0 = ymin.floor().max(0.0);
    let y1 = (ymax.ceil() - 1.0).min(height as f64 - 1.0);
    if !(y0 <= y1) {
        return;
    }
    let mut subs = [(0.0f64, 0.0f64); AA_SUB];
    for y in y0 as usize..=y1 as usize {
        let mut n = 0;
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        let (mut inner_lo, mut inner_hi) = (f64::NEG_INFINITY, f64::INFINITY);
        for j in 0..AA_SUB {
            let yc = y as f64 + (j as f64 + 0.5) / AA_SUB as f64;
            if let Some((xl, xr)) = outline.span(yc) {
                let (xl, xr) = (xl.max(0.0), xr.min(wf));
                if xl < xr {
                    subs[n] = (xl, xr);
                    n += 1;
                    lo = lo.min(xl);
                    hi = hi.max(xr);
                    inner_lo = inner_lo.max(xl);
                    inner_hi = inner_hi.min(xr);
                }
            }
        }
        if n == 0 {
            continue;
        }
        let (first, end) = (lo.floor() as usize, (hi.ceil() as usize).min(width));
        // 每条子线都完整盖住的像素：覆盖率正好为 1
        let (a, b) = if n == AA_SUB {
            let (a, b) = (inner_lo.ceil() as usize, inner_hi.floor() as usize);
            if a < b { (a, b) } else { (end, end) }
        } else {
            (end, end)
        };
        let edge = |out: &mut Vec<Span>, x: usize| {
            let (l, r) = (x as f64, x as f64 + 1.0);
            let mut sum = 0.0;
            for &(xl, xr) in &subs[..n] {
                sum += (xr.min(r) - xl.max(l)).max(0.0);
            }
            let m = sum / AA_SUB as f64;
            if m > 1e-9 {
                out.push(Span { y, x1: x, x2: x, m: m.min(1.0) });
            }
        };
        for x in first..a.min(end) {
            edge(out, x);
        }
        if a < b {
            out.push(Span { y, x1: a, x2: b - 1, m: 1.0 });
            for x in b..end {
                edge(out, x);
            }
        }
    }
}

#[cfg(test)]
mod aa_tests {
    use super::*;

    fn shape(k: u8, x: i32, y: i32, w: i32, h: i32, r: i32) -> Shape {
        Shape { k, x, y, w, h, r, a: 255, c: 0, delta: 0.0 }
    }

    /// 8×8 超采样的点内判定（独立于扫描线实现）
    fn supersampled(s: &Shape, w: usize, h: usize) -> Vec<f64> {
        let th = s.r as f64 * std::f64::consts::PI / 180.0;
        let (cos, sin) = (th.cos(), th.sin());
        let (sw, sh) = (s.w as f64, s.h as f64);
        let inside = |px: f64, py: f64| {
            let (dx, dy) = (px - s.x as f64, py - s.y as f64);
            let lx = dx * cos + dy * sin;
            let ly = -dx * sin + dy * cos;
            match s.k {
                KIND_RECT => lx.abs() <= sw / 2.0 && ly.abs() <= sh / 2.0,
                KIND_ELLIPSE => (2.0 * lx / sw).powi(2) + (2.0 * ly / sh).powi(2) <= 1.0,
                _ => ly >= -sh / 2.0 && ly <= sh / 2.0 && lx.abs() <= sw * (sh / 2.0 - ly) / (2.0 * sh),
            }
        };
        let mut out = vec![0.0; w * h];
        for y in 0..h {
            for x in 0..w {
                let mut n = 0;
                for j in 0..8 {
                    for i in 0..8 {
                        if inside(x as f64 + (i as f64 + 0.5) / 8.0, y as f64 + (j as f64 + 0.5) / 8.0) {
                            n += 1;
                        }
                    }
                }
                out[y * w + x] = n as f64 / 64.0;
            }
        }
        out
    }

    fn dense(c: &Cover, s: &Shape, w: usize, h: usize) -> Vec<f64> {
        let mut out = vec![0.0; w * h];
        for (p, m) in c.pixels(s, w) {
            assert_eq!(out[p], 0.0, "像素重复");
            out[p] = m;
        }
        out
    }

    #[test]
    fn integer_aligned_rect_is_fully_covered() {
        let (w, h) = (20, 16);
        let s = shape(KIND_RECT, 10, 8, 6, 4, 0);
        let mut c = Cover::default();
        c.compute(&s, w, h, true);
        assert!(c.spans.iter().all(|sp| sp.m == 1.0));
        let mut center = Cover::default();
        center.compute(&s, w, h, false);
        assert_eq!(dense(&c, &s, w, h), dense(&center, &s, w, h));
        assert_eq!(dense(&c, &s, w, h).iter().sum::<f64>(), 24.0);
    }

    #[test]
    fn coverage_matches_supersampled_area() {
        let (w, h) = (48, 40);
        let mut rng = crate::rng::Rng::new(7);
        let mut c = Cover::default();
        for _ in 0..300 {
            let k = 1 + rng.int(3) as u8;
            let s = shape(k, rng.int(w + 1) as i32, rng.int(h + 1) as i32, 1 + rng.int(30) as i32, 1 + rng.int(30) as i32, rng.int(360) as i32);
            c.compute(&s, w, h, true);
            let got = dense(&c, &s, w, h);
            let want = supersampled(&s, w, h);
            let (a, b): (f64, f64) = (got.iter().sum(), want.iter().sum());
            assert!((a - b).abs() <= 0.05 * b.max(4.0), "{s:?}: 覆盖 {a}，面积 {b}");
            // 逐像素：子线 4 条 vs 超采样 8 行，单个像素最多差约 1/4
            for p in 0..w * h {
                assert!((got[p] - want[p]).abs() <= 0.3, "{s:?} 像素 {p}: {} vs {}", got[p], want[p]);
            }
            // 按行、按列递增
            for pair in c.spans.windows(2) {
                assert!((pair[0].y, pair[0].x2) < (pair[1].y, pair[1].x1));
            }
        }
    }

    #[test]
    fn thin_needle_is_charged_for_its_area() {
        // 斜放的细长三角形：中心采样几乎踩不到像素，面积覆盖与几何面积相当
        let (w, h) = (200, 60);
        let s = shape(KIND_TRIANGLE, 100, 30, 2, 160, 75);
        let mut c = Cover::default();
        c.compute(&s, w, h, true);
        let area: f64 = c.pixels(&s, w).map(|(_, m)| m).sum();
        let want: f64 = supersampled(&s, w, h).iter().sum();
        assert!((area - want).abs() <= 0.05 * want, "覆盖 {area}，面积 {want}");
    }
}
