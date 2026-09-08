# H3 · 沿已有 Polygon 边界追踪（计划草案）

> Status: Done
>
> 创建日期：2026-09-07；代码核验基线：89849018。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：通过。

## 1. 交付范围与依赖

交付结果：沿已有 Polygon 边界追踪。不实施 Slice；H4a 不以 H3 为依赖。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

首版仅支持当前图片中已保存、可用的简单单外环 Polygon。起止点吸附到同一边界，预览顺/逆两条路径，默认较短弧，并提供两项明确选择；确认后一次追加到现有草稿，随后仍可逐点撤销。

冻结来源 ID/version；来源发生修改或消失时使预览失效。带孔或多外环对象使用现有复杂几何门控，明确显示不支持原因，不降级成 points-only 几何。测试凹多边形、跨首尾顶点、同点、近顶点与来源更新。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/stage/tools/PolygonTool.ts](../../apps/web/src/pages/Workbench/stage/tools/PolygonTool.ts)
- [apps/web/src/pages/Workbench/stage/shared/geometry/polygonOps.ts](../../apps/web/src/pages/Workbench/stage/shared/geometry/polygonOps.ts)
- [apps/web/src/pages/Workbench/stage/shared/geometry/geometryEditPolicy.ts](../../apps/web/src/pages/Workbench/stage/shared/geometry/geometryEditPolicy.ts)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                  | 当前结果 |
| ---- | ------------------------------------------------------------------------------- | -------- |
| H3-1 | 在凹 Polygon 同一边界选起止点，默认较短弧；切换另一条路径、确认，草稿准确追加。 | 通过     |
| H3-2 | 跨首尾顶点选择路径，没有重复端点；Backspace 逐点撤，取消预览不改来源对象。      | 通过     |
| H3-3 | 预览打开后通过第二测试会话修改/删除来源，再确认时拒绝失效预览。                 | 通过     |
| H3-4 | 含孔、multi_polygon、同点起止等情况显示原因，不能降级为单环保存。               | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/polygon-boundary-trace.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/stage/shared/geometry/polygonOps.test.ts src/pages/Workbench/stage/tools/PolygonTool.test.ts src/pages/Workbench/stage/ImageStageShapes.holes.test.tsx
pnpm --filter @anno/web test:e2e e2e/tests/workbench-image-konva-smoke.spec.ts --project=chromium
pnpm --filter @anno/web test:e2e e2e/tests/polygon-boundary-trace.spec.ts --project=chromium
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

- 实际提交：`9df2ebbe`（`feat(workbench): trace saved polygon boundaries into drafts`）。

完成日期：2026-09-08。实现基于 `89849018`，沿用现有草稿和创建事务；未新增 API 或修改来源标注。

### 实现与文档

- 图片 Polygon 工具增加“沿已有边界”控件。起止点按 8 CSS px 吸附，同一来源生成明确的顺/逆两条路径，默认较短弧；所选路径在画布中预览，确认后一次追加，连接处去重并继续支持逐点撤销。
- `polygonBoundaryTrace` 保留凹顶点与首尾环绕，投影和长度计算使用实际屏幕宽高，明确拒绝带孔、多外环、退化和自相交来源。选取时冻结完整 geometry、ID 和 version。
- `usePolygonBoundaryTrace` 只拥有预览；确认经现有 annotations GET 核验来源。来源变化后预览失效，网络失败保留可重试预览。取消、任务/工具切换、只读变化、草稿改变和卸载均阻止迟到追加。原 `useWorkbenchAnnotationActions` 一次更新点集，`useWorkbenchHotkeys` 先处理预览的 Enter/Esc/Backspace；不复制草稿状态树。
- 文档同步：`docs-site/user-guide/workbench/polygon.md`、`docs-site/dev/concepts/workbench-shell.md`、CHANGELOG Unreleased 与 Epic 索引；补记 H2 实际提交号。

### 浏览器实测

2026-09-08 11:52 起，真实 Chromium `147.0.7727.15` 无头自动化，Web `http://127.0.0.1:3010`、API `http://127.0.0.1:8011`，新功能视口 1440×1000、DPR 1；既有基线 1280×800。运行中通过进程工作目录核实 API PID 244540 来自本 worktree 的 `apps/api`，Vite PID 244860 来自本 worktree 的 `apps/web`。源代码为上述基线加本步工作区改动。受控图片是现有 64×48 SVG 夹具，AI 已通过项目配置及后端关联关闭；不属于模型质量或性能验证。

新增 `polygon-boundary-trace.spec.ts` 四项加原 `workbench-image-konva-smoke.spec.ts`，同一轮 **5 passed、0 failed/skipped/flaky**，共 81.1 秒。前台交互使用真实鼠标和键盘，未使用 DOM 事件注入、store 注入或业务 API 拦截。保存项均经 UI 创建、刷新和 API 读回验证；已打开检查预览与保存后截图。

| 验收     | 实际结果与任务证据                                                                                                                                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H3-1     | 凹六边形默认顺时针较短弧；切换逆时针后，已有 1 点草稿追加为 5 点，类别选择保存并刷新逐坐标读回，来源六边形不变。项目 `71153422-6c1b-4a3b-bf23-feb381fe3ace`，任务 `cc2945f1-dc46-4b47-bd13-898f029e322b`；15.1 秒。                                                                                                                                   |
| H3-2     | 起止点偏离顶点 2 px 仍准确吸附，路径跨最后/首个顶点，草稿连接处不重复；3 点撤为 2 点，Esc 只取消随后预览，再补点并保存为预期三角形。来源刷新读回不变。项目 `ac7a24c8-d7ff-4c41-a78c-0b5a1626f6cd`，任务 `c6b7c7c5-88d6-4356-ae4a-46f36e1dfa08`；12.3 秒。                                                                                             |
| H3-3     | 预览后由独立认证 APIRequestContext 测试会话通过正式 PATCH 修改来源，版本递增；前台点击确认拒绝追加。刷新后重新预览，再由该会话正式 DELETE 来源，前台再次拒绝；两次均保留 1 点草稿，前台无标注写请求。第二会话使用 API 操作，并非第二个浏览器窗口。项目 `e7d0f8ab-5933-4797-99f9-e8f6b455297f`，任务 `c287d036-15b9-4d99-98f5-0f0ba9768b14`；14.3 秒。 |
| H3-4     | 分别点击带孔对象的外环/内环、多外环对象的两个部分，均显示不支持原因；简单对象同点起止被拒绝，Enter 不创建几何。三个完整来源刷新读回不变，前台无写请求。项目 `56bc519d-66f1-42fd-bd0a-1c66fb5437ea`，任务 `11814e04-b4d5-48ab-9406-1646402e2167`；10.5 秒。                                                                                            |
| 既有基线 | Konva 图片画框基线通过，9.6 秒；未更新基线截图。                                                                                                                                                                                                                                                                                                      |

四个新场景均无页面异常和非预期 API/控制台错误；记录并单独过滤的只有导航期间指定 GET 与 heartbeat 的 `ERR_ABORTED`，未忽略标注写入错误。

### 检查与清理

- 定向 Vitest 累计 7 个文件、106 项通过：路径几何 4、预览生命周期 11、原 Polygon 运算 12、PolygonTool 7、孔洞渲染 7、AnnotationActions 12、Hotkeys 53。覆盖反向绕序、非等比屏幕投影、去重、来源更新、取消与迟到结果、核验失败重试。初轮测试暴露自交检查返回值使用错误，修正为检查 `.ok` 后相关测试通过，再执行浏览器验收。
- `pnpm --filter @anno/web exec tsc -b --noEmit`、E2E strict TypeScript、Web 全量 lint（含 CSS token）、docs `check:plans` / `check:codegen`、`git diff --check` 通过。
- 浏览器使用经过所有者标记核验的一次性数据库 `annotation_workbench_0dc6_e2e`，测试结束 seed reset，服务退出后核验零连接并删除数据库。原始 trace、截图、JSON、临时端口配置、类型和 Vitest 缓存及专用 Redis 在提交收尾时清理；不修改共享环境和依赖，不停止主工作区服务。
- 下一步 H4a：Polygon Slice 原子事务；本步不涉及 Slice。
