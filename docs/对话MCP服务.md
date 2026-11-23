# 对话 MCP 服务

让支持 MCP 的 AI 客户端（Claude Code、Claude Desktop 等）直接读、写、增量修改游戏对话结构体 JSON。入口是 `scripts/mcp.mjs`，数据逻辑与编辑器、草稿命令行共用 `src/model`。对话以草稿形式交换，格式见 `对话草稿格式.md`。

## 接入

**Claude Code**：仓库根目录的 `.mcp.json` 已登记服务 `diapig-dialog`。在仓库根目录启动 Claude Code，首次会询问是否启用，同意即可。

**其他客户端**（如 Claude Desktop）：在它的 MCP 配置里加一项，路径换成本机的绝对路径：

```json
{
  "mcpServers": {
    "diapig-dialog": {
      "command": "node",
      "args": ["<仓库>/scripts/mcp.mjs", "--root", "<存放对话 JSON 的目录>"]
    }
  }
}
```

需要先在仓库根目录执行 `npm ci`。

## 工具

| 工具 | 作用 |
| --- | --- |
| `dialog_format` | 返回草稿格式与增量修改的说明，AI 第一次使用前调用 |
| `dialog_read` | 读对话文件，返回草稿；每个节点带 id（`n<序号>`） |
| `dialog_check` | 只校验草稿，不写文件 |
| `dialog_write` | 把整份草稿写成对话文件，用于新建或整份重写 |
| `dialog_edit` | 对已有文件做一批增量操作：改字段、插入、删除、移动、设开始节点 |

`dialog_edit` 的操作写法由 `dialog_format` 返回，定义在 `scripts/mcp.mjs` 的 `EDIT_GUIDE`，逻辑在 `src/model/draftEdit.ts`。

## 安全与限制

- 只读写 `--root` 目录之内的 `.json` 文件；不写 `--root` 时为启动时的当前目录。
- 校验有错误时不写文件。`dialog_edit` 的一批操作全部成功才写回。
- `dialog_write` 遇到已有文件默认拒绝，需传 `overwrite: true`。
- 每次覆盖或修改前，把原文件复制为同目录的 `<文件名>.bak`（只保留最近一份，已加入 `.gitignore`）。
- 结构体 ID 的来源依次为草稿里的 `ids`、`ids_from` 指向的文件、被覆盖的原文件；都没有时为 0 并给出警告。
- 编辑器不监听文件变化：AI 改完后要在编辑器里重新打开文件才能看到；编辑器里有未保存修改时再保存，会盖掉 AI 的修改。
- 事件名是否与服务器侧一致无法校验，每次写入后会列出用到的事件名供人工核对。

## 自测

```bash
npm run mcp:test
```

启动服务，在临时目录里走一遍初始化、列工具、写、读、改和各错误路径。
