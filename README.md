# Diapig Editor

面向原神千星奇域创作者的 Windows 桌面编辑器，用来编写对话、管理任务链、预览对话表现，以及把图片导出为 Lua 图元或像素画。

## 主要功能

- **对话与任务链编辑**：可视化编辑对话节点、分支、事件与任务链，支持撤销重做、拖动排序、自动保存和历史文件分类管理。
- **对话预览**：在独立窗口中模拟游戏内的对话播放，方便随时核对排版和节奏。
- **图元拟合**：把图片拟合成硬边或渐变图元，支持重点区域权重蒙版与抗锯齿评分，导出供千星奇域 Lua 绘制的图元数据模块。
- **像素画生成**：自定义目标像素宽高，保留原色或轻度合色，导出 PNG 或 Lua 数据模块。
- **草稿命令行与 MCP 服务（可选）**：支持用精简草稿 JSON 读写对话，也可通过本地 stdio MCP 服务接入 AI 工具协助编写和校验。
- **原神离线输入设备切换（可选）**：在「设置 → 更多」里切换本机国服原神的键鼠与手柄配置，方便需要手柄测试的场景。

## 使用说明与限制

- **结构体版本与 ID**：游戏内导入只接受新版（v2）完整结构，编辑器新建和保存时统一输出新版格式，包含对话起止设置。导入旧版对话文件时会自动转换，随后需要在「对话设置」里填写起止设置结构体 ID，并确认其他结构体 ID 都来自实际游戏中的新版结构体。
- **离线输入设备切换**：仅面向 Windows 国服原神。使用前必须先关闭游戏，写入前会在应用数据目录 `top.pigest.diapigeditor/joypad-backup` 生成 `.reg` 备份，修改后需要重新启动游戏才会生效。游戏重启后的切换效果尚待实机验证。

## 快速开始

目前请从源码在 Windows 上构建。

### 环境要求

- Node.js 22.12+
- Rust MSVC 工具链（rustup，`stable-x86_64-pc-windows-msvc`）
- VS 2022 生成工具「使用 C++ 的桌面开发」
- WebView2 运行时（Windows 11 自带）

### 克隆与构建

```bash
git clone https://github.com/TmallKing1/DiapigEditorV2.git
cd DiapigEditorV2
npm ci
```

启动桌面端开发模式：

```bash
npm run tauri dev
```

构建安装包或免安装版：

```bash
# 构建 NSIS 安装包（首次构建会从 GitHub 下载 NSIS）
npm run tauri build

# 构建免安装 exe
npm run tauri build -- --no-bundle
```

桌面构建产物默认输出在 `src-tauri/target/`。如果要放到其他目录，可以在本机设置环境变量 `CARGO_TARGET_DIR`。

## 开发与测试

只调试前端界面时，可以运行浏览器开发模式（默认访问 `http://localhost:1420`）：

```bash
npm run dev
```

浏览器模式通过文件选择和下载来导入、导出。图元拟合等依赖 Tauri 后端的功能需在桌面端使用。

常用测试与命令行工具：

```bash
# 数据模型单元测试
npm test

# 图元拟合算法测试
cargo test -p primfit --manifest-path src-tauri/Cargo.toml

# 对话草稿转游戏对话 JSON
npm run draft -- build 草稿.json

# 对话 MCP 服务联调自测
npm run mcp:test
```

## 文档入口

- [对话草稿格式](docs/对话草稿格式.md)：精简草稿 JSON 字段说明与命令行用法
- [对话 MCP 服务](docs/对话MCP服务.md)：本地 MCP 服务的接入方式与能力说明
- [图元拟合图片约定](docs/图元拟合图片约定.md)：导出格式说明与 Lua 侧绘制方式
