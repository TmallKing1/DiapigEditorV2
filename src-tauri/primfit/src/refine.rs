//! 精修：贪心拟合结束后，回头逐个调整已有的图元（位置、尺寸、旋转、不透明度、颜色）和背景色，
//! 目标仍是整图平方误差。贪心时每个图元只在加入那一刻最优，被后面的图元盖住一部分后就不再最优。
//!
//! 记第 i 个图元下面的画面为 B，它上面所有图元的透过率之积为 Tr（被完全不透明的图元盖住处为 0），
//! 去掉它之后的最终画面为 F0。换成任意一个图元（不透明度 a、颜色 c、覆盖 Ω）后，最终画面在 Ω 上变为
//! F0 + a·Tr·(c − B)。于是误差变化量和最优颜色仍有闭式解，使用 Tr²、Tr²B、Tr²B²、r·Tr、r·Tr·B
//! （r = F0 − 目标）的按行前缀和，硬边候选为 O(覆盖行数)，软边候选逐像素加权。
//! 贪心搜索是它在 Tr = 1 时的特例。
//!
//! 保持几何不变、只重算颜色，就是对全部颜色做最小二乘的一步坐标下降；一轮精修自下而上把每个图元都做一遍。

use rayon::prelude::*;

use crate::fitter::Fitter;
use crate::raster::{Cover, Shape, KIND_LINEAR, KIND_TRIANGLE};
use crate::rng::{seed_for, Rng};
use crate::soft::{SoftPyramid, QUAD};
use crate::target::js_round;

/// 窗口前缀和每个像素位置 13 个数：Tr²，然后每个通道 Tr²B、Tr²B²、r·Tr、r·Tr·B；每一项都乘该像素的误差权重 ω。
const M: usize = 13;

/// 一个图元周围若干行的前缀和。候选图元只能落在这些行里。
struct Window {
    y0: usize,
    y1: usize,
    width: usize,
    height: usize,
    /// 硬边候选按面积覆盖率评分（Fitter::antialias）
    aa: bool,
    prefix: Vec<f64>,
}

impl Window {
    /// 最优颜色写入 s.c，返回「有这个图元」相对「没有这个图元」的整图平方误差变化量。
    /// 不覆盖任何像素或超出窗口时返回正无穷。只用于硬边图元。
    /// 抗锯齿时覆盖率为 m 的一段：二次项（Tr²、Tr²B、Tr²B²）乘 m²，一次项（r·Tr、r·Tr·B）乘 m，solve 不变。
    fn evaluate(&self, s: &mut Shape, cover: &mut Cover) -> f64 {
        if !cover.compute(s, self.width, self.height, self.aa) {
            return f64::INFINITY;
        }
        let stride = (self.width + 1) * M;
        let mut sums = [0.0f64; M];
        for sp in &cover.spans {
            if sp.y < self.y0 || sp.y > self.y1 {
                return f64::INFINITY;
            }
            let a = (sp.y - self.y0) * stride + sp.x1 * M;
            let b = (sp.y - self.y0) * stride + (sp.x2 + 1) * M;
            let (pa, pb) = (&self.prefix[a..a + M], &self.prefix[b..b + M]);
            if sp.m == 1.0 {
                for j in 0..M {
                    sums[j] += pb[j] - pa[j];
                }
            } else {
                let (m, m2) = (sp.m, sp.m * sp.m);
                sums[0] += m2 * (pb[0] - pa[0]);
                for c in 0..3 {
                    let o = 1 + c * 4;
                    sums[o] += m2 * (pb[o] - pa[o]);
                    sums[o + 1] += m2 * (pb[o + 1] - pa[o + 1]);
                    sums[o + 2] += m * (pb[o + 2] - pa[o + 2]);
                    sums[o + 3] += m * (pb[o + 3] - pa[o + 3]);
                }
            }
        }
        solve(&sums, s)
    }

    /// 软边图元：加权和取自多级评估数据（见 soft.rs），窗口行范围以外的格子没有刷新，所以同样只接受
    /// 落在窗口里的候选。exact 为真时逐像素精确求和，否则按图元大小近似。
    fn evaluate_soft(&self, pyramid: &SoftPyramid, s: &mut Shape, cover: &mut Cover, exact: bool) -> f64 {
        cover.compute(s, self.width, self.height, false);
        let Some((first, last)) = cover.rows() else {
            return f64::INFINITY;
        };
        if first < self.y0 || last > self.y1 {
            return f64::INFINITY;
        }
        let (quad, lin) = pyramid.sums(s, &mut cover.lines, exact);
        let mut sums = [0.0f64; M];
        sums[0] = quad[0];
        for c in 0..3 {
            sums[1 + c * 4] = quad[1 + c];
            sums[2 + c * 4] = quad[4 + c];
            sums[3 + c * 4] = lin[c];
            sums[4 + c * 4] = lin[3 + c];
        }
        solve(&sums, s)
    }
}

/// 由窗口内的和求最优颜色（写入 s.c）与误差变化量。
fn solve(sums: &[f64; M], s: &mut Shape) -> f64 {
    {
        let al = s.a as f64 / 255.0;
        let g = sums[0];
        let mut delta = 0.0;
        let mut color = 0u32;
        for c in 0..3 {
            let (gb, gbb, rg, rgb) = (sums[1 + c * 4], sums[2 + c * 4], sums[3 + c * 4], sums[4 + c * 4]);
            // 完全被上面的图元挡住：颜色无所谓
            let k = if g > 1e-12 { js_round((al * gb - rg) / (al * g)).clamp(0.0, 255.0) } else { 0.0 };
            delta += al * al * (k * k * g - 2.0 * k * gb + gbb) + 2.0 * al * (k * rg - rgb);
            color = (color << 8) | k as u32;
        }
        s.c = color;
        delta
    }
}

fn rgb(c: u32) -> [f64; 3] {
    [((c >> 16) & 255) as f64, ((c >> 8) & 255) as f64, (c & 255) as f64]
}

impl Fitter {
    /// 精修一轮：先重算背景色，再自下而上调整每个图元。shapes 必须正是当前画面上的全部图元（按叠放顺序）。
    /// age：每个搜索线程连续多少次改不动就换下一个图元。stopped() 为真时在下一个图元之前结束，已做的调整保留。
    /// on_progress(已处理的图元数)。返回是否完整做完这一轮。整图误差只降不升。
    pub fn refine_pass(
        &mut self,
        shapes: &mut [Shape],
        age: u32,
        seed: u32,
        pool: Option<&rayon::ThreadPool>,
        threads: usize,
        mut on_progress: impl FnMut(usize),
        stopped: impl Fn() -> bool + Sync,
    ) -> bool {
        if self.is_transparent() {
            return self.refine_alpha_pass(shapes, age, seed, pool, threads, on_progress, stopped);
        }
        let (w, h) = (self.w, self.h);
        let n = w * h;
        let aa = self.antialias;
        let mut lines = Cover::default();
        let mut old_lines = Cover::default();
        let mut thread_lines: Vec<Cover> = (0..threads.max(1)).map(|_| Cover::default()).collect();

        // 全部图元的透过率：非零因子的对数和 + 完全不透明因子数，移除时做减法避免乘积下溢
        let mut tr = vec![1.0f64; n];
        let mut log_tr = vec![0.0f64; n];
        let mut opaque = vec![0u16; n];
        for s in shapes.iter() {
            lines.compute(s, w, h, aa);
            for (p,m) in lines.pixels(s, w) {
                let q = s.a as f64/255.0*m;
                if q >= 1.0 { opaque[p] += 1; }
                else { log_tr[p] += (-q).ln_1p(); }
            }
        }

        for p in 0..n { tr[p] = log_tr[p].exp(); }

        // 背景色：最终画面 = 背景色 × 透过率 + 其余，对背景色是线性的。按误差权重 ω 加权求最小二乘
        // （初始背景色取的是不加权的平均色）
        let old_bg = rgb(self.bg);
        let mut num = [0.0f64; 3];
        let mut den = 0.0;
        for p in 0..n {
            if opaque[p] == 0 {
                let g = tr[p];
                let wt = self.omega[p];
                den += g * g * wt;
                for c in 0..3 {
                    num[c] += g * (self.current[p * 3 + c] - self.target[p * 3 + c] as f64) * wt;
                }
            }
        }
        let mut new_bg = old_bg;
        if den > 1e-12 {
            for c in 0..3 {
                new_bg[c] = js_round(old_bg[c] - num[c] / den).clamp(0.0, 255.0);
            }
            for p in 0..n {
                if opaque[p] == 0 {
                    for c in 0..3 {
                        self.current[p * 3 + c] += tr[p] * (new_bg[c] - old_bg[c]);
                    }
                }
            }
            self.bg = ((new_bg[0] as u32) << 16) | ((new_bg[1] as u32) << 8) | new_bg[2] as u32;
        }

        // 第 i 个图元下面的画面，自下而上逐个叠上去
        let mut below = vec![0.0f64; n * 3];
        for px in below.chunks_exact_mut(3) {
            px.copy_from_slice(&new_bg);
        }

        let margin = ((self.s as f64 / 8.0).ceil() as usize).max(6);
        let mut window = Window { y0: 0, y1: 0, width: w, height: h, aa, prefix: Vec::new() };
        // 软边图元的评估数据：这一轮里有软边图元才分配
        // 换类型：可用类型里的每一种都可以接替当前图元，所以硬边、软边两套数据可能都要
        let kinds = self.kinds().to_vec();
        let any_hard = kinds.iter().any(|k| *k <= 3);
        let any_soft = kinds.iter().any(|k| *k >= 4);
        let mut pyramid = (any_soft || shapes.iter().any(|s| s.k >= 4)).then(|| SoftPyramid::new(w, h));
        let mut gains = Vec::with_capacity(shapes.len());
        let stride = (w + 1) * M;
        let mut complete = true;

        for i in 0..shapes.len() {
            if stopped() {
                complete = false;
                // 剩下的图元不动；below 不再需要
                break;
            }
            let old = shapes[i];
            old_lines.compute(&old, w, h, aa);
            let old_rows = old_lines.rows();
            let old_al = old.a as f64 / 255.0;
            let old_col = rgb(old.c);
            // 从透过率里去掉自己，再从最终画面里去掉自己的贡献：current 变成 F0
            for (p,m) in old_lines.pixels(&old, w) {
                let old_al = old_al*m;
                if old_al >= 1.0 {
                    opaque[p] -= 1;
                } else {
                    log_tr[p] -= (-old_al).ln_1p();
                    tr[p] = log_tr[p].min(0.0).exp();
                }
                if opaque[p] == 0 {
                    for c in 0..3 {
                        self.current[p * 3 + c] -= old_al * tr[p] * (old_col[c] - below[p * 3 + c]);
                    }
                }
            }

            let mut best = old;
            if let Some((first, last)) = old_rows {
                // 窗口：原图元所在的行上下各多留 margin 行
                window.y0 = first.saturating_sub(margin);
                window.y1 = (last + margin).min(h - 1);
                let rows = window.y1 - window.y0 + 1;
                let (y0, current, target, below_ref, tr_ref, opaque_ref, omega) = (window.y0, &self.current, &self.target, &below, &tr, &opaque, &self.omega);
                let need_hard = old.k < 4 || any_hard;
                let need_soft = old.k >= 4 || any_soft;
                if let Some(pyramid) = pyramid.as_mut().filter(|_| need_soft) {
                    let (a0, a1) = pyramid.aligned(window.y0, window.y1);
                    pyramid.refresh(a0, a1, |p, cell| {
                        let g = if opaque_ref[p] == 0 { tr_ref[p] } else { 0.0 };
                        let wt = omega[p];
                        cell[0] = g * g * wt;
                        for c in 0..3 {
                            let b = below_ref[p * 3 + c];
                            let r = current[p * 3 + c] - target[p * 3 + c] as f64;
                            cell[1 + c] = g * g * b * wt;
                            cell[4 + c] = g * g * b * b * wt;
                            cell[QUAD + c] = r * g * wt;
                            cell[QUAD + 3 + c] = r * g * b * wt;
                        }
                    });
                }
                if need_hard {
                    window.prefix.clear();
                    window.prefix.resize(rows * stride, 0.0);
                }
                let fill = |(row, out): (usize, &mut [f64])| {
                    let y = y0 + row;
                    for x in 0..w {
                        let p = y * w + x;
                        let g = if opaque_ref[p] == 0 { tr_ref[p] } else { 0.0 };
                        let wt = omega[p];
                        let (prev, next) = out[x * M..(x + 2) * M].split_at_mut(M);
                        next[0] = prev[0] + g * g * wt;
                        for c in 0..3 {
                            let b = below_ref[p * 3 + c];
                            let r = current[p * 3 + c] - target[p * 3 + c] as f64;
                            let o = 1 + c * 4;
                            next[o] = prev[o] + g * g * b * wt;
                            next[o + 1] = prev[o + 1] + g * g * b * b * wt;
                            next[o + 2] = prev[o + 2] + r * g * wt;
                            next[o + 3] = prev[o + 3] + r * g * b * wt;
                        }
                    }
                };
                if need_hard {
                    match pool {
                        Some(pool) if rows * w >= 16384 => pool.install(|| window.prefix.par_chunks_mut(stride).enumerate().for_each(fill)),
                        _ => window.prefix.chunks_mut(stride).enumerate().for_each(fill),
                    }
                }
                let win = &window;
                let pyramid_ref = pyramid.as_ref();
                // 软边候选在爬山时用近似值（exact = false），起点和每个线程的结果用精确值
                let eval = |s: &mut Shape, lines: &mut Cover, exact: bool| match pyramid_ref {
                    Some(pyramid) if s.k >= 4 => win.evaluate_soft(pyramid, s, lines, exact),
                    _ => win.evaluate(s, lines),
                };

                // 起点：几何不变，颜色按当前上下文重算（颜色联合求解的一步）
                let mut start = old;
                start.delta = eval(&mut start, &mut lines, true);
                if !start.delta.is_finite() {
                    start = old;
                    start.delta = 0.0;
                }
                // 换类型：同样的位置、尺寸和角度换成别的可用类型，取最好的一种。它至少要拿到原类型九成的收益，
                // 才分一半线程从它出发爬山；不然全部线程仍从原类型出发。
                let mut alt: Option<Shape> = None;
                for &k in &kinds {
                    if k == old.k {
                        continue;
                    }
                    let mut v = old;
                    v.k = k;
                    if k != KIND_TRIANGLE && k != KIND_LINEAR {
                        v.r = v.r.rem_euclid(180);
                    }
                    v.delta = eval(&mut v, &mut lines, true);
                    if v.delta.is_finite() && alt.map_or(true, |a| v.delta < a.delta) {
                        alt = Some(v);
                    }
                }
                let alt = alt.filter(|a| a.delta < 0.9 * start.delta);
                let single = thread_lines.len() <= 1;
                let shared: &Fitter = self;
                let climb = |(j, scratch): (usize, &mut Cover)| {
                    let mut rng = Rng::new(seed_for(seed, i as u32, j as u32));
                    let mut state = match alt {
                        Some(a) if j % 2 == 1 || (single && a.delta < start.delta) => a,
                        _ => start,
                    };
                    let soft = (state.k >= 4).then_some(());
                    if soft.is_some() {
                        state.delta = eval(&mut state, scratch, false);
                    }
                    let mut fails = 0;
                    while fails < age && !stopped() {
                        let mut m = shared.mutate(&state, &mut rng);
                        m.delta = eval(&mut m, scratch, false);
                        if m.delta < state.delta {
                            state = m;
                            fails = 0;
                        } else {
                            fails += 1;
                        }
                    }
                    if soft.is_some() {
                        state.delta = eval(&mut state, scratch, true);
                    }
                    state
                };
                let results: Vec<Shape> = match pool {
                    Some(pool) if threads > 1 => pool.install(|| thread_lines.par_iter_mut().enumerate().map(climb).collect()),
                    _ => thread_lines.iter_mut().enumerate().map(climb).collect(),
                };
                best = start;
                if let Some(a) = alt {
                    if a.delta < best.delta {
                        best = a;
                    }
                }
                for r in &results {
                    if r.delta < best.delta {
                        best = *r;
                    }
                }
            }

            // 放回（可能已经变了的）图元：更新最终画面和它上面图元看到的「下面的画面」
            lines.compute(&best, w, h, aa);
            let al = best.a as f64 / 255.0;
            let col = rgb(best.c);
            for (p,m) in lines.pixels(&best, w) {
                let al = al*m;
                for c in 0..3 {
                    let b = below[p * 3 + c];
                    if opaque[p] == 0 {
                        self.current[p * 3 + c] += al * tr[p] * (col[c] - b);
                    }
                    below[p * 3 + c] = b + (col[c] - b) * al;
                }
            }
            shapes[i] = best;
            // best.delta 是「有它」相对「没有它」的误差变化量；没进窗口搜索的（不在画面内）记 0
            gains.push(if old_rows.is_some() { -best.delta } else { 0.0 });
            on_progress(i + 1);
        }

        // 提前停止时，没处理的图元还留在透过率里，current 仍是完整的最终画面，状态一致
        self.rebuild(shapes);
        self.gains = if complete { gains } else { Vec::new() };
        complete
    }

    /// 按给定的图元从背景色重新画一遍，刷新画面、前缀和与误差（消除增量更新累积的浮点误差）。
    pub fn rebuild(&mut self, shapes: &[Shape]) {
        let bg = rgb(self.bg);
        for px in self.current.chunks_exact_mut(3) {
            px.copy_from_slice(&bg);
        }
        if self.is_transparent() { self.current_alpha.fill(0.0); }
        let mut lines = Cover::default();
        for s in shapes {
            lines.compute(s, self.w, self.h, self.antialias);
            let al = s.a as f64 / 255.0;
            let col = rgb(s.c);
            for (p,m) in lines.pixels(s, self.w) {
                let al = al*m;
                if self.is_transparent() { self.current_alpha[p] += (255.0-self.current_alpha[p])*al; }
                for c in 0..3 {
                    let v = &mut self.current[p * 3 + c];
                    *v += (col[c] - *v) * al;
                }
            }
        }
        self.refresh_all();
    }

    /// 前 k 个图元（k = 1..=shapes.len()）各自的均方根误差，用于界面上「使用前 k 个」的相似度。
    pub fn prefix_rmse(&self, shapes: &[Shape]) -> Vec<f64> {
        let bg = rgb(self.bg);
        let mut current = vec![0.0f64; self.w * self.h * 3];
        let mut error = 0.0;
        for (px, t) in current.chunks_exact_mut(3).zip(self.target.chunks_exact(3)) {
            px.copy_from_slice(&bg);
            for c in 0..3 {
                let d = bg[c] - t[c] as f64;
                error += d * d;
            }
        }
        let mut alpha = vec![0.0; if self.is_transparent() { self.w*self.h } else { 0 }];
        if let Some(target) = &self.target_alpha { error += target.iter().map(|a| (*a as f64).powi(2)).sum::<f64>(); }
        let mut lines = Cover::default();
        let scale = (self.w * self.h * if self.is_transparent() { 4 } else { 3 }) as f64;
        shapes
            .iter()
            .map(|s| {
                lines.compute(s, self.w, self.h, self.antialias);
                let al = s.a as f64 / 255.0;
                let col = rgb(s.c);
                for (pixel,m) in lines.pixels(s, self.w) {
                    let al = al*m;
                    if let Some(target) = &self.target_alpha {
                        let before = alpha[pixel];
                        let after = before+(255.0-before)*al;
                        let t = target[pixel] as f64;
                        alpha[pixel] = after;
                        error += (after-t).powi(2)-(before-t).powi(2);
                    }
                    for c in 0..3 {
                        let p = pixel*3+c;
                        let t = self.target[p] as f64;
                        let before = current[p];
                        let after = before + (col[c]-before)*al;
                        current[p] = after;
                        error += (after-t)*(after-t)-(before-t)*(before-t);
                    }
                }
                (error.max(0.0) / scale).sqrt() / 255.0
            })
            .collect()
    }
}
