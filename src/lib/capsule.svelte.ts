// 主面板底部悬浮胶囊按钮的全局登记表。
// 页面通过 <CapsuleButton> 声明按钮（并自动在页尾预留底部占位），
// 由 App.svelte 中主滚动区外层的 <CapsuleHost> 独立渲染并播放原地缩放动效，
// 避免随 .page / .sub-leave 切页容器一起位移或淡出。

export interface CapsuleProps {
  icon: string;
  label: string;
  onclick: () => void;
  disabled?: boolean;
  /** 悬停说明（不可用时可写原因） */
  tip?: string;
}

export const capsuleState = $state<{
  item: CapsuleProps | null;
}>({ item: null });

let owner: symbol | null = null;

/** 登记或清除胶囊按钮；只有当前持有者能清除，避免旧页面卸载时清掉新页面的按钮 */
export function setCapsule(token: symbol, props: CapsuleProps | null) {
  if (props) {
    owner = token;
    capsuleState.item = props;
  } else if (owner === token) {
    owner = null;
    capsuleState.item = null;
  }
}
