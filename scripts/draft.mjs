// 对话草稿命令行：草稿 JSON ⇄ 游戏对话结构体 JSON。格式说明见 docs/对话草稿格式.md。
//   node scripts/draft.mjs check <草稿.json>
//   node scripts/draft.mjs build <草稿.json> [-o <对话.json>] [--ids-from <已有对话.json>] [--force]
//   node scripts/draft.mjs dump  <对话.json> [-o <草稿.json>]
// 数据逻辑复用 src/model（TypeScript），经 vite 加载，与编辑器是同一份代码。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `用法：
  npm run draft -- check <草稿.json>                      只校验，不写文件
  npm run draft -- build <草稿.json> [-o <对话.json>]     生成游戏对话 JSON（默认与草稿同名，扩展名 .dialog.json）
        [--ids-from <已有对话.json>]                      从已有对话文件带入结构体 ID
        [--force]                                         覆盖已存在的输出文件
  npm run draft -- dump <对话.json> [-o <草稿.json>]      把已有对话转成草稿（不写 -o 时输出到终端）`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [], force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") out.out = argv[++i];
    else if (a === "--ids-from") out.idsFrom = argv[++i];
    else if (a === "--force") out.force = true;
    else if (a.startsWith("-")) fail(`未知参数 ${a}\n\n${USAGE}`);
    else out._.push(a);
  }
  return out;
}

function readJsonFile(path, what) {
  let text;
  try {
    text = readFileSync(path, "utf8").replace(/^﻿/, "");
  } catch (e) {
    fail(`读不到${what} ${path}：${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`${what} ${path} 不是有效的 JSON：${e.message}`);
  }
}

async function loadModel() {
  const load = async (file) =>
    (await runnerImport(resolve(root, file), { root, configFile: false, logLevel: "silent" })).module;
  return { ...(await load("src/model/codec.ts")), ...(await load("src/model/draft.ts")) };
}

function report(result) {
  for (const w of result.warnings) console.error(`警告  ${w}`);
  for (const e of result.errors) console.error(`错误  ${e}`);
}

function summary(model, doc) {
  const ops = [0, 0, 0, 0];
  for (const n of doc.nodes) ops[n.op] += 1;
  const lines = [
    `节点 ${doc.nodes.length} 个（结束 ${ops[0]}、顺序 ${ops[1]}、跳转 ${ops[2]}、分支 ${ops[3]}），开始节点 ${doc.startNode}`,
    `结构体 ID：对话 ${doc.ids.dialog}，节点 ${doc.ids.node}，分支 ${doc.ids.branch}` +
      (doc.beginEnd ? `，起止设置 ${doc.ids.beginEnd}` : "（旧结构，没有起止设置）"),
    ...model.blackoutLines(doc),
  ];
  const events = model.eventNames(doc);
  if (events.length) lines.push(`用到的事件名（请与服务器侧核对）：${events.join("、")}`);
  return lines.join("\n");
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const input = args._[0];
if (!["check", "build", "dump"].includes(cmd) || !input || args._.length > 1) fail(USAGE);

const model = await loadModel();

if (cmd === "dump") {
  let doc;
  try {
    doc = model.readDialog(readJsonFile(input, "对话文件")).doc;
  } catch (e) {
    fail(`${input}：${e.message}`);
  }
  const text = JSON.stringify(model.docToDraft(doc), null, 2) + "\n";
  if (args.out) {
    if (existsSync(args.out) && !args.force) fail(`${args.out} 已存在；确认要覆盖请加 --force`);
    writeFileSync(args.out, text, "utf8");
    console.error(`已写出草稿 ${args.out}`);
  } else {
    process.stdout.write(text);
  }
} else {
  let ids;
  if (args.idsFrom) {
    try {
      ids = model.readDialog(readJsonFile(args.idsFrom, "对话文件")).doc.ids;
    } catch (e) {
      fail(`${args.idsFrom}：${e.message}`);
    }
  }
  const result = model.draftToDoc(readJsonFile(input, "草稿"), ids);
  report(result);
  if (!result.doc) fail(`\n校验未通过：${result.errors.length} 个错误，没有写出文件`);
  console.error(summary(model, result.doc));
  if (cmd === "build") {
    const out = args.out ?? input.replace(/(\.draft)?\.json$/i, "") + ".dialog.json";
    if (resolve(out) === resolve(input)) fail("输出文件不能与草稿是同一个文件");
    if (existsSync(out) && !args.force) fail(`${out} 已存在；确认要覆盖请加 --force`);
    writeFileSync(out, model.stringifyDialog(result.doc) + "\n", "utf8");
    console.error(`已写出 ${out}（用编辑器打开检查）`);
  } else {
    console.error("校验通过");
  }
}
