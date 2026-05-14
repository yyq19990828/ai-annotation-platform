---
audience: [annotator]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-05-14
---

# AI 工具组（Prompt-first，v0.10.2 重构）

> 点 / 框 / 文本 / 示例 — 选一种交互方式让 AI 把 polygon 画出来。

v0.10.2 起，原「SAM 智能工具 + 子工具栏」改为**按交互范式拆分的 4 个独立工具**。你直接在工具栏选「想怎么交互」，AI 自动跑对应的模型 prompt。

| 工具 | 图标 | 默认快捷键 | 后端要求 |
|---|---|---|---|
| **智能点** | 🎯 | `S` 循环 | `point` |
| **智能框** | ▭ | `S` 循环 | `bbox` |
| **文本提示** | 💬 | `S` 循环 | `text` |
| **Exemplar 示例** | ⎘ | `S` 循环 | `exemplar` (仅 SAM 3) |

按 `S` 在 4 个 AI 工具之间循环，**跳过当前后端不支持的工具**（按钮置灰）；第 5 次按 `S` 回到默认矩形工具。`Alt+3` 与 `S` 等价。

> **能力来自后端 `/setup.supported_prompts`**：项目挂的是 `grounded-sam2`（point/bbox/text）时 Exemplar 灰；挂 `sam3-backend` 时 Smart Point 灰。鼠标 hover 灰按钮会显示「当前后端不支持此交互模式」。

## 工具说明

### 智能点（Smart Point）— 单击让 SAM 找边缘

- **单击**：在目标上点一下 → SAM 把这个东西的轮廓找出来（positive point）
- **Alt + 单击**：负向点，告诉 SAM「这块不要」做减法
- 工具激活时右侧 **AIToolDrawer** 显示极性切换圆按钮，按 `=` / `+` 切正向，按 `-` 切负向

### 智能框（Smart Box）— 拖框作 bbox prompt

拖框，SAM 把框内主要前景的 polygon 找出来。比智能点更明确「就是这一块」，适合背景杂乱时。

### 文本提示（Text Prompt）— 不知道有几个目标就用文本

激活该工具后，**右栏 AI 面板**会弹出「找全图」输入框（同时 AIToolDrawer 显示提示文案）。输入英文 prompt（如 `ripe apple`、`car . truck . bicycle`），GroundingDINO 或 SAM 3 PCS 批量返回候选。

输出形态三选一：

- `□ 框`：仅 box，跳过 mask（速度最快，image-det 项目首选）
- `○ 掩膜`：mask → polygon（image-seg 项目默认）
- `⊕ 全部`：同实例配对 box + polygon（Tab 切活跃形态）

项目设置 → 基本信息 →「文本预标默认输出」可锁定项目级默认。

### Exemplar 示例（v0.10.2 新增，仅 SAM 3）

拖框圈出图中**已有的一个示例实例**，SAM 3 PCS 一步返回**全图相似实例**的 mask。

适用场景：

- 图里有 50 个红苹果，你只想框 1 个让模型批量补齐
- 不容易用英文描述的形态（特定造型部件 / 罕见品类）

> 与「智能框」手势相同（拖框），但意图不同：智能框是「就找这块的轮廓」，Exemplar 是「找全图所有跟这块相似的」。激活的工具决定路由。

## 候选确认

所有 AI 工具返回的 polygon 都是**待确认紫虚线**，需要确认才落库：

- **`Enter`** — 接受当前候选 → 弹类别选择器 → 选好类别才进库
- **`Tab` / `Shift+Tab`** — 切换候选（文本 / exemplar 路径常见多条）
- **`Esc`** — 全部取消

## 参数面板（AIToolDrawer）

工具激活时右侧抽屉显示一份**由后端 `/setup.params` 自动生成的参数表单**，常见字段：

- `box_threshold` / `text_threshold` — DINO 置信度（grounded-sam2）
- `score_threshold` — PCS 置信度（sam3）
- `model_variant` — base / large

调整后再次触发的 AI 请求会带上新参数，**仅在本次会话内生效**，不持久化到项目。

## 与 BboxTool / PolygonTool 的关系

- `B` 矩形工具：完全自己画框，AI 不参与，最快最精准但累。
- `S` AI 工具组：给 prompt 让 AI 出 polygon，最省手但需要确认候选。
- `P` polygon 工具：逐顶点画，最精细。

**典型工作流**：先 `S` → 文本提示「找全图」拿大类目，Tab + Enter 收明显的 → `B` 手补漏的 → `P` 精修 AI 没拟合好的边缘 → 复杂形态目标用 Exemplar 一键批量补齐。

## 快捷键速查

| 键 | 行为 |
|---|---|
| `S` | 在 4 个 AI 工具间循环（跳过置灰） |
| `Alt + 3` | 同 `S` |
| 单击 | Smart Point: positive point |
| `Alt + 单击` | Smart Point: negative point |
| `=` / `+` / `-` | Smart Point 默认极性切换 |
| 拖框 | Smart Box / Exemplar 触发 |
| `Enter` | 接受当前候选 |
| `Esc` | 取消所有候选 |
| `Tab` / `Shift+Tab` | 切换候选 |

## 常见问题

- **某个 AI 工具置灰**：当前项目挂的后端不支持该 prompt 类型；hover 工具看 tooltip，或到项目设置切换后端。
- **AIToolDrawer 没显示**：当前激活的不是 AI 工具，或 `/setup` 拉取失败（看右下状态指示，红 = 失败）。
- **参数调了没生效**：参数仅在本会话生效；切换项目或刷新会重置。需要持久化请到项目设置。
- **Exemplar 框出来 0 个结果**：示例区域太小 / 太模糊；尝试更明显的示例，或调低 `score_threshold`。
- **同图反复点击很慢**：第一次会跑 image encoder（~1.6s SAM2 / ~2-3s SAM3），命中 LRU 缓存后 < 50ms。
