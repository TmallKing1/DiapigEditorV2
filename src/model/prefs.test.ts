import { describe, expect, it } from "vitest";
import { canvasSize, deviceFor, DEVICE_PRESETS, fontNameFromPath, fontStack, INTERVAL_RANGE, migrateUiFont, parseFontFamily, parseIntIn, SIZE_W, SYSTEM_UI, uniqueFamily } from "./prefs";

describe("设备预设", () => {
  it("每种设备的预设值反推回该设备", () => {
    for (const [d, p] of Object.entries(DEVICE_PRESETS)) {
      expect(deviceFor(p.keyHint, p.canvas, 1, 1)).toBe(d);
    }
  });

  it("预设值对照 AGENTS.md 5.1", () => {
    expect(DEVICE_PRESETS.pc).toEqual({ keyHint: "kbm", canvas: "1600x900" });
    expect(DEVICE_PRESETS.touch).toEqual({ keyHint: "none", canvas: "1280x720" });
    expect(DEVICE_PRESETS.console).toEqual({ keyHint: "pad", canvas: "1920x1080" });
    expect(DEVICE_PRESETS.mobilePad).toEqual({ keyHint: "pad", canvas: "1280x720" });
  });

  it("不构成任何设备时为自定义", () => {
    expect(deviceFor("kbm", "1280x720", 0, 0)).toBe("custom");
    expect(deviceFor("none", "1600x900", 0, 0)).toBe("custom");
    expect(deviceFor("pad", "1600x900", 0, 0)).toBe("custom");
  });

  it("自定义画布按实际宽高比较", () => {
    expect(deviceFor("kbm", "custom", 1600, 900)).toBe("pc");
    expect(deviceFor("kbm", "custom", 1600, 901)).toBe("custom");
    expect(deviceFor("pad", "custom", 1920, 1080)).toBe("console");
  });

  it("推导出界面上不可选的设备时按自定义处理", () => {
    expect(deviceFor("none", "1280x720", 0, 0, ["pc"])).toBe("custom");
    expect(deviceFor("kbm", "1600x900", 0, 0, ["pc"])).toBe("pc");
  });

  it("画布尺寸", () => {
    expect(canvasSize("1920x1080", 1, 2)).toEqual({ w: 1920, h: 1080 });
    expect(canvasSize("custom", 854, 480)).toEqual({ w: 854, h: 480 });
  });
});

describe("整数输入", () => {
  it("范围内的整数", () => {
    expect(parseIntIn("854", SIZE_W)).toBe(854);
    expect(parseIntIn(" 320 ", SIZE_W)).toBe(320);
    expect(parseIntIn("7680", SIZE_W)).toBe(7680);
    expect(parseIntIn("20", INTERVAL_RANGE)).toBe(20);
  });
  it("非法输入返回 null", () => {
    for (const s of ["", "abc", "12.5", "-5", "1e3", "319", "7681", "0x10", "99999999"]) expect(parseIntIn(s, SIZE_W)).toBeNull();
    expect(parseIntIn("4", INTERVAL_RANGE)).toBeNull();
    expect(parseIntIn("3601", INTERVAL_RANGE)).toBeNull();
  });
});

describe("界面字体回退链", () => {
  it("按顺序加引号，末尾接默认字体栈", () => {
    expect(fontStack(["JetBrains Mono NL", "汉仪文黑"])).toBe('"JetBrains Mono NL", "汉仪文黑", var(--font-default)');
  });
  it("系统界面字体不加引号，引号与反斜杠转义", () => {
    expect(fontStack([SYSTEM_UI, 'a"b\\c'])).toBe('system-ui, "a\\"b\\\\c", var(--font-default)');
  });
  it("空列表为空串", () => {
    expect(fontStack([])).toBe("");
  });
});

describe("旧版界面字体迁移", () => {
  it("单个字体 → 自定义列表", () => {
    expect(migrateUiFont({ uiFont: "SimHei", x: 1 })).toEqual({ uiFonts: ["SimHei"], uiFontMode: "custom", x: 1 });
  });
  it("空串 → 系统默认", () => {
    expect(migrateUiFont({ uiFont: "" })).toEqual({ uiFonts: [], uiFontMode: "default" });
  });
  it("已有列表时只去掉旧键", () => {
    expect(migrateUiFont({ uiFont: "A", uiFonts: ["B"], uiFontMode: "default" })).toEqual({ uiFonts: ["B"], uiFontMode: "default" });
    expect(migrateUiFont({ uiFonts: ["B"] })).toEqual({ uiFonts: ["B"] });
  });
});

describe("自定义字体命名", () => {
  it("文件名去扩展名", () => {
    expect(fontNameFromPath("C:\\Fonts\\HYWenHei-85W.ttf")).toBe("HYWenHei-85W");
    expect(fontNameFromPath("/a/b/思源黑体.OTF")).toBe("思源黑体");
    expect(fontNameFromPath("x/.woff2")).toBe("自定义字体");
  });
  it("重名加序号，不分大小写", () => {
    expect(uniqueFamily("A", [])).toBe("A");
    expect(uniqueFamily("A", ["a"])).toBe("A 2");
    expect(uniqueFamily("A", ["A", "A 2"])).toBe("A 3");
  });
});

/** 拼一个只有 name 表的最小 sfnt；records：[platform, encoding, lang, nameId, 文本] */
function sfnt(records: [number, number, number, number, string][], ttc = false): ArrayBuffer {
  const enc = (p: number, s: string) => (p === 3 ? [...s].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255]) : [...s].map((c) => c.charCodeAt(0)));
  const strs = records.map((r) => enc(r[0], r[4]));
  const nameLen = 6 + records.length * 12 + strs.reduce((a, s) => a + s.length, 0);
  const lead = ttc ? 16 : 0;
  const nameOff = lead + 12 + 16;
  const buf = new ArrayBuffer(nameOff + nameLen);
  const v = new DataView(buf);
  if (ttc) {
    [..."ttcf"].forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
    v.setUint32(8, 1);
    v.setUint32(12, lead);
  }
  v.setUint32(lead, 0x00010000);
  v.setUint16(lead + 4, 1);
  [..."name"].forEach((c, i) => v.setUint8(lead + 12 + i, c.charCodeAt(0)));
  v.setUint32(lead + 12 + 8, nameOff);
  v.setUint32(lead + 12 + 12, nameLen);
  v.setUint16(nameOff + 2, records.length);
  v.setUint16(nameOff + 4, 6 + records.length * 12);
  let at = 0;
  records.forEach((r, i) => {
    const e = nameOff + 6 + i * 12;
    v.setUint16(e, r[0]);
    v.setUint16(e + 2, r[1]);
    v.setUint16(e + 4, r[2]);
    v.setUint16(e + 6, r[3]);
    v.setUint16(e + 8, strs[i].length);
    v.setUint16(e + 10, at);
    strs[i].forEach((b, k) => v.setUint8(nameOff + 6 + records.length * 12 + at + k, b));
    at += strs[i].length;
  });
  return buf;
}

describe("字体家族名解析", () => {
  it("优先简体中文名，其次英文名", () => {
    expect(parseFontFamily(sfnt([[3, 1, 0x409, 1, "Source Han Sans"], [3, 1, 0x804, 1, "思源黑体"]]))).toBe("思源黑体");
    expect(parseFontFamily(sfnt([[3, 1, 0x409, 1, "Source Han Sans"], [3, 1, 0x411, 1, "源ノ角"]]))).toBe("Source Han Sans");
  });
  it("同语言下印刷家族名优先", () => {
    expect(parseFontFamily(sfnt([[3, 1, 0x409, 1, "Foo Bold"], [3, 1, 0x409, 16, "Foo"]]))).toBe("Foo");
  });
  it("只有 Mac Roman 名称时也能读出", () => {
    expect(parseFontFamily(sfnt([[1, 0, 0, 1, "MacFont"]]))).toBe("MacFont");
  });
  it("字体集取第一款字体", () => {
    expect(parseFontFamily(sfnt([[3, 1, 0x409, 1, "Collection"]], true))).toBe("Collection");
  });
  it("读不了时返回 null", () => {
    expect(parseFontFamily(new ArrayBuffer(4))).toBeNull();
    expect(parseFontFamily(sfnt([[3, 1, 0x409, 4, "Full Name"]]))).toBeNull();
    const woff2 = new Uint8Array(64);
    woff2.set([0x77, 0x4f, 0x46, 0x32]);
    expect(parseFontFamily(woff2.buffer)).toBeNull();
  });
});
