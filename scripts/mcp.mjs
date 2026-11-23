// 对话 MCP 服务（stdio）：让 AI 客户端读、写、增量修改游戏对话结构体 JSON。
//   node scripts/mcp.mjs [--root <目录>]
// 只读写 --root（默认为启动时的当前目录）之内的 .json 文件。
// 数据逻辑复用 src/model（经 vite 加载），与编辑器、草稿命令行是同一份代码。
// 协议：MCP stdio 传输，每行一条 JSON-RPC 2.0 消息；标准输出只写协议消息，日志写标准错误。
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootArg = process.argv.indexOf("--root");
const fileRoot = resolve(rootArg >= 0 ? (process.argv[rootArg + 1] ?? ".") : ".");

console.log = (...a) => console.error(...a);

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "diapig-dialog", version: "1.0.0" };
const INSTRUCTIONS =
  "读写千星奇域 Diapig 对话文件（游戏对话结构体 JSON）。对话以“草稿”形式交换：精简 JSON，节点用 id 互相引用。" +
  "第一次使用先调用 dialog_format 了解草稿格式。结构体 ID 来自游戏编辑器，不能编造。" +
  "编辑器不会自动重新加载文件：改完后请用户在编辑器里重新打开。";

let modelPromise = null;
function loadModel() {
  modelPromise ??= (async () => {
    const load = async (file) =>
      (await runnerImport(resolve(toolRoot, file), { root: toolRoot, configFile: false, logLevel: "silent" })).module;
    return {
      ...(await load("src/model/codec.ts")),
      ...(await load("src/model/draft.ts")),
      ...(await load("src/model/draftEdit.ts")),
    };
  })();
  return modelPromise;
}

/** 工具执行中面向调用方的错误（不是程序故障） */
class ToolError extends Error {}

function safePath(path, what = "path") {
  if (typeof path !== "string" || path.trim() === "") throw new ToolError(`${what} 应是文件路径`);
  const full = resolve(fileRoot, path);
  const rel = relative(fileRoot, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ToolError(`${what} 必须在工作目录 ${fileRoot} 之内`);
  }
  if (!/\.json$/i.test(full)) throw new ToolError(`${what} 必须是 .json 文件`);
  return full;
}

function readDoc(model, full) {
  let text;
  try {
    text = readFileSync(full, "utf8");
  } catch (e) {
    throw new ToolError(`读不到 ${full}：${e.message}`);
  }
  try {
    return model.parseDialog(text).doc;
  } catch (e) {
    throw new ToolError(`${full} 不是对话文件：${e.message}`);
  }
}

/** 有些客户端把对象参数序列化成字符串传来 */
function asJson(value, what) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new ToolError(`${what} 不是有效的 JSON`);
  }
}

function issues(result) {
  return [...result.errors.map((e) => `错误  ${e}`), ...result.warnings.map((w) => `警告  ${w}`)];
}

function describe(model, doc) {
  const lines = [
    `节点 ${doc.nodes.length} 个，开始节点 n${doc.startNode}`,
    `结构体 ID：对话 ${doc.ids.dialog}，节点 ${doc.ids.node}，分支 ${doc.ids.branch}` +
      (doc.beginEnd ? `，起止设置 ${doc.ids.beginEnd}` : "（旧结构，没有起止设置）"),
    ...model.blackoutLines(doc),
  ];
  const events = model.eventNames(doc);
  if (events.length) lines.push(`用到的事件名（需与服务器侧核对）：${events.join("、")}`);
  return lines;
}

/** 写入对话文件；覆盖已有文件前留一份 .bak */
function saveDoc(model, full, doc) {
  let backup = null;
  if (existsSync(full)) {
    backup = full + ".bak";
    copyFileSync(full, backup);
  } else {
    mkdirSync(dirname(full), { recursive: true });
  }
  writeFileSync(full, model.stringifyDialog(doc) + "\n", "utf8");
  return backup;
}

const DRAFT_SCHEMA = { type: "object", description: "对话草稿，格式见 dialog_format" };

const TOOLS = [
  {
    name: "dialog_format",
    description: "返回对话草稿的格式说明（字段、流程、内容写法、校验规则）和增量修改的操作说明。第一次使用前先调用。",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const guide = readFileSync(resolve(toolRoot, "scripts/dialog-draft-guide.txt"), "utf8");
      return [guide, EDIT_GUIDE].join("\n\n");
    },
  },
  {
    name: "dialog_read",
    description:
      "读取对话文件，返回草稿 JSON。每个节点都带 id（n<序号>），dialog_edit 用这些 id 指定节点。文件有问题时一并列出。",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "对话 JSON 文件路径（相对工作目录）" } },
      required: ["path"],
    },
    async run(args) {
      const model = await loadModel();
      const doc = readDoc(model, safePath(args.path));
      const draft = model.docToDraft(doc, { explicit: true });
      const found = issues(model.draftToDoc(draft));
      return [JSON.stringify(draft, null, 2), ...(found.length ? ["文件现有的问题：", ...found] : [])].join("\n");
    },
  },
  {
    name: "dialog_check",
    description: "只校验草稿，不写文件。返回错误与警告。",
    inputSchema: { type: "object", properties: { draft: DRAFT_SCHEMA }, required: ["draft"] },
    async run(args) {
      const model = await loadModel();
      const result = model.draftToDoc(asJson(args.draft, "draft"));
      if (!result.doc) throw new ToolError(["校验未通过：", ...issues(result)].join("\n"));
      return [...issues(result), ...describe(model, result.doc), "校验通过"].join("\n");
    },
  },
  {
    name: "dialog_write",
    description:
      "把整份草稿写成对话文件。用于新建对话或整份重写；只改几个节点时用 dialog_edit。" +
      "结构体 ID 的来源依次为：草稿里的 ids、ids_from 指向的文件、被覆盖的原文件。校验有错误时不写文件。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "要写出的对话 JSON 文件路径（相对工作目录）" },
        draft: DRAFT_SCHEMA,
        ids_from: { type: "string", description: "从这份已有对话文件带入结构体 ID" },
        overwrite: { type: "boolean", description: "文件已存在时是否覆盖（覆盖前会留一份 .bak），默认 false" },
      },
      required: ["path", "draft"],
    },
    async run(args) {
      const model = await loadModel();
      const full = safePath(args.path);
      const exists = existsSync(full);
      if (exists && args.overwrite !== true) {
        throw new ToolError(`${full} 已存在。确认要整份覆盖时传 overwrite: true；只改部分节点请用 dialog_edit`);
      }
      let ids;
      if (args.ids_from !== undefined) ids = readDoc(model, safePath(args.ids_from, "ids_from")).ids;
      else if (exists) {
        try {
          ids = readDoc(model, full).ids;
        } catch {
          // 原文件不是对话文件：不带入 ID
        }
      }
      const result = model.draftToDoc(asJson(args.draft, "draft"), ids);
      if (!result.doc) throw new ToolError(["校验未通过，没有写文件：", ...issues(result)].join("\n"));
      const backup = saveDoc(model, full, result.doc);
      return [
        ...issues(result),
        `已写出 ${full}` + (backup ? `（原文件备份为 ${backup}）` : ""),
        ...describe(model, result.doc),
        model.outline(result.doc),
      ].join("\n");
    },
  },
  {
    name: "dialog_edit",
    description:
      "对已有对话文件做增量修改：按顺序执行一批操作，全部成功才写回（写回前留一份 .bak）。" +
      "节点用 dialog_read 返回的 id 指定；新插入的节点可自带 id 供同一批操作引用。操作格式见 dialog_format。" +
      "写回后节点 id 会按新位置重新编号，继续修改前看返回的概览或重新 dialog_read。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "对话 JSON 文件路径（相对工作目录）" },
        ops: {
          type: "array",
          description: "操作列表",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["set", "insert", "remove", "move", "start"] },
              node: { type: "string", description: "目标节点 id（set / remove / move / start）" },
              fields: { type: "object", description: "set：要改的草稿节点字段；值为 null 表示删除该字段" },
              nodes: { type: "array", items: { type: "object" }, description: "insert：要插入的草稿节点" },
              after: { type: "string", description: "insert / move：放到这个节点之后" },
              before: { type: "string", description: "insert / move：放到这个节点之前" },
            },
            required: ["op"],
          },
        },
        dry_run: { type: "boolean", description: "只校验并返回结果，不写文件，默认 false" },
      },
      required: ["path", "ops"],
    },
    async run(args) {
      const model = await loadModel();
      const full = safePath(args.path);
      const doc = readDoc(model, full);
      const edited = model.applyDraftEdits(model.docToDraft(doc, { explicit: true }), asJson(args.ops, "ops"));
      if (!edited.draft) {
        throw new ToolError(["操作有误，没有写文件：", ...edited.errors.map((e) => `错误  ${e}`)].join("\n"));
      }
      const result = model.draftToDoc(edited.draft);
      if (!result.doc) throw new ToolError(["修改后校验未通过，没有写文件：", ...issues(result)].join("\n"));
      const head =
        args.dry_run === true
          ? "试运行通过，没有写文件"
          : `已写回 ${full}（原文件备份为 ${saveDoc(model, full, result.doc)}）`;
      return [...issues(result), head, ...describe(model, result.doc), model.outline(result.doc)].join("\n");
    },
  },
];

const EDIT_GUIDE = `## 增量修改（dialog_edit）

先 dialog_read 取得各节点的 id（n0、n1……），再提交一批操作，按顺序执行，全部成功才写回：

| 操作 | 写法 | 说明 |
| --- | --- | --- |
| 改节点 | { "op": "set", "node": "n2", "fields": { "content": "新内容" } } | 只改写出的字段；值写 null 表示删除该字段；写了 goto / choices / end 之一时原来的流程自动去掉 |
| 插入 | { "op": "insert", "after": "n2", "nodes": [ … ] } | 也可写 before；都不写时加到末尾。新节点可自带 id，供同一批里的 goto 引用 |
| 删除 | { "op": "remove", "node": "n2" } | 还有节点引用它时会报错，需在同一批里先改掉那些引用 |
| 移动 | { "op": "move", "node": "n2", "before": "n0" } | |
| 开始节点 | { "op": "start", "node": "n2" } | |

- 一批操作内 id 始终指向同一个节点，不受前面增删的影响；节点引用只能写 id，不要写序号。
- 没写流程字段的节点会“顺序进入下一个节点”，这取决于位置：在它后面插入节点，它就进入新节点。
- 在原来的最后一个节点后面追加时注意：读出来的结束节点带 "end": true，要让它接着往下走，用 set 把 end 设为 null。
- 写回后 id 按新位置重新编号。`;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  const error = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
  if (id === undefined || id === null) return; // 通知：不需要回应

  if (method === "initialize") {
    const asked = params?.protocolVersion;
    reply({
      protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  } else if (method === "ping") {
    reply({});
  } else if (method === "tools/list") {
    reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  } else if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return error(-32602, `未知工具 ${params?.name}`);
    try {
      const text = await tool.run(params.arguments ?? {});
      reply({ content: [{ type: "text", text }] });
    } catch (e) {
      if (!(e instanceof ToolError)) console.error(e);
      const text = e instanceof ToolError ? e.message : `内部错误：${e?.message ?? e}`;
      reply({ content: [{ type: "text", text }], isError: true });
    }
  } else {
    error(-32601, `不支持的方法 ${method}`);
  }
}

// 按到达顺序逐条处理，避免两次写同一文件交错
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "不是有效的 JSON" } });
    return;
  }
  queue = queue.then(() => handle(msg)).catch((e) => console.error(e));
});
