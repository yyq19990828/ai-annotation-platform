# F3 · 追踪候选审阅范围（计划草案）

> Status: Ready
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：未开始；浏览器验收：未执行。

## 1. 交付范围与依赖

交付结果：追踪候选审阅范围。核心所有者是 apps/web/src/hooks/useVideoTrackerJobs.ts；不创建新的全局审阅 store。F1 已存在时接入它，未存在时先由现有审阅条承载，不等待 F1。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

在现有 `useVideoTrackerJobs` 审阅生命周期内管理当前 job、目标集和帧窗口，供 `VideoTrackerReviewBar`、轨迹条与时间轴消费。停止在每次渲染时默认取首个待审 job；也不在多个组件存独立的目标集。

切帧保留审阅目标与窗口；revision 更新后与剩余合法候选求交。换看参考轨迹不更换审阅目标，只有显式“加入/替换审阅目标”才改变集合。始终显示目标数、帧范围与未决数；部分接受后提供剩余区间的跳转入口。继续沿用局部决定与人工关键帧保护。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/stage/VideoTrackerReviewBar.tsx](../../apps/web/src/pages/Workbench/stage/VideoTrackerReviewBar.tsx)
- [apps/web/src/pages/Workbench/stage/VideoPlaybackOverlay.tsx](../../apps/web/src/pages/Workbench/stage/VideoPlaybackOverlay.tsx)
- [apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx](../../apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx)
- [apps/web/src/hooks/useVideoTrackerJobs.ts](../../apps/web/src/hooks/useVideoTrackerJobs.ts)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                              | 当前结果 |
| ---- | ------------------------------------------------------------------------------------------- | -------- |
| F3-1 | 两个待审 job 间显式切换，选目标和帧窗口；画布、审阅条、时间轴显示同一范围，不跳回首个 job。 | 未执行   |
| F3-2 | 切帧以及查看参考轨迹，原审阅目标/窗口保持；只有显式加入/替换目标改变集合。                  | 未执行   |
| F3-3 | 部分接受后剩余区间可点击跳转，人工关键帧保持；revision 更新与剩余合法目标求交。             | 未执行   |
| F3-4 | 运行审阅请求时切题或换 job，旧响应不复活候选，也不覆盖新范围；刷新按原 owner 恢复 job。     | 未执行   |

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
