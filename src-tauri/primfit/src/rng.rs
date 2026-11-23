//! 可复现的随机数：mulberry32，与 In Falsus 制谱器的 primfit.js 逐位一致。

pub struct Rng {
    s: u32,
    spare: Option<f64>,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng { s: if seed == 0 { 1 } else { seed }, spare: None }
    }

    /// [0, 1) 均匀分布
    pub fn next(&mut self) -> f64 {
        self.s = self.s.wrapping_add(0x6D2B_79F5);
        let s = self.s;
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }

    /// [0, n) 的整数
    pub fn int(&mut self, n: usize) -> usize {
        (self.next() * n as f64).floor() as usize
    }

    /// 标准正态分布（Box–Muller，成对产生）
    pub fn normal(&mut self) -> f64 {
        if let Some(v) = self.spare.take() {
            return v;
        }
        let mut u = 0.0;
        while u == 0.0 {
            u = self.next();
        }
        let v = self.next();
        let r = (-2.0 * u.ln()).sqrt();
        let angle = 2.0 * std::f64::consts::PI * v;
        self.spare = Some(r * angle.sin());
        r * angle.cos()
    }
}

/// 每个图元、每个搜索线程一个独立种子。
pub fn seed_for(seed: u32, index: u32, worker: u32) -> u32 {
    let mut h = seed
        ^ index.wrapping_add(1).wrapping_mul(0x9E37_79B1)
        ^ worker.wrapping_add(1).wrapping_mul(0x85EB_CA77);
    h = (h ^ (h >> 16)).wrapping_mul(0x7FEB_352D);
    h ^ (h >> 15)
}
