import { describe, expect, it } from "vitest";
import { agentPrompt } from "./agentPrompt";
import { initialPixelSize, readPixelResult, serializePixelArtLua } from "./pixelArt";
import { artFromTable, parseArtLua, serializeArtLua, type Art } from "./primfit";

function resultBuffer(rects: number[][]): ArrayBuffer {
  const buffer = new ArrayBuffer(4 + rects.length * 20 + 8);
  const view = new DataView(buffer);
  view.setUint32(0, rects.length, true);
  rects.flat().forEach((value, i) => view.setUint32(4 * (i + 1), value, true));
  new Uint8Array(buffer, 4 + rects.length * 20).set([137, 80, 78, 71, 13, 10, 26, 10]);
  return buffer;
}

// 读出 Lua 字符串数据，独立按输出约定恢复图元，检查末尾没有剩余字节。
function decodePacked(text: string, width: number, height: number): Art {
  const alphabet = /local alphabet = "([^"]+)"/.exec(text)![1];
  const chunks = /^"([^"]+)",$/gm;
  const data = [...text.matchAll(chunks)].map((match) => match[1]).join("");
  const radix = alphabet.length / 2;
  const values: number[] = [];
  let digits: number[] = [];
  for (const character of data) {
    const digit = alphabet.indexOf(character);
    expect(digit).toBeGreaterThanOrEqual(0);
    digits.push(digit % radix);
    if (digit < radix) {
      values.push(digits.reduceRight((value, next) => value * radix + next, 0));
      digits = [];
    }
  }
  expect(digits).toEqual([]);
  const [colorCount, sizeCount, recordCount, ...body] = values;
  const palette = body.slice(0, colorCount);
  const sizes = body.slice(colorCount, colorCount + sizeCount * 2);
  const records = body.slice(colorCount + sizeCount * 2);
  expect(records.length).toBe(recordCount * 3);
  const shapes: number[] = [];
  let position = 0;
  for (let i = 0; i < records.length; i += 3) {
    position += records[i];
    const size = records[i + 1] * 2;
    const [w, h] = sizes.slice(size, size + 2);
    const x = position % width;
    const y = Math.floor(position / width);
    shapes.push(1, x * 2 + w, (height - y) * 2 - h, w * 2, h * 2, 0, palette[records[i + 2]]);
  }
  return artFromTable({ format: 3, w: width * 2, h: height * 2, bg: 0, bgAlpha: 0, shapes });
}

describe("像素画 Lua 导出", () => {
  it("按原图比例初始化尺寸，短边至少为 1，且小图保持原始宽高", () => {
    expect(initialPixelSize(512, 99)).toEqual({ width: 64, height: 12 });
    expect(initialPixelSize(1, 8192)).toEqual({ width: 1, height: 64 });
    expect(initialPixelSize(31, 15)).toEqual({ width: 31, height: 15 });
  });

  it("保留奇数宽度的半像素中心、左下坐标和透明度", () => {
    const { art, png } = readPixelResult(resultBuffer([[1, 0, 3, 1, 0x80203c5a], [0, 2, 1, 1, 0xff000000]]), 5, 3);
    expect(art.width).toBe(10);
    expect(art.height).toBe(6);
    expect(art.shapes).toEqual([
      { k: 1, x: 5, y: 5, w: 6, h: 2, r: 0, a: 128, c: 0x203c5a },
      { k: 1, x: 1, y: 1, w: 2, h: 2, r: 0, a: 255, c: 0 },
    ]);
    expect(png.byteLength).toBe(8);
    const lua = serializePixelArtLua(art, "Sample", "原图.png");
    expect(lua.packed).toBe(false);
    expect(parseArtLua(lua.text)).toEqual(art);
    expect(lua.bytes).toBe(new TextEncoder().encode(lua.text).length);
  });

  it("可导出全透明画面，拒绝截断的计算结果", () => {
    const { art } = readPixelResult(resultBuffer([]), 1, 1);
    expect(parseArtLua(serializePixelArtLua(art, "Empty", "空.png").text)).toEqual(art);
    expect(() => readPixelResult(resultBuffer([[0, 0, 1, 1, 0xffffffff]]).slice(0, 14), 1, 1)).toThrow("成品数据不完整");
  });

  it("压缩调色板、尺寸和间隔后逐条还原，并按整个 Lua 文件计算节省", () => {
    const width = 85;
    const height = 24;
    const rects: number[][] = [];
    for (let y = 0; y < height; y++) {
      for (let x = y % 3; x < width - 1; x += 3) {
        rects.push([x, y, x % 2 + 1, 1, y % 2 ? 0xff30c070 : 0x80705030]);
      }
    }
    const { art } = readPixelResult(resultBuffer(rects), width, height);
    const result = serializePixelArtLua(art, "PixelArt", "条纹.png");
    const baseline = serializeArtLua(art, { module: "PixelArt", source: "条纹.png", pixelGrid: { width, height } });
    expect(result.packed).toBe(true);
    expect(result.bytes).toBeLessThan(new TextEncoder().encode(baseline).length);
    expect(result.bytes).toBe(new TextEncoder().encode(result.text).length);
    expect(decodePacked(result.text, width, height)).toEqual(art);

    const prompt = agentPrompt({ module: "SavedPixel", art, pixelArt: { filename: "SavedPixel.lua", packed: true } });
    expect(prompt).toContain("`SavedPixel.lua`");
    expect(prompt).toContain("85 × 24 px");
    expect(prompt).toContain("170 × 48");
    expect(prompt).toContain('PrimArtView.load("SavedPixel")');
    expect(prompt).toContain("自行解码");
    expect(prompt).toContain("builder.step(96)");
  });
});
