# G2 · 视频 Issue 完整上下文恢复（计划草案）

> Status: Ready
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：未开始；浏览器验收：未执行。

## 1. 交付范围与依赖

交付结果：视频 Issue 完整上下文恢复。扩展现有 JSONB，无新增列/迁移。接口输入校验、序列化、OpenAPI和 SDK 反馈合同需同提交更新。

硬依赖：[G1](1788769060_workbench-g1-video-issue-frame.md)

## 2. 设计与实现合同

保留 `anchor_type=pixel`、顶层 `task_id/annotation_id` 和 `anchor_position.x/y/frame`，在 `anchor_position` 中新增可选 `video_context`。现有 JSONB 与 pixel CHECK 允许此扩展，**不新增列、不要求历史回填、不需要数据库迁移**。

写入时仅允许视频任务的 pixel 锚携带 `video_context`，且必须同时提供旧 `frame`。新嵌套模型拒绝未知字段和非有限数；任务媒体类型由反馈 service 校验，`annotation_feedbacks.py` 的 `_serialize_anchor` 与创建路由一起更新。旧锚的输入和读取保持兼容。

| 字段                              | 明确语义                                                                    |
| --------------------------------- | --------------------------------------------------------------------------- |
| `schema_version`                  | 本合同为 1；读端遇到未知版本只使用旧帧/像素锚，不推断其内部结构             |
| `track_id`                        | 可选字符串，非 UUID；作为对象缺失后的软定位信息                             |
| `annotation_version`              | 可选 ≥1 整数；输入时要求顶层有 annotation_id；读取允许原对象已被删除        |
| `frame_range.from_frame/to_frame` | 可选，从 0 起的源帧整数闭区间，包含 anchor frame；与采样网格无关            |
| `viewport.center_x/center_y`      | 视频坐标归一化的视口中心；允许平移到图像外，但必须有限                      |
| `viewport.zoom`                   | 正且有限的 `scale / fitScale`；恢复时按新容器尺寸计算，不持久化屏幕像素平移 |
| `timeline_window.from/to`         | 沿用现有 `TimelineWindow` 的源帧窗口，允许分数帧；不重复保存缩放倍数        |

像素锚 x/y 仍限制在 `[0,1]`。范围与窗口在服务端校验顺序和视频边界；恢复时按当前媒体长度及既有窗口/缩放规则夹取，并对媒体变化给出提示。已有 `region_bbox` 可存紧凑几何快照；保留既有 Mask `compare_locator`，本轮不新增通用候选 locator。

**恢复顺序与失败行为**

1. Issue 点击事件携带目标 task 与锚点交给现有导航所有者，不能假设当前任务查询里已有目标 Issue。
2. 通过 `selectTask`、latest navigation scheduler 和未保存草稿保护进入目标任务，等待目标标注、媒体尺寸及首次 fit 就绪。
3. 确认 `seekToFrameReady` 返回 ready，随后恢复对象选择、视频 viewport、timeline window；通过 `VideoStageControls` 与 Overlay 的有限 capture/restore 接口调用各自现有所有者。恢复请求存活期间抑制由此次对象选择触发的普通自动聚焦 effect，最终只应用一次 Issue viewport，完成/失败/取消均释放该请求的抑制标记；不能依赖延时覆盖争抢。
4. 每次等待后检查导航代次与 task；连续点两个 Issue 时仅最后请求生效，用户主动导航取消旧恢复。
5. 对象已删或版本变化时，仍恢复帧和像素/region 锚并提示“对象已变化”；缺少新字段的旧 Issue 使用旧定位。无权限时保留当前位置并给出权限错误；解码失败提供重试，不宣称现场已恢复。

**验收**：10 个单帧问题和范围问题可直接定位；F120–F160 用一条范围 Issue 表达；刷新、不同画布尺寸、outside 对象、对象删除、采样网格、跨任务、快速连续点击、媒体失败与草稿保护均覆盖。

主要路径：`api/feedbacks.ts`、`shell/IssueCreateModal.tsx`、`state/useIssuePins.ts`、`state/useActiveIssueStore.ts`、`shell/WorkbenchStageHost.tsx`、`stage/VideoKonvaStage.tsx`、`stage/videoStageControls.ts`、`stage/useVideoPlaybackController.ts`、`stage/useFrameClock.ts`、`stage/VideoPlaybackOverlay.tsx`，以及 API feedback schema/service/序列化路由。同步 OpenAPI、生成客户端和 SDK 受影响的反馈合同；没有新外部账号或服务依赖。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/shell/IssueCreateModal.tsx](../../apps/web/src/pages/Workbench/shell/IssueCreateModal.tsx)
- [apps/web/src/pages/Workbench/state/useIssuePins.ts](../../apps/web/src/pages/Workbench/state/useIssuePins.ts)
- [apps/web/src/pages/Workbench/state/useActiveIssueStore.ts](../../apps/web/src/pages/Workbench/state/useActiveIssueStore.ts)
- [apps/web/src/pages/Workbench/stage/VideoKonvaStage.tsx](../../apps/web/src/pages/Workbench/stage/VideoKonvaStage.tsx)
- [apps/web/src/pages/Workbench/stage/videoStageControls.ts](../../apps/web/src/pages/Workbench/stage/videoStageControls.ts)
- [apps/web/src/pages/Workbench/stage/VideoPlaybackOverlay.tsx](../../apps/web/src/pages/Workbench/stage/VideoPlaybackOverlay.tsx)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

真实帧夹具复用 `video-webcodecs-precise-frame.spec.ts` 的 seed.videoWebCodecs 和帧标记。原 review-feedback-loop 只验证任务退回，不能证明视频图钉定位。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                                    | 当前结果 |
| ---- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| G2-1 | 选择轨迹、缩放/平移画布并缩放时间窗，创建 Issue；改变所有状态后点击，恢复 task/frame/object/viewport/window。     | 未执行   |
| G2-2 | 创建 F120–F160 范围 Issue，只需一条记录；刷新与改变浏览器容器尺寸后仍能恢复归一化视口和源帧范围。                 | 未执行   |
| G2-3 | 修改或删除被锚对象再点击 Issue，仍落到帧和像素/region 锚，提示对象已变化；旧 Issue 和未知版本上下文使用兼容定位。 | 未执行   |
| G2-4 | 跨任务连续点击两个 Issue，并在导航期间存在草稿；保护生效，旧导航取消，选择聚焦不会覆盖最终 Issue viewport。       | 未执行   |
| G2-5 | 无权限、帧解码失败、上下文字段非法时，分别核对权限/重试/验证错误，不宣称完整恢复。                                | 未执行   |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/video-issue-context.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

后端定向回归：在 apps/api 的本地虚拟环境与已核验测试库运行 `uv run pytest tests/test_annotation_feedbacks.py`。

```bash
pnpm --filter @anno/web test src/pages/Workbench/state/useIssuePins.test.tsx src/pages/Workbench/stage/useVideoPlaybackController.test.ts
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/video-webcodecs-precise-frame.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/video-issue-context.spec.ts --project=chromium
pnpm openapi:export
pnpm codegen
pnpm openapi:check
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
