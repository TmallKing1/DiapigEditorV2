// 对话预览窗口的入口（preview.html）。预览配置随对话一起从主窗口传入。
import { mount } from "svelte";
import PreviewApp from "./PreviewApp.svelte";
import "../ui/app.css";

// 与主窗口一致：不使用 WebView2 自带的右键菜单
document.addEventListener("contextmenu", (e) => e.preventDefault());

mount(PreviewApp, { target: document.getElementById("app")! });
