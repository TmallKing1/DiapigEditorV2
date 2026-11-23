import { mount } from "svelte";
import App from "./App.svelte";
import "./ui/app.css";
import { applyContentFont, applyTheme, applyUiFont, loadCustomFonts } from "./lib/settings.svelte";

// 先套用保存的主题色和字体再挂载，避免首帧闪一下默认样式
applyTheme();
applyUiFont();
applyContentFont();
// 自定义字体要读文件，异步加载；加载完成前用到它的文字先按后备字体显示
void loadCustomFonts();

// WebView2 会给文本框弹「保存的信息」（自动填充历史）：所有输入框一律关掉。
// 在元素插入时统一设置，新增的输入框不必逐个记得加属性。
function noAutofill(root: ParentNode) {
  for (const el of root.querySelectorAll("input, textarea")) {
    if (el.getAttribute("autocomplete") !== "off") el.setAttribute("autocomplete", "off");
  }
}
const target = document.getElementById("app")!;
new MutationObserver((records) => {
  for (const r of records) {
    for (const n of r.addedNodes) {
      if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) n.setAttribute("autocomplete", "off");
      else if (n instanceof Element) noAutofill(n);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// 复选框、单选按钮确认切换后播放「先收缩再回弹」（样式见 app.css 的 .check）
document.addEventListener("change", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || (el.type !== "checkbox" && el.type !== "radio") || !el.parentElement?.classList.contains("check")) return;
  el.classList.remove("bump");
  void el.offsetWidth; // 重新触发动画
  el.classList.add("bump");
});
document.addEventListener("animationend", (e) => {
  if ((e.animationName === "check-bump" || e.animationName === "radio-bump") && e.target instanceof Element) e.target.classList.remove("bump");
});

mount(App, { target });
noAutofill(document.body);
