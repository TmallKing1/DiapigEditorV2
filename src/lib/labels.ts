import { parseRichText } from "../model/richtext";
import { type DialogNode, PLAYER_NAME } from "../model/types";

export function titleText(node: DialogNode): string {
  if (node.inheritTitle) return "（继承标题）";
  return node.title === PLAYER_NAME ? "玩家" : node.title || "（无标题）";
}

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join("") + "…" : text;
}

/** 下拉选项里的节点名：#3 标题：内容摘要 */
export function nodeLabel(node: DialogNode, index: number): string {
  const body = parseRichText(node.content)
    .segments.map((s) => (s.player ? "〔玩家名〕" : s.text))
    .join("")
    .replaceAll("\\n", " ");
  return `#${index} ${clip(titleText(node), 10)}：${clip(body, 18)}`;
}
