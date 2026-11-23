//! 图元拟合：用素材库的纯白矩形 100001、圆 100002、等腰三角形 100003 染色、半透明叠加，逼近一张图片；
//! 外层是一个纯色矩形遮罩（颜色 = 背景色）。
//!
//! 移植自 In Falsus 制谱器的 primfit.js，光栅化与误差计算与它逐项一致（见 tests/parity.rs）。
//! 不同之处：全部搜索线程共享同一份只读的拟合状态，每加一个图元只更新一次。
//! 另外两项那份 JS 没有的改进：候选图元的中心可以按当前误差加权抽取（FitOptions::guided），
//! 以及贪心结束后的精修（run_refine，见 refine.rs）。
//! 支持实测软边图元（4 径向 / 5 单向 / 6 对称光带）；硬边评分继续使用前缀和。
//! 可选逐像素误差权重（FitOptions::weights，界面上的「重点区域」）：优化 Σ ω·(F − T)²，相似度仍不加权；
//! 不给权重时结果与不支持权重的实现逐位相同（tests/weights.rs）。
//! 可选抗锯齿评分（FitOptions::antialias，编辑器开启，2026-11-19）：硬边图元按面积覆盖率（raster.rs 的 Cover，
//! 每像素行 AA_SUB 条子扫描线）评分、绘制与精修，与编辑器预览和游戏的抗锯齿绘制一致；不开时按像素中心采样，
//! 与 JS 逐位一致。只按中心采样时细长图元能从像素中心之间穿过去不被罚分，画出来是贯穿黑底的细线
//! （tests/sliver.rs 诊断，tests/antialias.rs 验证评估、增量绘制与精修的一致性）。

mod fitter;
mod raster;
mod refine;
mod refine_alpha;
mod rng;
mod soft;
mod target;

pub use fitter::{Budget, FitOptions, Fitter, Scratch, BUDGET_FAST, BUDGET_FINE, BUDGET_NORMAL};
pub use raster::{rasterize, Cover, Span, AA_SUB, Shape, KIND_ELLIPSE, KIND_RECT, KIND_TRIANGLE, KIND_RADIAL, KIND_LINEAR, KIND_BAND, gradient_kernel, coverage_row};
pub use rng::{seed_for, Rng};
pub use target::{average_color, prepare_target, prepare_target_alpha, prepare_weights, resize_rgba, Target, AlphaTarget};

use rayon::prelude::*;

/// 默认搜索线程数：留一个核给界面。
pub fn default_threads() -> usize {
    std::thread::available_parallelism().map_or(1, |n| n.get()).saturating_sub(1).max(1)
}

fn make_pool(threads: usize) -> Option<rayon::ThreadPool> {
    if threads > 1 {
        rayon::ThreadPoolBuilder::new().num_threads(threads).build().ok()
    } else {
        None
    }
}

/// 一组搜索任务：硬边一组占 threads 个；各种软边合起来再占 threads 个，轮流分给每种（每种至少一个）。
/// 于是多开几种软边不再成倍增加工作量。只有一组时每个任务的随机数种子与最初的实现相同。
struct Searcher {
    pool: Option<rayon::ThreadPool>,
    groups: Vec<Vec<u8>>,
    hard: bool,
    hard_tasks: usize,
    scratches: Vec<Scratch>,
}

impl Searcher {
    fn new(fitter: &Fitter, threads: usize) -> Self {
        let groups = fitter.search_groups();
        let hard = groups.first().is_some_and(|g| g[0] <= 3);
        let soft_groups = groups.len() - hard as usize;
        let hard_tasks = if hard { threads } else { 0 };
        let soft_tasks = if soft_groups > 0 { threads.max(soft_groups) } else { 0 };
        Searcher {
            pool: make_pool(threads),
            groups,
            hard,
            hard_tasks,
            scratches: (0..hard_tasks + soft_tasks).map(|_| fitter.scratch()).collect(),
        }
    }

    /// 在当前画面上找一个使误差下降最多的图元（delta 与颜色已是精确值）。index 区分不同的搜索，
    /// 相同的 seed 与 index 得到相同的结果。
    fn best(&mut self, fitter: &Fitter, budget: Budget, seed: u32, index: u32, stopped: &(impl Fn() -> bool + Sync)) -> Shape {
        let (groups, hard, hard_tasks) = (&self.groups, self.hard as usize, self.hard_tasks);
        let soft_groups = groups.len() - hard;
        let search = |(j, scratch): (usize, &mut Scratch)| {
            // 任务 j → (组, 组内序号)
            let (g, worker) = if j < hard_tasks { (0, j) } else { (hard + (j - hard_tasks) % soft_groups, (j - hard_tasks) / soft_groups) };
            let group = &groups[g];
            let group_seed = if group[0] <= 3 { seed } else { seed_for(seed, 0x6000 + group[0] as u32, 0) };
            let mut rng = Rng::new(seed_for(group_seed, index, worker as u32));
            fitter.search_from(&mut rng, budget, scratch, group, stopped)
        };
        let results: Vec<Shape> = match &self.pool {
            Some(pool) => pool.install(|| self.scratches.par_iter_mut().enumerate().map(search).collect()),
            _ => self.scratches.iter_mut().enumerate().map(search).collect(),
        };
        // 按任务序号取第一个最小值，结果与线程调度无关
        let mut best = results[0];
        for r in &results[1..] {
            if r.delta < best.delta {
                best = *r;
            }
        }
        best
    }
}

/// 每轮精修后最多尝试搬走这么多个图元（另受图元总数的十分之一限制）
const RELOCATE_MAX: usize = 64;
/// 连续这么多次搬家没有降低误差就停
const RELOCATE_FAILS: usize = 3;

/// 搬家：把贡献最小的图元拿掉，在拿掉之后的画面上重新找一个最好的图元放到最上层。
/// 只有整图误差确实下降才保留，否则原样放回。gains 是刚做完的那一轮精修给出的各图元贡献。
/// 图元总数不变；被搬走的图元从原来的叠放位置消失，新图元在最上面。
fn relocate(
    fitter: &mut Fitter,
    shapes: &mut [Shape],
    gains: &[f64],
    searcher: &mut Searcher,
    budget: Budget,
    seed: u32,
    stopped: &(impl Fn() -> bool + Sync),
) {
    let n = shapes.len();
    if gains.len() != n || n < 2 {
        return;
    }
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|a, b| gains[*a].total_cmp(&gains[*b]));
    // 原来的序号 → 现在的位置（前面有图元被搬走后，后面的都往前挪一位）
    let mut position: Vec<usize> = (0..n).collect();
    let (mut fails, mut moved) = (0, false);
    for (attempt, &original) in order.iter().take((n / 10).clamp(1, RELOCATE_MAX)).enumerate() {
        if stopped() {
            break;
        }
        let p = position[original];
        let before = fitter.error();
        let removed = shapes[p];
        shapes[p..].rotate_left(1);
        fitter.rebuild(&shapes[..n - 1]);
        let found = searcher.best(fitter, budget, seed, 0x7E10_0000 + attempt as u32, stopped);
        let mut keep = !stopped() && found.delta < 0.0;
        if keep {
            fitter.add(&found);
            keep = fitter.error() < before;
        }
        if keep {
            shapes[n - 1] = found;
            for q in position.iter_mut() {
                if *q > p {
                    *q -= 1;
                }
            }
            (fails, moved) = (0, true);
        } else {
            shapes[n - 1] = removed;
            shapes[p..].rotate_right(1);
            fitter.rebuild(shapes);
            fails += 1;
            if fails >= RELOCATE_FAILS {
                break;
            }
        }
    }
    if moved {
        // 消除增量更新累积的浮点误差
        fitter.rebuild(shapes);
    }
}

/// 精修：对已经拟合出的全部图元做 passes 轮回头调整（见 refine.rs），整图误差只降不升。
/// 每一轮先自下而上调整每个图元（位置、尺寸、旋转、不透明度、颜色，以及在可用类型之间换类型），
/// 再把贡献最小的少数图元搬到别处（见 relocate）。每个图元的调整强度取 budget.age。
/// on_progress(第几轮（从 0 起）, 这一轮已处理的图元数)。
/// stopped() 为真时在搜索循环中取消，已做的调整保留。返回完整做完的轮数。
/// 注意：精修后的图元是按「全部一起显示」优化的，叠放顺序也可能变了，只取前 k 个时不再保证是 k 个图元的最好结果。
pub fn run_refine(
    fitter: &mut Fitter,
    shapes: &mut [Shape],
    passes: usize,
    budget: Budget,
    seed: u32,
    threads: usize,
    mut on_progress: impl FnMut(usize, usize),
    stopped: impl Fn() -> bool + Sync,
) -> usize {
    let threads = threads.max(1);
    let mut searcher = Searcher::new(fitter, threads);
    for pass in 0..passes {
        // 每一轮用不同的种子，不重复上一轮试过的改动
        let pass_seed = seed_for(seed, 0x5EED_0000 + pass as u32, 0);
        let done = fitter.refine_pass(shapes, budget.age, pass_seed, searcher.pool.as_ref(), threads, |n| on_progress(pass, n), &stopped);
        if !done {
            return pass;
        }
        let gains = fitter.take_gains();
        relocate(fitter, shapes, &gains, &mut searcher, budget, pass_seed, &stopped);
    }
    passes
}

/// 逐个添加图元，最多 count 个。每个图元由若干搜索任务各自搜索（见 Searcher），取误差下降最多的一个。
/// on_shape(图元, 序号, 拟合状态) 每添加一个调用一次；候选与爬山循环会检查 stopped()。
/// 再也找不到能降低误差的图元时提前结束。相同的种子和线程数得到相同的结果。
pub fn run_fit(
    fitter: &mut Fitter,
    count: usize,
    budget: Budget,
    seed: u32,
    threads: usize,
    mut on_shape: impl FnMut(&Shape, usize, &Fitter),
    stopped: impl Fn() -> bool + Sync,
) -> Vec<Shape> {
    let mut searcher = Searcher::new(fitter, threads.max(1));
    let mut shapes = Vec::with_capacity(count);
    for i in 0..count {
        if stopped() {
            break;
        }
        let best = searcher.best(fitter, budget, seed, i as u32, &stopped);
        if stopped() || !(best.delta < 0.0) {
            break;
        }
        fitter.add(&best);
        shapes.push(best);
        on_shape(&best, i, fitter);
    }
    shapes
}
