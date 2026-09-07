# H4b · Mask Slice 与可回收数据保护（计划草案）

> Status: Ready
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：未开始；浏览器验收：未执行。

## 1. 交付范围与依赖

交付结果：Mask Slice 与可回收数据保护。沿现有 mask-mutations 增加 slice_mask，不冒用 split_components。复用 H4a 的 restore 和 D 的主动作；新增操作类型 CHECK，复用 MaskAnnotationRevision 的30天保护。

硬依赖：[H4a](1788769060_workbench-h4a-polygon-slice-transaction.md)、[D](1788769060_workbench-d-mask-primary-actions.md)

## 2. 设计与实现合同

首版仅图片已保存、未锁定、无活动子对象的 Raster Mask，使用穿过当前 Mask bbox 的直线切割。输入为有序、不同的两个归一化有限端点，零长度拒绝。以像素中心 `((x+0.5)/W,(y+0.5)/H)` 对有向切线求叉积，`>=0` 归左侧，其余归右侧，前后端不使用不同 epsilon。允许来源自身含孔洞或多个连通分量，结果固定为两个非空实例。像素较多的一块保留源 ID，数量相等时左侧保留；新对象属性与 provenance 遵守 H4a 规则。结果逐像素不重叠且并集等于来源，禁止通过擦除切线造成像素损失。

在现有 `mask-mutations:commit` 中新增 `slice_mask`，通过恰含两个点的 `cut_path` 提交切线，并提交预览结果，服务端独立验证分区；其它 operation 不接受该字段。不能冒用要求“完整原连通分量”的 `split_components`。保持 D 的实例预览与影响范围展示，沿用现有尺寸/内存预算和 RLE 运算。

复用 H4a 的受限 restore 合同和历史命令，并为 `slice_mask` 增加相应账本 CHECK。H4a 不等待 Mask 上线；H4b 在该原子恢复合同上扩展，不改变既有 split_components 的含义。

Mask 恢复保存版本引用，不把 RLE 正文复制进操作账本。复用 `MaskAnnotationRevision` 与现有捕获触发器：更新/停用时保存旧几何，现有 GC 已保护未过期 revision。切割/恢复事务保证所需版本可由当前对象或 revision 定位，并把引用 revision 的 `expires_at` 非缩短地保护到原切割的 30 天截止；现有无限保留项不改短。缺少版本、过期或内容校验失败时整体拒绝且零写入。验收包含 undo 后新实例停用、GC 运行、再 redo，避免回滚指向已回收的 mask asset；无需新增 GC 扫描来源或保留配置。

**H4 验收**：预览数量、面积/像素与落库结果一致；取消零写入；成功后一次撤销完全恢复、一次重做恢复切割结果。覆盖权限/锁、过期版本、同键重放、同键异参、任一步异常回滚、提交成功但响应丢失、重试、任务切换、输出被修改后撤销冲突。Polygon 面积守恒、Mask 像素守恒均由服务端测试验证。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/shell/MaskToolbar.tsx](../../apps/web/src/pages/Workbench/shell/MaskToolbar.tsx)
- [apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx](../../apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx)
- [apps/web/src/pages/Workbench/state/useAnnotationHistory.ts](../../apps/web/src/pages/Workbench/state/useAnnotationHistory.ts)
- [apps/web/src/pages/Workbench/stage/shared/geometry/maskInstanceOperations.ts](../../apps/web/src/pages/Workbench/stage/shared/geometry/maskInstanceOperations.ts)
- [apps/web/src/pages/Workbench/stage/shared/geometry/maskMutationDraft.ts](../../apps/web/src/pages/Workbench/stage/shared/geometry/maskMutationDraft.ts)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号  | 操作与通过条件                                                                     | 当前结果 |
| ----- | ---------------------------------------------------------------------------------- | -------- |
| H4b-1 | 非正方形、含孔和多组件 Mask 直线切割，保存刷新后两块交集为空、并集逐像素等于来源。 | 未执行   |
| H4b-2 | 切线穿像素中心、倒转端点、等面积及零长度场景满足固定分区/身份规则或明确拒绝。      | 未执行   |
| H4b-3 | 按钮/Enter 只提交一次；锁、冲突与失败时预览和来源保持；取消零持久写入。            | 未执行   |
| H4b-4 | undo 停用新实例后由隔离夹具执行 GC，再从浏览器 redo；两个 ID 与像素完整恢复。      | 未执行   |
| H4b-5 | 恢复过期、引用缺失或输出被修改时显示失败，零写入且历史位置不变。                   | 未执行   |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/mask-slice.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

后端现有参照是 `apps/api/tests/test_mask_mutations.py`；H4a 新增 `test_annotation_slices.py`，H4b 同时覆盖新增 Slice 与 Mask revision/GC 场景。迁移演练必须使用一次性数据库。

```bash
pnpm --filter @anno/web test src/pages/Workbench/stage/shared/geometry/maskInstanceOperations.test.ts src/pages/Workbench/stage/shared/geometry/maskMutationDraft.test.ts
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/mask-advanced-operations.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/raster-mask-native.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/mask-slice.spec.ts --project=chromium
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
