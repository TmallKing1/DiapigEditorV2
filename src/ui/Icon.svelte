<script lang="ts" module>
  // 统一 24 网格、1.8 线宽的几何线条图标
  const PATHS: Record<string, string> = {
    clock: "M21 12a9 9 0 10-18 0 9 9 0 0018 0zM12 7v5l3 2",
    target: "M21 12a9 9 0 10-18 0 9 9 0 0018 0zM17 12a5 5 0 10-10 0 5 5 0 0010 0zM12 12h.01",
    cpu: "M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4",
    layers: "M12 3L3 8l9 5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5",
    image: "M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6M15 8h.01",
    plus: "M12 5v14M5 12h14",
    copy: "M9 9h10v10H9zM5 15V5h10",
    paste: "M9 4h6v3H9zM9 5H6v15h12V5h-3M9 12h6M9 16h6",
    duplicate: "M8 8h11v11H8zM5 16V5h11M13.5 11v5M11 13.5h5",
    trash: "M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v5M14 11v5",
    up: "M12 19V5M6 11l6-6 6 6",
    "back-to-top": "M5 4h14M12 20V8M6 14l6-6 6 6",
    down: "M12 5v14M6 13l6 6 6-6",
    import: "M12 3v12M7 10l5 5 5-5M4 17v3h16v-3",
    export: "M12 15V3M7 8l5-5 5 5M4 17v3h16v-3",
    save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
    "save-as": "M11 20H5V4h11l3 3v3M8 4v5h7V4M8 20v-6h3M14 21v-2.5l5-5 2.5 2.5-5 5z",
    file: "M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6",
    clean: "M14 4l6 6-9 9H6l-2-2zM9 9l6 6M12 20h8",
    edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
    grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
    close: "M6 6l12 12M18 6L6 18",
    maximize: "M6 6h12v12H6z",
    restore: "M6 9h9v9H6zM9 9V6h9v9h-3",
    minimize: "M6 12h12",
    flag: "M5 21V4M5 4h13l-3 4.5 3 4.5H5",
    warn: "M12 4l9 16H3zM12 10v4M12 17h.01",
    check: "M5 12l5 5 9-10",
    chat: "M4 5h16v11H10l-5 4v-4H4zM8 9h8M8 12h5",
    // 平顶六边形（圆角柔化）+ 中心小圆
    settings:
      "M20.2 10.61Q21 12 20.2 13.39L17.3 18.4Q16.5 19.79 14.9 19.79H9.1Q7.5 19.79 6.7 18.4L3.8 13.39Q3 12 3.8 10.61L6.7 5.6Q7.5 4.21 9.1 4.21H14.9Q16.5 4.21 17.3 5.6ZM14.6 12a2.6 2.6 0 10-5.2 0 2.6 2.6 0 105.2 0z",
    palette:
      "M12 3a9 9 0 100 18c1 0 1.6-.7 1.6-1.6 0-1-.8-1.4-.8-2.4 0-1 .8-1.6 1.8-1.6H17a4 4 0 004-4c0-4.6-4-8.4-9-8.4zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
    // 短袖上衣：领口弧线 + 两侧袖子
    shirt: "M9 4L4 6.5 2.5 11l3 1.2L7 10.5V20h10v-9.5l1.5 1.7 3-1.2L20 6.5 15 4q-.6 2.5-3 2.5T9 4z",
    // 2×2 柔和正方形网格
    grid: "M6 4h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2zM15 4h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V6a2 2 0 012-2zM6 13h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3a2 2 0 012-2zM15 13h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3a2 2 0 012-2z",
    chevron: "M6 9l6 6 6-6",
    // 数学键盘与翻页：单/双左右箭头、退格
    "chev-left": "M15 6l-6 6 6 6",
    "chev-right": "M9 6l6 6-6 6",
    "chevs-left": "M11 6l-6 6 6 6M18 6l-6 6 6 6",
    "chevs-right": "M6 6l6 6-6 6M13 6l6 6-6 6",
    backspace: "M9 5h11v14H9l-6-7zM10 9l6 6M16 9l-6 6",
    type: "M5 7V5h14v2M12 5v14M9 19h6",
    refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
    info:"M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01",
    chart: "M4 4v16h16M7.5 15l3.5-4.5 3 2.5 5-7",
    bold: "M7 5h6a3.5 3.5 0 010 7H7zM7 12h7.5a3.5 3.5 0 010 7H7z",
    italic: "M10 5h8M6 19h8M14 5l-4 14",
    undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11",
    redo: "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13",
    eraser: "M4 7V5h12v2M10 5L8 19M14 14l6 6M20 14l-6 6",
    newline: "M19 5v6a3 3 0 01-3 3H6M10 10l-4 4 4 4",
    code: "M9 8l-5 4 5 4M15 8l5 4-5 4",
    // 文稿：折角纸张 + 三行文字
    doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 11h6M9 14h6M9 17h4",
    // 图元：圆、三角形、矩形
    shapes: "M7.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM17 4l4 7h-8zM5 14h7v6H5zM15.5 14h5v6h-5z",
    // 三线段左箭头：子页面的返回按钮
    back: "M20 12H5M11 6l-6 6 6 6",
    // 逆时针回转箭头：重置
    reset: "M4 12a8 8 0 102.3-5.7M4 4v5h5",
    history: "M3.5 12a8.5 8.5 0 102.5-6M3.5 4v4.5H8M12 8v4.5l3 2",
    folder: "M3 6h6l2 2.5h10V19H3z",
    "folder-plus": "M3 6h6l2 2.5h10V19H3zM12 11.5v5M9.5 14h5",
    "tab-plus": "M4 6h7l2 3h7v10H4zM12 12v4M10 14h4",
    // 文件夹 + 向右箭头：移到其他页签
    "folder-move": "M3 6h6l2 2.5h10V19H3zM8.5 14h7M13 11.5l2.5 2.5-2.5 2.5",
    eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z",
    play: "M7 5l12 7-12 7z",
    // 空白文件（不带加号）
    "file-blank": "M6 3h8l4 4v14H6zM14 3v4h4",
    "trash-x": "M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11l4 5M14 11l-4 5",
    zoom: "M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM15.5 15.5L20 20M10.5 8v5M8 10.5h5",
    swap: "M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7",
    user:"M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  };
</script>

<script lang="ts">
  let { name, size = 16 }: { name: string; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name] ?? ""} />
</svg>
