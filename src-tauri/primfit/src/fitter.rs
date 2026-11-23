//! 拟合状态与搜索。算法同 fogleman/primitive：逐个贪心添加图元，每个图元先随机取样再爬山微调，
//! 取整图平方误差下降最多者。给定形状与不透明度时最优颜色有闭式解；当前画面与目标图各维护按行前缀和，
//! 硬边候选只需 O(覆盖行数)，软边候选按覆盖像素求加权统计量。

use crate::raster::{rasterize, Cover, Shape, KIND_ELLIPSE, KIND_TRIANGLE, KIND_LINEAR, coverage_row};
use crate::rng::Rng;
use crate::soft::{SoftPyramid, LIN, QUAD};
use crate::target::{average_color, js_round};

/// 搜索强度：每次重启的随机取样数、每个搜索线程的重启次数、爬山连续失败多少次后停止。
#[derive(Clone, Copy, Debug)]
pub struct Budget {
    pub candidates: u32,
    pub restarts: u32,
    pub age: u32,
}

pub const BUDGET_FAST: Budget = Budget { candidates: 100, restarts: 1, age: 40 };
pub const BUDGET_NORMAL: Budget = Budget { candidates: 200, restarts: 2, age: 80 };
pub const BUDGET_FINE: Budget = Budget { candidates: 400, restarts: 3, age: 150 };

#[derive(Clone, Debug)]
pub struct FitOptions {
    /// 可用类型：1 矩形 / 2 椭圆 / 3 三角形 / 4 径向 / 5 单向 / 6 对称光带；空表示只用椭圆
    pub kinds: Vec<u8>,
    /// 0 = 每个图元自动选不透明度，否则固定 1–255
    pub alpha: i32,
    /// 自动时的不透明度下限
    pub min_alpha: i32,
    /// 背景色 0xRRGGBB；None 取目标图平均色
    pub bg: Option<u32>,
    /// 随机取样时，有多大比例的候选把中心放在当前误差大的地方（按像素误差加权抽取）；0 = 全部均匀取样
    pub guided: f64,
    /// 逐像素误差权重 ω（行自下而上，长度 = 宽 × 高，取值 ≥ 1，小于 1 的按 1 算）；None 表示全为 1。
    /// 优化的误差变为 Σ ω·(F − T)²；相似度（rmse、prefix_rmse）仍按不加权误差计算。
    pub weights: Option<Vec<f32>>,
    /// 硬边图元按面积覆盖率评分（每像素行 AA_SUB 条子扫描线，与编辑器预览、游戏的抗锯齿绘制一致）；
    /// false 时按像素中心采样，与 In Falsus 的 primfit.js 逐位一致。只按中心采样时，细长图元可以从
    /// 像素中心之间穿过去不被罚分，画出来却是整条细线（2026-11-19）。
    pub antialias: bool,
}

impl Default for FitOptions {
    fn default() -> Self {
        FitOptions { kinds: vec![KIND_ELLIPSE], alpha: 0, min_alpha: 24, bg: None, guided: 0.0, weights: None, antialias: false }
    }
}

/// 每个搜索线程自己的扫描线缓冲，搜索循环里不再分配内存。
pub struct Scratch {
    lines: Vec<i32>,
    cover: Cover,
}

/// 前缀和每个像素位置 16 个数：目标和 T1、目标平方和 T2、画面和 C1、画面平方和 C2、画面×目标和 CT，各 3 通道，
/// 最后是权重和 Σω。每一项都已乘上该像素的权重 ω（不加权时 ω = 1，乘法是精确的，结果与不加权逐位相同）。
/// 放在同一个数组里，评估一行只碰两小段连续内存。
const N: usize = 16;

pub struct Fitter {
    pub(crate) w: usize,
    pub(crate) h: usize,
    /// 长边
    pub(crate) s: usize,
    pub(crate) target: Vec<u8>,
    kinds: Vec<u8>,
    fixed_alpha: i32,
    min_alpha: i32,
    pub(crate) bg: u32,
    pub(crate) current: Vec<f64>,
    /// 透明模式：RGB 为预乘值，Alpha 使用 0–255 标度；旧模式不分配这些数组。
    pub(crate) target_alpha: Option<Vec<u8>>,
    pub(crate) current_alpha: Vec<f64>,
    /// sum A, A², target A, A*target A, target A²（均乘 ω）
    alpha_prefix: Vec<f64>,
    /// 逐像素误差权重 ω（行自下而上）；没有权重时全为 1
    pub(crate) omega: Vec<f64>,
    /// 是否给了权重：没给时 rmse 直接由 error 得出
    weighted: bool,
    /// 每行 (w + 1) × 16 个前缀和
    prefix: Vec<f64>,
    pub(crate) error: f64,
    cover: Cover,
    /// 抗锯齿评估读边缘像素用：每像素 [ω, 画面 RGB, 目标 RGB, 画面 Alpha] 连在一起（一个缓存行），
    /// 比分别读 current、target、omega 三个数组少很多缓存未命中。不开抗锯齿时为空。
    px: Vec<[f64; 8]>,
    /// 硬边图元按面积覆盖率评分与绘制（FitOptions::antialias）
    pub(crate) antialias: bool,
    guided: f64,
    /// 各行误差的累计（长度 h + 1），按误差取样时先用它选行
    row_cum: Vec<f64>,
    /// 软边候选的多级评估数据；可用类型里没有软边图元时不分配
    pub(crate) soft: Option<SoftPyramid>,
    add_rows: Option<(usize, usize)>,
    pub(crate) gains: Vec<f64>,
}

/// 爬山时的中间状态：各参数还没取整。
struct Raw {
    k: u8,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    r: f64,
    a: f64,
}

impl Fitter {
    /// target：工作分辨率 RGB，行自下而上。
    pub fn new(target: Vec<u8>, width: usize, height: usize, options: &FitOptions) -> Self {
        assert_eq!(target.len(), width * height * 3, "目标图尺寸与数据长度不符");
        let bg = options.bg.unwrap_or_else(|| average_color(&target));
        let bg_rgb = [((bg >> 16) & 255) as f64, ((bg >> 8) & 255) as f64, (bg & 255) as f64];
        let mut current = vec![0.0; width * height * 3];
        for px in current.chunks_exact_mut(3) {
            px.copy_from_slice(&bg_rgb);
        }
        let omega: Vec<f64> = match &options.weights {
            Some(weights) => {
                assert_eq!(weights.len(), width * height, "权重长度与尺寸不符");
                weights.iter().map(|v| (*v as f64).max(1.0)).collect()
            }
            None => vec![1.0; width * height],
        };
        let stride = (width + 1) * N;
        let mut prefix = vec![0.0; height * stride];
        for y in 0..height {
            for x in 0..width {
                let o = y * stride + x * N;
                let wt = omega[y * width + x];
                for c in 0..3 {
                    let t = target[(y * width + x) * 3 + c] as f64;
                    prefix[o + N + c] = prefix[o + c] + t * wt;
                    prefix[o + N + 3 + c] = prefix[o + 3 + c] + t * t * wt;
                }
                prefix[o + N + 15] = prefix[o + 15] + wt;
            }
        }
        let mut error = 0.0;
        for (i, (v, t)) in current.iter().zip(&target).enumerate() {
            let d = v - *t as f64;
            error += d * d * omega[i / 3];
        }
        let mut fitter = Fitter {
            w: width,
            h: height,
            s: width.max(height),
            target,
            kinds: if options.kinds.is_empty() { vec![KIND_ELLIPSE] } else { options.kinds.clone() },
            fixed_alpha: if options.alpha > 0 { options.alpha.min(255) } else { 0 },
            min_alpha: options.min_alpha,
            bg,
            current,
            target_alpha: None,
            current_alpha: Vec::new(),
            alpha_prefix: Vec::new(),
            omega,
            weighted: options.weights.is_some(),
            prefix,
            error,
            cover: Cover::default(),
            px: if options.antialias { vec![[0.0; 8]; width * height] } else { Vec::new() },
            antialias: options.antialias,
            guided: options.guided.clamp(0.0, 1.0),
            row_cum: vec![0.0; height + 1],
            soft: None,
            add_rows: None,
            gains: Vec::new(),
        };
        if fitter.kinds.iter().any(|k| *k >= 4) {
            fitter.soft = Some(SoftPyramid::new(width, height));
        }
        for y in 0..height {
            fitter.refresh_row(y);
        }
        fitter.refresh_row_cum();
        fitter.refresh_soft(0, height - 1);
        fitter
    }

    /// 预乘 RGB 与独立 Alpha（行自下而上），透明背景固定为零，不使用 matte。
    pub fn new_alpha(target: Vec<u8>, width: usize, height: usize, alpha: Vec<u8>, options: &FitOptions) -> Self {
        assert_eq!(alpha.len(), width*height, "Alpha 长度与尺寸不符");
        let mut opts = options.clone();
        opts.bg = Some(0);
        opts.min_alpha = 1;
        let mut fitter = Self::new(target, width, height, &opts);
        fitter.target_alpha = Some(alpha);
        fitter.current_alpha = vec![0.0; width*height];
        fitter.alpha_prefix = vec![0.0; height*(width+1)*5];
        fitter.refresh_all();
        fitter
    }

    pub fn is_transparent(&self) -> bool { self.target_alpha.is_some() }
    pub fn bg_alpha(&self) -> u8 { if self.is_transparent() { 0 } else { 255 } }

    /// 一行里前 x 个像素的加权平方误差（三通道合计），由前缀和直接得到。
    #[inline]
    fn row_error_before(&self, y: usize, x: usize) -> f64 {
        let o = y * (self.w + 1) * N + x * N;
        let p = &self.prefix[o..o + N];
        let mut e = 0.0;
        for c in 0..3 {
            e += p[9 + c] - 2.0 * p[12 + c] + p[3 + c];
        }
        if self.is_transparent() {
            let a = y*(self.w+1)*5+x*5;
            e += self.alpha_prefix[a+1]-2.0*self.alpha_prefix[a+3]+self.alpha_prefix[a+4];
        }
        e
    }

    /// 画面（current）被整体改写后，重算全部前缀和、误差与取样用的行累计。
    pub(crate) fn refresh_all(&mut self) {
        let omega = &self.omega;
        let mut error = 0.0;
        for (i, (v, t)) in self.current.iter().zip(&self.target).enumerate() {
            let d = v - *t as f64;
            error += d * d * omega[i / 3];
        }
        if let Some(target) = &self.target_alpha {
            for (p, (a,t)) in self.current_alpha.iter().zip(target).enumerate() { error += (a-*t as f64).powi(2) * omega[p]; }
        }
        self.error = error;
        for y in 0..self.h {
            self.refresh_row(y);
        }
        self.refresh_row_cum();
        self.refresh_soft(0, self.h - 1);
    }

    /// 画面第 y0–y1 行变了：刷新软边候选的评估数据。
    fn refresh_soft(&mut self, y0: usize, y1: usize) {
        if let Some(mut soft) = self.soft.take() {
            let (current, target, current_alpha, target_alpha, omega) = (&self.current, &self.target, &self.current_alpha, self.target_alpha.as_deref(), &self.omega);
            // 贪心时图元上面没有别的图元：透过率为 1，下面的画面就是当前画面。每一项都乘该像素的权重 ω。
            soft.refresh(y0, y1, |p, cell| {
                let wt = omega[p];
                cell[0] = wt;
                for c in 0..3 {
                    let b = current[p * 3 + c];
                    let r = b - target[p * 3 + c] as f64;
                    cell[1 + c] = b * wt;
                    cell[4 + c] = b * b * wt;
                    cell[QUAD + c] = r * wt;
                    cell[QUAD + 3 + c] = r * b * wt;
                }
                if let Some(ta) = target_alpha {
                    let a = current_alpha[p];
                    let remaining = 255.0 - a;
                    cell[7] = remaining * remaining * wt;
                    cell[QUAD + 6] = (a - ta[p] as f64) * remaining * wt;
                }
            });
            self.soft = Some(soft);
        }
    }

    fn refresh_row_cum(&mut self) {
        if self.guided <= 0.0 {
            return;
        }
        let mut sum = 0.0;
        for y in 0..self.h {
            sum += self.row_error_before(y, self.w).max(0.0);
            self.row_cum[y + 1] = sum;
        }
    }

    /// 按像素误差加权抽一个像素；画面已经没有误差时返回 None。
    fn sample_error_pixel(&self, rng: &mut Rng) -> Option<(usize, usize)> {
        let total = self.row_cum[self.h];
        if !(total > 0.0) {
            return None;
        }
        let u = rng.next() * total;
        // 第一个累计值超过 u 的行
        let y = self.row_cum[1..].partition_point(|&v| v <= u).min(self.h - 1);
        let v = rng.next() * self.row_error_before(y, self.w);
        let (mut lo, mut hi) = (0, self.w);
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.row_error_before(y, mid + 1) <= v {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        Some((lo.min(self.w - 1), y))
    }

    pub(crate) fn search_groups(&self) -> Vec<Vec<u8>> {
        let hard: Vec<u8> = self.kinds.iter().copied().filter(|k| *k <= 3).collect();
        let mut groups = Vec::new();
        if !hard.is_empty() { groups.push(hard); }
        for &k in &self.kinds { if k >= 4 { groups.push(vec![k]); } }
        groups
    }

    /// 可用的图元类型
    pub(crate) fn kinds(&self) -> &[u8] {
        &self.kinds
    }

    /// 最近一轮完整精修里，每个图元在轮到它时对整图误差的贡献（去掉它误差会增加多少，越小越没用）；
    /// 这一轮没做完时为空。
    pub(crate) fn take_gains(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.gains)
    }

    pub fn width(&self) -> usize {
        self.w
    }

    pub fn height(&self) -> usize {
        self.h
    }

    pub fn bg(&self) -> u32 {
        self.bg
    }

    /// 内部优化用的误差：有权重时是加权平方误差 Σ ω·(F − T)²。
    pub fn error(&self) -> f64 {
        self.error
    }

    /// 是否按逐像素权重优化
    pub fn is_weighted(&self) -> bool {
        self.weighted
    }

    /// 不加权的整图平方误差（逐像素从头算）。没有权重时与 error() 相同（只差增量累计的舍入）。
    pub fn plain_error(&self) -> f64 {
        let mut error = 0.0;
        for (v, t) in self.current.iter().zip(&self.target) {
            let d = v - *t as f64;
            error += d * d;
        }
        if let Some(target) = &self.target_alpha {
            for (a, t) in self.current_alpha.iter().zip(target) {
                error += (a - *t as f64).powi(2);
            }
        }
        error
    }

    /// 均方根误差（0–1）；相似度 = 1 − rmse。始终是不加权的真实误差，不同权重设置之间可比：
    /// 没有权重时照旧由 error 得出；有权重时逐像素重算一遍（512² 约 1 ms）。
    pub fn rmse(&self) -> f64 {
        let error = if self.weighted { self.plain_error() } else { self.error };
        (error.max(0.0) / (self.w * self.h * if self.is_transparent() { 4 } else { 3 }) as f64).sqrt() / 255.0
    }

    pub fn scratch(&self) -> Scratch {
        Scratch { lines: vec![0; self.h * 3], cover: Cover::default() }
    }

    fn refresh_row(&mut self, y: usize) {
        let base = y * (self.w + 1) * N;
        for x in 0..self.w {
            let o = base + x * N;
            let wt = self.omega[y * self.w + x];
            for c in 0..3 {
                let i = (y * self.w + x) * 3 + c;
                let v = self.current[i];
                self.prefix[o + N + 6 + c] = self.prefix[o + 6 + c] + v * wt;
                self.prefix[o + N + 9 + c] = self.prefix[o + 9 + c] + v * v * wt;
                self.prefix[o + N + 12 + c] = self.prefix[o + 12 + c] + v * self.target[i] as f64 * wt;
            }
        }
        if let Some(target) = &self.target_alpha {
            let base = y*(self.w+1)*5;
            for x in 0..self.w {
                let o = base+x*5;
                let a = self.current_alpha[y*self.w+x];
                let t = target[y*self.w+x] as f64;
                let wt = self.omega[y*self.w+x];
                let values = [a*wt,a*a*wt,t*wt,a*t*wt,t*t*wt];
                for j in 0..5 { self.alpha_prefix[o+5+j] = self.alpha_prefix[o+j]+values[j]; }
            }
        }
        if !self.px.is_empty() {
            for p in y * self.w..(y + 1) * self.w {
                let (b, t) = (&self.current[p * 3..p * 3 + 3], &self.target[p * 3..p * 3 + 3]);
                let a = if self.target_alpha.is_some() { self.current_alpha[p] } else { 0.0 };
                self.px[p] = [self.omega[p], b[0], b[1], b[2], t[0] as f64, t[1] as f64, t[2] as f64, a];
            }
        }
    }



    /// 计算最优颜色（写入 s.c）并返回整图平方误差的变化量；不覆盖任何像素时返回正无穷。只读，可多线程同时调用。
    pub fn evaluate(&self, s: &mut Shape, scratch: &mut Scratch) -> f64 {
        if s.k >= 4 { return self.evaluate_soft(s, scratch); }
        if self.antialias { return self.evaluate_aa(s, scratch); }
        self.evaluate_center(s, scratch)
    }

    /// 硬边图元按像素中心采样评估（不开抗锯齿时的评估；开抗锯齿时只用来粗筛随机候选）。
    fn evaluate_center(&self, s: &mut Shape, scratch: &mut Scratch) -> f64 {
        let rows = rasterize(s, self.w, self.h, &mut scratch.lines);
        let stride = (self.w + 1) * N;
        let mut sums = [0.0f64; N];
        let mut count = 0i64;
        let mut alpha_sums = [0.0; 5];
        for line in scratch.lines[..rows * 3].chunks_exact(3) {
            let (y, x1, x2) = (line[0] as usize, line[1] as usize, line[2] as usize);
            let a = y * stride + x1 * N;
            let b = y * stride + (x2 + 1) * N;
            count += (x2 - x1 + 1) as i64;
            if self.is_transparent() {
                let aa = (y*(self.w+1)+x1)*5;
                let ab = (y*(self.w+1)+x2+1)*5;
                for j in 0..5 { alpha_sums[j] += self.alpha_prefix[ab+j]-self.alpha_prefix[aa+j]; }
            }
            let (pa, pb) = (&self.prefix[a..a + N], &self.prefix[b..b + N]);
            for j in 0..N {
                sums[j] += pb[j] - pa[j];
            }
        }
        // 是否覆盖到像素看整数计数；公式里的像素数换成权重和 Σω（不加权时二者相等，且都是精确整数）
        if count == 0 {
            return f64::INFINITY;
        }
        let count = sums[15];
        let al = s.a as f64 / 255.0;
        let bl = 1.0 - al;
        let mut delta = 0.0;
        let mut color = 0u32;
        for c in 0..3 {
            let (st, st2, sc, sc2, sct) = (sums[c], sums[3 + c], sums[6 + c], sums[9 + c], sums[12 + c]);
            let k = js_round((st - bl * sc) / (al * count)).clamp(0.0, 255.0);
            let after = bl * bl * sc2 + al * al * k * k * count + st2 + 2.0 * al * bl * k * sc - 2.0 * bl * sct - 2.0 * al * k * st;
            delta += after - (sc2 - 2.0 * sct + st2);
            color = (color << 8) | k as u32;
        }
        if self.is_transparent() {
            let [sa,sa2,ta,sata,_] = alpha_sums;
            delta += 2.0*al*(255.0*sa-sa2-255.0*ta+sata) + al*al*(65025.0*count-510.0*sa+sa2);
        }
        s.c = color;
        delta
    }

    /// 抗锯齿评估（硬边图元）：每段像素的覆盖率为 m，不透明度 q = al·m。误差变化量
    /// Σω[q²(k − B)² + 2q(k − B)(B − T)] 按 k 展开后，二次项（Σωm²、Σωm²B、Σωm²B²）乘 al²，
    /// 一次项（Σωm(B − T)、Σωm(B − T)B）乘 al。内部像素（m = 1）取前缀和之差；边缘像素逐个读 px。
    fn evaluate_aa(&self, s: &mut Shape, scratch: &mut Scratch) -> f64 {
        if !scratch.cover.compute(s, self.w, self.h, true) {
            return f64::INFINITY;
        }
        // q：按 m² 加权，l：按 m 加权
        let (mut q, mut l) = ([0.0f64; N], [0.0f64; N]);
        let (mut qa, mut la) = ([0.0f64; 5], [0.0f64; 5]);
        let transparent = self.is_transparent();
        let stride = (self.w + 1) * N;
        for sp in &scratch.cover.spans {
            if sp.m == 1.0 {
                // 内部像素：前缀和之差，二次项与一次项相同
                let a = sp.y * stride + sp.x1 * N;
                let b = sp.y * stride + (sp.x2 + 1) * N;
                let (pa, pb) = (&self.prefix[a..a + N], &self.prefix[b..b + N]);
                for j in 0..N {
                    let d = pb[j] - pa[j];
                    q[j] += d;
                    l[j] += d;
                }
                if transparent {
                    let aa = (sp.y * (self.w + 1) + sp.x1) * 5;
                    let ab = (sp.y * (self.w + 1) + sp.x2 + 1) * 5;
                    for j in 0..5 {
                        let d = self.alpha_prefix[ab + j] - self.alpha_prefix[aa + j];
                        qa[j] += d;
                        la[j] += d;
                    }
                }
                continue;
            }
            // 边缘像素：直接读画面与目标（比前缀和表小得多，按行连续），只累加用得到的项
            let (m, m2) = (sp.m, sp.m * sp.m);
            for x in sp.x1..=sp.x2 {
                let p = sp.y * self.w + x;
                let v = &self.px[p];
                let wt = v[0];
                let (wq, wl) = (m2 * wt, m * wt);
                q[15] += wq;
                for c in 0..3 {
                    let (b, t) = (v[1 + c], v[4 + c]);
                    q[6 + c] += wq * b;
                    q[9 + c] += wq * b * b;
                    l[c] += wl * t;
                    l[6 + c] += wl * b;
                    l[9 + c] += wl * b * b;
                    l[12 + c] += wl * b * t;
                }
                if let Some(target) = &self.target_alpha {
                    let (a, ta) = (v[7], target[p] as f64);
                    qa[0] += wq * a;
                    qa[1] += wq * a * a;
                    la[0] += wl * a;
                    la[1] += wl * a * a;
                    la[2] += wl * ta;
                    la[3] += wl * a * ta;
                }
            }
        }
        let al = s.a as f64 / 255.0;
        let den = al * al * q[15];
        if den <= 1e-20 {
            return f64::INFINITY;
        }
        let mut delta = 0.0;
        let mut color = 0u32;
        for c in 0..3 {
            // T1 = c, C1 = 6 + c, C2 = 9 + c, CT = 12 + c
            let num = al * al * q[6 + c] - al * (l[6 + c] - l[c]);
            let constant = al * al * q[9 + c] - 2.0 * al * (l[9 + c] - l[12 + c]);
            let k = js_round(num / den).clamp(0.0, 255.0);
            delta += den * k * k - 2.0 * k * num + constant;
            color = (color << 8) | k as u32;
        }
        if self.is_transparent() {
            // [A, A², 目标 A, A·目标 A, 目标 A²]
            delta += 2.0 * al * (255.0 * la[0] - la[1] - 255.0 * la[2] + la[3]) + al * al * (65025.0 * q[15] - 510.0 * qa[0] + qa[1]);
        }
        s.c = color;
        delta
    }

    /// 搜索循环里用的评估：硬边图元与 evaluate 相同；软边图元在与其尺寸相称的缩小画面上近似计算，
    /// 开销不随图元面积增长。近似值只用来比较候选，选定的图元要再用 evaluate 复算。
    pub(crate) fn evaluate_search(&self, s: &mut Shape, scratch: &mut Scratch) -> f64 {
        match &self.soft {
            Some(soft) if s.k >= 4 => {
                let (quad, lin) = soft.sums(s, &mut scratch.lines, false);
                soft_delta(s, &quad, &lin)
            }
            _ => self.evaluate(s, scratch),
        }
    }

    fn evaluate_soft(&self, s: &mut Shape, scratch: &mut Scratch) -> f64 {
        let rows = rasterize(s, self.w, self.h, &mut scratch.lines);
        let mut den = 0.0;
        let mut num = [0.0; 3];
        let mut bc = [0.0; 3];
        let mut constant = 0.0;
        let al = s.a as f64 / 255.0;
        for l in scratch.lines[..rows*3].chunks_exact(3) {
            for (p,m) in coverage_row(s, l[0] as usize, l[1] as usize, l[2] as usize, self.w) {
                let q = al*m;
                // 每个像素的贡献乘它的权重 ω
                let wt = self.omega[p];
                den += q*q*wt;
                if let Some(target) = &self.target_alpha {
                    let before = self.current_alpha[p];
                    let r = before-target[p] as f64;
                    let d = q*(255.0-before);
                    constant += (d*d+2.0*r*d)*wt;
                }
                for c in 0..3 {
                    let b = self.current[p*3+c];
                    let r = b-self.target[p*3+c] as f64;
                    num[c] += q*(q*b-r)*wt;
                    bc[c] += (q*r-q*q*b)*wt;
                    constant += (q*q*b*b-2.0*q*r*b)*wt;
                }
            }
        }
        if den <= 1e-20 { return f64::INFINITY; }
        let mut delta = constant;
        let mut color = 0;
        for c in 0..3 {
            let k = js_round(num[c]/den).clamp(0.0,255.0);
            delta += den*k*k + 2.0*k*bc[c];
            color = (color<<8) | k as u32;
        }
        s.c = color;
        delta
    }

    /// 按图元自带的颜色与不透明度绘制，逐像素累计误差变化，只刷新覆盖到的行。
    pub fn add(&mut self, s: &Shape) {
        let mut cover = std::mem::take(&mut self.cover);
        cover.compute(s, self.w, self.h, self.antialias);
        let al = s.a as f64 / 255.0;
        let col = [((s.c >> 16) & 255) as f64, ((s.c >> 8) & 255) as f64, (s.c & 255) as f64];
        // 覆盖按行号递增
        self.add_rows = cover.rows();
        for (pixel,m) in cover.pixels(s, self.w) {
            let al = al*m;
            let wt = self.omega[pixel];
            if let Some(target) = &self.target_alpha {
                let before = self.current_alpha[pixel];
                let after = before+(255.0-before)*al;
                let t = target[pixel] as f64;
                self.current_alpha[pixel] = after;
                self.error += ((after-t).powi(2)-(before-t).powi(2))*wt;
            }
            for c in 0..3 {
                let p = pixel * 3 + c;
                let t = self.target[p] as f64;
                let before = self.current[p];
                let after = before + (col[c] - before) * al;
                self.current[p] = after;
                self.error += ((after - t) * (after - t) - (before - t) * (before - t)) * wt;
            }
        }
        if let Some((first, last)) = self.add_rows {
            for y in first..=last {
                self.refresh_row(y);
            }
        }
        self.cover = cover;
        self.refresh_row_cum();
        if let Some((first, last)) = self.add_rows.take() {
            self.refresh_soft(first, last);
        }
    }

    fn clamp(&self, m: Raw) -> Shape {
        let side = |v: f64, max: usize| js_round(v).clamp(0.0, max as f64) as i32;
        let size = |v: f64| js_round(v).clamp(1.0, (2 * self.s) as f64) as i32;
        let period = if m.k == KIND_TRIANGLE || m.k == KIND_LINEAR { 360 } else { 180 };
        let a = if self.fixed_alpha != 0 {
            self.fixed_alpha
        } else {
            js_round(m.a).clamp(self.min_alpha as f64, 255.0) as i32
        };
        Shape {
            k: m.k,
            x: side(m.x, self.w),
            y: side(m.y, self.h),
            w: size(m.w),
            h: size(m.h),
            r: (js_round(m.r) as i64).rem_euclid(period) as i32,
            a,
            c: 0,
            delta: f64::INFINITY,
        }
    }

    pub fn random_shape(&self, rng: &mut Rng) -> Shape {
        self.random_from(rng, &self.kinds)
    }

    fn random_from(&self, rng: &mut Rng, kinds: &[u8]) -> Shape {
        let k = kinds[rng.int(kinds.len())];
        let limit = (self.s as f64 * 0.3).max(2.0);
        let guided = if self.guided > 0.0 && rng.next() < self.guided { self.sample_error_pixel(rng) } else { None };
        let (x, y) = match guided {
            // 像素 (px, py) 占 [px, px + 1]：中心取它的某个角
            Some((px, py)) => ((px + rng.int(2)) as f64, (py + rng.int(2)) as f64),
            None => (rng.int(self.w + 1) as f64, rng.int(self.h + 1) as f64),
        };
        let w = 1.0 + rng.next() * limit;
        let h = 1.0 + rng.next() * limit;
        let r = rng.int(360) as f64;
        let a = if self.fixed_alpha != 0 { self.fixed_alpha as f64 } else { 128.0 };
        self.clamp(Raw { k, x, y, w, h, r, a })
    }

    pub fn mutate(&self, s: &Shape, rng: &mut Rng) -> Shape {
        let mut m = Raw { k: s.k, x: s.x as f64, y: s.y as f64, w: s.w as f64, h: s.h as f64, r: s.r as f64, a: s.a as f64 };
        let step = (self.s as f64 / 16.0).max(2.0);
        let options = if self.fixed_alpha != 0 { 4 } else { 5 };
        match rng.int(options) {
            0 => {
                m.x += rng.normal() * step;
                m.y += rng.normal() * step;
            }
            1 => m.w += rng.normal() * step,
            2 => m.h += rng.normal() * step,
            3 => m.r += rng.normal() * 24.0,
            _ => m.a += rng.normal() * 24.0,
        }
        self.clamp(m)
    }

    /// 找一个使误差下降最多的图元（带 delta 与颜色）；找不到能降低误差的就返回 delta ≥ 0 的最好结果。
    /// 只读：多个线程可以各拿一个 rng 和 scratch，同时在同一个 Fitter 上搜索。
    pub fn search(&self, rng: &mut Rng, budget: Budget, scratch: &mut Scratch) -> Shape {
        self.search_from(rng, budget, scratch, &self.kinds, &|| false)
    }

    pub(crate) fn search_from(&self, rng: &mut Rng, budget: Budget, scratch: &mut Scratch, kinds: &[u8], stopped: &(impl Fn() -> bool + Sync)) -> Shape {
        let mut best: Option<Shape> = None;
        for _ in 0..budget.restarts.max(1) {
            let mut state: Option<Shape> = None;
            for _ in 0..budget.candidates.max(1) {
                if stopped() { break; }
                let mut s = self.random_from(rng, kinds);
                // 抗锯齿时随机候选先按像素中心粗筛（约快 5 倍），选出的起点再按面积覆盖复算后爬山
                s.delta = if self.antialias && s.k <= 3 { self.evaluate_center(&mut s, scratch) } else { self.evaluate_search(&mut s, scratch) };
                if state.map_or(true, |st| s.delta < st.delta) {
                    state = Some(s);
                }
            }
            let Some(mut state) = state else { break; };
            if self.antialias && state.k <= 3 {
                state.delta = self.evaluate_aa(&mut state, scratch);
            }
            let mut fails = 0;
            while fails < budget.age && !stopped() {
                let mut m = self.mutate(&state, rng);
                m.delta = self.evaluate_search(&mut m, scratch);
                if m.delta < state.delta {
                    state = m;
                    fails = 0;
                } else {
                    fails += 1;
                }
            }
            if state.k >= 4 && self.soft.is_some() {
                // 搜索时用的是近似值：选定后按精确公式复算误差变化量与颜色
                state.delta = self.evaluate(&mut state, scratch);
            }
            if best.map_or(true, |b| state.delta < b.delta) {
                best = Some(state);
            }
        }
        best.unwrap_or(Shape { k: kinds[0], x:0, y:0, w:1, h:1, r:0, a:255, c:0, delta:f64::INFINITY })
    }
}

/// 由软边图元的加权和（见 soft.rs）求最优颜色（写入 s.c）与整图平方误差变化量；没有覆盖时返回正无穷。
fn soft_delta(s: &mut Shape, quad: &[f64; QUAD], lin: &[f64; LIN]) -> f64 {
    let al = s.a as f64 / 255.0;
    let den = al * al * quad[0];
    if den <= 1e-20 {
        return f64::INFINITY;
    }
    let mut delta = al * al * quad[7] + 2.0 * al * lin[6];
    let mut color = 0u32;
    for c in 0..3 {
        let num = al * al * quad[1 + c] - al * lin[c];
        let k = js_round(num / den).clamp(0.0, 255.0);
        delta += al * al * quad[4 + c] - 2.0 * al * lin[3 + c] + den * k * k - 2.0 * k * num;
        color = (color << 8) | k as u32;
    }
    s.c = color;
    delta
}
