// 「手动输入文件路径」的输入框（设置「更多」-「调试选项」）。
// files.ts 的打开 / 保存 / 选文件夹在开关打开时调用 askPath，等用户填完或取消；App.svelte 渲染 pathAsk。
import { type PathRequest, registerPathPrompt } from "./files";
import { settings } from "./settings.svelte";

export interface PathAsk extends PathRequest {
  value: string;
}

export const pathAsk = $state<{ current: PathAsk | null }>({ current: null });
let resolver: ((path: string | null) => void) | null = null;

function askPath(req: PathRequest): Promise<string | null> {
  // 同时只有一个输入框：旧的请求按取消处理
  resolver?.(null);
  pathAsk.current = { ...req, value: req.preset ?? "" };
  return new Promise((resolve) => (resolver = resolve));
}

/** 确定（path）或取消（null） */
export function answerPath(path: string | null) {
  const done = resolver;
  resolver = null;
  pathAsk.current = null;
  done?.(path);
}

registerPathPrompt(() => settings.manualPaths, askPath);
