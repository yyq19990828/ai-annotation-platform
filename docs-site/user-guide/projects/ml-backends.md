---
audience: [project_admin]
type: how-to
since: v0.10.3
status: stable
last_reviewed: 2026-06-09
---

# ML 后端绑定

> 适用角色：项目管理员 / 超级管理员

每个项目可以绑定 ML backend 用于工作台交互式 AI 工具（智能点 / 智能框 / Exemplar，均为画布手势驱动）和批量预标注（文本「找全图」/ 几何 / OCR / 版面）。本页解释**注册、绑定、解绑**三件事，以及开发环境为什么默认只允许每个项目注册一个。

> **交互线 / 批量线分流（v0.14.18）**：注册多个后端时，工作台 AI 按角色 + 能力路由——交互工具(point/bbox/exemplar)自动路由到支持该 prompt 的交互后端，批量预标走批量后端，两条线**同时就绪**。例如 yolo 设为默认（批量几何）+ gsam2 注册：批量「开始预标」走 yolo，工具栏 point/bbox 自动命中 gsam2。文本「找全图」属批量线（不在工具栏）。详见 [AI 工具组 § 交互后端选择](../workbench/sam-tool.md#交互后端选择多后端)。

## 注册一个 backend

进入 **项目设置 → ML 模型** 标签。页面上方是 AI 预标注设置，页面下方是本项目的 backend 注册列表：

- 标题右侧角标显示 **已用 X / Y**——X 是当前已注册数，Y 是 `MAX_ML_BACKENDS_PER_PROJECT`（默认 1）。
- 点 **「注册 backend」** 弹出表单。
- 必填项：
  - **名称**：本项目内唯一，建议带模型/环境后缀，如 `grounded-sam2-prod`。
  - **URL**：后端容器内可达的 HTTP(S) 地址。Docker 同主机宿主网常用 `http://172.17.0.1:8001`。
- 可选项：鉴权方式、`max_concurrency`（1-32，控制单 backend 并发预标请求数）。
- 注册前点 **「测试连接」**——平台会用临时探针打一次 `/health`，确认 URL 可达且鉴权配置正确，**不会**写 DB。

> **交互能力 / 支持模态自动探测**：「是否交互式 backend」不需要手填。平台在**健康检查**时会顺带探一次 `/setup`，按 backend 自报的 `is_interactive` / `supported_prompts`（图像 prompt）/ `supported_trackers`（视频 tracker）派生交互能力与支持模态，写库后在列表只读展示。注册一个新 backend 后，先在表格里点一次「健康检查」（刷新图标）即可看到检测到的能力。

## 配置 AI 预标注与默认 backend

在页面上方的 **AI 预标注设置** 中：

- 勾选 **启用 AI 预标注**。
- 在 **默认 ML Backend** 下拉中选择已注册 backend。
- 可设置 **AI 框去重阈值** 和 **SAM 文本预标默认输出**。
- 点 **保存 AI 设置**。

这些字段原先分散在“基本信息”，现在统一收口到 **ML 模型**。

## 从列表快捷设为默认 backend

> **注册 ≠ 默认**：项目可注册多个 backend（受 `MAX_ML_BACKENDS_PER_PROJECT` 上限约束），它们都可用；「默认」只是单个 `ml_backend_id` 指针，决定工作台 / 批量页打开时**默认预选**哪个，并非「唯一可用」。已注册的其它 backend 仍可在 AI 面板的 backend 选择器里切换使用。

注册后在表格里点 **「设为默认」**：

- 会同时把项目 `ml_backend_id` 设为该 backend、`ai_enabled` 置 true。
- 作为默认的行显示蓝色 `默认` 角标，其他行仍可点 **「设为默认」** 改默认。
- 工作台进入时会拉这个 backend 的 `/setup`，按返回的 `supported_prompts` 决定工具栏哪些 AI 工具置灰。
- **模态校验**：设默认时平台会按项目数据类型校验——视频项目只能设自报 `supported_trackers`（支持视频追踪）的 backend，否则拒绝。若 backend 此刻不可达探测失败，则放行（不因瞬时宕机卡住操作）。

## 能力列

表格的「能力」列展示每个 backend 的 `supported_prompts` 与 `supported_trackers`（视频追踪），例如：

- `grounded-sam2`：`point` `bbox` `text` `sam2_video`（最后一项为视频追踪能力徽标）
- `sam3-backend`：`bbox` `text` `exemplar`

数据来自后端 `GET /setup`（详见 [开发文档 § ML Backend Protocol](../../dev/reference/ml-backend-protocol.md)）。后端如返回 `—`，说明 `/setup` 不可达或协议信息不完整。

## 为什么开发环境默认只能注册一个？

测试环境单机显存有限。**两个 backend（grounded-sam2 + sam3）同时长驻会爆显存**。所以 `MAX_ML_BACKENDS_PER_PROJECT` 默认是 1。

后端 API 和 DB schema 已经按 1:N 设计；前端的多 backend 选择器也会在配额放开后出现。生产环境可按显存和并发预算调大 env：

```bash
MAX_ML_BACKENDS_PER_PROJECT=2
```

UI 形态不会变——配额角标自动更新、「注册 backend」按钮自动解禁。具体决策见 [ADR-0019](../../dev/adr/0019-prompt-first-tooldock-1n-arch.md)。

## 达到上限时会发生什么？

- 「注册 backend」按钮**置灰**，hover tooltip 提示 "已达上限 N，请先解绑现有后端"。
- 强行触发或竞态情况下，会弹出 **「🚧 多后端共存暂未支持」** 模态框，文案来自服务器 `409` 响应。
- 解决：先在目标后端那行点 **删除** 解绑（确认后该 backend 记录从项目中移除），再注册新的。

## 解绑与删除

| 操作 | 影响 |
|---|---|
| **删除 backend** | 从项目移除该 backend 记录。如果它是当前预标注 backend，项目 `ml_backend_id` 自动置 null、`ai_enabled` 不变。 |
| **绑定其他 backend** | 切换 `ml_backend_id` 并同步 `ai_model` 展示名，老 backend 仍注册在项目里。 |

## 常见问题

**Q: 已经生成的预标注会受切换 backend 影响吗？**
不会。已写库的标注不会被回滚；只有新触发的预标注/交互式调用会走新 backend。

**Q: 我直接改 DB 加多行可以吗？**
可以，但工作台侧仍应通过项目绑定和页面下拉显式选择 backend。绕过 env 配额直接改 DB 容易造成显存超预算或路由不清晰，运维纪律上不建议这么做。

**Q: 工具栏某个 AI 工具是灰的怎么办？**
按 ADR-0020 的能力协商约定，工具栏交互工具只 enable **任一已注册交互后端** `supported_prompts` 支持的项（v0.14.18 起按并集判定，不再只看默认后端）。Hover 灰按钮会显示「当前后端不支持此交互模式」。如果你需要那个交互模式，注册一个声明支持它的 backend 即可（无需设为默认）。

## 相关文档

- 协议契约：[ML Backend Protocol](../../dev/reference/ml-backend-protocol.md)
- 架构决策：[ADR-0019 Prompt-first ToolDock + 1:N 架构](../../dev/adr/0019-prompt-first-tooldock-1n-arch.md)、[ADR-0020 Capability 协商](../../dev/adr/0020-ml-backend-capability-negotiation.md)
- 工作台侧使用：[AI 工具组](../workbench/sam-tool.md)
