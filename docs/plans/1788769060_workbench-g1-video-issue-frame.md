# G1 · 视频 Issue 创建与真实落帧（计划草案）

> Status: Ready
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：未开始；浏览器验收：未执行。

## 1. 交付范围与依赖

交付结果：视频 Issue 创建与真实落帧。不新增 video_context；先交付旧 pixel/frame 合同闭环和明确的就绪结果。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

接通 `WorkbenchStageHost` 与视频画布的 drop-arm/onIssuePinDrop，复用现有创建框。创建时暂停播放且不吸附到采样网格，冻结打开时的源帧和归一化落点；提交时不能重新读取后来变化的播放头。已有帧图钉、时间轴标记与点击跳转共用该锚点。

无像素位置的任务级 Issue 继续可用。新视频像素 Issue 自动写 `anchor_position.frame`；该帧必须对应实际展示帧，尚未完成的 seek 不能用于冻结锚点。当前 `seekToFrameReady` 会丢失底层结果，且底层有禁用直接返回和超时被标为接受的路径；G1 同时补齐明确的 ready/cancelled/timeout/unavailable 结果，只有实际展示帧等于目标且 task/generation 仍有效才为 ready。Issue 调用方检查结果，失败保持原锚点和可重试状态，不把 Promise 结束等同于定位完成。现有调用方逐一适配与回归。这一步可独立完成创建和跳帧闭环。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/shell/IssueCreateModal.tsx](../../apps/web/src/pages/Workbench/shell/IssueCreateModal.tsx)
- [apps/web/src/pages/Workbench/shell/WorkbenchStageHost.tsx](../../apps/web/src/pages/Workbench/shell/WorkbenchStageHost.tsx)
- [apps/web/src/pages/Workbench/state/useIssuePins.ts](../../apps/web/src/pages/Workbench/state/useIssuePins.ts)
- [apps/web/src/pages/Workbench/stage/VideoKonvaStage.tsx](../../apps/web/src/pages/Workbench/stage/VideoKonvaStage.tsx)
- [apps/web/src/pages/Workbench/stage/videoStageControls.ts](../../apps/web/src/pages/Workbench/stage/videoStageControls.ts)
- [apps/web/src/pages/Workbench/stage/useVideoPlaybackController.ts](../../apps/web/src/pages/Workbench/stage/useVideoPlaybackController.ts)
- [apps/web/src/pages/Workbench/stage/useFrameClock.ts](../../apps/web/src/pages/Workbench/stage/useFrameClock.ts)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

真实帧夹具复用 `video-webcodecs-precise-frame.spec.ts` 的 seed.videoWebCodecs 和帧标记。原 review-feedback-loop 只验证任务退回，不能证明视频图钉定位。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                        | 当前结果 |
| ---- | ----------------------------------------------------------------------------------------------------- | -------- |
| G1-1 | 视频画布落点创建 Issue；打开时暂停且不吸附网格，保存 frame 与实际展示源帧相同，图钉及时间轴标记可见。 | 未执行   |
| G1-2 | 在 seek 尚未完成时尝试创建，不能用乐观播放头冻结锚点；显示准备状态并在真实帧就绪后继续。              | 未执行   |
| G1-3 | 切至其它帧后点 Issue，确认实际媒体帧落到锚点；同时旧任务级无像素 Issue 仍可创建。                     | 未执行   |
| G1-4 | 制造 disabled、stale、timeout 和解码失败，不能显示定位成功；重试恢复，快速连续点击只响应最后目标。    | 未执行   |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/video-issue-frame.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

后端定向回归：在 apps/api 的本地虚拟环境与已核验测试库运行 `uv run pytest tests/test_annotation_feedbacks.py`。

```bash
pnpm --filter @anno/web test src/pages/Workbench/state/useIssuePins.test.tsx src/pages/Workbench/stage/useFrameClock.test.ts src/pages/Workbench/stage/useVideoPlaybackController.test.ts
pnpm --filter @anno/web test:e2e e2e/tests/video-webcodecs-precise-frame.spec.ts --project=chromium
pnpm --filter @anno/web test:e2e e2e/tests/video-issue-frame.spec.ts --project=chromium
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
