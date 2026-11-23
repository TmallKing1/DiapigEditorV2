<script lang="ts">
  // 对话预览在主窗口里常驻的部分（挂在 App.svelte）。选择预览类型的对话框走全局 ask()，这里不再画界面；
  // 只负责主窗口卸载时关掉浏览器开发预览里另开的预览页。桌面端的预览窗口由 Rust 在主窗口销毁时关闭
  // （closeWindow() 用 destroy()，不会触发前端的卸载事件）。
  import { closePopup } from "../lib/preview.svelte";
</script>

<svelte:window onpagehide={closePopup} />
