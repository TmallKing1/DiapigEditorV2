// 列表拖动排序（对话节点、任务共用）。
// 不用 HTML5 拖放：Tauri 窗口在 Windows 上接管了拖放（用于文件拖入），网页里的 dragover 永远显示“不可用”。
// 这里用指针事件自行实现：按住手柄移动 4px 后开始，原位淡化，虚影跟随指针，行之间画分界线表示插入位置。
// layout: "wrap" 用于横排换行的标签（界面字体列表）：按指针所在的行、再按左右位置求插入缝，分界线是竖线。

export interface RowDragOptions {
  /** 列表元素：直接子元素 li.row（或 items 指定的元素）是可拖动的行 */
  list: () => HTMLElement | undefined;
  /** 可拖动项的选择器（相对列表），默认 ":scope > li.row" */
  items?: string;
  /** vertical：上下排列（默认）；wrap：横排换行，分界线为竖线 */
  layout?: "vertical" | "wrap";
  /** 拖动到上下边缘时滚动的容器 */
  scroller: () => HTMLElement | undefined;
  canStart: () => boolean;
  /** 松手：把 from 处的行移到最终位置 to */
  onmove: (from: number, to: number) => void;
}

export class RowDrag {
  /**
   * from 为被拖行，gap 为插入缝隙序号（0 = 第一行之前），lineY 为分界线相对列表的位置。
   * wrap 布局另有 lineX（竖线的横坐标）和 lineH（竖线高度），lineY 为竖线顶端。
   */
  state = $state<{ from: number; gap: number; lineY: number; lineX?: number; lineH?: number } | null>(null);

  constructor(private opt: RowDragOptions) {}

  /** 插入位置与原位置相同（原行上下两条缝）时不画分界线 */
  get showLine(): boolean {
    const d = this.state;
    return d != null && d.gap !== d.from && d.gap !== d.from + 1;
  }

  private gapAt(clientX: number, clientY: number): { gap: number; lineY: number; lineX?: number; lineH?: number } {
    if (this.opt.layout === "wrap") return this.wrapGapAt(clientX, clientY);
    const listEl = this.opt.list();
    const rows = [...(listEl?.querySelectorAll<HTMLElement>(this.opt.items ?? ":scope > li.row") ?? [])];
    const listTop = listEl?.getBoundingClientRect().top ?? 0;
    let gap = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        gap = i;
        break;
      }
    }
    // 分界线放在两行间距的正中；首尾放在行外侧同样距离处
    const half = 4;
    const lineY =
      gap < rows.length
        ? rows[gap].getBoundingClientRect().top - listTop - half
        : rows[rows.length - 1].getBoundingClientRect().bottom - listTop + half;
    return { gap, lineY };
  }

  /** 横排换行：先找指针所在（或最近）的一行，再在行内按各项中线找插入缝 */
  private wrapGapAt(clientX: number, clientY: number): { gap: number; lineY: number; lineX: number; lineH: number } {
    const listEl = this.opt.list();
    const items = [...(listEl?.querySelectorAll<HTMLElement>(this.opt.items ?? ":scope > li.row") ?? [])];
    const box = listEl?.getBoundingClientRect();
    const ox = box?.left ?? 0;
    const oy = box?.top ?? 0;
    if (!items.length) return { gap: 0, lineX: 0, lineY: 0, lineH: 0 };
    const rects = items.map((el) => el.getBoundingClientRect());
    // 按顶边分行（同一行的项顶边相同，容差 4px）
    const lines: number[][] = [];
    rects.forEach((r, i) => {
      const line = lines.find((l) => Math.abs(rects[l[0]].top - r.top) < 4);
      if (line) line.push(i);
      else lines.push([i]);
    });
    const dist = (l: number[]) => {
      const r = rects[l[0]];
      return clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
    };
    const line = lines.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    const half = 3;
    for (const i of line) {
      const r = rects[i];
      if (clientX < r.left + r.width / 2) return { gap: i, lineX: r.left - ox - half, lineY: r.top - oy, lineH: r.height };
    }
    const last = line[line.length - 1];
    const r = rects[last];
    return { gap: last + 1, lineX: r.right - ox + half, lineY: r.top - oy, lineH: r.height };
  }

  start(index: number, e: PointerEvent) {
    if (e.button !== 0 || !this.opt.canStart()) return;
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    const row = grip.closest("li") as HTMLElement;
    const sx = e.clientX;
    const sy = e.clientY;
    let lastX = sx;
    let lastY = sy;
    let ghost: HTMLElement | null = null;
    let frame = 0;
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      // 指针已失效（如合成事件）：不捕获也能工作，只是指针移出窗口后收不到事件
    }

    // 指针靠近滚动区域上下边缘时持续滚动
    const autoScroll = () => {
      const scroller = this.opt.scroller();
      const box = scroller?.getBoundingClientRect();
      if (scroller && box && this.state) {
        const edge = 48;
        const d = lastY < box.top + edge ? -(box.top + edge - lastY) : lastY > box.bottom - edge ? lastY - (box.bottom - edge) : 0;
        if (d) {
          scroller.scrollTop += Math.max(-16, Math.min(16, d / 3));
          this.state = { from: index, ...this.gapAt(lastX, lastY) };
        }
      }
      frame = requestAnimationFrame(autoScroll);
    };

    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        const r = row.getBoundingClientRect();
        ghost = row.cloneNode(true) as HTMLElement;
        ghost.classList.remove("enter");
        ghost.classList.add("drag-ghost");
        Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        document.body.append(ghost);
        document.body.classList.add("dragging-row");
        frame = requestAnimationFrame(autoScroll);
      }
      ghost.style.transform = `translate(${ev.clientX - sx}px, ${ev.clientY - sy}px)`;
      this.state = { from: index, ...this.gapAt(ev.clientX, ev.clientY) };
    };

    const finish = (apply: boolean) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc, true);
      cancelAnimationFrame(frame);
      ghost?.remove();
      document.body.classList.remove("dragging-row");
      const d = this.state;
      this.state = null;
      if (apply && d) this.opt.onmove(d.from, d.gap > d.from ? d.gap - 1 : d.gap);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc, true);
  }
}
