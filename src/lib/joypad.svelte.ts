import { invoke } from "@tauri-apps/api/core";
import { ask, toast } from "./ui.svelte";

const DISCLAIMER_KEY = "diapig-editor.joypad-disclaimer.v1";
export const JOYPAD_DISCLAIMER = "本功能通过修改注册表，来实现与登录时修改原神操作设置一致的效果，适用于千星奇域开发中需要使用手柄进行测试的场合。Diapig Editor 不保证该方法没有任何安全风险，也不承担可能导致的账号损失。正常游玩时建议在游戏内切换输入设备。";
export const joypad = $state({ busy: false, prompting: false, uid: "", uids: [] as string[], disclaimer: false, seconds: 5 });
let countdown: ReturnType<typeof setInterval> | undefined;
let readyAt = 0;

export async function startJoypadToggle() {
  if (joypad.busy || joypad.prompting || joypad.disclaimer) return;
  let accepted = false;
  try { accepted = localStorage.getItem(DISCLAIMER_KEY) === "accepted"; } catch { /* Show disclaimer when storage is unavailable. */ }
  if (accepted) { await loadJoypadUids(); return; }
  joypad.disclaimer = true;
  joypad.seconds = 5;
  readyAt = performance.now() + 5000;
  countdown = setInterval(() => {
    joypad.seconds = Math.max(0, Math.ceil((readyAt - performance.now()) / 1000));
    if (!joypad.seconds) clearInterval(countdown);
  }, 100);
}

export function cancelJoypadDisclaimer() {
  clearInterval(countdown);
  joypad.disclaimer = false;
}

export async function acceptJoypadDisclaimer() {
  if (!joypad.disclaimer || performance.now() < readyAt) return;
  try { localStorage.setItem(DISCLAIMER_KEY, "accepted"); }
  catch { toast("无法保存免责声明确认，请检查本机存储权限后重试。", "error"); return; }
  cancelJoypadDisclaimer();
  await loadJoypadUids();
}

async function loadJoypadUids() {
  joypad.busy = true;
  joypad.uid = "";
  joypad.uids = [];
  try {
    const result = await invoke<{ uids: string[] }>("joypad_list_uids");
    if (!result.uids.length) throw new Error("未找到 UID 非零的原神账号配置。");
    joypad.uids = result.uids;
    joypad.uid = result.uids[0];
    joypad.prompting = true;
  } catch (error) { toast(String(error), "error"); }
  finally { joypad.busy = false; }
}

export async function submitJoypadUid() {
  if (joypad.busy) return;
  const uid = joypad.uid;
  if (!joypad.uids.includes(uid)) {
    toast("请选择原神 UID。", "error");
    return;
  }
  joypad.prompting = false;
  joypad.busy = true;
  try {
    const checked = await invoke<{ usingJoypad: boolean; snapshot: string; target: string }>("joypad_inspect", { uid });
    const current = checked.usingJoypad ? "手柄" : "键鼠";
    const next = checked.usingJoypad ? "键鼠" : "手柄";
    ask({
      title: "确认切换输入设备",
      message: `当前该账号为${current}输入。\n是否切换为${next}输入？`,
      actions: [
        { label: "取消" },
        { label: "确认", style: "accent", run: () => { void commit(uid, checked); } },
      ],
    });
  } catch (error) {
    toast(String(error), "error");
  } finally {
    joypad.busy = false;
  }
}

async function commit(uid: string, checked: { snapshot: string; target: string }) {
  if (joypad.busy) return;
  joypad.busy = true;
  try {
    const result = await invoke<{ usingJoypad: boolean }>("joypad_commit", { uid, snapshot: checked.snapshot, target: checked.target });
    toast(`已切换为${result.usingJoypad ? "手柄" : "键鼠"}输入，下次启动原神时生效。`);
  } catch (error) {
    toast(String(error), "error");
  } finally {
    joypad.busy = false;
  }
}
