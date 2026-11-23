import { describe, expect, it } from "vitest";
import PRIM_ART_VIEW from "./PrimArtView.lua?raw";
import { agentPrompt } from "./agentPrompt";
import type { Art } from "./primfit";

const hard: Art = {
  width: 200,
  height: 150,
  bg: 0x2a2b33,
  shapes: [
    { k: 2, x: 109, y: 61, w: 57, h: 99, r: 82, a: 0xe5, c: 0xa39de7 },
    { k: 1, x: 152, y: 113, w: 35, h: 203, r: 9, a: 0x18, c: 0xf8f0ff },
  ],
};
const transparent: Art = {
  width: 64,
  height: 64,
  bg: 0,
  bgAlpha: 0,
  shapes: [{ k: 4, x: 32, y: 32, w: 40, h: 30, r: 0, a: 200, c: 0xffffff }],
};

describe("Agent 提示词", () => {
  it("提示词附带完整的参考绘制代码", () => {
    const text = agentPrompt({ module: "CoverArt", art: hard }).replace(/\r\n/g, "\n");
    const section = text.slice(text.indexOf("## 6. 参考实现"));
    const code = /```lua\n([\s\S]*?)\n```/.exec(section)?.[1];
    expect(code).toBe(PRIM_ART_VIEW.replace(/\r\n/g, "\n").trimEnd());
  });

  it("包含各章节，并代入本次导出的参数", () => {
    const text = agentPrompt({ module: "CoverArt", art: hard, similarity: 0.9331, source: "cover.png" });
    for (const heading of ["## 1. 本次导出的模块", "## 2. 模块格式", "## 3. 图元类型", "## 4. 运行环境前提", "## 5. 先在工作区里找", "## 6. 参考实现", "## 7. 必须遵守", "## 8. 完成后交给用户的事"]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("`format = 1`");
    expect(text).toContain("200 × 150");
    expect(text).toContain("图元数：2");
    expect(text).toContain("1 矩形、2 椭圆");
    expect(text).toContain("93.3%");
    expect(text).toContain('PrimArtView.load("CoverArt")');
    expect(text).toContain("function V.begin(parent, name, art, x, y, width, count)");
    // format 1 只列硬图元
    expect(text).not.toContain("| 4 | 柔边椭圆");
    // 不引用本机路径
    expect(text).not.toMatch(/[A-Za-z]:\\|docs\//);
  });

  it("透明格式写出 bgAlpha 与透明底检查", () => {
    const text = agentPrompt({ module: "Logo", art: transparent });
    expect(text).toContain("`format = 3`，背景不透明度 `bgAlpha = 0`（透明底）");
    expect(text).toContain("bgAlpha=0,");
    expect(text).toContain("| 4 | 柔边椭圆 | 106057 | `Basic` | 是 |");
    expect(text).toContain("深色、浅色和彩色背景");
    expect(text).not.toContain("相似度");
  });
});
