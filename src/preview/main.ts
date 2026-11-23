// 对话预览窗口的入口（preview.html）。独立页面：设置从同源 localStorage 重新读取。
import { mount } from "svelte";
import PreviewApp from "./PreviewApp.svelte";
import "../ui/app.css";
import { applyTheme, applyUiFont, loadCustomFonts } from "../lib/settings.svelte";

applyUiFont();
applyTheme();
void loadCustomFonts();

// 与主窗口一致：不使用 WebView2 自带的右键菜单
document.addEventListener("contextmenu", (e) => e.preventDefault());

mount(PreviewApp, { target: document.getElementById("app")! });
