//! Refinement on transparent black, using premultiplied RGB and alpha in 0..255.
//!
//! Removing a layer leaves F0. A replacement changes RGB by a*m*Tr*(c-B)
//! and alpha by a*m*Tr*(255-BA), where B/BA are the composite below it.
//! The row moments keep hard candidates O(rows); soft candidates weight the
//! quadratic moments by m² and the residual moments by m, summed over the
//! multi-level cells of soft.rs.

use rayon::prelude::*;

use crate::fitter::Fitter;
use crate::raster::{Cover, Shape, KIND_LINEAR, KIND_TRIANGLE};
use crate::rng::{seed_for, Rng};
use crate::soft::{SoftPyramid, QUAD};
use crate::target::js_round;

// Tr²; (Tr²B, Tr²B², rRGB*Tr, rRGB*Tr*B) for each RGB channel;
// rA*Tr*(255-BA); Tr²*(255-BA)².
// 每一项都乘该像素的误差权重 ω（不加权时 ω = 1，结果逐位不变）。
const M: usize = 15;

struct Window {
    y0: usize,
    y1: usize,
    width: usize,
    height: usize,
    /// Hard candidates use area coverage (Fitter::antialias).
    aa: bool,
    prefix: Vec<f64>,
}

impl Window {
    /// Delta relative to F0, evaluated with the actual integer output color.
    /// Passing false preserves the original color as a valid baseline.
    ///
    /// Soft shapes pass the pyramid (see soft.rs) and whether to sum exactly
    /// (level 0, per pixel) or approximately (a level chosen by shape size).
    /// Rows outside the window are stale in the pyramid, so soft candidates
    /// are confined to the window just like hard ones.
    fn evaluate(
        &self,
        soft: Option<(&SoftPyramid, bool)>,
        s: &mut Shape,
        cover: &mut Cover,
        solve_color: bool,
    ) -> f64 {
        let Some((first, last)) = cover.compute(s, self.width, self.height, self.aa).then(|| cover.rows()).flatten() else {
            return f64::INFINITY;
        };
        let stride = (self.width + 1) * M;
        let mut sums = [0.0; M];
        if let Some((pyramid, exact)) = soft.filter(|_| s.k >= 4) {
            if first < self.y0 || last > self.y1 {
                return f64::INFINITY;
            }
            let (quad, lin) = pyramid.sums(s, &mut cover.lines, exact);
            sums[0] = quad[0];
            for c in 0..3 {
                sums[1 + c * 4] = quad[1 + c];
                sums[2 + c * 4] = quad[4 + c];
                sums[3 + c * 4] = lin[c];
                sums[4 + c * 4] = lin[3 + c];
            }
            sums[13] = lin[6];
            sums[14] = quad[7];
        } else {
            for sp in &cover.spans {
                if sp.y < self.y0 || sp.y > self.y1 {
                    return f64::INFINITY;
                }
                let base = (sp.y - self.y0) * stride;
                let a = base + sp.x1 * M;
                let b = base + (sp.x2 + 1) * M;
                if sp.m == 1.0 {
                    for (j, sum) in sums.iter_mut().enumerate() {
                        *sum += self.prefix[b + j] - self.prefix[a + j];
                    }
                } else {
                    // Area coverage m: quadratic moments (0, Tr²B, Tr²B², 14) scale
                    // by m², residual moments (rTr, rTrB, 13) by m.
                    let (m, m2) = (sp.m, sp.m * sp.m);
                    for (j, sum) in sums.iter_mut().enumerate() {
                        let linear = j == 13 || (j >= 1 && j <= 12 && (j - 1) % 4 >= 2);
                        *sum += if linear { m } else { m2 } * (self.prefix[b + j] - self.prefix[a + j]);
                    }
                }
            }
        }

        let al = s.a as f64 / 255.0;
        if al == 0.0 {
            return 0.0;
        }
        let g = sums[0];
        let old_color = rgb(s.c);
        let mut color = 0;
        let mut delta = al * (2.0 * sums[13] + al * sums[14]);
        for c in 0..3 {
            let o = 1 + c * 4;
            let (gb, gbb, rg, rgb) = (sums[o], sums[o + 1], sums[o + 2], sums[o + 3]);
            // Divide by g first, rather than al*g (which can underflow).
            // A hidden shape keeps its color; there is no arbitrary Tr cutoff.
            let k = if solve_color && g > 0.0 {
                js_round(gb / g - (rg / g) / al).clamp(0.0, 255.0)
            } else {
                old_color[c]
            };
            delta += al * al * k.mul_add(k * g - 2.0 * gb, gbb) + 2.0 * al * k.mul_add(rg, -rgb);
            color = (color << 8) | k as u32;
        }
        if solve_color {
            s.c = color;
        }
        if delta.is_finite() {
            delta
        } else {
            f64::INFINITY
        }
    }
}

fn rgb(c: u32) -> [f64; 3] {
    [
        ((c >> 16) & 255) as f64,
        ((c >> 8) & 255) as f64,
        (c & 255) as f64,
    ]
}

/// Read-only context after removing the old layer from the final composite.
struct Composite<'a> {
    below: &'a [f64],
    below_alpha: &'a [f64],
    tr: &'a [f64],
    opaque: &'a [usize],
}

impl Composite<'_> {
    /// Verify a winner directly over the union of both footprints. Computing
    /// new-old per pixel avoids subtracting two large, nearly equal moment
    /// scores, including when the old shape already matches the target.
    fn replacement_delta(
        &self,
        fitter: &Fitter,
        old: &Shape,
        new: &Shape,
        old_cover: &Cover,
        new_cover: &Cover,
        stopped: &(impl Fn() -> bool + Sync),
    ) -> Option<f64> {
        let target_alpha = fitter
            .target_alpha
            .as_ref()
            .expect("transparent target alpha");
        let (old_col, new_col) = (rgb(old.c), rgb(new.c));
        let (mut delta, mut correction) = (0.0, 0.0);
        // Both covers list pixels in increasing index order (row by row).
        let mut old_pixels = old_cover.pixels(old, fitter.w).peekable();
        let mut new_pixels = new_cover.pixels(new, fitter.w).peekable();
        let mut row = usize::MAX;
        while old_pixels.peek().is_some() || new_pixels.peek().is_some() {
            let p = old_pixels
                .peek()
                .map_or(usize::MAX, |v| v.0)
                .min(new_pixels.peek().map_or(usize::MAX, |v| v.0));
            // Check for cancellation once per row.
            if p / fitter.w != row {
                row = p / fitter.w;
                if stopped() {
                    return None;
                }
            }
            let old_q = if old_pixels.peek().is_some_and(|v| v.0 == p) {
                old.a as f64 / 255.0 * old_pixels.next().unwrap().1
            } else {
                0.0
            };
            let new_q = if new_pixels.peek().is_some_and(|v| v.0 == p) {
                new.a as f64 / 255.0 * new_pixels.next().unwrap().1
            } else {
                0.0
            };
            if self.opaque[p] != 0 {
                continue;
            }
            let g = self.tr[p];
            let mut change = 0.0;
            for c in 0..3 {
                let b = self.below[p * 3 + c];
                let old_effect = old_q * g * (old_col[c] - b);
                let d = new_q * g * (new_col[c] - b) - old_effect;
                let r =
                    fitter.current[p * 3 + c] + old_effect - fitter.target[p * 3 + c] as f64;
                change += d * (2.0 * r + d);
            }
            let remaining = 255.0 - self.below_alpha[p];
            let d = (new_q - old_q) * g * remaining;
            let r = fitter.current_alpha[p] + old_q * g * remaining - target_alpha[p] as f64;
            change += d * (2.0 * r + d);
            // 加权误差：整个像素的变化量乘该像素的权重 ω
            let term = change * fitter.omega[p] - correction;
            let sum = delta + term;
            correction = (sum - delta) - term;
            delta = sum;
        }
        Some(delta)
    }
}

impl Fitter {
    /// One bottom-to-top pass. Geometry, alpha, color and kind (among the
    /// enabled kinds) change;
    /// the background stays transparent black. Every exit rebuilds the complete
    /// RGBA image, even cancellation after a layer has been temporarily removed.
    pub(crate) fn refine_alpha_pass(
        &mut self,
        shapes: &mut [Shape],
        age: u32,
        seed: u32,
        pool: Option<&rayon::ThreadPool>,
        threads: usize,
        mut on_progress: impl FnMut(usize),
        stopped: impl Fn() -> bool + Sync,
    ) -> bool {
        self.bg = 0;
        // Kind switching: any enabled kind may take over a layer, so both the
        // hard (prefix) and the soft (pyramid) data may be needed per layer.
        let kinds = self.kinds().to_vec();
        let any_hard = kinds.iter().any(|k| *k <= 3);
        let any_soft = kinds.iter().any(|k| *k >= 4);
        let mut gains = Vec::with_capacity(shapes.len());
        let complete = (|| {
            if stopped() {
                return false;
            }
            let (w, h) = (self.w, self.h);
            let n = w * h;
            let aa = self.antialias;
            let mut lines = Cover::default();
            let mut old_lines = Cover::default();
            let mut thread_lines: Vec<Cover> =
                (0..threads.max(1)).map(|_| Cover::default()).collect();

            // Logarithms recover tiny products when lower layers are removed;
            // fully opaque factors are counted separately (never log(0)).
            let mut log_tr = vec![0.0f64; n];
            let mut opaque = vec![0usize; n];
            for shape in shapes.iter() {
                if stopped() {
                    return false;
                }
                lines.compute(shape, w, h, aa);
                for (p, m) in lines.pixels(shape, w) {
                    let q = shape.a as f64 / 255.0 * m;
                    if q >= 1.0 {
                        opaque[p] += 1;
                    } else {
                        log_tr[p] += (-q).ln_1p();
                    }
                }
            }
            let mut tr: Vec<f64> = log_tr.iter().map(|v| v.exp()).collect();
            let mut below = vec![0.0; n * 3];
            let mut below_alpha = vec![0.0; n];
            let margin = ((self.s as f64 / 8.0).ceil() as usize).max(6);
            let stride = (w + 1) * M;
            let mut window = Window {
                y0: 0,
                y1: 0,
                width: w,
                height: h,
                aa,
                prefix: Vec::new(),
            };

            // Evaluation data for soft shapes; allocated only if the pass has any.
            let mut pyramid =
                (any_soft || shapes.iter().any(|s| s.k >= 4)).then(|| SoftPyramid::new(w, h));

            for i in 0..shapes.len() {
                if stopped() {
                    return false;
                }
                let old = shapes[i];
                if stopped() {
                    return false;
                }
                old_lines.compute(&old, w, h, aa);
                let old_rows = old_lines.rows();
                let old_al = old.a as f64 / 255.0;
                let old_col = rgb(old.c);
                for (p, m) in old_lines.pixels(&old, w) {
                    let q = old_al * m;
                    if q >= 1.0 {
                        opaque[p] -= 1;
                    } else {
                        log_tr[p] -= (-q).ln_1p();
                    }
                    tr[p] = log_tr[p].min(0.0).exp();
                    if opaque[p] == 0 {
                        for c in 0..3 {
                            self.current[p * 3 + c] -=
                                q * tr[p] * (old_col[c] - below[p * 3 + c]);
                        }
                        self.current_alpha[p] -= q * tr[p] * (255.0 - below_alpha[p]);
                    }
                }

                let mut best = old;
                let mut gain = 0.0;
                let need_hard = old.k < 4 || any_hard;
                let need_soft = old.k >= 4 || any_soft;
                if let Some((first, last)) = old_rows {
                    window.y0 = first.saturating_sub(margin);
                    window.y1 = last.saturating_add(margin).min(h - 1);
                    let rows = window.y1 - window.y0 + 1;
                    window.prefix.clear();
                    window.prefix.resize(rows * stride, 0.0);
                    let target_alpha = self
                        .target_alpha
                        .as_ref()
                        .expect("transparent target alpha");
                    let (current, current_alpha, target, omega) =
                        (&self.current, &self.current_alpha, &self.target, &self.omega);
                    let y0 = window.y0;
                    let fill = |(row, out): (usize, &mut [f64])| {
                        if stopped() {
                            return;
                        }
                        let y = y0 + row;
                        for x in 0..w {
                            let p = y * w + x;
                            let g = if opaque[p] == 0 { tr[p] } else { 0.0 };
                            let g2 = g * g;
                            // 每一项乘该像素的误差权重 ω
                            let wt = omega[p];
                            let (prev, next) = out[x * M..(x + 2) * M].split_at_mut(M);
                            next[0] = prev[0] + g2 * wt;
                            for c in 0..3 {
                                let b = below[p * 3 + c];
                                let r = current[p * 3 + c] - target[p * 3 + c] as f64;
                                let o = 1 + c * 4;
                                next[o] = prev[o] + g2 * b * wt;
                                next[o + 1] = prev[o + 1] + g2 * b * b * wt;
                                next[o + 2] = prev[o + 2] + r * g * wt;
                                next[o + 3] = prev[o + 3] + r * g * b * wt;
                            }
                            let remaining = 255.0 - below_alpha[p];
                            next[13] = prev[13]
                                + (current_alpha[p] - target_alpha[p] as f64) * g * remaining * wt;
                            next[14] = prev[14] + g2 * remaining * remaining * wt;
                        }
                    };
                    {
                        if let Some(pyramid) = pyramid.as_mut().filter(|_| need_soft) {
                            let (a0, a1) = pyramid.aligned(window.y0, window.y1);
                            pyramid.refresh(a0, a1, |p, cell| {
                                let g = if opaque[p] == 0 { tr[p] } else { 0.0 };
                                let g2 = g * g;
                                let wt = omega[p];
                                cell[0] = g2 * wt;
                                for c in 0..3 {
                                    let b = below[p * 3 + c];
                                    let r = current[p * 3 + c] - target[p * 3 + c] as f64;
                                    cell[1 + c] = g2 * b * wt;
                                    cell[4 + c] = g2 * b * b * wt;
                                    cell[QUAD + c] = r * g * wt;
                                    cell[QUAD + 3 + c] = r * g * b * wt;
                                }
                                let remaining = 255.0 - below_alpha[p];
                                cell[7] = g2 * remaining * remaining * wt;
                                cell[QUAD + 6] =
                                    (current_alpha[p] - target_alpha[p] as f64) * g * remaining * wt;
                            });
                        }
                        if need_hard {
                            match pool {
                                Some(pool) if rows * w >= 16384 => pool.install(|| {
                                    window
                                        .prefix
                                        .par_chunks_mut(stride)
                                        .enumerate()
                                        .for_each(fill)
                                }),
                                _ => window.prefix.chunks_mut(stride).enumerate().for_each(fill),
                            }
                        }
                    }
                    if stopped() {
                        return false;
                    }
                    // Soft candidates climb on approximate sums; the start and
                    // each thread's result are evaluated exactly.
                    let soft = pyramid.as_ref();
                    let (soft_exact, soft_fast) = (soft.map(|p| (p, true)), soft.map(|p| (p, false)));

                    // Keep the unchanged old color explicitly, even if moment
                    // roundoff makes the newly solved, rounded color worse.
                    best.delta = window.evaluate(soft_exact, &mut best, &mut lines, false);
                    let old_delta = best.delta;
                    let mut start = old;
                    start.delta = window.evaluate(soft_exact, &mut start, &mut lines, true);
                    if start.delta < best.delta {
                        best = start;
                    }
                    let start = best;
                    // Kind switching: the same placement as every other enabled
                    // kind; the best one gets half of the threads if it keeps at
                    // least 90% of the original kind's gain.
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
                        v.delta = window.evaluate(soft_exact, &mut v, &mut lines, true);
                        if v.delta.is_finite() && alt.map_or(true, |a| v.delta < a.delta) {
                            alt = Some(v);
                        }
                    }
                    let alt = alt.filter(|a| a.delta < 0.9 * start.delta);
                    if let Some(a) = alt {
                        if a.delta < best.delta {
                            best = a;
                        }
                    }
                    let single = threads <= 1;
                    let shared: &Fitter = self;
                    let win = &window;
                    let climb = |(j, scratch): (usize, &mut Cover)| {
                        let mut rng = Rng::new(seed_for(seed, i as u32, j as u32));
                        let mut state = match alt {
                            Some(a) if j % 2 == 1 || (single && a.delta < start.delta) => a,
                            _ => start,
                        };
                        if soft_fast.is_some() {
                            state.delta = win.evaluate(soft_fast, &mut state, scratch, false);
                        }
                        let mut fails = 0;
                        while fails < age && !stopped() {
                            let mut candidate = shared.mutate(&state, &mut rng);
                            candidate.delta = win.evaluate(soft_fast, &mut candidate, scratch, true);
                            if candidate.delta < state.delta {
                                state = candidate;
                                fails = 0;
                            } else {
                                fails += 1;
                            }
                        }
                        if soft_exact.is_some() {
                            state.delta = win.evaluate(soft_exact, &mut state, scratch, false);
                        }
                        state
                    };
                    let results: Vec<Shape> = match pool {
                        Some(pool) if threads > 1 => pool.install(|| {
                            thread_lines.par_iter_mut().enumerate().map(climb).collect()
                        }),
                        _ => thread_lines.iter_mut().enumerate().map(climb).collect(),
                    };
                    for result in results {
                        if result.delta < best.delta {
                            best = result;
                        }
                    }
                    if stopped() {
                        return false;
                    }
                    lines.compute(&best, w, h, aa);
                    let composite = Composite {
                        below: &below,
                        below_alpha: &below_alpha,
                        tr: &tr,
                        opaque: &opaque,
                    };
                    match composite.replacement_delta(self, &old, &best, &old_lines, &lines, &stopped) {
                        Some(delta) if delta.is_finite() && delta < 0.0 => gain = -best.delta,
                        Some(_) => {
                            best = old;
                            gain = -old_delta;
                        }
                        None => return false,
                    }
                }

                // Commit only after the complete search and direct check.
                // Cancellation during this loop also rebuilds from shapes,
                // where this layer still has its original geometry and color.
                if stopped() {
                    return false;
                }
                lines.compute(&best, w, h, aa);
                let col = rgb(best.c);
                for (p, m) in lines.pixels(&best, w) {
                    let q = best.a as f64 / 255.0 * m;
                    for c in 0..3 {
                        let b = below[p * 3 + c];
                        if opaque[p] == 0 {
                            self.current[p * 3 + c] += q * tr[p] * (col[c] - b);
                        }
                        below[p * 3 + c] = b + q * (col[c] - b);
                    }
                    let remaining = 255.0 - below_alpha[p];
                    if opaque[p] == 0 {
                        self.current_alpha[p] += q * tr[p] * remaining;
                    }
                    below_alpha[p] += q * remaining;
                }
                shapes[i] = best;
                gains.push(if gain.is_finite() { gain } else { 0.0 });
                on_progress(i + 1);
            }
            true
        })();
        self.rebuild(shapes);
        self.gains = if complete { gains } else { Vec::new() };
        complete
    }
}
