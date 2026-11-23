// 生成 parity.json：用 In Falsus 制谱器的 primfit.js 导出对拍数据。用法：node make-parity.mjs <primfit.js 路径> parity.json
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const [, , modPath, outPath] = process.argv;
const P = await import(pathToFileURL(modPath).href);

const out = {};

// 随机数
{
    const rng = P.createRng(12345);
    const next = []; for (let i = 0; i < 8; i++) next.push(rng.next());
    const ints = []; for (let i = 0; i < 8; i++) ints.push(rng.int(361));
    const normal = []; for (let i = 0; i < 6; i++) normal.push(rng.normal());
    const seeds = [];
    for (const [s, i, w] of [[1, 0, 0], [1, 5, 3], [0xDEADBEEF, 999, 7], [42, 4999, 15]]) seeds.push([s, i, w, P.seedFor(s, i, w)]);
    out.rng = { seed: 12345, next, ints, normal, seeds };
}

// 目标图缩小
{
    const rng = P.createRng(777);
    const sw = 37, sh = 23, rgba = [];
    for (let i = 0; i < sw * sh * 4; i++) rgba.push(rng.int(256));
    const cases = [];
    for (const [size, matte] of [[16, 0x204060], [200, 0xFFFFFF], [5, 0]]) {
        const t = P.prepareTarget(Uint8Array.from(rgba), sw, sh, size, matte);
        cases.push({ size, matte, width: t.width, height: t.height, data: Array.from(t.data), average: P.averageColor(t.data) });
    }
    out.target = { width: sw, height: sh, rgba, cases };
}

// 光栅化与评估
{
    const W = 64, H = 48;
    const rng = P.createRng(2026);
    const target = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3;
        target[o] = Math.min(255, Math.round(x * 4 + rng.int(30)));
        target[o + 1] = Math.min(255, Math.round(y * 5 + rng.int(30)));
        target[o + 2] = (Math.hypot(x - 32, y - 24) < 14 ? 220 : 40) + rng.int(30);
    }
    const fitter = new P.Fitter(target, W, H, { kinds: [1, 2, 3], alpha: 0 });
    const initialError = fitter.error;
    const added = [];
    for (let i = 0; i < 24; i++) {
        const s = fitter.search(P.createRng(P.seedFor(9, i, 0)), P.BUDGETS.fast);
        fitter.add(s);
        added.push([s.k, s.x, s.y, s.w, s.h, s.r, s.a, s.c]);
    }
    const lines = new Int32Array(H * 3);
    const probes = [];
    const probe = (s) => {
        const n = P.rasterize(s, W, H, lines);
        const delta = fitter.evaluate(s);
        probes.push({ s: [s.k, s.x, s.y, s.w, s.h, s.r, s.a], lines: Array.from(lines.subarray(0, n * 3)), delta: Number.isFinite(delta) ? delta : null, c: s.c });
    };
    let prev = fitter.randomShape(rng);
    for (let i = 0; i < 1900; i++) {
        const s = i % 2 === 0 ? fitter.randomShape(rng) : fitter.mutate(prev, rng);
        prev = s;
        probe({ ...s });
    }
    // 边界情况：轴对齐、超出画面、极小、极大
    for (const k of [1, 2, 3]) {
        for (const r of [0, 45, 90, 135, 180, 270]) {
            if (k !== 3 && r >= 180) continue;
            for (const [x, y, w, h] of [[32, 24, 10, 10], [0, 0, 7, 3], [64, 48, 9, 9], [32, 24, 128, 128], [10, 40, 1, 1], [31, 23, 2, 1], [5, 5, 96, 2]]) {
                for (const a of [24, 128, 255]) probe({ k, x, y, w, h, r, a, c: 0 });
            }
        }
    }
    out.fit = { width: W, height: H, target: Array.from(target), bg: fitter.bg, initialError, added, errorAfter: fitter.error, rmse: fitter.rmse(), probes };
}

writeFileSync(outPath, JSON.stringify(out));
console.log('probes', out.fit.probes.length, 'bytes', JSON.stringify(out).length);
