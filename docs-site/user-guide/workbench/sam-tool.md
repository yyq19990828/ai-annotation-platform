---
audience: [annotator]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-05-27
---

# AI 工具组

> 点 / 框 / 文本 / 示例 / Magic Box — 选一种交互方式让 AI 把 polygon 画出来,或直接收紧到 bbox。

<!-- history: prompt-first tools and Magic Box were introduced in separate releases; this page describes the current tool model. -->

工具栏按交互范式拆成 5 个独立 AI 工具。你直接选择「想怎么交互」，AI 自动走对应模型 prompt。

| 工具 | 图标 | 默认快捷键 | 后端要求 | 输出形态 |
|---|---|---|---|---|
| **智能点** | 🎯 | `S` 循环 | `point` | polygon 候选 |
| **智能框** | ▭ | `S` 循环 | `bbox` | polygon 候选 |
| **Magic Box** | ✨ | `G` / `S` 循环 | `bbox` | **直接** bbox 标注 |
| **文本提示** | 💬 | `S` 循环 | `text` | polygon / bbox 候选 |
| **Exemplar 示例** | ⎘ | `S` 循环 | `exemplar` (仅 SAM 3) | polygon / bbox 候选 |

按 `S` 在 5 个 AI 工具之间循环，**跳过当前后端不支持的工具**（按钮置灰）；循环顺序: smart-point → smart-box → **magic-box** → text-prompt → exemplar → 回 smart-point。`Alt+3` 与 `S` 等价。

> **能力来自后端 `/setup.supported_prompts`**：项目挂的是 `grounded-sam2`（point/bbox/text）时 Exemplar 灰；挂 `sam3-backend`（text/exemplar）时 **Smart Point、Smart Box、Magic Box 都灰**——sam3 这一档物理上只做 PCS「找全图相似」（走 Exemplar）与文本提示，不做单物体的点/框分割（需 grounded-sam2 或大显存卡开 inst_interactivity）。鼠标 hover 灰按钮会显示「当前后端不支持此交互模式」。

## 工具说明

### 智能点（Smart Point）— 单击让 SAM 找边缘

- **单击**：在目标上点一下 → SAM 把这个东西的轮廓找出来（positive point）
- **Alt + 单击**：负向点，告诉 SAM「这块不要」做减法
- 工具激活时右侧 **AIToolDrawer** 显示极性切换圆按钮，按 `=` / `+` 切正向，按 `-` 切负向

### 智能框（Smart Box）— 拖框作 bbox prompt

拖框，SAM 把框内主要前景的 polygon 找出来。比智能点更明确「就是这一块」，适合背景杂乱时。

### Magic Box — 拖框 → SAM 收紧到对象紧凑外接矩形

拖框时不要求精准，拖一个**大致包住目标**的框就行;SAM 跑 mask → 自动取 mask 的紧凑外接矩形 → **直接落 bbox 标注**(不经过候选层确认)。

| 与 Smart Box 的区别 |
|---|
| Smart Box: 输出 polygon 候选,等 `Enter` 接受 + 选类 |
| Magic Box: 输出 **bbox** 直接落库,跳过候选层 |

**使用场景**: 想要精准 bbox 但不想拖到对象边缘的精细位置 — 粗框一下,SAM 帮你把"距离对象边 5px"的浪费空间砍掉。

**注意**: 落库的 bbox 类别取当前 `activeClass`(左侧调色板高亮的类);若未选类则用 SAM 返回的 label 或类别列表首个。Magic Box 的标注归 `ai_interactive` 工具单位,类别集从该单位读取（工具维度类别详见[创建项目](../projects/index.md#工具维度类别--属性)）。

### 文本提示（Text Prompt）— 不知道有几个目标就用文本

激活该工具后，**右栏 AI 面板**会弹出「找全图」输入框（同时 AIToolDrawer 显示提示文案）。输入英文 prompt（如 `ripe apple`、`car . truck . bicycle`），GroundingDINO 或 SAM 3 PCS 批量返回候选。

输出形态三选一：

- `□ 框`：仅 box，跳过 mask（速度最快，image-det 项目首选）
- `○ 掩膜`：mask → polygon（image-seg 项目默认）
- `⊕ 全部`：同实例配对 box + polygon（Tab 切活跃形态）

项目设置 → ML 模型 →「SAM 文本预标默认输出」可锁定项目级默认。

### Exemplar 示例（仅 SAM 3）

拖框圈出图中**已有的一个示例实例**，SAM 3 PCS 一步返回**全图相似实例**。

AIToolDrawer 提供与文本提示相同的输出形态三选一（`□ 框` / `○ 掩膜` / `⊕ 全部`），默认 `○ 掩膜`；选 `□ 框` 仅返回 box，`⊕ 全部` 同实例配对 box + polygon。

适用场景：

- 图里有 50 个红苹果，你只想框 1 个让模型批量补齐
- 不容易用英文描述的形态（特定造型部件 / 罕见品类）

> 与「智能框」手势相同（拖框），但意图不同：智能框是「就找这块的轮廓」，Exemplar 是「找全图所有跟这块相似的」。激活的工具决定路由。

## 候选确认

所有 AI 工具返回的 polygon 都是**待确认紫虚线**，需要确认才落库：

- **`Enter`** — 接受当前候选 → 弹类别选择器 → 选好类别才进库
- **`Tab` / `Shift+Tab`** — 切换候选（文本 / exemplar 路径常见多条）
- **`Esc`** — 全部取消

## 参数面板（悬浮 AI 面板）

点工具栏「AI」打开可拖动的悬浮面板，其中有一份**由所绑定后端 `/setup.params` 自动生成的参数表单**，每个字段下方带简短说明。常见字段：

- `box_threshold` / `text_threshold` — DINO 置信度（grounded-sam2）
- `score_threshold` — PCS 置信度（sam3）
- `simplify_tolerance` — 多边形轮廓简化容差（像素）
- `model_variant` / `embedding_cache_size` — 只读信息（禁用展示，不可改）

模型变体（SAM2 / DINO 变体）在同一面板的「变体选择器」里切换。backend 若上报 `/setup.supported_variants`，选项会显示显存估算、快速/均衡/精度档位和推荐标识；未上报时回落到 `/setup.params` 的 enum。参数按**所绑定后端**动态显示——绑 sam3 不会出现 DINO 阈值，绑 gsam2 才有。

调整后再次触发的 AI 请求会带上新参数。普通阈值/容差设置**按你个人 + 后端独立保存**（存入用户偏好），刷新或下次进工作台仍保留；工作台里的模型变体保持会话级，ai-pre 批量预标页面的变体选择则按 backend 记忆。

## 多模型选择与兼容性提示

v0.14.9 起，若所绑定 backend 在[能力声明协议 v2](../../dev/reference/ml-backend-protocol) 中暴露**多个 model 条目**，右栏 AIToolDrawer 顶部会出现「模型」下拉，按 task 中文分组（如「文字识别」「版面分析」）。切换后续 AI 请求改用所选 model。

> 与「变体选择器」的区别：**变体**是同一 model 的不同权重档位（如 SAM2-L / SAM2-B）；**模型**是同一 backend 暴露的不同 model 条目（往往 task 不同）。backend 只有单个 model（含老 backend / 协议 v1）时不渲染模型下拉，行为完全不变。

选中 model 的输出与当前项目配置不匹配时，AIToolDrawer 与 AI 面板会显示**非阻断**警告条幅（不影响触发）：

- **几何不匹配**：模型输出某种几何但项目未启用对应标注工具，采纳后可能无法落库。
- **缺文本属性**：模型会输出识别文本（OCR），但项目未配置 text 属性，采纳后文本将丢失——需在项目设置为对应工具添加 text 属性。

## 与 BboxTool / PolygonTool 的关系

- `B` 矩形工具：完全自己画框，AI 不参与，最快最精准但累。
- `S` AI 工具组：给 prompt 让 AI 出 polygon，最省手但需要确认候选。
- `P` polygon 工具：逐顶点画，最精细。

**典型工作流**：先 `S` → 文本提示「找全图」拿大类目，Tab + Enter 收明显的 → `B` 手补漏的 → `P` 精修 AI 没拟合好的边缘 → 复杂形态目标用 Exemplar 一键批量补齐。

## 快捷键速查

| 键 | 行为 |
|---|---|
| `S` | 在 5 个 AI 工具间循环（跳过置灰；含 Magic Box） |
| `G` | 直接切到 Magic Box |
| `Alt + 3` | 同 `S` |
| 单击 | Smart Point: positive point |
| `Alt + 单击` | Smart Point: negative point |
| `=` / `+` / `-` | Smart Point 默认极性切换 |
| 拖框 | Smart Box / Magic Box / Exemplar 触发 |
| `Enter` | 接受当前候选（Magic Box 跳过此步直接落库） |
| `Esc` | 取消所有候选 |
| `Tab` / `Shift+Tab` | 切换候选 |

## 常见问题

- **某个 AI 工具置灰**：当前项目挂的后端不支持该 prompt 类型；hover 工具看 tooltip，或到项目设置切换后端。
- **AIToolDrawer 没显示**：当前激活的不是 AI 工具，或 `/setup` 拉取失败（看右下状态指示，红 = 失败）。
- **参数调了没生效**：确认是在悬浮 AI 面板里调（非左侧子工具抽屉）；只读字段（模型版本 / 缓存容量）不可改。参数按个人 + 后端保存，切到使用不同后端的项目会各用各的设置。
- **Exemplar 框出来 0 个结果**：示例区域太小 / 太模糊；尝试更明显的示例，或调低 `score_threshold`。
- **同图反复点击很慢**：第一次会跑 image encoder（~1.6s SAM2 / ~2-3s SAM3），命中 LRU 缓存后 < 50ms。
