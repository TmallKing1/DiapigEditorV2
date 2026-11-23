import { KIND, serializeArtLua, type Art } from "./primfit";

export const MAX_PIXEL_SIDE = 512;
const INITIAL_SIDE = 64;
const ENCODER = new TextEncoder();
// 安全的 Lua 双引号字符串字符。前半区终止，后半区表示还有一位。
const ALPHABET = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33))
  .filter((c) => c !== '"' && c !== "\\" && c !== "-").slice(0, 90).join("");
const RADIX = ALPHABET.length / 2;
const CHUNK_SIZE = 1024;
const RECORD_BYTES = 20;

export function initialPixelSize(width: number, height: number) {
  const scale = Math.min(1, INITIAL_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface PixelResult {
  art: Art;
  png: Uint8Array<ArrayBuffer>;
}

export function readPixelResult(buffer: ArrayBuffer, width: number, height: number): PixelResult {
  if (buffer.byteLength < 4) throw new Error("成品数据不完整");
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  const pngOffset = 4 + count * RECORD_BYTES;
  if (count > width * height || pngOffset + 8 > buffer.byteLength) throw new Error("成品数据不完整");
  const shapes: Art["shapes"] = [];
  for (let offset = 4; offset < pngOffset; offset += RECORD_BYTES) {
    const x = view.getUint32(offset, true);
    const y = view.getUint32(offset + 4, true);
    const w = view.getUint32(offset + 8, true);
    const h = view.getUint32(offset + 12, true);
    const color = view.getUint32(offset + 16, true);
    // 内部记录以左上为原点。Lua 使用左下原点及半像素坐标，中心仍是整数。
    shapes.push({ k: KIND.rect, x: 2 * x + w, y: 2 * (height - y) - h, w: 2 * w, h: 2 * h, r: 0, a: color >>> 24, c: color & 0xffffff });
  }
  return {
    art: { width: 2 * width, height: 2 * height, bg: 0, bgAlpha: 0, shapes },
    png: new Uint8Array(buffer, pngOffset),
  };
}

function encodeUInt(value: number): string {
  let encoded = "";
  while (value >= RADIX) {
    encoded += ALPHABET[RADIX + value % RADIX];
    value = Math.floor(value / RADIX);
  }
  return encoded + ALPHABET[value];
}

function frequencyOrder<Key>(items: Map<Key, number>): Key[] {
  return [...items.keys()].sort((a, b) => items.get(b)! - items.get(a)!);
}

/** 固定用矩形与零旋转。按左上角行序存格点间隔、宽高字典索引、ARGB 调色板索引。 */
function encodeRecords(art: Art, width: number, height: number): string {
  const colorCounts = new Map<number, number>();
  const sizeCounts = new Map<number, number>();
  const stride = MAX_PIXEL_SIDE + 1;
  for (const shape of art.shapes) {
    const color = shape.a * 0x1000000 + shape.c;
    const size = (shape.w / 2) * stride + shape.h / 2;
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
    sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + 1);
  }
  const palette = frequencyOrder(colorCounts);
  const sizes = frequencyOrder(sizeCounts);
  const colorIndex = new Map(palette.map((color, i) => [color, i]));
  const sizeIndex = new Map(sizes.map((size, i) => [size, i]));
  const stream = [encodeUInt(palette.length), encodeUInt(sizes.length), encodeUInt(art.shapes.length)];
  for (const color of palette) stream.push(encodeUInt(color));
  for (const size of sizes) stream.push(encodeUInt(Math.floor(size / stride)), encodeUInt(size % stride));
  let previous = 0;
  for (const shape of art.shapes) {
    const w = shape.w / 2;
    const h = shape.h / 2;
    const x = (shape.x - w) / 2;
    const y = height - (shape.y + h) / 2;
    const origin = y * width + x;
    const color = shape.a * 0x1000000 + shape.c;
    stream.push(encodeUInt(origin - previous), encodeUInt(sizeIndex.get(w * stride + h)!), encodeUInt(colorIndex.get(color)!));
    previous = origin;
  }
  return stream.join("");
}

export interface PixelLua {
  text: string;
  bytes: number;
  packed: boolean;
}

export function serializePixelArtLua(art: Art, module: string, source: string): PixelLua {
  const width = art.width / 2;
  const height = art.height / 2;
  const literal = serializeArtLua(art, { module, source, pixelGrid: { width, height } });
  const literalBytes = ENCODER.encode(literal).length;
  const records = encodeRecords(art, width, height);
  const chunks: string[] = [];
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    chunks.push(`"${records.slice(i, i + CHUNK_SIZE)}",`);
  }
  const comments = literal.slice(0, literal.indexOf("\nreturn {\n"));
  const packed = `${comments}
-- 此文件在 require 时还原同一格式的 shapes 表。
local data = table.concat({
${chunks.join("\n")}
})
local alphabet = "${ALPHABET}"
local digits = {}
for j = 1, #alphabet do digits[alphabet:byte(j)] = j - 1 end
local i = 1
local function read()
    local v, place = 0, 1
    while true do
        local d = assert(digits[data:byte(i)], "invalid pixel art data")
        i = i + 1
        v = v + (d % ${RADIX}) * place
        if d < ${RADIX} then return v end
        place = place * ${RADIX}
    end
end
local paletteCount, sizeCount, count = read(), read(), read()
local palette, widths, heights = {}, {}, {}
for j = 1, paletteCount do palette[j] = read() end
for j = 1, sizeCount do widths[j], heights[j] = read(), read() end
local shapes, origin = {}, 0
for j = 1, count do
    origin = origin + read()
    local size, color = read() + 1, read() + 1
    local w, h = widths[size], heights[size]
    local x, y = origin % ${width}, origin // ${width}
    local k = (j - 1) * 7
    shapes[k + 1], shapes[k + 2], shapes[k + 3] = 1, 2 * x + w, ${art.height} - 2 * y - h
    shapes[k + 4], shapes[k + 5], shapes[k + 6], shapes[k + 7] = 2 * w, 2 * h, 0, palette[color]
end
assert(i == #data + 1, "invalid pixel art data length")
return {format=3,w=${art.width},h=${art.height},bg=0,bgAlpha=0,shapes=shapes}
`;
  const packedBytes = ENCODER.encode(packed).length;
  return packedBytes < literalBytes
    ? { text: packed, bytes: packedBytes, packed: true }
    : { text: literal, bytes: literalBytes, packed: false };
}
