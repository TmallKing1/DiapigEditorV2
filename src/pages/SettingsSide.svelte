<script lang="ts">
  // 设置页的左侧栏：子页签导航。当前页签由 App.svelte 管（切换动效与主区同步）。
  import SideTabs, { type SideTab } from "./SideTabs.svelte";

  let {
    current,
    onpick,
    onreset,
    entering = false,
    leaving = false,
  }: {
    current: string;
    onpick: (id: string) => void;
    onreset?: (tab: SideTab) => void;
    entering?: boolean;
    leaving?: boolean;
  } = $props();

  const SECTIONS: SideTab[] = [
    { id: "general", label: "常规", icon: "settings" },
    { id: "dialog", label: "对话", icon: "chat" },
    { id: "personal", label: "个性化", icon: "shirt" },
    { id: "advanced", label: "更多", icon: "grid" },
  ];
</script>

<SideTabs tabs={SECTIONS} {current} label="设置分类" {onpick} {onreset} {entering} {leaving} />
