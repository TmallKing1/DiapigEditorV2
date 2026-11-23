// 「复制 Agent 提示词」：给其他设备上的 Agent 用的完整说明，告诉它如何在千星奇域 Lua 项目里使用本工具导出的图元拟合模块。
// 对方的工作区不一定有本机的 Skill、API 文档、工作约定或素材表，模板 ID 也可能不同，所以这里只写引擎与 API 层面的事实，
// 不引用本机路径；项目相关的 ID 让对方先在工作区找、找不到再问用户。
// 参考绘制代码只维护一份：PrimArtView.lua 与仓库 docs/图元拟合图片约定.md 第 4 节逐字相同（agentPrompt.test.ts 检查）。
import PRIM_ART_VIEW from "./PrimArtView.lua?raw";
import { ASSET_OF_KIND, IMAGE_TYPE_OF_KIND, KIND_LABELS, type Art, artFormat, colorHex } from "./primfit";

export interface PromptInfo {
  /** 模块名（= 文件名去掉 .lua = 脚本映射名） */
  module: string;
  /** 本次导出的数据（已截取前 k 个） */
  art: Art;
  /** 相似度 0–1；不知道时省略 */
  similarity?: number;
  /** 源图文件名 */
  source?: string;
  pixelArt?: { filename: string; packed: boolean };
}

const FENCE = "```";

export function agentPrompt(info: PromptInfo): string {
  const { module, art, pixelArt } = info;
  const filename = pixelArt?.filename ?? `${module}.lua`;
  const title = pixelArt ? "像素画" : "图元拟合图片";
  const format = artFormat(art);
  const count = art.shapes.length;
  const used = [...new Set(art.shapes.map((s) => s.k))].sort((a, b) => a - b);
  const bgAlpha = format === 3 ? (art.bgAlpha ?? 255) : 255;
  const kindRows = [1, 2, 3, 4, 5, 6]
    .filter((k) => pixelArt ? k === 1 : format !== 1 || k <= 3)
    .map((k) => `| ${k} | ${KIND_LABELS[k]} | ${ASSET_OF_KIND[k]} | \`${IMAGE_TYPE_OF_KIND[k]}\` | ${used.includes(k) ? "是" : "否"} |`);

  const facts = [
    `- 模块名：\`${module}\`（文件 \`${filename}\`；脚本映射名与 require 名都跟随文件名）`,
    `- 格式：\`format = ${format}\`${format === 3 ? `，背景不透明度 \`bgAlpha = ${bgAlpha}\`${bgAlpha === 0 ? "（透明底）" : ""}` : "（不透明背景）"}`,
    `- 画面坐标单位：${art.width} × ${art.height}（只是坐标单位，可按任意显示宽度等比缩放）`,
    `- 图元数：${count}（控件数 = 图元数 + 1）`,
    `- 用到的图元类型：${used.length ? used.map((k) => `${k} ${KIND_LABELS[k]}`).join("、") : "无（空画面）"}`,
  ];
  if (pixelArt) facts.splice(2, 0, `- 成品像素：${art.width / 2} × ${art.height / 2} px，每个成品像素占 2 × 2 个 Lua 坐标单位`);
  if (info.source) facts.push(`- 源图：${info.source}`);
  if (info.similarity !== undefined) facts.push(`- 相似度：${(info.similarity * 100).toFixed(1)}%`);
  const first = art.shapes[0];
  const sample = pixelArt
    ? (first ? `1,${first.x},${first.y},${first.w},${first.h},0,${colorHex(first)},\n` : "")
    : "2,109,61,57,99,82,0xE5A39DE7,\n1,152,113,35,203,9,0x18F8F0FF,\n";

  return `# 任务：在千星奇域 Lua 客户端项目里显示一张「${title}」

你在为一个原神「千星奇域」（Miliastra）客户端 Lua 项目工作。千星奇域不能导入外部图片，所以用户${pixelArt ? '用 Diapig Editor 的「像素画生成」把点阵转换成同色矩形，导出为可由图元拟合读取器加载的 Lua 模块' : '用 Diapig Editor 的「图元拟合」把一张图片近似成几百个染色、半透明的基础图元，导出成一个**纯数据 Lua 模块**'}。你的任务是写代码，在游戏界面里把它画出来。

本说明自成一体：你的工作区里可能没有关于这个格式的任何文档，以下内容就是全部依据。工作区若有项目自己的规范（如 AGENTS.md、API 文档、控件工厂、编辑器数据表），优先遵守项目规范，并复用其中已有的工具函数。

## 1. 本次导出的模块

${facts.join("\n")}

## 2. 模块格式

${pixelArt?.packed ? '文件在 `require` 时自行解码为下方格式的表。接入时直接复用 `PrimArtView`。' : '文件只有注释和一个 `return` 表，形如：'}

${FENCE}lua
return {
format=${format},w=${art.width},h=${art.height},bg=0x${art.bg.toString(16).toUpperCase().padStart(6, "0")},${format === 3 ? `bgAlpha=${bgAlpha},` : ""}
shapes={
${sample}},
}
${FENCE}

| 字段 | 含义 |
| --- | --- |
| \`format\` | \`1\`：不透明背景，只有 kind 1–3；\`2\`：不透明背景，kind 1–6；\`3\`：背景不透明度由 \`bgAlpha\` 给出，kind 1–6 |
| \`w\`、\`h\` | 画面宽高，坐标单位（${pixelArt ? '每个成品像素对应 2 个坐标单位' : '拟合时的工作分辨率'}），显示时按任意宽度等比缩放 |
| \`bg\` | 背景色 \`0xRRGGBB\`，也是外层遮罩矩形的 RGB |
| \`bgAlpha\` | 背景不透明度 0–255 的整数。format 3 必填；format 1/2 可省略（视为 255），给了也只校验范围、绘制时仍用 255 |
| \`shapes\` | 每 7 个整数一个图元，按叠放顺序**从下到上** |

每个图元的 7 个整数：

1. kind（类型，见下表）。format 1 只允许 1–3，format 2/3 允许 1–6；未知 kind 必须拒绝，不能退回矩形。
2. 中心 x、3. 中心 y：原点在画面**左下角**，X 向右、Y 向上。
4. 宽、5. 高：即控件的 \`sizeDelta\`。椭圆是两轴直径，三角形是底边宽和高（尖顶朝局部 +Y）。
6. 旋转角（整数度），**逆时针为正**，即 \`SetLocalRotation(0, 0, r)\`。kind 3、5 为 0–359，其余为 0–179。
7. 颜色 \`0xAARRGGBB\`（非预乘），AA 是不透明度 1–255。

## 3. 图元类型、素材与图片模式

| kind | 名称 | 素材 ID | \`Enum.ImageType\` | 本次用到 |
| --- | --- | --- | --- | --- |
${kindRows.join("\n")}

- 素材都是素材库的静态图片，用 \`SetImage(Enum.ImageSource.StaticReference, 素材ID)\` 绑定，与项目无关、各设备相同。
${format === 1 || pixelArt ? "" : "- kind 4（106057）必须用 `Basic`，其余用 `Stretch`；用错会改变渐变形状。软边来自素材自身的 Alpha，**不要**开 `enableSoftEdge` 或其他羽化字段。\n"}- 外层遮罩是一张 100001 矩形图片：颜色 RGB 为 \`bg\`，Alpha 在 format 3 取 \`bgAlpha\`、format 1/2 取 255；\`enableMask = true\`、\`reverseMaskArea = false\`。Alpha 为 0 时它仍能裁切子图片（已实机确认）。
- 图元全部是遮罩的子控件，各自 \`enableMask = false\`；超出画面的部分由遮罩裁掉。
- 坐标、旋转方向与引擎一致（布局 Y 向上、旋转逆时针为正），**不要**取负或翻转。
- 必须按顺序创建（后建的在上层）：半透明颜色是按叠放顺序拟合出来的。
${pixelArt ? '- 画完整像素画时按记录顺序创建全部图元。需要更少控件时，可以生成较小尺寸或启用轻微合色。' : '- 拟合是贪心的，前 k 个图元本身就是「只用 k 个」的近似，缩略图可以只画前缀，不必另导一份。'}

## 4. 运行环境前提（引擎事实）

- 运行时是 Lua 5.3：整数位运算 \`>> & |\` 可用；\`io.*\`、\`string.dump\`、大部分 \`os.*\` / \`debug.*\` / \`coroutine.*\` 不可用。
- 原生 \`require\` 可用，但只能加载**在千星沙箱里建了脚本映射**的文件；没有映射的文件 require 不到，也不会进存档。子文件夹里的模块写 \`require("子文件夹.模块名")\`，只写模块名取不到。\`require\` 有缓存，改文件后要重新进入试玩才生效。
- 控件用 \`game.InstantiateClientUIControl(图片控件模板索引, 父控件)\` 创建、\`game.DestroyClientUIControl(控件)\` 销毁；颜色用 \`Color(r, g, b, a)\`（0–255）。
- 每帧创建控件不宜超过约 96 个，图元多时要分帧创建。
- 只有入口脚本有生命周期回调（\`OnInit\` / \`OnUpdate\` 等）；定义了 \`OnUpdate\` 的入口要在 \`OnInit\` 里调用一次 \`script:EnableUpdate(true)\`。被 require 的模块在导入阶段只声明函数和数据，不创建控件。

## 5. 先在工作区里找，找不到再问用户

不要猜 ID。按顺序在工作区（文档、数据表、已有代码）里查找，仍然没有的再一次性问用户：

1. **图片控件（ClientUIImageControl）的模板索引**：\`game.InstantiateClientUIControl\` 的第一个参数。不同存档不同，不能沿用别处的数字。项目已有封装好的「创建图片」函数时直接复用。
2. **数据模块放在哪里**：在 \`external_lua_file\` 根目录还是子文件夹，由此确定 require 名（根目录 \`"${module}"\`，子文件夹 \`"文件夹.${module}"\`）。用户还没把文件放进工作区时，请对方放进去。
3. **显示位置**：画在哪个页面 / 父控件下、中心位置、显示宽度（高度按 \`h / w\` 等比），以及何时创建、何时销毁。
${pixelArt ? '4. **预计同时加载几张像素画**，便于按页面管理控件与分帧预算。' : '4. **是否只画前 k 个**（如缩略图）。'}
5. 项目有没有自己的坐标适配层（逻辑画布缩放、舞台换算）、控件所有权登记和分帧任务调度器——有就接入，没有就用下面参考代码自带的 \`step(budget)\`。

## 6. 参考实现

下面的 \`PrimArtView\` 只用官方 API，不依赖任何项目上下文，可以原样新建为一个模块（文件 \`PrimArtView.lua\`，同样要建脚本映射），也可以把做法并进项目自己的控件工厂。它会严格校验数据，格式不对时返回原因而不是画错。

${FENCE}lua
${PRIM_ART_VIEW.trimEnd()}
${FENCE}

入口里的用法（示意）：

${FENCE}lua
-- OnInit / 装配阶段（IMAGE_PREFAB 是图片控件模板索引）
local PrimArtView = require("PrimArtView")(IMAGE_PREFAB)

-- 页面打开时
local art, why = PrimArtView.load("${module}")   -- 放在子文件夹时写 "文件夹.${module}"
if not art then
    printerr("[PrimArt] 读取失败：" .. tostring(why))   -- 降级：显示占位或跳过
else
    builder = PrimArtView.begin(parentControl, "${module}", art, 0, 0, 400)
end

-- OnUpdate：每帧最多建 96 个，建完为止
if builder and not builder.done then builder.step(96) end

-- 离开页面时（建完或没建完都要）
if builder then builder.destroy(); builder = nil end
${FENCE}

## 7. 必须遵守

- 用 \`pcall(require, 名字)\` 取数据，取到后立刻 \`package.loaded[名字] = nil\`，建完控件就不再持有原始表（参考代码的 \`load\` 已这样做）。
- 模块缺失或校验失败时降级（占位或跳过）并打一条带前缀的日志，不要让整个页面报错，也不要逐帧刷日志。
- 位置和尺寸都乘同一个系数 \`k = 显示宽度 / w\`；宽高用不同系数会让旋转过的图元变形。
- 子图元锚点放在遮罩左下角 \`(0, 0)\`、轴心在中心，\`anchoredPosition\` 直接用表中坐标乘 \`k\`。项目有逻辑画布缩放时，把显示位置和宽度先按项目的适配层换算成父级局部坐标再传入。
- 移动、缩放、显隐都作用在遮罩上，不逐个改图元。不要旋转遮罩或它的父级（表现未知）。
- 遮罩和图元控件要登记到页面或会话的所有者，离开页面时销毁；还没建完就离开也要销毁并丢掉进行中的任务。
${pixelArt ? '- 需要不同的像素画时，请用户从 Editor 重新生成并导出完整模块。' : '- 不要修改数据模块的内容或格式；需要不同的图元数就请用户重新导出，或只画前缀。'}

## 8. 完成后交给用户的事

在回复里清楚列出用户需要手动做的事，不要说成已经完成：

1. 把 \`${filename}\` 放进项目的 \`external_lua_file\`（或约定的子文件夹）。
2. 在千星沙箱的「客户端脚本资源管理器」里，为 \`${module}\` 和新建的绘制模块（如 \`PrimArtView\`）各建立**同名脚本映射**：文件名去掉 \`.lua\`、保留大小写，只建映射、不挂载到容器。放在子文件夹的模块，require 名要带文件夹前缀。
3. 如果你向用户要了图片控件模板索引或其他 ID，说明它填在了哪里。
4. 重新进入试玩（require 有缓存，切换页面不会读到新文件）。
5. 与 Diapig Editor 里的预览对比：位置、旋转、颜色、半透明叠加、四边裁切${format === 3 ? "；透明底要分别放在深色、浅色和彩色背景上看，应没有不透明的底色矩形" : ""}。图元多时留意创建期间的帧率。
6. 有问题时把实机截图或千星沙箱日志窗口里的脚本日志发回来。

交付说明里如实区分：你做过的静态检查或桌面模拟只能说明语法和逻辑，**不等于实机通过**；实机表现以用户反馈为准。
`;
}
