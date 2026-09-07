# H4a · Polygon Slice 与原子恢复（计划草案）

> Status: Ready
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：未开始；浏览器验收：未执行。

## 1. 交付范围与依赖

交付结果：Polygon Slice 与原子恢复。需最小账本 CHECK 迁移、受限新 API、原子 history 命令和30天恢复期限；取消UI入口不是删除审计数据。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

**几何范围**：图片内已保存、未锁定、无活动子对象的简单单外环 Polygon。切线可以是折线，但不能自交，必须恰有两次有效穿越；相切、沿边重合、多次进出、零面积、孔洞和 multi_polygon 明确拒绝。折线最多 256 个点，作为固定解析边界，不新增环境变量。

**算法与预览**：截取切线在对象内的路径，与原边界的两条弧分别组成结果环。复用已有 polygon 操作做前端有效性检查；服务端根据原几何和切线独立重算、校验两个结果非空、内部不重叠、并集等于原形状，面积误差阈值为 `max(1e-10, source_area * 1e-8)`（归一化坐标）。[polygon-clipping 官方接口](https://github.com/mfogel/polygon-clipping)提供布尔 Polygon/MultiPolygon 运算，未提供开放切线 Slice，因此不能把 difference 的删面积语义直接当作切割。

**受限 API**：新增 `POST /tasks/{task_id}/annotations/polygon-slices:commit`，输入为 `annotation_id`、`expected_version`、`idempotency_key` 和归一化 `cut_path`。服务端决定结果，不能信任客户端提交两块几何。按面积大者保留源 ID；相等时按质心 x/y 排序确定，另一块生成新 ID。源对象身份与属性保持；新对象复制类别、工具单元、业务 attributes、对应 attributes_meta、z_order 和原 parent_annotation_id，保持同一父对象关系，不把被切来源设为新对象的 parent。新对象 source 为 manual、user_id 为操作者、confidence 为空，不复用 external_id 或 parent_prediction_id；来源追溯通过 lineage 保存。

一次数据库事务完成校验、更新/创建、操作账本和 lineage。沿用 Task → Annotation 锁顺序、权限、版本与幂等约定；相同幂等键不同内容冲突。新增应用内 `annotation_slice` 模块，不建通用 mutation 框架，不引入生产几何库或新部署服务。

新增文件集中在 `apps/api/app/schemas/annotation_slice.py`、`apps/api/app/services/annotation_slice.py`、`apps/api/app/api/v1/tasks/annotation_slices.py` 和 `apps/web/src/api/annotationSlices.ts`；原有任务路由注册、账本模型、几何预览及 history 调用方同步接入。前端新增的切线预览会话仍归图片 Stage 所有。

**撤销/重做**：同一切片新增 `POST /tasks/{task_id}/annotations/slices/{operation_id}:restore`，请求带目标 `before/after`、当前完整结果版本集和新的幂等键。服务端从操作账本中的受限前后快照恢复几何与活动状态，保留 ID，版本单调递增；客户端不能传任意回滚几何。仅允许恢复 slice 类操作，继续执行当前权限与任务状态门控。任一结果版本变化或出现活动子对象时整批拒绝，保留历史栈当前位置。提交和恢复响应均带 `restore_expires_at`：固定为原切割提交后 30 天，超期拒绝恢复并说明，重做不延长截止。

完整版本集必须是原 slice 或最后一次成功 restore 返回并由服务端记录的版本集，不能刷新任意最新版本后覆盖人工修改。响应返回两个 ID 的全部版本（含 inactive 对象），供历史命令更新。恢复到当前同一侧返回现有结果，不递增版本或追加历史；同一次 restore 的超时重试复用同一幂等键，新一次 undo/redo 才生成新键。

客户端在 `useAnnotationHistory` 增加受限 slice 命令，一次请求对应一次撤销/重做，不能组合 create/delete 叶命令伪装成原子操作。当前 history 会先移出命令再吞失败，slice 分支必须改为成功后移动栈，失败保留并提示；切题后只结算原任务历史。持久化失败不清空预览，超时重试沿用原提交幂等键；首版不进入不支持复合事务的离线队列。

扩展现有账本 kind CHECK 接受 `slice_polygon`、`restore_slice`，lineage 增加明确恢复关系；需要最小 Alembic 迁移，无新增业务表。新操作写入后不能直接收窄 CHECK 回旧值，回滚时先移除入口、保留兼容 schema 和审计数据。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/stage/shared/geometry/polygonOps.ts](../../apps/web/src/pages/Workbench/stage/shared/geometry/polygonOps.ts)
- [apps/web/src/pages/Workbench/stage/shared/geometry/geometryEditPolicy.ts](../../apps/web/src/pages/Workbench/stage/shared/geometry/geometryEditPolicy.ts)
- [apps/web/src/pages/Workbench/state/useAnnotationHistory.ts](../../apps/web/src/pages/Workbench/state/useAnnotationHistory.ts)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号  | 操作与通过条件                                                                                | 当前结果 |
| ----- | --------------------------------------------------------------------------------------------- | -------- |
| H4a-1 | 简单凹 Polygon 切割预览两块；取消后刷新仍只有来源，确认后两块与预览一致且较大块保留源 ID。    | 未执行   |
| H4a-2 | 一次 undo 恢复原形状，一次 redo 恢复相同两个 ID；刷新核对属性、父对象关系和数量。             | 未执行   |
| H4a-3 | 相切、沿边、多次进出、孔洞/multi、锁定、有活动子对象均拒绝且零写入。                          | 未执行   |
| H4a-4 | 提交已成功但响应丢失后在页面重试，只有一次切割；新一次 undo/redo 用新幂等键，同次重试用原键。 | 未执行   |
| H4a-5 | 第二测试会话修改输出，再回第一会话 undo；显示版本冲突，几何和历史栈不变，过期恢复同样拒绝。   | 未执行   |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/polygon-slice.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

后端现有参照是 `apps/api/tests/test_mask_mutations.py`；H4a 新增 `test_annotation_slices.py`，H4b 同时覆盖新增 Slice 与 Mask revision/GC 场景。迁移演练必须使用一次性数据库。

```bash
pnpm --filter @anno/web test src/pages/Workbench/stage/shared/geometry/polygonOps.test.ts src/pages/Workbench/state/useAnnotationHistory.hook.test.ts
pnpm --filter @anno/web test:e2e e2e/tests/workbench-image-konva-smoke.spec.ts --project=chromium
pnpm --filter @anno/web test:e2e e2e/tests/polygon-slice.spec.ts --project=chromium
pnpm openapi:export
pnpm codegen
pnpm openapi:check
pnpm --filter @anno/web typecheck
pnpm --filter @anno/web lint
git diff --check
```

文档同步：对应用户指南、开发者合同（如改变）和 CHANGELOG Unreleased；具体路径沿用 Epic 对应步骤的文档表。 本步 API/账本合同进入 docs-site/api/、README.md、OpenAPI/SDK 产物及原子恢复 ADR。

## 6. 执行、记录与回滚

- 用户于 2026-09-07 更新执行要求：独立草案形成后按序实施，每个里程碑浏览器实测通过后提交。本草案已包含在该执行授权中。
- 按依赖核对当前代码与已交付合同，实施本文件范围，保持原有状态所有者、任务锁与异步代次保护。
- 运行定向回归、浏览器验收和受影响文档检查，修复发现的问题，再复核最终 diff。
- 浏览器所有必测项通过后才将本里程碑标为完成；失败或未测明确保留为未完成，不以其它检查代替。
- 追加 `## Outcome`，记录实际改动、文档位置、测试结果、浏览器逐项结果与证据、清理情况；只有实际存在才记录提交号。更新 Epic 状态索引。
- 每次测试后清理本次中间产物和测试数据；保留明确交付的最小证据。停止本任务启动的进程，恢复浏览器缩放，清理临时配置，不修改共享 .env/依赖或停止主工作区服务。
- 本里程碑验收并提交后，按依赖继续下一份草案。版本与发布日期仍由维护者决定，本轮不作版本发布。

回滚：先关闭新增入口并保留扩展 CHECK、操作账本与兼容数据；不得删除审计记录或收窄已使用的枚举。
