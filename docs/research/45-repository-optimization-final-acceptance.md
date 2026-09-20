# 仓库优化 P10 验收证据矩阵（草案）

> **文件性质：draft evidence matrix（草稿证据矩阵）。** 本文件是 P10 完整验收的**准备件**，用于把计划 §10 的每条完成标准映射到具体来源与最新实际证据；它**不关闭计划 §10 复选框**，也不声称 P9 或 P10 完成。
> 完成日期：2026-09-20 · 隶属计划：`docs/plans/1789880018_repository-optimization-plan.md`（§3 约束 / §9 记录要求 / §10 完成标准）
> 不可变基线：`9cec9751a9f7a5518cfa09af6d1d75a789f28758`（计划 §2 审阅基线，= PR #129 合并点）
> 当前验收根：`e91ac8dfda5bf46a534413088aac857f29d3b5da`（accepted root：P0–P8 已接受 + P10 验证通道 [40]/[41]/[42] + 点云/lidar 消费者修复 [44]）
> 阶段状态：P0–P8 **完成**；P9 **进行中**（由他处 lane 拥有 `docs/research/43`、`docs-site/dev/testing.md` 与 CI 门禁，本文件不检查其 mutable 文件）；P10 **未开始（pending；本矩阵仅为准备）**
> 证据类型图例：**EXEC** 本仓/工作树实际执行 · **STATIC** 配置/代码结构静态读取 · **REMOTE-CI** 远程 CI 实际运行 · **REUSE** 字节一致复用 · **GAP** 未执行/缺口
> 复用前提（对每一条 REUSE）：`git diff --name-only <证据 SHA> e91ac8dfd -- <相关子树>` 为空 **且** 配置/依赖身份不变（`playwright.config.ts`、覆盖率阈值、`pnpm-lock.yaml`、`apps/api/openapi.snapshot.json`、node/python/uv 版本、迁移 head `0174`）；否则必须复跑。

## 0. 结论（草案）

1. 计划 §10 共 **22 条**标准，在 `e91ac8dfd` 上按现有证据的草稿判定为：**满足 17 条**（有 EXEC/STATIC 证据）、**部分满足 4 条**（CI E2E 的门禁/报告落点依赖 P9，或在真实 CI 运行后才可确认）、**归 P9 1 条**（默认 7/9 策略替换）。
2. 这些判定是**证据映射与状态校准**，不是 P10 收口。剩余事项为：P9 的影子对比与门禁切换（他处进行中，与 P10 的“同候选运行”不是同一件事）、候选远程 CI 未运行（本仓无 push 授权，如实记录，**不是**新增授权要求或阻塞项）、以及 P9 的 `43` 就绪后的最终文档重建。**不存在“必须重复整套验收”的缺口**：只要相关输入与配置/依赖身份字节一致，已接受的 [40]/[41]/[39] 证据按复用规则在 `e91ac8dfd` 继续有效，只有**实际变更或未验证**的行为才需要复跑。
3. **不发明任何运行/性能收益。** before/after 只列已记录的数字（行数、文件/用例计数、阈值与选择条目）；执行耗时、包体、覆盖率百分比 delta、候选 flaky 率与远程 CI 通过率均未测量，明确列为 unknown。
4. 证据分层严格区分：**EXEC**（本地工作树实跑）、**STATIC**（配置/代码/清单静态读取）、**REMOTE-CI**（仅 P0 历史校准 60 次运行属于基线，不是候选证据；候选远程 CI 尚无结果）。

## 1. before/after（不可变 `9cec9751a` → 验收根 `e91ac8dfd`）

> 只列可复核数字。基线侧“未测”表示计划基线阶段没有执行该检查，不填入任何推测值。

| 维度                                   | 基线 `9cec9751a`                                                                                | 当前 `e91ac8dfd`                                                                              | 证据                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 受管源文件分类                         | 5873 个文件全部归类                                                                             | 分类口径沿用；热点模块已收敛（见下行）                                                        | [26§2]                                                      |
| 测试文件清单                           | 1042（P0 机器可读清单）                                                                         | **1134 可执行 + 4 测试支撑 = 1138**；TSV 已同步（双向比对 0 缺口）                            | [26§3/§9/§12] + 本次 `git ls-files` 发现（STATIC）          |
| 前端单测                               | 未在基线执行                                                                                    | **562 文件 / 5626 用例**（P1 曾 5580）                                                        | [41] EXEC                                                   |
| 后端测试                               | 未在基线执行                                                                                    | **4428 tests collected（含 15 skipped ⇒ 4413 passed）/ 0 failures / 0 errors**（`9e34dfafb`） | [40] EXEC；`apps/api` 在 `9e34dfafb..e91` 字节不变（REUSE） |
| `useWorkbenchShellModel.tsx`           | 8919 行                                                                                         | **6646 行**                                                                                   | `git show` EXEC                                             |
| `…helpers.ts`                          | 480 行                                                                                          | **306 行**                                                                                    | `git show` EXEC                                             |
| `apps/api/app/workers/signals.py`      | 225 行                                                                                          | **121 行**                                                                                    | `git show` EXEC                                             |
| `apps/api/tests/conftest.py`           | 311 行                                                                                          | 317 行                                                                                        | `git show` EXEC                                             |
| `ProjectDataManagerPage.flow.test.tsx` | 946 行                                                                                          | **401 行**                                                                                    | `git show` EXEC                                             |
| `apps/web/vite.config.ts`              | 163 行                                                                                          | 141 行                                                                                        | `git show` EXEC                                             |
| 覆盖率阈值                             | 45/45/45/70                                                                                     | **45/45/45/70（未变）**                                                                       | `git show` + [30] STATIC                                    |
| 前端覆盖率实测                         | 未测                                                                                            | **72.28 stmts / 79.33 branch / 66.92 funcs / 72.28 lines**                                    | [41] EXEC                                                   |
| 后端覆盖率实测                         | 未测                                                                                            | line **73.61%** / branch **55.33%**                                                           | [40] EXEC                                                   |
| §7.1 指定文件的版本叙事命中            | **36**（conftest 9、vite.config 14、vitest.setup 3、playwright.config 1、helpers 8、signals 1） | **0**                                                                                         | 本次 `git grep -E 'v[0-9]+\.[0-9]+\|逐字搬运\|旧测套'` EXEC |
| CI E2E PR 默认选择                     | 7（docs-only/未知）或 9（含 visual+stress）                                                     | legacy 门禁不变；shadow 追加 `smoke`/`video-pipeline`/`pointcloud`，全量 12                   | [36] STATIC                                                 |

**明确未测量（不得编造）**：运行时长/性能 before-after、覆盖率百分比 delta、包体 delta、构建时长 delta、候选 flaky 率、候选远程 CI 通过率、P9 影子选择差异。

## 2. 计划 §10 逐条证据矩阵

状态取值：`满足(draft)` 有 EXEC/STATIC 证据且无待办；`部分` 已有实现证据但落点依赖 P9/远程 CI；`P9` 由 P9 lane 负责。

### 2.1 代码结构

| §10 标准                                      | 权威来源（文件/符号）                                                                                                                                                                  | 最新实际证据                                                                                                                                    | 类型   | 状态        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------- |
| 全仓台账覆盖所有受管目录，非热点也有结论      | `docs/research/26` §2（5873 文件分类）；`docs/research/data/26-…inventory.tsv`                                                                                                         | TSV 已按确定性发现回填至 **1138 行 = 1134 可执行 + 4 测试支撑**，双向比对 0 缺口；状态 ci-wired 1123 / script-wired 15 / not-wired 0（[26§12]） | STATIC | 满足(draft) |
| 同一规则唯一权威实现；跨语言靠合同校验        | `apps/api/app/services/project_access.py`（`platform_role_is_manager`/`is_privileged_for_project`）；前端 `hooks/useProjectAccess.ts`；OpenAPI 快照                                    | P4 删除重复矩阵并统一导入（[32]）；`export_openapi.py --check` 通过、SDK 322 passed（[40]）                                                     | EXEC   | 满足(draft) |
| 工作台装配/领域/命令/副作用/视图边界清楚      | `Workbench/state/{taskNavigation,useMaskMutationWorkflows,maskMutationPolicy,useVideoMaskCorrection}.ts`；`shell/SelectionCardContent.tsx`；`docs-site/dev/concepts/repository-map.md` | model 8919→6646、六条规则下沉 + 两组视图迁入 shell（[33]）                                                                                      | EXEC   | 满足(draft) |
| `signals.py` 封闭分派去重复骨架，特殊终态保留 | `apps/api/app/workers/signals.py`（121 行）；`services/async_job_terminal.py`                                                                                                          | 四类领域账本终态进入封闭分派；`partial`/`rollback_failed`/`cancelled` 语义保留；`test_worker_signals.py` 8 例（[32]/[28]）                      | EXEC   | 满足(draft) |
| 无新万能 helper、平行权限、包装层或循环依赖   | `project_access.py` 单一授权源；P5 领域模块归属；`canBatchConvert`/helpers 有据 KEEP                                                                                                   | P5 逐行等价核对与 KEEP 理由（[33]）；无新增循环依赖审计                                                                                         | STATIC | 满足(draft) |
| 旧 shim/别名/导出/fixture 实删；保留有消费者  | `apps/api/tests/conftest.py`（ORM shim、`httpx_client_bound`）；`coalesce_legacy_into_tool_bindings`                                                                                   | shim 删除 + 70 文件归一（[29]）；`coalesce` 因生产路由仍在用而保留在兼容边界（[29]）                                                            | EXEC   | 满足(draft) |

### 2.2 测试

| §10 标准                                      | 权威来源（文件/符号）                                                                                                                             | 最新实际证据                                                                                                         | 类型   | 状态        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ | ----------- |
| 关键约束均有测试；删测试有替代/失效依据       | `docs/research/28`（57 文件/39 具名 ID，C1–C8）；`test_seed_owned.py`、P5 领域回归                                                                | C1–C8 无未映射项；P0 两处 GAP 已补（C6 signals、C8 测试库守卫）（[28]/[29]）                                         | EXEC   | 满足(draft) |
| 前端不靠旧角色数据或大规模无关 hook mock      | P1 修正 27 个前端旧平台角色文件；`ProjectDataManagerPage.flow.test.tsx` 改 MSW 边界                                                               | data-manager 重建为 API 边界 + 纯 URL 下沉（[30]）；最终 5626 用例通过（[41]）                                       | EXEC   | 满足(draft) |
| 后端直接用现行模型，不全局替换 ORM 构造器     | `apps/api/tests/conftest.py`、`factory.py`                                                                                                        | 43 处旧 kwargs 迁 `tool_bindings`、shim 删除（[29]）；后端 4428 collected / 0 failed / 0 errors / 15 skipped（[40]） | EXEC   | 满足(draft) |
| 安全/并发/事务/幂等/离线/渲染保护未因精简丢失 | `test_project_member_concurrency.py`、`test_review_evidence_guard.py`、`test_discussion_notifications_commit.py`、`test_task_lock*`；E2E 渲染家族 | P2/P4 独立事务与锁序测试保留（[29]/[32]）；P7 隔离与分类器（[31]）；渲染资格 [42]                                    | EXEC   | 满足(draft) |
| 覆盖率口径/排除项/阈值可信，无自动降门槛      | `apps/web/vite.config.ts` thresholds；`src/test/**` 排除理由                                                                                      | 阈值 45/45/45/70 未变；删除逐版本流水账并记录排除口径（[30]）；实测 [41]                                             | STATIC | 满足(draft) |

### 2.3 CI E2E

| §10 标准                                            | 权威来源（文件/符号）                                                                         | 最新实际证据                                                                      | 类型        | 状态        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------- | ----------- |
| PR 核心/专项/全量职责明确；7/9 默认策略已按验收替换 | `scripts/plan-e2e-suites.mjs`、`.github/workflows/{ci,e2e-run}.yml`（P9 落点）                | P8 仅交付影子选择（`shadow=`/`required=`/`ml_cpu=`），**legacy 门禁未切**（[36]） | STATIC      | **P9**      |
| fixture 清理不误删；未隔离部分保持安全串行          | seed owned 命名空间 + `apps/api/tests/test_seed_owned.py`；`playwright.config.ts` `workers:1` | 邻居探针（A 清理后 B 字节级不变）+ 失败证据先留（[31]）；9 例 smoke 首过（[38]）  | EXEC        | 满足(draft) |
| 请求取消判定集中且有负向测试；写入失败不被宽泛忽略  | `apps/web/e2e/helpers/request-errors.ts`；`apps/web/scripts/video-request-errors.test.ts`     | 16 例同时覆盖允许/相邻禁止侧与跨流程不渗透（[31]）                                | EXEC        | 满足(draft) |
| 首次失败/flaky/超时/环境/取消/未执行分别统计        | `scripts/summarize-e2e-results.mjs`（新）+ `scripts/fixtures/e2e-summary/*`                   | 4 例单测；分类实现存在，但**无真实 CI 运行**；flaky 非零门禁属 P9（[36]）         | STATIC      | 部分        |
| 同构建条件复用产物；不同 mode 不误用缓存            | `e2e-run.yml` build job 指纹 + `SHA256SUMS`；`plan-e2e-suites` 构建契约                       | 本地 archive 建/验、篡改拒绝、多 archive 拒绝三组探针（[36]）；无真实 CI          | EXEC/STATIC | 部分        |
| 汇总稳定；必需 suite 缺失不能过；纯文档跳过有理由   | `scripts/summarize-e2e-results.mjs` fail-closed；docs-only 白名单                             | audit/planner 18 passed；纯文档白名单双侧回归；非法选择不空跑（[36]）             | EXEC        | 满足(draft) |
| 定时全量与候选发布入口明确，有保守回退方案          | `plan-e2e-suites` scope（extended/full）；影子差异仅告警                                      | schedule=full、dispatch 显式 scope；门禁切换与候选入口属 P9（[36]）               | STATIC      | 部分        |

### 2.4 注释与文档

| §10 标准                                                     | 权威来源（文件/符号）                                                                           | 最新实际证据                                                                                            | 类型   | 状态        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ | ----------- |
| 活动源码/测试/CI 无用版本叙事已清理，未搬回注释              | §7.1 指定文件（conftest、vite.config、vitest.setup、playwright.config、helpers、signals、CI）   | 指定文件命中 36→0；P5/P6 provenance 清理（[34]/[35]）；`CLAUDE.md` 指导收敛                             | EXEC   | 满足(draft) |
| session 绑定/覆盖率/渲染限制/迁移回退/信号兜底说明与实现一致 | `conftest.py`、`vite.config.ts`、`playwright.config.ts`、`validate_migrations.py`、`signals.py` | [29]（事务绑定）、[30]（覆盖率）、[42]（渲染限制）、[39]（迁移回退）、[28]（信号）                      | STATIC | 满足(draft) |
| API/协议版本、迁移元数据、锁文件、许可、真实历史保留         | §7.3；`alembic` `revision/down_revision`；`pnpm-lock.yaml`                                      | P0 分类保留；P2 兼容边界保留；P8 未重写已发布迁移（[26]/[29]/[39]）                                     | STATIC | 满足(draft) |
| 引用/命令/架构文档/共享指引同步，文档构建通过                | `docs-site/dev/concepts/repository-map.md`；`docs/research/README.md`                           | docs 构建在前端通道通过（34.24s，[41]）；P9 修改 `43`/`testing.md`/CI 后再构建一次，本轮不构建（见 §5） | EXEC   | 部分        |

## 3. 证据类别小结（任务要求的分类）

- **代码结构**：唯一授权源 `project_access.py`；`signals.py` 121 行 + `async_job_terminal.py` 封闭分派；工作台 model 8919→6646 与六条规则下沉；旧 shim/别名删除（[29]/[32]/[33]/[34]/[35]）。
- **负向守卫**：P1 三处破坏→失败→恢复变异（signals 终态、viewer×work fail-closed、自审/证据拒绝）[28]；P6 `managed_pool` 并发套件负向变异 [34]；P7 请求分类器允许/禁止双侧 16 例 [31]；P8 audit fail-closed（缺失必需 suite 非零）[36]；迁移策略 fail-closed（多 head/环/未知父版本一律 `UnsupportedChain`）[39]。
- **权限**：`project_access.py` 单源 + `is_privileged_for_project`；C1/C3 跨项目与撤权重检由 `test_project_access.py`、`test_employee_project_roles_acceptance.py`、`test_project_member_concurrency.py` 与 `employee-project-roles.spec.ts` 覆盖 [28]/[31]/[32]。
- **迁移**：真实四阶段 runner（fresh / 可逆段真实 downgrade / 前向数据断言 / 备份恢复）取代 `alembic stamp`；33 例策略测试 [39]；`apps/api` 与 `scripts/{alembic_reversible_floor,validate_migrations,test_alembic_migration_policy}.py` 在证据点后字节不变（REUSE，本次 git diff 为空）。
- **清单（inventory）**：机器可读 TSV 现为 **1138 行 = 1134 可执行 + 4 测试支撑**（P0 1042 → P6 1136 → P8 接线后 1138 收口），确定性 `git ls-files` 发现与 TSV 双向比对 0 缺口；状态 ci-wired 1123 / script-wired 15 / not-wired 0。
- **规则（rules）**：CI 选择单一入口 `scripts/plan-e2e-suites.mjs` + `plan-e2e-suites.test.mjs`；门禁由 `legacyGate` 派生，影子仅告警 [36]；P9 负责切换。
- **文档**：`docs/research/26–42/44` + 本 `45`；架构调用链在 `docs-site/dev/concepts/repository-map.md`；版本叙事清理命中 36→0。

## 4. 证据类型分布（EXEC / STATIC / REMOTE-CI）

- **EXEC（本地实际执行）**：前端覆盖率/构建/size/typecheck/lint/format（[41]）；后端 pytest+coverage、OpenAPI 漂移、SDK 322、示例 5/15、ML CPU 8 套件（[40]）；迁移四阶段 + 策略 33（[39]）；P7 浏览器专项与邻居/重试探针（[31]）；P8 核心 smoke 9/9 首过（[38]）；渲染器点云 21 + WebCodecs 9（[42]）；点云/lidar 消费者修复实跑（[44]）。
- **STATIC（静态读取）**：全仓台账与 TSV（[26]）；阈值与排除口径；planner/审计/报告的脚本层契约（[36]）；本矩阵的行数与差异比对。
- **REMOTE-CI（远程实际运行）**：**候选 SHA 无远程 CI 结果**（无 push；如实记录为未运行，非门禁要求）。P0 校准的 60 次运行（49/6/4/1）是**基线历史**，不是候选证据（[26§5]）。

## 5. 剩余事项（在复用规则下，非“必须重复整套验收”的缺口）

> 本节已按 root 复核修正：**不要求重复已完成且相关输入字节一致的验收**；只有实际变更或未验证的行为才需复跑。候选远程 CI 如实记录为“未运行”，不是新增授权要求或阻塞项。

1. **（已关闭）测试文件清单**：`docs/research/data/26-…inventory.tsv` 已在 `e91ac8dfd` 上按确定性发现回填至 **1138 行 = 1134 可执行 + 4 测试支撑**；`git ls-files` 发现与 TSV 路径双向比对 **0 缺口**；状态 **ci-wired 1123 / script-wired 15 / not-wired 0**（含 P8 新增 `scripts/audit-e2e-requirements.test.mjs`、`scripts/summarize-e2e-results.test.mjs`，以及 89 个 ML/共享 CPU 测试、`scripts/image-reference-utils.test.mjs`、`scripts/test_alembic_migration_policy.py` 的接线）。证据见 [26§12]。
2. **P9（他处进行中，独立工作）**：默认 7/9 策略替换、影子-旧策略在**同一候选**上的对照、非零 flaky 门禁与候选发布入口属 P9；不因 P10 的字节一致复用而省略，也不由本文件收口。
3. **候选远程 CI：未运行（非门禁要求）**：本仓无 push 授权，全部证据为本地执行；`ci.yml` 各 job 对 `e91` 无远程结果。此为“未运行”的事实记录，不构成授权要求或阻塞项。
4. **P10 终验（按复用规则执行）**：已接受的 [40]（后端/SDK/ML）、[41]（前端）、[39]（迁移）在其相关子树与配置/依赖身份相对 `e91ac8dfd` 字节一致时继续有效；终验只需对**实际变更或未验证**的行为复跑并产出 before/after 记录。本矩阵只做映射，未执行复跑。
5. **最终 docs 构建（待 P9 的 `43` 就绪）**：`pnpm docs:build` 已在 `e91` 的前端通道通过（34.24s，[41]）；P9 修改 `43`/`testing.md`/CI 后再构建一次；本轮不构建。
6. **“同 SHA 同跑”不是独立缺口**：P10 三个验证通道虽在不同根上运行，但各自相关子树与配置/依赖身份在 `e91ac8dfd` 字节不变（§4），按复用规则其证据继续有效；只有实际变更或未验证的行为需要复跑。P9 的“同一候选上新旧选择对照”是另一件事（见第 2 条）。

## 6. 限制

- 本文件是**准备件**：所有“终验动作”均为预期，不是完成声明；计划 §10 复选框**未被勾选**，P9/P10 状态**未被标为完成**。
- 只读证据来自 accepted research 与 immutable SHA；未运行任何测试、数据库、迁移、浏览器或网络，未改动源代码/CI/`43`/`testing.md`。
- before/after 只覆盖可复核的静态/计数维度；不包含任何性能或耗时对比。
- 复用判定基于 `git diff` 子树为空 + 身份假设；若配置/依赖身份在终验前变化，复用失效并须复跑。
- 阶段状态与确定性快照见 [26§11/§12] 与 [27]；本文件不复制其历史结论，只做 §10 映射与状态校准。
