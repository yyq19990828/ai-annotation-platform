---
audience: [project_admin]
type: how-to
since: v0.10.3
status: stable
last_reviewed: 2026-05-14
---

# ML 后端绑定

> 适用角色：项目管理员 / 超级管理员

每个项目可以绑定 ML backend 用于工作台交互式 AI 工具（智能点 / 智能框 / 文本提示 / Exemplar）和批量预标注。本页解释**注册、绑定、解绑**三件事，以及开发环境为什么默认只允许每个项目注册一个。

## 注册一个 backend

进入 **项目设置 → ML 模型** 标签。页面上方是 AI 预标注设置，页面下方是本项目的 backend 注册列表：

- 标题右侧角标显示 **已用 X / Y**——X 是当前已注册数，Y 是 `MAX_ML_BACKENDS_PER_PROJECT`（默认 1）。
- 点 **「注册 backend」** 弹出表单。
- 必填项：
  - **名称**：本项目内唯一，建议带模型/环境后缀，如 `grounded-sam2-prod`。
  - **URL**：后端容器内可达的 HTTP(S) 地址。Docker 同主机宿主网常用 `http://172.17.0.1:8001`。
- 可选项：鉴权方式、`max_concurrency`（1-32，控制单 backend 并发预标请求数）。
- 注册前点 **「测试连接」**——平台会用临时探针打一次 `/health`，确认 URL 可达且鉴权配置正确，**不会**写 DB。

> **交互能力 / 支持模态自动探测（v0.10.37 起）**：「是否交互式 backend」不再手填。平台在**健康检查**时会顺带探一次 `/setup`，按 backend 自报的 `is_interactive` / `supported_prompts`（图像 prompt）/ `supported_trackers`（视频 tracker）派生交互能力与支持模态，写库后在列表只读展示。注册一个新 backend 后，先在表格里点一次「健康检查」（刷新图标）即可看到检测到的能力。

## 配置 AI 预标注与绑定 backend

在页面上方的 **AI 预标注设置** 中：

- 勾选 **启用 AI 预标注**。
- 在 **实际 ML Backend** 下拉中选择已注册 backend。
- 可设置 **AI 框去重阈值** 和 **SAM 文本预标默认输出**。
- 点 **保存 AI 设置**。

这些字段原先分散在“基本信息”，现在统一收口到 **ML 模型**。

## 从列表快捷绑定 backend

注册后在表格里点 **「绑定到本项目」**：

- 会同时把项目 `ml_backend_id` 设为该 backend、`ai_enabled` 置 true。
- 已绑定的行显示蓝色 `已绑定` 角标，其他行仍可"绑定到本项目"实现切换。
- 工作台进入时会拉这个 backend 的 `/setup`，按返回的 `supported_prompts` 决定工具栏哪些 AI 工具置灰。
- **模态校验（v0.10.37 起）**：绑定时平台会按项目数据类型校验——视频项目只能绑自报 `supported_trackers`（支持视频追踪）的 backend，否则拒绝绑定。若 backend 此刻不可达探测失败，则放行（不因瞬时宕机卡住操作）。

## 能力列

表格的「能力」列展示每个 backend 的 `supported_prompts` 与 `supported_trackers`（视频追踪），例如：

- `grounded-sam2`：`point` `bbox` `text` `sam2_video`（最后一项为视频追踪能力徽标）
- `sam3-backend`：`bbox` `text` `exemplar`

数据来自后端 `GET /setup`（详见 [开发文档 § ML Backend Protocol](../../dev/reference/ml-backend-protocol.md)）。后端如返回 `—`，说明 `/setup` 不可达或未升级到 v0.10.1+。

## 为什么开发环境默认只能注册一个？（v0.10.x）

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
可以，但工作台没有 backend 路由层（v0.11+ 才有），SAM 工具会随机走第一行。运维纪律上不建议绕过 env 锁。

**Q: 工具栏某个 AI 工具是灰的怎么办？**
按 ADR-0020 的能力协商约定，工具栏只 enable 当前 backend `supported_prompts` 里的工具。Hover 灰按钮会显示「当前后端不支持此交互模式」。如果你需要那个交互模式，切换到声明支持它的 backend。

## 相关文档

- 协议契约：[ML Backend Protocol](../../dev/reference/ml-backend-protocol.md)
- 架构决策：[ADR-0019 Prompt-first ToolDock + 1:N 架构](../../dev/adr/0019-prompt-first-tooldock-1n-arch.md)、[ADR-0020 Capability 协商](../../dev/adr/0020-ml-backend-capability-negotiation.md)
- 工作台侧使用：[AI 工具组](../workbench/sam-tool.md)
