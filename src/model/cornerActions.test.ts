import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORNER_EXIT_MS,
  clearCornerActions,
  cornerActions,
  removeCornerAction,
  upsertCornerAction,
} from "../lib/cornerActions.svelte";
import { primfitProgress } from "./primfit";

const noop = () => {};

describe("cornerActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearCornerActions();
  });

  afterEach(() => {
    clearCornerActions();
    vi.useRealTimers();
  });

  it("places first button at bottom (slot 0) and stacks newer buttons above it", () => {
    upsertCornerAction({ id: "a", icon: "shapes", label: "A", detail: "A", onclick: noop });
    upsertCornerAction({ id: "b", icon: "play", label: "B", detail: "B", onclick: noop });
    upsertCornerAction({ id: "c", icon: "export", label: "C", detail: "C", onclick: noop });
    expect(cornerActions.map((x) => [x.id, x.slot])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("updates an existing button in place without changing slot or replaying enter", () => {
    upsertCornerAction({ id: "a", icon: "shapes", label: "A", detail: "10%", progress: 0.1, onclick: noop });
    upsertCornerAction({ id: "a", icon: "shapes", label: "A", detail: "80%", progress: 0.8, onclick: noop });
    expect(cornerActions).toHaveLength(1);
    expect(cornerActions[0]).toMatchObject({ id: "a", slot: 0, enterKey: 1, detail: "80%", progress: 0.8, exiting: false });
  });

  it("clamps progress into [0, 1]", () => {
    upsertCornerAction({ id: "a", icon: "shapes", label: "A", detail: "", progress: -0.5, onclick: noop });
    expect(cornerActions[0].progress).toBe(0);
    upsertCornerAction({ id: "a", icon: "shapes", label: "A", detail: "", progress: 1.5, onclick: noop });
    expect(cornerActions[0].progress).toBe(1);
  });

  it("keeps upper buttons in place while lower button exits, then drops them down together", () => {
    upsertCornerAction({ id: "a", icon: "shapes", label: "A", detail: "A", onclick: noop });
    upsertCornerAction({ id: "b", icon: "play", label: "B", detail: "B", onclick: noop });
    upsertCornerAction({ id: "c", icon: "export", label: "C", detail: "C", onclick: noop });

    removeCornerAction("a");
    // 退出动画期间：a 标记 exiting，上方 b、c 保持原槽位不下落
    expect(cornerActions.map((x) => [x.id, x.slot, x.exiting])).toEqual([
      ["a", 0, true],
      ["b", 1, false],
      ["c", 2, false],
    ]);

    vi.advanceTimersByTime(CORNER_EXIT_MS - 1);
    expect(cornerActions.map((x) => [x.id, x.slot])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);

    // 退出动画结束：a 移除，b、c 统一下落占位
    vi.advanceTimersByTime(1);
    expect(cornerActions.map((x) => [x.id, x.slot])).toEqual([
      ["b", 0],
      ["c", 1],
    ]);
  });

  it("cancels exit and replays enter if re-added before exit finishes", () => {
    upsertCornerAction({ id: "a", icon: "shapes", label: "A", detail: "A", onclick: noop });
    removeCornerAction("a");
    expect(cornerActions[0].exiting).toBe(true);

    upsertCornerAction({ id: "a", icon: "shapes", label: "A", detail: "A2", onclick: noop });
    expect(cornerActions[0]).toMatchObject({ exiting: false, enterKey: 2, detail: "A2" });

    vi.advanceTimersByTime(CORNER_EXIT_MS * 2);
    expect(cornerActions).toHaveLength(1);
  });
});

describe("primfitProgress", () => {
  it("maps build stage 0..100% linearly when refineGoal is 0", () => {
    expect(primfitProgress({ done: 0, goal: 200, refineGoal: 0, refining: null })).toMatchObject({
      progress: 0,
      percent: 0,
      stage: "build",
    });
    expect(primfitProgress({ done: 100, goal: 200, refineGoal: 0, refining: null })).toMatchObject({
      progress: 0.5,
      percent: 50,
      stage: "build",
    });
    expect(primfitProgress({ done: 200, goal: 200, refineGoal: 0, refining: null })).toMatchObject({
      progress: 1,
      percent: 100,
      stage: "build",
    });
  });

  it("allocates build + 2 refine passes as 2/3 build + 1/3 refine and stays monotonic", () => {
    const midBuild = primfitProgress({ done: 250, goal: 500, refineGoal: 2, refining: null });
    expect(midBuild.progress).toBeCloseTo(1 / 3, 5);
    expect(midBuild.percent).toBe(33);
    expect(midBuild.detail).toContain("建控件：250 / 500");

    const endBuild = primfitProgress({ done: 500, goal: 500, refineGoal: 2, refining: null });
    expect(endBuild.progress).toBeCloseTo(2 / 3, 5);

    const startRefine = primfitProgress({
      done: 420, // 提前收敛
      goal: 500,
      refineGoal: 2,
      refining: { pass: 1, passes: 2, index: 0, total: 420 },
    });
    expect(startRefine.progress).toBeCloseTo(2 / 3, 5);
    expect(startRefine.stage).toBe("refine");

    const midRefine = primfitProgress({
      done: 420,
      goal: 500,
      refineGoal: 2,
      refining: { pass: 1, passes: 2, index: 420, total: 420 },
    });
    expect(midRefine.progress).toBeCloseTo(5 / 6, 5);
    expect(midRefine.percent).toBe(83);
    expect(midRefine.detail).toContain("精修：第 1 / 2 轮（420 / 420）");

    const endRefine = primfitProgress({
      done: 420,
      goal: 500,
      refineGoal: 2,
      refining: { pass: 2, passes: 2, index: 420, total: 420 },
    });
    expect(endRefine.progress).toBeCloseTo(1, 5);
    expect(endRefine.percent).toBe(100);
  });
});
