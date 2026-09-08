# H4b · Mask Slice 与可回收数据保护（计划草案）

> Status: Done
>
> 创建日期：2026-09-07；代码核验基线：ff9a7005。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：全部必测场景通过。

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

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均未作为本步验收服务。本步使用当前 worktree 的 3010 Web / 8011 API 与一次性数据环境，运行记录见 Outcome。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号  | 操作与通过条件                                                                     | 当前结果 |
| ----- | ---------------------------------------------------------------------------------- | -------- |
| H4b-1 | 非正方形、含孔和多组件 Mask 直线切割，保存刷新后两块交集为空、并集逐像素等于来源。 | 通过     |
| H4b-2 | 切线穿像素中心、倒转端点、等面积及零长度场景满足固定分区/身份规则或明确拒绝。      | 通过     |
| H4b-3 | 按钮/Enter 只提交一次；锁、冲突与失败时预览和来源保持；取消零持久写入。            | 通过     |
| H4b-4 | undo 停用新实例后由隔离夹具执行 GC，再从浏览器 redo；两个 ID 与像素完整恢复。      | 通过     |
| H4b-5 | 恢复过期、引用缺失或输出被修改时显示失败，零写入且历史位置不变。                   | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/mask-slice.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

GC 用例还需要本次运行独占的一次性对象桶，通过 `MINIO_BUCKET` 指定；名称以 `-e2e`、`_e2e`、`-test` 或 `_test` 结尾。先核验并创建桶，运行后删除桶内测试对象及空桶；夹具会拒绝默认或非测试桶，不能复用开发数据桶。

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

## Outcome

### 实际交付

- 在现有 Mask 原子提交接口增加 `slice_mask`，仅支持图片已保存、未锁定且没有活动子对象的 Raster Mask。两个有序端点定义无限直线，前后端使用同一双精度像素中心叉积；不使用 epsilon，不擦除切线像素，较大块保留来源 ID，同面积时左侧保留。
- 服务端直接分割 COCO RLE，按列处理前景段并二分定位交点，沿用像素、RLE 段数和计算预算；独立验证客户端两份预览及其更新 / 创建角色。来源身份和业务属性保留，新对象复制业务属性、属性 meta 和原父对象关系，记录人工来源与 split lineage。
- 复用 H4a 的受限恢复与历史命令。操作账本只存 Mask 版本及几何摘要引用；恢复前校验两个结果、版本、内容、任务与对象锁。按 Task → 内容资源 → revision → Annotation 顺序获取锁，版本捕获后非缩短地保护恢复引用，固定截止时间为原切割后 30 天。
- Alembic `0162` 只扩展操作类型 CHECK；空账本可降级 / 升级，已存在 Mask 切割账本时拒绝降级，保留数据和约束。
- 图片 Mask 高级菜单提供直线切割。原生拖动只生成预览，展示两个结果、像素数与来源版本；主按钮和 Enter 复用 D 的原子提交，Esc 取消。草稿归属、只读、比较态、来源变化和切题均沿用当前会话保护，成功回执先写入原任务历史再更新界面。
- 浏览器实测修复了三个实际问题：原生鼠标按下与抬起的亚像素坐标差异使零距离点击误成切线；同步预览先于影响范围引用发布，导致第一屏缺少面积和版本；AI 能力失败恢复条遮住 Mask 高级工具。切割时临时收起对象浮窗，保持工具条可操作，切回选择工具仍可重试 AI 协商。
- 复核恢复画面发现可变对象 URL 被 HTTP 缓存复用：API 已是 1034 px，界面仍显示原 1614 px。内容接口改用 `private, no-cache` 和 ETag；客户端图片及视频帧内容读取主动重新校验已有缓存。相同摘要仍可返回 304，摘要变化返回新 RLE；同一浏览器回归在修复前失败、修复后通过。
- 文档同步：Mask 用户指南、任务与标注 API、Workbench 架构、README、CHANGELOG Unreleased、ADR-0074、OpenAPI 快照与本地生成客户端。没有新增生产依赖、GC 扫描来源或保留配置，也未变更版本与发布安排。

### 自动化与浏览器验收

- 后端 Mask Slice、既有原子操作、Polygon Slice、Mask revision 与 GC 共 134 项通过，其中新增 Mask Slice 28 项包含 360 次像素分区独立核对、身份 / 属性 / 父对象保留、锁与子对象、并发版本、同键异参、缺失 / 过期引用、缺失资源和中途异常回滚。内容读取与 ETag 回归另有 17 项通过。两份迁移实库演练共 2 项通过。
- 前端 Mask 几何、来源守卫、工具与工具栏定向回归共 45 项通过；完整 TypeScript、Web ESLint 与 CSS token 检查通过。OpenAPI 导出、codegen、一致性检查与 SDK 合同 4 项通过。文档生成 / ADR / 计划检查通过；文档路由仍为 390 条，74 份 ADR 连续，无过期计划。
- 按失败项及实际代码影响补测，最终覆盖 31 个不同浏览器场景：新增切割 10 项、既有高级编辑 9 项、原生 Mask 11 项、AI 能力恢复入口 1 项，全部通过。native 配置下的两个 closed-gate 场景按既有矩阵跳过，未声称覆盖关闭写闸的部署。
- 最后一次运行开始于 `2026-09-08T06:12:23.716Z`，105.913s，5/5 通过、0 跳过、0 意外失败、0 flaky；包含 H4b-1、H4b-4、同类非重叠、原生新建 / 保存 / 再编辑及 8K 分块保存。先前通过且不受后续修复影响的场景未重复执行。
- 使用真实无头 Chromium `147.0.7727.15`、DPR 1。功能场景默认 1440×1000；像素中心场景通过原生适应视口操作调整至 1368×1200，媒体区域 896×672，使切线 x 精确为 `31.5/64`。未向应用注入 store 或 DOM `dispatchEvent`。
- Web 为 `http://127.0.0.1:3010`，API 为 `http://127.0.0.1:8011`；代码是 `/home/hehao/.codex/worktrees/0dc6/ai-annotation-platform` 的 `ff9a7005` 加本里程碑修改。运行时以进程 cwd 核验 Web / API 分别来自该 worktree 的 `apps/web` / `apps/api`；共享主工作区服务未作为验收服务。

| 场景                             | 最后通过的测试任务                     | 结果          |
| -------------------------------- | -------------------------------------- | ------------- |
| H4b-1 预览、取消、保存和刷新     | `b7d94abe-5f6b-4dd0-8781-5e0b0d197665` | 通过，25.308s |
| H4b-2 中心、反转、等面积和零长度 | `624fe26d-7c90-48eb-8eb8-c44e8f6ddee3` | 通过，27.028s |
| H4b-3 重复点击与长按 Enter       | `907352f6-5fb9-4963-aa6a-a8961dc21a7c` | 通过，23.909s |
| H4b-3 提交响应丢失后重试         | `19545f2a-e5fb-471c-93dd-412922e47bb5` | 通过，20.391s |
| H4b-3 来源锁和活动子对象         | `70fb0f8a-d5e1-4f9d-bd06-e9c8ab211e92` | 通过，25.981s |
| H4b-3 丢弃预览并切题             | `2c11d0ef-21e2-46ec-96b9-044a4a32a8dd` | 通过，22.099s |
| H4b-4 撤销、实际 GC、重做和刷新  | `9444241e-6ab4-4bbb-ba4b-c5d9088683d6` | 通过，21.406s |
| H4b-5 超过恢复期限               | `4a0d3866-5aa2-44fd-ab89-30f7ad1aee08` | 通过，21.906s |
| H4b-5 恢复引用缺失               | `4313ece2-b5ff-4e8f-9466-69d3e8c2ac79` | 通过，24.686s |
| H4b-5 输出被后续修改             | `ba1c890a-15cc-4705-b2fc-ad2adcd1dff3` | 通过，25.067s |

- H4b-1：64×48、含孔和多个组件的来源共 1614 px，预览取消后零写入、零账本且刷新像素不变；再次提交得到 1034/580 px，两个结果逐像素无交集且并集等于来源，页面列表与 API 的像素数一致。操作 `5ac78c73-9ec7-491c-aa3a-ccd36a1d0f86`，来源 `d89c74f0-d920-48f9-a2f5-ebaa04a0f663`、新对象 `7454de5b-eb4b-4c58-8dfd-56e29074136f`，版本 2/1；业务属性相同，只有一条历史和账本。
- H4b-2：3072 px 的全图 Mask，以 x=`0.4921875` 顺向切割得到 1536/1536，反转端点后中心列仍按左侧规则分配，得到 1584/1488；水平切割为 1536/1536。每次撤销并刷新恢复完整来源，零长度不生成提交。
- H4b-3：明确的延迟夹具仅暂缓真实提交以重复原生输入；同一事务只发送一次。响应丢失夹具先请求真实 API 完成提交，再中断返回；重试复用完全相同 payload 和 key，返回同一操作及 `idempotent_replay=true`，无重复对象或历史。来源加锁后的提交返回 409 并保留预览；活动子对象禁用入口。切题经两段原生确认丢弃预览，保留当前 Mask 工具但清空事务，旧任务锁从数据库确认已释放，两题均无几何写入。
- H4b-4：操作 `c53136ad-0706-45a6-8555-90d00e2bec55` 的来源 `684e69ba-fd4a-488e-8d4b-c7d3f4d0fa2b` 和新对象 `afb34359-e345-44bb-ba6d-fbaeb9324d28`，切割后版本 2/1；undo 后新对象 inactive，实际 GC 扫描 6 个对象，保留 3 个引用资源、删除 3 个孤儿资源，0 错误。浏览器 redo 后同 ID 变为版本 4/3，像素及可见面积仍为 1034/580，截止时间固定为 `2026-10-08T06:13:39.294529Z`。
- GC 仅使用本任务独占且带所有权标记的 `annotations-0dc6-h4b-e2e` 桶和一次性数据库。夹具明确把对象列表时间设为两天前以跨过宽限期，并创建随机孤儿内容，然后调用真实非 dry-run GC；未操作共享桶。缺失 revision 和 31 天过期使用限定 task / operation 的 SQL 夹具，后续编辑使用独立已认证 API 会话。
- H4b-5：分别返回 410 `restore_expired`、409 `snapshot_unavailable` 和 409 `version_mismatch`。失败时结果、像素及历史位置保持，未创建恢复账本。所有功能场景检查最近 API、console、pageerror 和 requestfailed；扣除明确注入的错误及精确匹配的导航中止后，unexpectedErrors 为空。
- 预览、保存及 GC 重做后的截图已逐一查看；本节保留最小可复核记录，原始日志、截图、JSON、临时配置及测试数据按约定清理。测试使用独立 Python 虚拟环境；未变更共享环境配置。
