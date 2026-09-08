# F3 · 追踪候选审阅范围

> Status: Completed
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：F3-1–F3-4 全部通过。

## 1. 交付范围与依赖

交付结果：追踪候选审阅范围。核心所有者是 apps/web/src/hooks/useVideoTrackerJobs.ts；不创建新的全局审阅 store。F1 已存在时接入它，未存在时先由现有审阅条承载，不等待 F1。

硬依赖：无硬依赖；当前实施基线为 F2 提交 `bfe7ae70`，接入已完成的 F1 轨迹条及 F2 工具准入。

## 2. 设计与实现合同

在现有 `useVideoTrackerJobs` 审阅生命周期内管理当前 job、目标集和帧窗口，供 `VideoTrackerReviewBar`、轨迹条与时间轴消费。停止在每次渲染时默认取首个待审 job；也不在多个组件存独立的目标集。

切帧保留审阅目标与窗口；revision 更新后与剩余合法候选求交。换看参考轨迹不更换审阅目标，只有显式“加入/替换审阅目标”才改变集合。始终显示目标数、帧范围与未决数；部分接受后提供剩余区间的跳转入口。继续沿用局部决定与人工关键帧保护。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/stage/VideoTrackerReviewBar.tsx](../../../apps/web/src/pages/Workbench/stage/VideoTrackerReviewBar.tsx)
- [apps/web/src/pages/Workbench/stage/VideoPlaybackOverlay.tsx](../../../apps/web/src/pages/Workbench/stage/VideoPlaybackOverlay.tsx)
- [apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx](../../../apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx)
- [apps/web/src/hooks/useVideoTrackerJobs.ts](../../../apps/web/src/hooks/useVideoTrackerJobs.ts)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

按用户已授权方式，在真实 Playwright Chromium 中通过点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。本步已复核并使用当前 worktree 的 3010 Web / 8011 API 独立服务完成实测，环境及任务见 Outcome。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                              | 当前结果 |
| ---- | ------------------------------------------------------------------------------------------- | -------- |
| F3-1 | 两个待审 job 间显式切换，选目标和帧窗口；画布、审阅条、时间轴显示同一范围，不跳回首个 job。 | 通过     |
| F3-2 | 切帧以及查看参考轨迹，原审阅目标/窗口保持；只有显式加入/替换目标改变集合。                  | 通过     |
| F3-3 | 部分接受后剩余区间可点击跳转，人工关键帧保持；revision 更新与剩余合法目标求交。             | 通过     |
| F3-4 | 运行审阅请求时切题或换 job，旧响应不复活候选，也不覆盖新范围；刷新按原 owner 恢复 job。     | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

```bash
pnpm --filter @anno/web test src/pages/Workbench/stage/VideoTrackerReviewBar.test.tsx src/hooks/useVideoTrackerJobs.test.ts
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/video-tracker-local-review.spec.ts --project=chromium
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

提交：`3d820ecc`（`feat(workbench): keep tracker review scope consistent`）。

2026-09-08 完成实施与验收，基于 F2 提交 `bfe7ae70`。

### 实现与文档

- `TrackerJobStore` 在原 owner 内统一当前作业、各作业的目标集和源帧窗口。后到候选不抢走当前作业；切换作业保留各自选区，revision 仅与合法剩余目标求交，不扩大窗口。候选及计数从原数据派生。
- 审阅条提供明确作业选择，轨迹条与紧凑/展开时间轴持续显示同一范围。查看参考轨迹与切帧保留目标，只有加入/替换按钮按真实 source / target annotation ID 改变目标。剩余区间导航保留工具和多选，通过原绘制与 Mask 草稿保护；首尾单帧范围仍可见。
- bbox 与 Mask 画布仅显示当前审阅选区的候选。Mask 解码期间立即退出旧作业的预览，迟到解码不能复活已退役范围；原标注位图释放顺序与缓存保持。
- 恢复、预览与决定使用任务 epoch、作业代次和请求归属，覆盖任务 A→B→A、旧 revision、终态后迟到结果及提交状态清理。失败的初次列表恢复在登录态就绪后重试。人工帧覆盖确认绑定原意图与原 selector，换作业或任务后失效；各作业可独立提交。
- 真实并发操作发现 `candidate_decision_conflict` 先于 revision 校验返回，现与源版本及作业版本冲突一起刷新候选并保留范围。Mask QC 区域 selector 与原人工关键帧保护继续使用同一决定入口。
- 已同步 `video-propagate.md`、`video-track.md`、`workbench-shell.md` 和 `CHANGELOG.md` Unreleased。未改变生产 API schema、版本或追踪执行架构；本次画布实测为 bbox，Mask 范围与解码归属另有单测，不声明新增 polygon 候选渲染能力。

### 实测环境与证据

- Web `http://127.0.0.1:3010`、API `http://127.0.0.1:8011`，进程 cwd 分别核验为本 worktree 的 `apps/web` / `apps/api`；未使用主工作区 3000/8000 或 Grafana 3001。
- Chromium `147.0.7727.15`，视口 1440×1000；真实 1440×810 视频媒体，所有操作使用浏览器原生点击、选项、输入与按键。数据库 `annotation_workbench_0dc6_e2e`、Redis 6397 为本轮隔离资源。
- 追踪候选来自确定性 staged-output 夹具；正常场景不拦截业务 API。三项异步场景只延迟真实 API 响应的交付，保留真实请求、服务端决定、响应与标注读回，不构造成功响应，也不作为模型质量验证。

| 验收               | 实际证据                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F3-1、F3-2         | 任务 `ee0aeefb-13ce-4393-8d18-a8320c763f39`，作业 `056a6cbc-16e6-48d1-8eae-186abd30b409` / `5c10cc7b-eb92-4fc5-896b-152a0935b551`。三处摘要与 job UUID、目标、帧窗、未决数一致；切换返回保留范围，参考轨迹仅通过加入/替换改变目标。Konva 实际图层目标色像素：A-only 为 A=78/B=0，窗口外为 0/0，B-only 为 A=0/B=78；两张截图已复核，刷新后四条源标注保持不变。 |
| F3-3               | 任务 `4539a399-5ef7-4a2a-93d9-f62fcc6b4ea3`，作业 `1b2fd56e-de8b-41cd-b076-4a5dfd207d91`。另一真实请求先拒绝 B 后，旧选区收到 409，刷新仅保留 A 与原 F12–F15；接受该区间后 accepted=4/rejected=10/pending=6，剩余 F10–F11、F16–F19 可直接定位，人工 F16 保持，刷新后读回一致。                                                                                |
| 局部决定与人工保护 | 任务 `ec526b37-5720-4094-8795-9959824e27b4`，作业 `b13d50cc-c3ec-4970-9c7c-cd21b4f63040`。分目标接受/拒绝后窗口保持；A/F16 真实 409 后明确确认，同一 selector 以 override 成功 200，最终 accepted=7/rejected=6/pending=7，刷新读回来源为 prediction。                                                                                                         |
| F3-4：旧成功换作业 | 任务 `177b9bb8-ea80-4937-9e1a-3d00d261c199`，旧作业 `ec1d49c5-8606-408a-b502-d32f2f1c4c36` 的真实 200 在切至另一作业后交付。当前 B/F10–F11 与源帧不变；旧 A 的 4 帧确已持久化，pending=16，刷新可恢复。                                                                                                                                                       |
| F3-4：旧人工冲突   | 换作业任务 `3a1d1735-c863-4986-9532-c540812201a0`；换任务 `14171acf-1174-43a5-8050-ebd09dd066ff` → `d4f0e3a8-5913-40b0-bd2c-592bf255b48f`。旧 A/F16 的真实 409 延后交付，新 B/F12–F15 保持；没有旧确认或 override 重试，原标注和 pending=20 均不变，刷新恢复新任务。                                                                                          |

最终同轮执行 6/6 通过，用时 1.2 分钟。除预期的人工保护与候选决定冲突 409 外，没有额外业务 API 或页面/控制台错误。验收过程中发现的 Mask 预览残留及并发冲突刷新遗漏均已先复现再修复；测试夹具同时改为显示全部参考轨迹、及时读取响应证据，并正确等待已解决目标控件消失。

### 检查与清理

- 共 251 个不同 Web 单测通过：审阅 owner/helper 40、审阅条/轨迹条/时间轴 80、Stage 与宿主 52、导航/输入/类别/Mask 79。
- 完整 Web typecheck、lint 与 CSS token 检查通过；文档 codegen 核验 112 个快捷键、47 个设置项、388 条路由/64 个模块一致，计划 freshness 无陈旧未记录项；最终 diff 已检查。
- 各浏览器场景退出页面后清理种子，整轮 teardown 清理测试数据；已停止本轮 Web/API/Redis，核验测试库所有者及零活动连接后删除一次性数据库。测试日志、截图、JSON 报告、缓存与临时 Playwright 配置在验收记录提取后清理；共享配置、依赖、主服务和静态夹具未改动。
