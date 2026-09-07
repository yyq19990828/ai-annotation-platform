# F2 · 视频单帧与轨迹范围

> Status: Completed
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：F2-1–F2-5 通过。

## 1. 交付范围与依赖

交付结果：视频单帧与轨迹范围。不依赖 F1 的状态条；只增加现有 VideoTool 的范围投影，不改后台几何类型。

硬依赖：[B](1788769060_workbench-b-tool-dock-overflow.md)，已提交为 `4a9e0397`；当前实施基线为 F1 提交 `b6d081d3`。

## 2. 设计与实现合同

工具坞顶部提供作用范围选择，下面投影当前范围可用工具，复用 `VideoTool`、`videoToolUnits` 与现有提交路径。

选择轨迹且无草稿时进入轨迹范围；点空白只清除选择，保留显式作用范围，避免下一笔因取消选中而意外变为单帧。切换范围必须经过草稿保护。原有快捷键保留明确目标：B/P/M 等进入其单帧工具，T 进入轨迹，范围显示同步更新。预览旁显示“仅当前源帧”或“新建轨迹，从当前源帧开始”。

范围和工具通过同一事件原子更新：只有新的轨迹选中事件会触发自动范围变化，不能用“当前仍选着轨迹”的 effect 反复覆盖显式工具命令。bbox/polygon/polyline/Mask 轨迹分别映射到 `track`/`polygon-track`/`polyline-track`/`mask-track`；`select` 为中性工具，保留最近显式范围。目标工具不可用时保留选择工具并解释原因，不隐式切到其它几何或 AI。

已有矩形框轨迹的续画沿用松手即写入关键帧的原流程。鼠标未松开前拒绝切换并说明先完成本帧；新建拖框仍提供继续或丢弃确认。该区分避免在原关键帧已经提交后仍提供“丢弃”选项，不新增草稿或事务所有者。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/shell/ToolDock.tsx](../../apps/web/src/pages/Workbench/shell/ToolDock.tsx)
- [apps/web/src/pages/Workbench/state/useWorkbenchState.ts](../../apps/web/src/pages/Workbench/state/useWorkbenchState.ts)
- [apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx](../../apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx)
- [apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts](../../apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts)
- [apps/web/src/pages/Workbench/stage/videoToolUnits.ts](../../apps/web/src/pages/Workbench/stage/videoToolUnits.ts)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

按用户已授权方式，在真实 Playwright Chromium 中通过点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。本步在端口检查后使用当前 worktree 的 3010 Web / 8011 API、独立 Redis 与一次性数据库完成实测；环境已清理。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                       | 当前结果 |
| ---- | ---------------------------------------------------------------------------------------------------- | -------- |
| F2-1 | 切换单帧/轨迹，分别创建同几何对象，预览提示与保存后的 payload 类型/帧范围一致。                      | 通过     |
| F2-2 | 选择一条轨迹后按 B/P/M，实际工具和范围一起变成单帧，不因仍有选中轨迹而被 effect 切回。               | 通过     |
| F2-3 | bbox/polygon/polyline/Mask 轨迹的新选中事件分别映射对应工具；select 保留最近显式范围，点空白仅清选。 | 通过     |
| F2-4 | 有草稿时切范围触发保护，取消后保留原草稿；工具不可用时保持中性选择并解释原因。                       | 通过     |
| F2-5 | 在短屏更多菜单中重复切范围，当前工具保持可达且不会产生隐形激活工具。                                 | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/video-tool-scope.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/shell/ToolDock.test.tsx src/pages/Workbench/state/useWorkbenchHotkeys.test.ts
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/workbench-layout.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/video-tool-scope.spec.ts --project=chromium
pnpm --filter @anno/web typecheck
pnpm --filter @anno/web lint
git diff --check
```

文档同步：对应用户指南、开发者合同（如改变）和 CHANGELOG Unreleased；具体路径沿用 Epic 对应步骤的文档表。

## 6. 执行、记录与回滚

- 用户于 2026-09-07 更新执行要求：独立草案形成后按序实施，每个里程碑浏览器实测通过后提交。本草案已包含在该执行授权中。
- 按依赖核对当前代码与已交付合同，实施本文件范围，保持原有状态所有者、任务锁与异步代次保护。
- 运行定向回归、浏览器验收和受影响文档检查，修复发现的问题，再复核最终 diff。
- 浏览器所有必测项通过后才将本里程碑标为完成；失败或未测明确保留为未完成，不以其它检查代替。
- 追加 `## Outcome`，记录实际改动、文档位置、测试结果、浏览器逐项结果与证据、清理情况；只有实际存在才记录提交号。更新 Epic 状态索引。
- 每次测试后清理本次中间产物和测试数据；保留明确交付的最小证据。停止本任务启动的进程，恢复浏览器缩放，清理临时配置，不修改共享 .env/依赖或停止主工作区服务。
- 本里程碑验收并提交后，按依赖继续下一份草案。版本与发布日期仍由维护者决定，本轮不作版本发布。

回滚：按本里程碑回退实现；保留已保存的标准标注/反馈数据及后续客户端可选读取字段，不清空用户数据。

## Outcome

2026-09-08 完成实现与验收，基于 `b6d081d3` 及本里程碑工作区变更。

- 工具和范围使用同一会话状态；工具坞投影当前范围，四类轨迹的新选中事件映射对应工具，明确快捷键保持原目标，不因查询刷新覆盖用户选择。
- `useVideoToolCommands` 统一工具、范围、对象行及追踪种子入口的准入。对象行的跳帧和选择一起等待确认；直接查询和清理原 Stage 草稿，Mask 保留原 writer。迟到结果校验任务、分段、源帧、路由、请求代次、稿件身份和种子面板／模式。
- 新建拖框在确认期间松手形成的类别稿按原几何与源帧处理；已有轨迹续画先完成原提交再允许切换，松手后内部自动选择下一轨迹不再触发草稿确认。预览显示真实创建范围。
- 浏览器发现的视频 Mask 临时 ID 读取已在远程描述入口排除，真实 ID 即使沿用临时渲染键也正常读回。布局容器的 2px 水平滚动曾触发位置校验失败，现使用不可滚动裁剪，保留原位置容差和面板内容滚动。
- 同步视频用户指南、Workbench 开发者合同及 CHANGELOG；没有 API payload、布局 schema、版本号或模型执行流程变更。

**浏览器环境。** 当前工作区 `/home/hehao/.codex/worktrees/0dc6/ai-annotation-platform`，Web `http://127.0.0.1:3010`、API `http://127.0.0.1:8011`，Playwright Chromium、Redis 6397 和经归属校验的一次性数据库 `annotation_workbench_0dc6_e2e`。功能场景为 1366×900，短屏为 1440×768；视频为 1440×810 的 `native-mask.webm`。相邻工具坞使用独立浏览器配置，覆盖 768/900/1080 高度及原生 100%/125%/150% 缩放，实际 DPR 和 CSS 视口均有断言。

| 验收项 | 实际交互与持久结果                                                                                                                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F2-1   | bbox、polygon、polyline、Mask 分别在 F3 新建单帧、F6 新建轨迹，保存类型和源帧一致，刷新读回；原生 Mask 比较实际像素。                                                                                                                                             |
| F2-2   | 选中 bbox 轨迹后 B/P/M 分别进入单帧工具，后续渲染及源帧变化不覆盖明确命令。                                                                                                                                                                                       |
| F2-3   | 四类轨迹行分别激活对应轨迹工具；V 保留范围，真实空白点击只清选择。                                                                                                                                                                                                |
| F2-4   | 点集、类别待选和松手后的新建框均覆盖继续／丢弃；轨迹行在继续时保留 F8 原稿，在丢弃 F9 新稿后才跳 F0。续画中 B 被拒绝，松手仅 PATCH 原轨迹补 F8 并保留 F0/F10。种子采集保护原稿、只添加一个目标点并在退出后恢复工具；Mask 继续／丢弃／保存及不可用工具回退均通过。 |
| F2-5   | 短面板反复切范围、打开更多、键盘导航及退出，当前工具保持可见且可达；原画布节点保持同一实例。                                                                                                                                                                      |

F2-1 的 bbox、polygon、polyline、Mask 测试任务分别为 `e3bd762c-acee-46cf-ba57-1debe486cc40`、`7493af00-ba26-4f00-8661-b5df0a8fb2df`、`15f08a80-e582-48f3-9281-bdd2fed8ff36`、`3829e7d6-b0d2-46dc-b8ee-b0f6c08046f1`。F2-2 为 `53398836-3df2-44bc-88f9-30e5850de377`，F2-3 为 `1371e999-d316-44df-bd41-2c37b75e7f45`。F2-4 两条行选择、续画和种子场景分别为 `eccaea5c-f118-4b5f-8f8f-d765fde5e673`、`fb540e36-706f-4a4d-8e74-083372157402`、`e14d44f4-6cc5-4e7d-8df7-5fee6f282c83`、`ee902346-c71e-45cc-bccf-00d1d1ea9d9b`；F2-5 为 `1b12f1c0-83b1-4e56-9c92-b29efb1263d9`。测试记录已清理，标识仅说明实测范围。

**验证。** 401 项不同 Web 单测通过，包括草稿迁移、续画和临时 Mask ID 的实际红绿回归；全量 Web 类型、lint/CSS token、文档生成与计划有效性检查通过。最终 23 条不同浏览器场景通过：本步 16 条、布局 4 条、工具坞 3 条，按修正后对应通过场景的并集计数，不将失败运行计为通过。新增场景最终页面异常、控制台错误和业务 API 错误为空。主题夹具移除不相关的外部 AI 依赖后，原有四张日夜／浮动布局基线在正常比较模式通过，未改比较阈值或基线图片。

正常创建、编辑、选择、保存及读回使用真实业务 API 与鼠标／键盘，无强制点击或 DOM `dispatchEvent`。原生 Mask 输入为确定性 RLE；种子测试只夹具化 ML `/setup` 与 `/capabilities`，不执行模型推理或追踪作业，不据此评价模型质量。

**清理。** 每轮完成种子清理，删除本轮报告与截图；独立 Web/API/Redis 已停止，验证归属和零活动连接后删除一次性数据库。临时配置、脚本、探针及测试缓存已清理，共享 `.env`、主工作区服务和约定复用的静态媒体／内容寻址夹具保持原状。
