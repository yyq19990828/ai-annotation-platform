# E2 · AI Inspector 阶段展示

> Status: Completed
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：E2-1–E2-5 通过。

## 1. 交付范围与依赖

交付结果：AI Inspector 阶段展示。AIPredictionPopover 是 AIInspectorPanel.tsx 内部导出组件，没有独立同名文件；不创建统一 AI 执行状态机。

硬依赖：[E1](1788769060_workbench-e1-ai-toolbar-layers.md)，已提交为 `44c253ef`。

## 2. 设计与实现合同

交付 Inspector 的 idle/running/review/error 展示。idle 显示运行输入；running 显示进度、当前请求输入摘要与支持的取消；review 显示候选、属性及接受/拒绝；error 显示重试和诊断。一次只突出当前阶段主动作，高级区仍能手动展开。复用 E1 的顶栏，SAM、普通预测、追踪作业继续各自执行。属性草稿在面板隐藏后保留；旧任务结果不打开新题审阅；不改 Dockview grammar、面板实例数或后台编排。当前题运行仍调用原图片预标 mutation 或视频帧预测 API；新增展示与取消归属只跟踪提交时冻结的任务、帧和输入。项目级 WebSocket 不能作为本次作业的身份；图片通过返回的 Celery ID 精确关联已有 async_jobs，复用现有进度与取消接口。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx](../../apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx)
- [apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx](../../apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

使用用户已授权的 Playwright Chromium，通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。本步使用 3010 Web / 8011 API 的隔离服务完成验收。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                               | 当前结果 |
| ---- | -------------------------------------------------------------------------------------------- | -------- |
| E2-1 | 从无结果运行当前题，观察 idle→running→review；每阶段一个主动作，运行摘要固定为该次请求输入。 | 通过     |
| E2-2 | 审阅时修改候选属性、隐藏再打开面板；草稿保留，接受后刷新检查属性落库。                       | 通过     |
| E2-3 | 运行中停靠、浮动、隐藏面板；作业继续且业务实例数不增加。                                     | 通过     |
| E2-4 | 制造失败后重试，再验证取消/切题后的迟到结果不打开新题审阅。                                  | 通过     |
| E2-5 | 视频重复运行与审阅，单帧预测和追踪作业仍使用原执行器和各自范围。                             | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/workbench-ai-inspector-phases.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/shell/AIInspectorPanel.test.tsx
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/workbench-ai-tracker-layout.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/native-mask-ai.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/workbench-ai-inspector-phases.spec.ts --project=chromium
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

2026-09-07 完成实现与验收，代码基于 `44c253ef`，包含本里程碑工作区变更。

- `AIInspectorPanel` 按等待输入、运行、审阅、错误呈现当前题；运行摘要保留提交时的模型变体、阈值、任务和视频帧。配置变更用于下一次运行，不回写进行中的摘要。候选属性草稿由 Shell 保存，浮动、隐藏再打开仍可继续编辑，接受与拒绝复用原有动作及写入门控。
- 新增 `useWorkbenchAiRequest` 跟踪当前请求的归属与展示，图片使用实际返回的 Celery ID 匹配既有作业、进度和取消 API；视频仍调用原单帧预测。切题和取消后的旧结果不切换新题阶段，追踪作业与 SAM 保持各自所有者。
- 浏览器检查发现并修复三项相邻问题：Dockview 分隔条遮住面板菜单；AI Inspector 的全局键盘屏蔽误伤手工视频 Mask 控件；选中本地 AI 候选后讨论区把候选 ID 当作标注 UUID 查询而返回 422。最终图片与视频完整流程的页面异常、控制台错误均为空。
- 同步 `current-task-inference.md`、`projects/ai-preannotate.md`、`workbench/sam-tool.md`、开发者 `workbench-shell.md`、E2E README 与 CHANGELOG Unreleased。

**浏览器证据。** 使用当前工作区 `/home/hehao/.codex/worktrees/0dc6/ai-annotation-platform` 的 `http://127.0.0.1:3010` Web、`http://127.0.0.1:8011` API、独立 Celery 和 Redis，以及已核验的一次性数据库 `annotation_workbench_0dc6_e2e`。浏览器为 Playwright Chromium；新增场景视口为 1440×1080，相邻场景覆盖 1280×720 和 1366×900。图片输入为 64×48 SVG，视频为 1440×810 的 `native-mask.webm`。

| 验收项 | 实际路径与持久结果                                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2-1   | 图片从等待输入进入真实异步作业，按 Celery ID 显示运行进度，再进入审阅；运行中将下一次模型大小改为 large，当前摘要仍为 small。视频 F0 使用原帧预测 API 进入审阅。 |
| E2-2   | 在 polygon 工具激活时选中 bbox 候选，按候选自己的属性定义编辑；面板浮动、隐藏、恢复后草稿保留。按 A 接受，刷新后读回真实标注及属性。                             |
| E2-3   | 图片作业运行中完成浮动、停靠和隐藏，恢复后仍是同一作业，面板和业务实例不增加。另通过布局预设、浮窗调整大小及刷新恢复回归。                                       |
| E2-4   | 确定性模型夹具明确注入一次 503，错误阶段原地重试成功；队列取消等待服务端 cancelled，切到下一题后迟到结果不打开新题审阅。                                         |
| E2-5   | 视频 F0 连续两次运行并使用真实 A/D 决策；接受后刷新读回 `video_bbox` 的 F0 几何。原追踪作业 20 个待审候选及原标注深比较保持不变。                                |

最终图片完整流程的项目/任务为 `34395d37-fdb2-4004-8b66-169fb6952902` / `d105e9b5-f269-4bda-98be-dcc3a61e3db7`；视频为 `0c1d59c6-b28c-4dda-b33c-017bf92c1b8e` / `e69306f4-6cb7-46ec-b675-71821aa79fca`。这些记录已随一次性测试数据清理，仅保留标识用于说明实测范围。

**检查结果。** 181 项不同的相关单测通过（Inspector 39、请求归属 31、图片动作 45、快捷键 47、Dock workspace 19）；全量 Web typecheck、lint 与 CSS token 检查通过。15 条不同的浏览器场景最终通过：新增 E2 场景 4 条、原生 Mask AI 6 条、AI/tracker 布局 2 条、视频候选决策 2 条、标准布局 1 条。首次运行及后续窄范围复验发现的问题已修复；该数量为不同场景的并集，不代表一次运行全部通过。新增四条场景在最终对应运行中均检查页面异常与控制台错误。文档代码生成一致性及计划检查通过。

只对明确声明的模型 HTTP 夹具使用确定性输出和失败注入；正常业务保存、决策、作业进度和取消 API 使用真实服务。交互使用真实点击、按键和拖动，无强制点击或 DOM `dispatchEvent`。本步不宣称模型质量或量化效率提升。

**清理。** 每轮执行既有种子清理；按确切测试任务 UUID 删除上传的帧预测中间文件。停止独立 Web/API/Celery/Redis；确认数据库属于当前连接用户且无活动连接后删除测试数据库。清理 Playwright 报告、Vitest 缓存、临时端口配置和执行脚本，未修改共享 `.env`、依赖或主工作区服务。
