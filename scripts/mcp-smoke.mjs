// MCP 服务联调自测：启动 scripts/mcp.mjs，在临时目录里走一遍 初始化 → 列工具 → 写 → 读 → 改 → 错误路径。
//   node scripts/mcp-smoke.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), "diapig-mcp-"));
const child = spawn(process.execPath, [resolve(here, "mcp.mjs"), "--root", work], {
  stdio: ["pipe", "pipe", "inherit"],
});

const pending = new Map();
let stray = 0;
createInterface({ input: child.stdout }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    stray += 1; // 标准输出里混入了非协议内容
    return;
  }
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((ok, fail) => {
    pending.set(id, ok);
    setTimeout(() => fail(new Error(`${method} 超时`)), 20000);
  });
}
async function call(name, args) {
  const { result } = await request("tools/call", { name, arguments: args });
  return { text: result.content[0].text, isError: result.isError === true };
}

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed += 1;
  console.log(`${cond ? "通过" : "失败"}  ${name}${cond || !detail ? "" : `\n      ${detail}`}`);
}

const draft = {
  ids: { dialog: "101", node: "102", branch: "103" },
  nodes: [
    { title: "向导", content: "要听规则吗？", choices: [{ text: "听" }, { text: "不听", goto: "尾" }] },
    { content: "规则很简单。" },
    { id: "尾", title: "向导", content: "出发吧！", leave: "开始游戏" },
  ],
};

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  check("初始化", init.result?.protocolVersion === "2025-06-18" && init.result.capabilities.tools !== undefined);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const list = await request("tools/list", {});
  const names = list.result.tools.map((t) => t.name).join(",");
  check("列出工具", names === "dialog_format,dialog_read,dialog_check,dialog_write,dialog_edit", names);

  const format = await call("dialog_format", {});
  check("格式说明", !format.isError && format.text.includes("节点字段") && format.text.includes("dialog_edit"));

  const checked = await call("dialog_check", { draft });
  check("校验草稿", !checked.isError && checked.text.includes("校验通过"), checked.text);

  const wrote = await call("dialog_write", { path: "a.json", draft });
  check("写新文件", !wrote.isError && existsSync(join(work, "a.json")), wrote.text);
  const file = JSON.parse(readFileSync(join(work, "a.json"), "utf8"));
  check("文件是对话结构体", file.type === "Struct" && file.structId === "101");

  const again = await call("dialog_write", { path: "a.json", draft });
  check("不带 overwrite 时拒绝覆盖", again.isError && again.text.includes("已存在"), again.text);

  const read = await call("dialog_read", { path: "a.json" });
  const got = JSON.parse(read.text);
  check("读回草稿", got.nodes.length === 3 && got.nodes[2].id === "n2" && got.nodes[0].choices[1].goto === "n2");

  const dry = await call("dialog_edit", {
    path: "a.json",
    dry_run: true,
    ops: [{ op: "set", node: "n1", fields: { content: "试运行" } }],
  });
  const untouched = !readFileSync(join(work, "a.json"), "utf8").includes("试运行");
  check("试运行不写文件", !dry.isError && untouched && !existsSync(join(work, "a.json.bak")), dry.text);

  const edited = await call("dialog_edit", {
    path: "a.json",
    ops: [
      { op: "insert", after: "n1", nodes: [{ id: "补", content: "记得看路牌。" }] },
      { op: "set", node: "n2", fields: { content: "那就出发吧！" } },
    ],
  });
  check("增量修改", !edited.isError && edited.text.includes("n3 向导：那就出发吧！"), edited.text);
  check("修改前留了备份", existsSync(join(work, "a.json.bak")));
  const after = JSON.parse((await call("dialog_read", { path: "a.json" })).text);
  check("引用随插入移动", after.nodes.length === 4 && after.nodes[0].choices[1].goto === "n3" && after.ids.dialog === "101");

  const dangling = await call("dialog_edit", { path: "a.json", ops: [{ op: "remove", node: "n3" }] });
  check("删除被引用的节点报错", dangling.isError && dangling.text.includes("没有写文件"), dangling.text);

  const noIds = await call("dialog_write", { path: "b.json", draft: { nodes: draft.nodes }, ids_from: "a.json" });
  const b = existsSync(join(work, "b.json")) ? JSON.parse(readFileSync(join(work, "b.json"), "utf8")) : {};
  check("ids_from 带入结构体 ID", !noIds.isError && b.structId === "101", noIds.text);

  const outside = await call("dialog_write", { path: "../escape.json", draft });
  check("拒绝工作目录之外的路径", outside.isError && outside.text.includes("之内"), outside.text);
  const notJson = await call("dialog_read", { path: "a.txt" });
  check("拒绝非 .json 文件", notJson.isError);
  const bad = await call("dialog_write", { path: "c.json", draft: { nodes: [{ content: "x", goto: "无" }] } });
  check("校验失败不写文件", bad.isError && !existsSync(join(work, "c.json")), bad.text);
  const asString = await call("dialog_check", { draft: JSON.stringify(draft) });
  check("草稿以字符串传入也可以", !asString.isError);

  const unknown = await request("tools/call", { name: "nope", arguments: {} });
  check("未知工具返回协议错误", unknown.error?.code === -32602);
  check("标准输出只有协议消息", stray === 0);
} catch (e) {
  failed += 1;
  console.log(`失败  ${e.message}`);
} finally {
  child.kill();
  rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
