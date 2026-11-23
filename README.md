# Diapig Editor（桌面端，Tauri 2）

面向原神千星奇域的 Windows 桌面编辑器，支持编辑和预览对话、编辑任务链，以及把图片导出为 Lua 图元或像素画。对话编辑功能由 JavaFX 版 `GenshinDialogEditor` 迁移而来，导出对话节点 v2 结构体。界面规范见 [UI 设计指南](ui-design-guide.md) 和 [UI 动效指南](ui-motion-design-guide.md)。

**原神离线输入设备切换**（2026-11-17）：在「设置 → 更多」的「原神输入设备切换」卡片点击「切换输入设备」，首次使用先显示危险样式的「免责声明」，「仍然继续」倒计时 5 秒后可用，接受后单独保存到本机 localStorage，之后不再显示（取消或 Esc 不记为接受，也不受设置页重置影响）。文案包含「需要使用手柄进行测试的场合」。随后枚举 `HKCU\Software\miHoYo\原神` 下严格匹配 `USD_<UID>_h<数字>` 且 UID 非零的注册表值名，将去重后的 UID 以单列原生单选按钮显示在「选择原神 UID」对话框内；不再手动输入 UID。读取国服原神 HKCU 配置并显示当前键鼠 / 手柄状态；取消不写入，确认后才取反 `isUsingJoypad`，下次启动原神时生效。复用原脚本的进程、REG_BINARY、JSON、编码往返、唯一布尔字面量、修改范围和回读校验；保留 BOM 与末尾零字节。确认后及写入前再次检查游戏进程与配置快照，配置变化则中止。写入前在应用数据目录 `top.pigest.diapigeditor/joypad-backup` 留 UTF-16 `.reg` 备份；写入或回读失败会尝试恢复并验证原值。所有失败通过左下角错误 toast 提示，回读成功才弹成功 toast。实现位于 `src/lib/joypad.svelte.ts` 与 `src-tauri/src/joypad.{rs,ps1}`，PowerShell 脚本编译进 exe，不依赖原脚本目录。HKCU 通常可直接写入；写权限不足时提示以管理员身份重启编辑器，不自动切换账户或修改注册表 ACL。

验证：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/joypad-test.ps1` 验证纯编解码、UID 枚举过滤 / 去重与备份；`npm test -- src/model/joypad.test.ts` 验证免责声明倒计时 / 持久化、UID 选择、确认 / 取消和错误提示；在 `src-tauri` 目录运行 `cargo test joypad::tests` 验证隐藏子进程的 UTF-8 错误返回。以上不写真实原神注册表。实际切换验收：退出原神，首次使用等待 5 秒并确认免责声明，从列表选择本机登录过的 UID，核对确认框后确认，应显示切换成功；再次点击应读出相反状态。真实注册表写入及游戏重启生效仍需实际验证。

**对话结构体的新旧两种结构**（2026-11-16）：新结构比旧结构多一个「起止设置」字段（结构体「对话起止设置」：锁定对话前后的黑场时间与事件）。游戏内导入只接受新版完整结构，所以编辑器总是按新结构编辑和保存（2026-11-17）：新建对话带起止设置；导入旧结构的文件时自动补上，并在「对话设置」里提示填写起止设置结构体 ID、确认其他 ID 来自新结构。草稿与 MCP 仍按文件原结构读写。草稿与 MCP 用 `blackout` 字段，见 `docs/对话草稿格式.md`。

## 环境

- Node.js 22.12+（开发使用 24）
- Rust（rustup，`stable-x86_64-pc-windows-msvc`）
- VS 2022 生成工具「使用 C++ 的桌面开发」
- WebView2 运行时（Windows 11 自带）

## 命令

```bash
npm ci
npm test              # 数据模型单元测试（vitest）
npm run draft -- build 草稿.json   # 对话草稿 → 游戏对话 JSON，见 docs/对话草稿格式.md
npm run mcp:test      # 对话 MCP 服务联调自测，见 docs/对话MCP服务.md
npm run dev           # 只在浏览器里跑前端：http://localhost:1420（导入 / 导出回退为文件选择与下载）
npm run tauri dev     # 桌面端开发模式
cargo test -p primfit --manifest-path src-tauri/Cargo.toml   # 图元拟合算法对拍测试
npm run tauri build -- --no-bundle   # 只出免安装 exe
npm run tauri build   # 另出 NSIS 安装包（首次会从 GitHub 下载 NSIS）
```

桌面构建产物默认位于 `src-tauri/target/`。需要将产物放到其他位置时，可在本机设置 `CARGO_TARGET_DIR`。

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/model/types.ts` | 对话 / 节点 / 分支的数据模型 |
| `src/model/codec.ts` | 游戏结构体 JSON 读写；旧版（v1）文件导入时自动转换 |
| `src/model/ops.ts` | 节点增、删、移、粘贴、清理与引用序号修正 |
| `src/model/inheritTitles.ts` | 导出时补全「继承标题」节点沿用的标题 / 副标题（供断线重连），以及来源冲突的检查 |
| `src/model/draft.ts` | 对话草稿（供人和 AI 手写的精简 JSON）与对话数据互转、校验 |
| `scripts/draft.mjs` | 草稿命令行（`check` / `build` / `dump`） |
| `src/model/draftEdit.ts` | 在草稿上做增量修改（改、插入、删除、移动） |
| `scripts/mcp.mjs` | 对话 MCP 服务（stdio），接入方式见 [对话 MCP 服务](docs/对话MCP服务.md) |
| `src/model/richtext.ts` | `<color=#HEX>` 标签的预览解析 |
| `src/model/primfit.ts`、`src/lib/primfit.svelte.ts`、`src/pages/PrimFitPage.svelte` | 「更多 → 图元拟合」：把图片拟合成硬边和实测渐变图元，导出一个 Lua 数据模块（不透明纯硬边 format 1；不透明渐变 format 2；保留透明度 format 3）。格式与 Lua 引用方法见 [图元拟合图片约定](docs/图元拟合图片约定.md) |
| `src/pages/PixelArtPage.svelte`、`src-tauri/src/pixel_art.rs` | 「更多 → 像素画生成」：分别设置成品像素宽高，保留原色或轻微合色，导出 PNG 或可由 `PrimArtView` 读取的 format 3 Lua 模块。 |
| `src/model/agentPrompt.ts`、`src/model/PrimArtView.lua` | 「复制 Agent 提示词」：给其他设备上的 Agent 的自含说明（格式、参考绘制代码、要向用户索要的内容、完成后的手动步骤），代入当前导出参数。`PrimArtView.lua` 与 `docs/图元拟合图片约定.md` 第 4 节逐字相同，由测试检查 |
| `src/model/weightMask.ts`、`src/ui/WeightMaskDialog.svelte` | 图元拟合「高级参数 → 重点区域」：权重蒙版的笔刷、自动生成（细节 / 中心）与覆盖率（纯函数，有单测），以及涂抹 / 擦除 / 撤销的编辑对话框。蒙版随拟合请求发给后端，按 ω = 1 + 8 × m / 255 加权误差；不改导出格式 |
| `src/lib/ui.svelte.ts`、`src/lib/nav.svelte.ts` | 全局提示条与选择对话框；页面导航与「子页面」栈（顶栏换成返回按钮 + 子页面标题，Esc 返回） |
| `src/model/task.ts`、`src/model/taskCodec.ts` | 任务链数据模型、列表操作（新任务编号取最大 + 1）与结构体 JSON 读写；`detectKind` 按根结构体形状区分对话与任务链文件 |
| `src/lib/fileSession.svelte.ts` | 通用文件会话（撤销 / 重做 50 步、保存与自动保存、导入与按路径打开）；导入或打开时按文件种类交给对话或任务会话，并切换主页页签 |
| `src/lib/dialog.svelte.ts`、`src/lib/task.svelte.ts` | 对话、任务链各自的会话与操作 |
| `src/lib/home.svelte.ts` | 主页的共同部分：启动时回到上次的页签并打开文件（另一页签切过去时再打开）、定时自动保存、关闭前同时检查两种文件 |
| `src/pages/HomeSide.svelte`、`src/pages/HomeMain.svelte`、`src/pages/DialogMain.svelte`、`src/pages/TaskMain.svelte` | 「主页」：左侧栏「对话 / 任务」页签，文件信息；「设置」进入子页面「对话设置 - <文件名>」（`DialogMetaMain.svelte`：结构体 ID、开始节点、起止黑场）或「任务设置 - <文件名>」（`TaskMetaMain.svelte`：结构体 ID）；主区的节点列表、任务列表（拖动排序见 `src/ui/rowDrag.svelte.ts`） |
| `src/lib/history.svelte.ts`、`src/model/history.ts`、`src/pages/History*.svelte` | 「历史文件」子页面：打开过的对话与任务链文件按自定义页签归类（图标区分种类），可导入文件夹；保存在本机 localStorage |
| `src/lib/preview.svelte.ts`、`preview.html`、`src/preview/`、`src/model/preview*.ts` | 「预览对话」：独立窗口模拟游戏内的对话表现。与千星奇域对话模板运行时对应的常量集中在 `src/model/previewConfig.ts` |
| `src/lib/settings.svelte.ts`、`src/model/prefs.ts`、`src/pages/SettingsMain.svelte` | 设置（常规：启动 / 自动保存；对话：编辑 / 预览；个性化：主题色 / 字体与自定义字体 / 标题栏） |
| `src/model/mathExpr.ts`、`src/ui/MathField.svelte`、`src/ui/MathKeyboard.svelte` | 成长曲线的自然书写公式框与数学键盘（分式、根式、乘方、函数嵌套），与公式源码互转 |
| `src/model/zoomView.ts`、`src/ui/PrimPreviewDialog.svelte` | 图元拟合的放大预览对话框（滚轮缩放、拖动、原图 / 拟合图切换） |
| `src/lib/reset.ts` | 左侧栏页签右侧「重置」按钮调用的各页面重置函数 |
| `src-tauri/src/files.rs` | 按保存下来的路径读写、列出、删除本机文件的命令（历史文件、自动保存、自定义字体用） |
| `src-tauri/primfit/` | 图元拟合算法（Rust，独立 crate，单独按速度优化）；`cargo test -p primfit` 与 In Falsus 的 JS 实现对拍。「高级参数 → 抗锯齿评分」（默认开启，对应 `FitOptions::antialias`，2026-11-19）：硬边图元按每像素行 4 条子扫描线的面积覆盖率评分与绘制，与预览、游戏的抗锯齿绘制一致；只按像素中心采样时，黑底白字这类图会被细长图元钻空子，留下贯穿黑底的细白线。随机候选仍按像素中心粗筛，爬山、精修用面积覆盖；同样参数约慢一倍，关闭即恢复原来的中心采样。诊断：`PRIMFIT_IMAGE=<图片> PRIMFIT_AA=1 cargo test -p primfit --release --test sliver sliver -- --ignored --nocapture` |
| `src-tauri/src/fit.rs` | 图元拟合的 Tauri 命令（载入图片、开始、停止；只读所选图片，不写文件） |
| `src/lib/files.ts` | 打开 / 保存与关闭确认（Tauri 与浏览器两套实现） |
| `src/ui/CollapsibleCard.svelte` | 默认收起的通用卡片，平滑展开、箭头旋转和键盘操作；图元拟合的「高级参数」使用此组件 |
| `src/ui/app.css` | 设计令牌与基础控件样式 |
| `src/App.svelte`、`src/ui/*.svelte` | 页面与组件 |
| `src-tauri/` | Tauri 外壳、权限（主窗口与预览窗口各一份 capability） |

## 数据格式

外层包装与旧版相同。对话节点字段顺序（v2）：

| # | 字段 | 类型 |
| --- | --- | --- |
| 0 | 操作码 | Int32 |
| 1 | 跳转节点 | Int32 |
| 2 | 分支列表 | StructList（分支名称 String、跳转节点 Int32） |
| 3 | 默认分支 | Int32 |
| 4 | 继承标题? | Bool |
| 5 | 标题 | String |
| 6 | 副标题 | String（空串 = 无） |
| 7 | 内容 | String |
| 8 | 显示模式 | Int32（0 默认 / 1 打字机 / 2 整段渐显 / 3 直出） |
| 9 | 进入事件 | String |
| 10 | 离开事件 | String |
| 11 | 时长 | Float |

「继承标题?」为真的节点在导出时也写上实际沿用的标题与副标题（2026-11-20）：断线重连后 Lua 只拿到当前节点，靠这两个字段显示名字；正常游玩时 Lua 仍沿用上一节点，不读它们。沿用来源从开始节点沿下个节点、指定跳转和各分支推算，开始节点之前是空标题。能从不同说话人走到的继承节点不补（写空串），保存时提示，草稿校验（`dialog_check`、`draft.mjs check`）给出警告；改为直接填写标题即可消除。编辑器里「清理未使用的数据」仍会清空这两个字段，下次保存时重新补上。

导入时按第 6 个字段的类型判断版本：`Bool` 为旧版。旧版转换规则：`副标题?` 为假则副标题置空；内容列表拼成一个字符串，列表长度大于 1 时显示模式取 1，否则取 0。只导出 v2。

`时长` 的类型沿用旧编辑器的 `Float`，尚未用游戏里重建后的 v2 结构体导出文件核对。
