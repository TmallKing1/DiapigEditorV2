import { describe, expect, it } from "vitest";
import {
  UNSORTED,
  addEntries,
  addTab,
  checkTabName,
  dirName,
  dissolveTabEntries,
  emptyHistory,
  entriesOf,
  moveEntry,
  normalizeHistory,
  pathKey,
  recordOpen,
  removeEntry,
  removeTab,
  uniqueTabName,
  visibleTabs,
} from "./history";

describe("记录打开", () => {
  it("新文件进未分类页签，再次打开只更新时间", () => {
    let d = recordOpen(emptyHistory(), "C:\\a\\x.json", 1);
    d = addTab(d, "剧情", "t1");
    d = moveEntry(d, "C:\\a\\x.json", "t1");
    d = recordOpen(d, "c:/A/X.json", 5, "task");
    expect(d.entries).toEqual([{ path: "C:\\a\\x.json", tab: "t1", time: 5, kind: "task" }]);
  });
  it("导入时按文件种类记", () => {
    const d = addEntries(emptyHistory(), ["C:\\a.json", "C:\\b.json"], UNSORTED, 9, (p) => (p.endsWith("b.json") ? "task" : "dialog"));
    expect(d.entries.map((e) => e.kind)).toEqual(["dialog", "task"]);
  });
  it("另存为时把新路径或已记录的路径归入指定页签", () => {
    let d = addTab(emptyHistory(), "剧情", "t1");
    d = recordOpen(d, "C:\\new.json", 1, "dialog", "t1");
    d = recordOpen(d, "C:\\old.json", 2, "task");
    d = recordOpen(d, "c:/OLD.json", 3, "task", "t1");
    expect(entriesOf(d, "t1").map((e) => e.kind)).toEqual(["task", "dialog"]);
    expect(entriesOf(d, UNSORTED)).toEqual([]);
  });
  it("另存为的目标页签已删除时归入未分类", () => {
    let d = addTab(emptyHistory(), "剧情", "t1");
    d = removeTab(d, "t1");
    d = recordOpen(d, "C:\\new.json", 1, "task", "t1");
    expect(entriesOf(d, UNSORTED)).toHaveLength(1);
  });
  it("空路径不记", () => {
    expect(recordOpen(emptyHistory(), "  ", 1).entries).toEqual([]);
  });
  it("不改传入的数据", () => {
    const d = recordOpen(emptyHistory(), "C:\\x.json", 1);
    recordOpen(d, "C:\\x.json", 9);
    expect(d.entries[0].time).toBe(1);
  });
  it("路径键统一分隔符、大小写和末尾分隔符", () => {
    expect(pathKey("C:/Foo/Bar.JSON")).toBe(pathKey("c:\\foo\\bar.json"));
    expect(pathKey("C:\\dir\\")).toBe("c:\\dir");
  });
});

describe("页签", () => {
  it("名称不能为空、不能重名（不区分大小写、含未分类）", () => {
    const d = addTab(emptyHistory(), "Story", "t1");
    expect(checkTabName(d, "  ")).not.toBe("");
    expect(checkTabName(d, "story ")).not.toBe("");
    expect(checkTabName(d, "未分类")).not.toBe("");
    expect(checkTabName(d, "其他")).toBe("");
    expect(addTab(d, "STORY", "t2")).toBe(d);
  });
  it("重名时加序号", () => {
    let d = addTab(emptyHistory(), "对话", "t1");
    expect(uniqueTabName(d, "对话")).toBe("对话 (2)");
    d = addTab(d, "对话 (2)", "t2");
    expect(uniqueTabName(d, "对话")).toBe("对话 (3)");
    expect(uniqueTabName(d, "新的")).toBe("新的");
  });
  it("解散页签：引用移到未分类，页签本身删除；未分类页签不能解散", () => {
    let d = addTab(emptyHistory(), "A", "t1");
    d = addEntries(d, ["C:\\1.json", "C:\\2.json"], "t1", 10);
    d = recordOpen(d, "C:\\3.json", 11);
    d = dissolveTabEntries(d, "t1");
    expect(d.tabs).toEqual([]);
    expect(d.entries.map((e) => e.path).sort()).toEqual(["C:\\1.json", "C:\\2.json", "C:\\3.json"]);
    expect(d.entries.every((e) => e.tab === UNSORTED)).toBe(true);
    expect(dissolveTabEntries(d, UNSORTED)).toBe(d);
  });
  it("删除页签连同其中的引用；未分类页签删不掉", () => {
    let d = addTab(emptyHistory(), "A", "t1");
    d = addEntries(d, ["C:\\1.json", "C:\\2.json"], "t1", 10);
    d = recordOpen(d, "C:\\3.json", 11);
    d = removeTab(d, "t1");
    expect(d.tabs).toEqual([]);
    expect(d.entries.map((e) => e.path)).toEqual(["C:\\3.json"]);
    expect(removeTab(d, UNSORTED)).toBe(d);
  });
  it("未分类页签没有文件时不显示，有文件时排在最前", () => {
    let d = addTab(emptyHistory(), "A", "t1");
    expect(visibleTabs(d).map((t) => t.id)).toEqual(["t1"]);
    d = recordOpen(d, "C:\\x.json", 1);
    expect(visibleTabs(d).map((t) => t.id)).toEqual([UNSORTED, "t1"]);
    d = removeEntry(d, "c:/x.json");
    expect(visibleTabs(d).map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("文件引用", () => {
  it("导入：去重，已有的移到新页签并保留时间，新的按顺序排", () => {
    let d = recordOpen(emptyHistory(), "C:\\old.json", 100);
    d = addTab(d, "导入", "t1");
    d = addEntries(d, ["C:\\b.json", "C:/OLD.json", "C:\\c.json", "c:\\B.json"], "t1", 50);
    expect(entriesOf(d, "t1").map((e) => e.path)).toEqual(["C:\\old.json", "C:\\b.json", "C:\\c.json"]);
    expect(entriesOf(d, UNSORTED)).toEqual([]);
  });
  it("移动到不存在的页签无效", () => {
    const d = recordOpen(emptyHistory(), "C:\\x.json", 1);
    expect(moveEntry(d, "C:\\x.json", "nope")).toBe(d);
  });
  it("按最近打开时间倒序", () => {
    let d = recordOpen(emptyHistory(), "C:\\a.json", 1);
    d = recordOpen(d, "C:\\b.json", 2);
    d = recordOpen(d, "C:\\a.json", 3);
    expect(entriesOf(d, UNSORTED).map((e) => e.path)).toEqual(["C:\\a.json", "C:\\b.json"]);
  });
  it("目录部分", () => {
    expect(dirName("C:\\a\\b.json")).toBe("C:\\a");
    expect(dirName("/x/y.json")).toBe("/x");
    expect(dirName("y.json")).toBe("");
  });
});

describe("读取存储", () => {
  it("结构不对退回空", () => {
    expect(normalizeHistory(null)).toEqual(emptyHistory());
    expect(normalizeHistory("x")).toEqual(emptyHistory());
    expect(normalizeHistory({ tabs: 1, entries: [] })).toEqual(emptyHistory());
  });
  it("丢弃坏条目，去重保留较新的一条，页签不存在的归入未分类", () => {
    const d = normalizeHistory({
      tabs: [{ id: "t1", name: "A" }, { id: "t2", name: "a" }, { id: 3, name: "B" }, null],
      entries: [
        { path: "C:\\x.json", tab: "t1", time: 1 },
        { path: "c:/X.json", tab: "t1", time: 4 },
        { path: "C:\\y.json", tab: "gone", time: 2, kind: "task" },
        { path: "", tab: "t1", time: 3 },
        { path: "C:\\z.json", time: "bad", kind: "bogus" },
        42,
      ],
    });
    expect(d.tabs).toEqual([{ id: "t1", name: "A" }]);
    // 旧记录没有种类：按对话处理
    expect(d.entries).toEqual([
      { path: "c:/X.json", tab: "t1", time: 4, kind: "dialog" },
      { path: "C:\\y.json", tab: UNSORTED, time: 2, kind: "task" },
      { path: "C:\\z.json", tab: UNSORTED, time: 0, kind: "dialog" },
    ]);
  });
});
