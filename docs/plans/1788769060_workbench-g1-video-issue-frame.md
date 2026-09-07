# G1 · 视频 Issue 创建与真实落帧（计划草案）

> Status: Completed
>
> 创建日期：2026-09-07；代码核验基线：3d820ecc。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：G1-1–G1-4 通过，具体边界见 Outcome。

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

按用户已确认的 Playwright Chromium 方案，通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。本步已使用用户确认的 Playwright Chromium 方案实测，详细环境见 Outcome。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                        | 当前结果                          |
| ---- | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| G1-1 | 视频画布落点创建 Issue；打开时暂停且不吸附网格，保存 frame 与实际展示源帧相同，图钉及时间轴标记可见。 | 通过                              |
| G1-2 | 在 seek 尚未完成时尝试创建，不能用乐观播放头冻结锚点；显示准备状态并在真实帧就绪后继续。              | 通过                              |
| G1-3 | 切至其它帧后点 Issue，确认实际媒体帧落到锚点；同时旧任务级无像素 Issue 仍可创建。                     | 通过                              |
| G1-4 | 制造 disabled、stale、timeout 和解码失败，不能显示定位成功；重试恢复，快速连续点击只响应最后目标。    | 通过；disabled 为单测，其余为实测 |

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

## Outcome

2026-09-08 完成 G1。视频落点模式、创建框、讨论卡片、图钉和时间轴已接通同一源帧锚点；进入落点模式暂停且不吸附网格，坐标与源帧按当次会话冻结。准备期间继续拦截画布绘制，超时、取消和切题不会提交或复活旧锚点。视频任务级入口不等待媒体，且固定为空锚点，不能通过手填坐标绕过源帧确认；图片手填坐标及已有视频像素锚的编辑仍可用。

`seekToFrameReady` 现在返回明确结果，并等待实际媒体绘制回执。原生回退使用真实 ffprobe 时间表和 rVFC 证据，位图捕获前后检查任务、帧和请求代次；rVFC 先于 seeked 到达时，后续事件会重新核验已有证据。普通原生播放在没有精确回执时仍可显示画面，但不宣称定位就绪。Mask QC 定位已适配结果检查。既有反馈 JSONB 与公开 API 结构未变，无迁移、SDK 或版本变更；真实视频夹具补入源媒体时间表，元数据故障只破坏解码样本。

### 浏览器证据

使用本 worktree 的 Web `http://127.0.0.1:3010` 与 API `http://127.0.0.1:8011`，基于 `3d820ecc` 加本次变更；运行时已核对 API/Web 进程目录分别为本 checkout 的 `apps/api`、`apps/web`。任务 URL 为 `/projects/{project_id}/annotate?task={task_id}`。Chromium `147.0.7727.15`，视口 1440×1000，Desktop Chrome 的 DPR 配置为 1。主机是 Precision 7920 / Xeon Gold 6238R / 双 RTX 3090；本次 CDP 报告 Canvas、视频解码和合成为软件路径，未据此认证硬件解码或 GPU 性能。FFmpeg 使用本机已有的 7.0.2，仅在测试进程 PATH 选择；未修改共享依赖。

新增 9 个场景于 03:04–03:06 全部通过，0 skip；最终任务级表单补强后，03:09–03:10 定向复验 3 条创建路径全部通过。最终源码对应的检查集合如下：

| 场景   | 真实交互和持久证据                                                                                                                                                     | 测试任务 ID                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| G1-1/3 | 播放时开启落点会暂停；聚焦 FAB 按 Space 不误播放。采样步长 5 下保存 F17，刷新后卡片、时间轴和实际图钉仍定位 F17，WebCodecs 像素签名一致；没有标注写入。                | `fd0511c8-e78d-4773-90cb-441e4d382e62` |
| G1-3   | 清空像素表单两坐标，写入并刷新读回 `anchor_type=task, anchor_position=null`；点击任务级问题不改变 F8，不产生帧标记。                                                   | `cd338b5a-a5b5-4feb-836b-dadc5f366cd5` |
| G1-3   | 延迟真实 MP4，像素定位准备中直接打开任务级表单；没有坐标控件，媒体放行前已保存空锚点，放行后不复活旧表单，刷新读回仍为空锚点。                                         | `d20fc963-9965-4a7a-b4fc-2c6ebfa5159c` |
| G1-4   | F3 两点多边形草稿上聚焦 F17 Issue 标记并按 Enter，确认框阻止跳帧；继续绘制后补第三点并持久保存 F3 三点几何，重试原 Issue 才定位 F17。                                  | `2c8f8865-28ea-42f6-9191-2bb2efc94ce0` |
| G1-2   | 延迟真实 MP4，首次落点后再次点击和拖框都不穿透；没有标注 POST 或几何草稿。放行后保留最初 F3 落点并保存、读回。                                                         | `f9a12b59-33fe-4649-a421-6c4b083246e4` |
| G1-4   | 延迟超过 3 秒，就绪返回 timeout 且不打开表单；放行并重试后显示原坐标与 F3，实际像素匹配。                                                                              | `88cd8801-0124-458d-af08-d9e901aca814` |
| G1-4   | 真实媒体延迟期间连续选择 F3/F17、SPA 切题 A→B→A；只采纳最后请求，旧任务结果不能复活 ready 或创建框。                                                                   | `20e2c1e9-095f-4537-851c-abbec0f8b27e` |
| G1-4   | 确定性损坏解码样本，原生位图回退仍有真实 F3 像素证据，才报告 ready。                                                                                                   | `385994b4-2e4d-4c48-a9d4-4fff8b25fe21` |
| G1-4   | 明确注入“丢弃原生帧回执”故障：初次及恢复回调后的同帧重试均无新回执，保持 timeout。真实 Shift+ArrowLeft 产生并核对 F2 后，再重试原 F3 锚点，原生位图像素与 ready 一致。 | `f4e98f8a-3cbf-4ff0-a8a7-4929558859bd` |

第一条最终项目 ID 为 `e5a9804b-a516-4108-a69e-6ba51c7c1db1`。落点坐标断言使用独立捕获的真实 click.clientX/clientY 与媒体变换映射，考虑屏幕整像素和表单三位小数量化，保存/读回仍精确相等；F17 实际保存 `{x:0.374,y:0.624,frame:17}`。不是从提交结果反推预期值。确认框关闭后才继续画布输入，避免关闭动画遮挡低层鼠标事件。

相关控制台和 HTTP 错误为 0，未预期的失败请求为 0；任务切换取消的指定读取、心跳、释放锁与延迟媒体请求单独记录。正常业务写入未拦截，反馈与标注写入错误未列入忽略项。延迟真实 MP4、损坏样本、丢弃回执均为明确标注的故障夹具，不代表模型质量测试。控制器 `canSetupFrame=false` 的内部 disabled 分支由单测验证；浏览器使用真实草稿保护的取消路径，未伪造 Stage 状态将其冒称为 disabled 实测。

相邻 `video-webcodecs-precise-frame.spec.ts` 的 9 个场景已在相同播放实现下通过：开关关闭时精确 API 零请求，开关开启，baseline、B 帧重排、GOP 边界、VFR 的真实像素、pending→ready、unsupported 和 malformed 回退。最终仅表单入口收紧，未重复这些已完成的媒体验收。

### 自动化、文档与清理

- 前端 17 个相关单测文件覆盖 347 个用例：先运行 343 个，播放回执与任务级表单各补 2 个回归后定向复验均通过。最终播放 54 个、Issue hook/表单 47 个通过。
- 后端一次性 PostgreSQL 测试库的反馈持久化回归 14 个通过，包含 F0/F17 与任务级空锚；真实编码夹具 11 个通过，包含 VFR、B 帧与源时间表。合计 25 个。
- 完整 Web TypeScript、ESLint、CSS token 检查通过；新增/相邻 E2E TypeScript 与 ESLint 检查通过；计划 freshness、生成文档同步和 `git diff --check` 通过。检查不代表远端 CI。
- 用户指南、视频播放说明、审核开发合同、API 使用示例、README 和 CHANGELOG Unreleased 同步，无发布或版本递增。
- 测试种子逐例清理；最终核对测试库 `annotation_workbench_0dc6_e2e` 的所有者和零连接后删除。停止本次 Redis，Web/API 随验收退出，3010/8011/6397 已释放；没有修改主工作区服务、共享 `.env` 或 Node 依赖。
- 清理测试报告、缓存、临时端口配置与原始调试产物；最小结果保留在本 Outcome。工作分支在集成与等价核对后清理。此文档与实现同次提交，实际提交记录以 Git 为准；随后按依赖继续 G2。
