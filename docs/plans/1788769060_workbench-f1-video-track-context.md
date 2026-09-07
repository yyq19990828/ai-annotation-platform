# F1 · 当前视频轨迹条

> Status: Completed
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：F1-1–F1-4 通过。

## 1. 交付范围与依赖

交付结果：当前视频轨迹条。不引入 3D temporal 领域或持久化状态；不改变现有 Mask 最近可见关键帧保持语义。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

放在画布面板内、视频画布上缘，不依赖可隐藏的详细时间轴。收敛现有选中卡与 sticky 信息，复用 `videoStageGeometry.ts`、`videoTrackOutside.ts`、`videoTrackTimeline.ts` 派生：

- 类别、短 track id、颜色、锁定状态；无选中时显示选择提示。
- 从 0 起的当前源帧、关键帧/插值/保持/outside、遮挡状态与相邻关键帧。
- 来源只使用实际存在的关键帧 provenance；缺字段显示“来源未知”，不能从整条 Annotation 来源推断人工或 AI。
- 补关键帧、outside、重传播或审阅入口仅在相应写入条件满足时出现；最多显示 3–5 个当前可用快捷键。

当前不可见或 outside 不等于轨迹不存在。查询轨迹身份与当前帧状态分离，不从当前帧可见几何数组推断生命周期；不依赖 3D 研究中的未实现状态。K 继续暂停播放，不照搬竞品的关键帧键位。

源码核验发现读取旧关键帧时，`AnnotationOut.geometry` 的验证默认值会把缺失来源补为人工。本步在响应 JSON 序列化时保留这一字段的原始缺省，写入 schema 默认值和存量数据不变；浏览器通过真实 PATCH 与 GET 验证缺来源的旧数据展示，不用拦截响应伪造该场景。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/stage/VideoKonvaStage.tsx](../../apps/web/src/pages/Workbench/stage/VideoKonvaStage.tsx)
- [apps/web/src/pages/Workbench/stage/videoStageGeometry.ts](../../apps/web/src/pages/Workbench/stage/videoStageGeometry.ts)
- [apps/web/src/pages/Workbench/stage/videoTrackOutside.ts](../../apps/web/src/pages/Workbench/stage/videoTrackOutside.ts)
- [apps/web/src/pages/Workbench/stage/videoTrackTimeline.ts](../../apps/web/src/pages/Workbench/stage/videoTrackTimeline.ts)
- [apps/api/app/schemas/annotation.py](../../apps/api/app/schemas/annotation.py)：读取时保留旧关键帧来源缺失。

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

使用用户已授权的 Playwright Chromium，通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                                  | 当前结果 |
| ---- | --------------------------------------------------------------------------------------------------------------- | -------- |
| F1-1 | 依次选择 bbox、polygon、polyline 与 Mask 轨迹，跨关键帧与派生帧跳转；身份、源帧、状态和邻近关键帧与时间轴一致。 | 通过     |
| F1-2 | 跳至 outside 和遮挡帧；轨迹身份仍可见，缺 provenance 明示来源未知，不从整条 annotation 猜人工/AI。              | 通过     |
| F1-3 | 展开/收起时间轴并调整布局；当前轨迹条留在画布面板，不依赖浮窗可见性。                                           | 通过     |
| F1-4 | 锁定轨迹或进入只读审核，写动作禁用；K 仍暂停，已有轨迹快捷键不变。                                              | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/video-track-context.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/stage/videoStageGeometry.test.ts src/pages/Workbench/stage/videoTrackTimeline.test.ts
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/video-mask-keyframe-operations.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/video-track-context.spec.ts --project=chromium
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

2026-09-07 完成实现与验收，基于 `9976d0c9` 及本里程碑工作区变更。

- 新增 `videoTrackContext` 与 `VideoTrackContextBar`。身份从完整标注集合获取；框、点集和 Mask 状态复用现有几何解析，区分插值、最近可见关键帧保持、outside 与本帧无几何。只读时间轴导航扩展到四类轨迹，原有算法、Mask 像素保持与快捷键目标不变。
- 轨迹条使用画布上方的正常布局行，合并 sticky 提示及原选中卡的当前状态；详细卡保留几何、属性和关键帧编辑。公共工具与追踪审阅浮层统一定位在下方视频区域，与原绘制节点互为兄弟，保留测量、坐标及事件边界。浏览器发现的 AI 顶栏遮挡已修复。
- 插值帧可通过既有 upsert / `onUpdate` 补关键帧，bbox 与 Mask 的 outside、延展入口沿用原动作；检查只读、标注锁、会话轨迹锁、工作范围和绘制/播放状态。既有轨迹动作补齐标注锁检查，O/Q 不再绕过该锁。
- `AnnotationOut` JSON 读取保留旧关键帧来源缺省，不从标注整体来源推断；不修改写入默认值或回填存量数据。OpenAPI 与生成客户端已刷新检查，快照没有结构差异。
- 同步视频用户指南、任务与标注 API 指南、README、Workbench 开发者合同和 CHANGELOG；更新受文案迁移影响的 Mask 回归及文档录制定位器。

**浏览器环境。** 当前工作区 `/home/hehao/.codex/worktrees/0dc6/ai-annotation-platform`，Web `http://127.0.0.1:3010`、API `http://127.0.0.1:8011`，Playwright Chromium、独立 Redis 和已核验的一次性数据库 `annotation_workbench_0dc6_e2e`。新增用例使用 1366×900，布局用例另以 900×740 检查窄视口；视频为 1440×810 的 `native-mask.webm`。

| 验收项 | 实际交互与读回证据                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1-1   | 真实 API 创建四类 F0/F10 轨迹，选择、逐帧、上一/下一关键帧；框与点集显示插值，Mask F5 保持 F0、F6 保持 F10，来源随实际锚点显示。                                              |
| F1-2   | 带预测父关联的 bbox 通过真实 PATCH 保留 F0 来源缺省，GET 与页面均确认未知；F0 遮挡，F5 outside、F8 无几何，轨迹 ID 与颜色仍保留，F10 显示实际人工来源。                       |
| F1-3   | bbox、polygon、polyline 在 F5 补人工关键帧，刷新读回原端点和新关键帧；Mask 标记 outside、恢复后刷新读回。详细时间轴折叠及面板布局调整后轨迹条保持可达，宽窄截图已人工检查。   |
| F1-4   | 标注锁、L 会话锁、已完成任务的只读审核均无可用写动作，O/Q 不修改标注；K 暂停真实播放，锁定与只读状态下仍可跳关键帧。最终对应场景的页面异常、控制台错误及非预期 API 错误为空。 |

F1-1 的项目/任务为 `8bd1ff07-6990-4eb7-bd78-26df2b6f818a` / `6588335a-8c06-44e3-a22a-8e4fd3b502f5`；F1-2 为 `6813538f-3b8f-42c4-a592-f9d4f1490f67` / `e19f5f82-5feb-4d79-9077-77b661467164`；F1-3 为 `a92b6165-65f9-4a27-bbf7-34d8b9effca5` / `55f2b53c-b7b1-4175-bd8c-baef7556e0cb`；F1-4 为 `12812014-f157-48d3-bcb5-60543263e3a5` / `1ae4e177-25ce-41b4-a4f0-b53c51d69cc9`。测试记录已清理，标识仅说明实测范围。

**验证。** 174 项不同的 Web 单测及 8 项 API schema 测试通过；全量 Web 类型、lint/CSS token、Ruff、OpenAPI 一致性及文档生成检查通过。最终 9 条不同浏览器场景通过：本步 4 条、原生 Mask 关键帧操作 1 条、视频 AI 采纳与漂移修正 2 条、追踪局部审阅 1 条、AI/tracker 停靠布局 1 条。数量为修复后各次对应通过场景的并集；首次夹具顺序、版本头、账号切换租约与旧文案定位失败均已修正，不将失败运行计为通过。

新增四条场景使用真实业务 API、点击和按键，无强制点击或 DOM `dispatchEvent`。Mask 输入为明确声明的确定性 RLE 夹具；相邻 AI 场景沿用其已声明的模型响应夹具，不属于真实模型质量验收。本步没有量化效率或移动端整体可用性的结论。

**清理。** 每轮执行种子清理并删除本轮报告与截图；停止独立 Web/API/Redis，确认数据库归属与零活动连接后删除一次性数据库。临时启动配置、执行脚本和测试缓存已清理；共享 `.env`、主工作区服务和仓库约定复用的静态媒体夹具保持原状。

**提交。** 本里程碑已提交为 `b6d081d3`，提交钩子的 Web lint、类型检查与 OpenAPI 再生成检查全部通过。
