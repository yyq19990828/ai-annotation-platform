# 仓库优化 P0 基线：全仓目录分类、测试清单与 CI 实证

> 盘点日期：2026-09-20 · 隶属计划：`docs/plans/1789880018_repository-optimization-plan.md`（P0 工作包）
> 基线提交：`9cec9751a9f7a5518cfa09af6d1d75a789f28758`（来自分支 `feat/codebase_opt260920`，该提交在基线时点等于 `origin/main`，即 PR #129 合并点）
> 证据输入：P0-A 初稿 `/tmp/aap-opt-p0-inventory.md`（静态盘点）；P0-B 校准稿 `/tmp/aap-opt-p0-ci.md`（**CI 权威源**）
> 证据图例：**[V]** 本工作树在 HEAD 逐条复核通过；**[A]** 采纳 P0-A 静态读数（未逐条复跑）；**[R]** 采纳 P0-B 远程 CI 证据（`gh` 只读）；**[GAP]** 未执行或需服务/授权
>
> **结论强度声明：本文的目录结论是清单级盘点加热点文件级复核，不是实现级全量审计。**
> `SOUND` 只表示“当前没有发现改动证据、按现状进入后续阶段”，不表示“已逐文件审查通过”。
> 需要实现级判断的条目在对应阶段（P1–P8）的验收门里执行，不在 P0 里冒充完成。

## 0. 结论

1. 全仓 5873 个受管文件已全部归入下方目录分类；不存在“只有热点文件、其余空白”的清单。
2. CI 证据采用校准后的 P0-B：最近 60 次真实 GitHub Actions 运行（2026-09-17 → 09-20），49 成功 / 6 失败 / 4 取消 / 1 跳过，计数可加和；6 次失败均有首次失败分类，断言差异类一律记为“证据不足/疑似”，不当作已确认产品缺陷。
3. 计划第 3 节的 8 条业务约束全部映射到现有测试 ID（第 4 节）；两处缺口是新增保护而非重写：`signals.py` 信号兜底无直接测试（C6）、`conftest` 默认测试库回退吞掉配置错误（C8）。
4. P0 只建立清单与基线；所有删除候选（第 6 节）停留在“盘点级”，未做任何生产代码或测试改动。
5. 本工作树（`worktree-agent-opt-p0`）如需跑后端/E2E 测试，必须使用 `pnpm dev:worktree` 供给的 `aap_wt_*` 工作树自有数据库（经 `TEST_DATABASE_URL` 注入），不得直连共享遗留库 `annotation_test` / `annotation_e2e`；依据与一次性库身份见 §1.1。

## 1. 基线记录

| 项目     | 值                                                                                    | 证据                                           |
| -------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 基线提交 | `9cec9751a9f7a5518cfa09af6d1d75a789f28758`（Merge PR #129）                           | [V] `git rev-parse HEAD`                       |
| 来源分支 | `feat/codebase_opt260920`（= 基线时点 `origin/main`；注意不是从 `main` 本地分支派生） | [V] 协调方校准 + 运行时盘点（要点固化于 §1.1） |

### 1.1 工作树运行时与一次性测试库身份（持久记录）

原运行时盘点证据以 /tmp 交接，要点固化为本节（盘点时点 2026-09-20，只读核实）：

- **检出拓扑**：主检出 `/home/hehao/桌面/ai-annotation-platform`（primary Compose 栈与本机 API/Web 从此处运行）；`feat/codebase_opt260920` 与本工作树为其 Orca 管理的 worktree。本工作树经 `scripts/orca-worktree-setup.sh` 完成初始化：`.env` 与三处 node 依赖目录为共享符号链接；`apps/api/.venv` 与 `apps/web/src/api/generated` 必须保持在本检出内（脚本对符号链接形式报错）。
- **一次性数据库身份**（Postgres `ai-annotation-platform-postgres-1`，盘点时迁移 head `0174`）：`annotation_test`（一次性，raw API pytest 的默认回退名）、`annotation_e2e`（一次性，Playwright 本地默认，runner 启动时迁移）、`annotation_screenshots_test`（一次性，截图专用）、`annotation`（**开发数据，非一次性**）、`annotation_production`（**严禁触碰**）。当时全部这些库的 ownership 标记为空，即**共享遗留库**，不是任何 worktree 的自有资源。
- **worktree 规则**：`pnpm dev:worktree` 为各模式供给带 ownership 标记的 `aap_wt_<id>_<mode>` 自有库/Redis/桶；`worktree_resources.py` 拒绝仅按名字认领数据库。因此 worktree 内的后端/E2E 测试必须经 `dev:worktree` 注入的 `TEST_DATABASE_URL`（test 模式）指向自有库，不得直连上面的共享遗留库；`--skip-migrations` 仅在自有库已处于本检出迁移 head 时合法。
- **测试库连接解析（conftest 实际行为，[V] 读取于 HEAD）**：`test_db_url` fixture 取 `os.environ.get("TEST_DATABASE_URL", TEST_DB_DEFAULT)`（conftest L117-118），即**环境变量优先**——worktree 测试模式正是经它注入自有库；`TEST_DB_DEFAULT` 由 `_default_test_db_url()` 从 `settings.effective_migration_database_url` 派生（沿用 host/port/账号，库名改为 `annotation_test`）；该函数内 `except Exception: return` 会再回退到历史硬编码默认串（同名，含占位凭据）。种子路由的库名守卫是**后缀检查** `_test`/`_e2e`（`apps/api/app/api/v1/_test_seed.py` L48），不是全名固定 `annotation_test`。剩余整改点：异常回退静默吞掉配置错误（计划 §5.3-8）。
  | 本工作分支 | `worktree-agent-opt-p0`（本文件所在隔离工作树） | [V] |
  | 受管文件总数 | 5873 | [V] `git ls-files` 计数 |
  | `git status`（基线时点） | 仅未跟踪计划文件与 Orca 本地状态 | [A] P0-A §1 |
  | `git diff --check` | 干净（基线时点 exit 0） | [A] P0-A §1 |
  | 近期提交 | `aa1c879c`（评审修复）、`27027653`、`fb9e5e97`、`cbd8d620`（CI/测试修复） | [V] `git log` |

## 2. 目录分类（覆盖全部 5873 个受管文件）

图例：**CHANGE** = 后续阶段需改动 · **SOUND** = 清单级未见改动证据，保留现状 · **GEN** = 生成物/快照/媒体，不手改 · **OUT** = 不在重构范围（历史/基础设施/agent 配置）。
文件数为 [V] `git ls-files` 计数；判断为 [A]/[V] 混合，热点文件逐条标注。

### apps/（4494）

| 目录                                                            |       文件数 | 分类                                           | 证据 / 备注                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | -----------: | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/app/`                                                 |          458 | **CHANGE**（热点）+ 其余 SOUND                 | 热点 [V]：`workers/signals.py` 225 行，`_mark_failed`/`_mark_cancelled` 重复生命周期；`api/v1/projects.py`、`project_templates.py` 调用 `coalesce_legacy_into_tool_bindings`（保留在兼容边界）。其余 120 个 service 文件未做实现级审查 [A] |
| `apps/api/tests/`                                               |          363 | **CHANGE**                                     | [V] `conftest.py` 311 行（ORM shim L76/101、`httpx_client_bound` 别名 L203-204、`test_db_url` 解析与 `_default_test_db_url` 异常回退，见 §1.1）；`factory.py` 143 行；69 个测试文件引用旧别名（[V] 70 命中含 conftest 本身）               |
| `apps/api/alembic/`                                             |          175 | **SOUND**                                      | 迁移元数据按计划 §7.3 保留；round-trip 脚本 `scripts/alembic_reversible_floor.py` 在 HEAD 存在 [V]                                                                                                                                         |
| `apps/api/scripts/`                                             |           35 | **SOUND**（P6 复查）                           | [A]                                                                                                                                                                                                                                        |
| `apps/api/openapi.snapshot.json` 等 2 个快照                    |            2 | **GEN**                                        | 只经工作流再生成 [A]                                                                                                                                                                                                                       |
| `apps/web/src/pages/`                                           |         1005 | **CHANGE**（Workbench 状态域）+ 其余以清单为准 | [V] `Workbench/state/useWorkbenchShellModel.tsx` 8919 行、`useWorkbenchShellModel.helpers.ts` 480 行（含版本叙事）、`shell/WorkbenchShell.tsx` 181 行（薄壳）。pages 其余子树为目录级盘点，未逐文件审查                                    |
| `apps/web/src/components/`                                      |          235 | **SOUND**（P6 审计）                           | [A] 目录级                                                                                                                                                                                                                                 |
| `apps/web/src/hooks/`                                           |          111 | **SOUND**                                      | `hooks/useProjectAccess.ts` 为前端授权真值 [A]                                                                                                                                                                                             |
| `apps/web/src/api/`                                             |           71 | **SOUND** + `generated/` 为 **GEN**            | codegen 产物不手改 [A]                                                                                                                                                                                                                     |
| `apps/web/src/utils/`                                           |           38 | **SOUND**（P6 审计）                           | [A]                                                                                                                                                                                                                                        |
| `apps/web/src/lib/`、`stores/`                                  |        9 / 8 | **SOUND**                                      | [A]                                                                                                                                                                                                                                        |
| `apps/web/src/test/`、`mocks/`                                  |        1 / 2 | **CHANGE**（仅测试基建）                       | [A] `src/test/konvaMock.tsx` 保留并注明局限；MSW `onUnhandledRequest: "warn"` [V] `vitest.setup.ts` L10/L80                                                                                                                                |
| `apps/web/src` 其余测试文件                                     |          549 | **CHANGE**（按清单精选）                       | [V] 计数口径：`apps/web/src` 下 `*.test.ts(x)`/`*.spec.ts(x)`；含 20 个出现 `"annotator"` 字符串的测试文件（**候选**：该字符串仍是合法项目职责名，命中不等于废弃平台角色残留，P1 逐条分类；见 §6-4）                                       |
| `apps/web/e2e/tests/`                                           |           67 | **CHANGE**（精选）                             | [V] 67 个 spec；其中 7 个内联 `ERR_ABORTED` 分类（polygon-auto-points、video-issue-context、polygon-boundary-trace、mask-slice、bbox-center-out、polygon-slice、video-issue-frame）；快照 PNG 为 **GEN**                                   |
| `apps/web/e2e/helpers/`、`fixtures/`                            |       4 / 12 | **CHANGE**（错误分类器合并）/ SOUND            | [A] `video-request-errors.ts` 为共享 helper                                                                                                                                                                                                |
| `apps/web/e2e/screenshots/`                                     |          120 | **SOUND**（P8 域）                             | doc-media 机制自带测试 [A]                                                                                                                                                                                                                 |
| `apps/web/scripts/`                                             |           31 | **SOUND**                                      | [V] 计数校正：31（P0-A 写 15 有误）；含 `video-request-errors.test.ts`、`check-bundle-size.{mjs,test.mjs}`、基准脚本                                                                                                                       |
| `apps/web/vitest.setup.ts`                                      |            1 | **CHANGE**                                     | [V] 5s 全局 `asyncUtilTimeout`、MSW `warn`、Konva 替身、版本注释                                                                                                                                                                           |
| `apps/web/vite.config.ts`                                       |            1 | **CHANGE**                                     | [V] 覆盖率阈值 45/45/45/70（L154-157）+ 历史叙事注释                                                                                                                                                                                       |
| `apps/web/playwright.config.ts`                                 |            1 | **CHANGE**（注释）                             | [V] `workers:1`（L85）、`retries: isCI?1:0`（L81）、`maxFailures: isCI?1:0`（L83）、`globalTimeout` CI 15 分钟（L84）                                                                                                                      |
| `apps/grounded-sam2-backend/`                                   |          880 | **SOUND / OUT**                                | ML 后端；`checkpoints/` 为运行时权重占位（**GEN/OUT**）[A]                                                                                                                                                                                 |
| `apps/sam3-backend/`                                            |          558 | **SOUND**                                      | [A]                                                                                                                                                                                                                                        |
| `apps/_shared/`                                                 |          147 | **SOUND**                                      | [V] 计数校正：`apps/_shared` 共 147，其中 `backend_runtime` 20（P0-A 把 147 记到 backend_runtime 名下，已纠正）                                                                                                                            |
| `apps/yolo-backend/`、`rapidocr-backend/`、`onnxtools-backend/` | 32 / 20 / 20 | **SOUND**                                      | [A]                                                                                                                                                                                                                                        |

### packages/、scripts/、.github/、infra/、docs、根目录

| 目录                                                                                                                                                                                                         |                文件数 | 分类                       | 证据 / 备注                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------: | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/python-sdk/`                                                                                                                                                                                       |                    61 | **SOUND**                  | [V] 61 个文件，其中 25 个 `tests/test_*.py`（P0-A 写 28，按 glob `/test[^/]*\.py$` 实为 25）；含 `test_openapi_contract.py`、`test_docs_snippets.py`                                 |
| `scripts/`                                                                                                                                                                                                   |                    40 | **SOUND**；planner 有测试  | [V] planner 声明 4 default + 3 mask + 2 extended（`plan-e2e-suites.mjs` L4-20）；`plan-e2e-suites.test.mjs` 5/5 通过为 P0-A 执行记录 [A]（协调方：无需复跑）；node 测试清单见第 3 节 |
| `.github/workflows/`                                                                                                                                                                                         | 12（`.github` 共 14） | **SOUND**（§7 注释清理域） | [A] `ci.yml` 三段式 E2E（planning/execution/aggregate）；`e2e-run.yml` `fail-fast: false`、`built` 任务各自构建 [R]                                                                  |
| `docs-site/`                                                                                                                                                                                                 |                   492 | **SOUND**（当前文档）      | [A] `.vitepress/` 主题保留；`public/` 媒体为 **GEN**；`dev/adr/` 构建期生成                                                                                                          |
| `docs/plans/`                                                                                                                                                                                                |                   481 | **OUT**                    | 历史计划归档；只做链接维护                                                                                                                                                           |
| `docs/adr/` 77、`docs/changelogs/` 24、`docs/research/` 44、`ROADMAP/` 20                                                                                                                                    |                   165 | **OUT**                    | 真实历史，按 §7.3 保留                                                                                                                                                               |
| `docs/articles/` 20、`docs/assets/` 4、`docs/migration/` 3、`docs/benchmarks/` 1                                                                                                                             |                    28 | **OUT / SOUND**            | [A]                                                                                                                                                                                  |
| `infra/`                                                                                                                                                                                                     |                    19 | **OUT**                    | 部署配置；仅环境文档                                                                                                                                                                 |
| `.agents/` 31、`.claude/` 15、`.codex/` 4、`orca.yaml`、`.mcp.json`、`skills-lock.json`                                                                                                                      |                    53 | **OUT**                    | agent/工具配置；唯一计划内改动是 `CLAUDE.md` 指导语（§7.1，P6 域）                                                                                                                   |
| 根配置与 compose（`pnpm-workspace.yaml`、lockfile、`.env.example`、5 个 `docker-compose*.yml`、`ruff.toml`、`prettier.config.mjs`、`.pre-commit-config.yaml`、`patches/`、`config/`、`.nvmrc`、`.npmrc` 等） |          27（根文件） | **GEN / OUT**              | lockfile/补丁 **GEN**；compose 属 infra **OUT**                                                                                                                                      |
| `README.md`、`DEV.md`、`CHANGELOG.md`、`CLAUDE.md`/`AGENTS.md`、`codecov.yml`、`ROADMAP.md`                                                                                                                  |            （含于上） | **SOUND**（定点编辑）      | P6 域                                                                                                                                                                                |

## 3. 测试清单与运行入口

| 套件                              | 数量                                                                                                                                                          | 运行入口                                                                                                                                        | 数据库/环境要求                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 后端 pytest                       | 359 个测试文件 [A]（`apps/api/tests` 共 363 文件 [V]）                                                                                                        | `pnpm dev:worktree -- exec --mode test -- bash -lc 'cd apps/api && uv run pytest -q'`                                                           | `TEST_DATABASE_URL` 优先（worktree 测试模式注入 `aap_wt_*` 自有库 [V] conftest L117-118）；无该变量时默认回退名 `annotation_test`（§1.1），worktree 内不得直连共享遗留库 |
| 前端 vitest                       | [V] 549（src 下 `*.test/spec.ts(x)`）                                                                                                                         | `pnpm --filter @anno/web test`（coverage 阈值 45/45/45/70 [V]）                                                                                 | 无（MSW）                                                                                                                                                                |
| Playwright E2E                    | 67 个 spec [V]；收集口径 [R]：默认 309 tests/65 files（chromium 271 + pointcloud 38），mask-readonly 13、mask-native 22、mask-ai-native 7、visual 3、stress 6 | `test:e2e`（4 分片）+ 三个 mask 命令 + visual/stress                                                                                            | e2e 模式隔离服务；mask 套件强制隔离 dev-server（`:8010` API / `:3001` web）且 CI 中不构建前端 [R]                                                                        |
| scripts node 测试                 | [V] `scripts/` 4 个（plan-e2e-suites、check-workflow-names、dev-worktree、image-reference-utils）                                                             | CI `node --test` 跑前 3 个（`ci.yml` L244-245 [V]）；`image-reference-utils.test.mjs` 未接入任何门禁/命令（[V] 全仓检索），需手动 `node --test` | 无                                                                                                                                                                       |
| Python SDK                        | 25 个测试文件 [V]                                                                                                                                             | `packages/python-sdk` pytest（CI 另含 `uv build` [R]）                                                                                          | 无                                                                                                                                                                       |
| scripts Python（worktree 运行时） | 9 [A]                                                                                                                                                         | pytest                                                                                                                                          | 隔离                                                                                                                                                                     |

**清单级发现（P0-A 写“4 个”但列 5 个名字的校正）**：真实情况是 `scripts/` 下 4 个 `.test.mjs`，其中 3 个接入 CI，`image-reference-utils.test.mjs` 未接入；`apps/web/scripts/` 下的测试另有归属——`media-derivation.test.mjs` 由 `node --test`（npm script）运行且被 vitest 排除，其余 4 个（check-bundle-size、video-bench、video-request-errors、video-timeline-seek）为 vitest 风格、被 vitest 收集（[V] `vite.config.ts` test.exclude L84 及注释），随 CI Frontend verification 运行。初稿“两个未接入 CI”的说法就此修正。

**机器可读测试文件清单**：`docs/research/data/26-repository-test-file-inventory.tsv`（P6 收口后 1128 个测试文件，列 `path/layer/runner/dependency/decision/reason/replacement/status`；decision 一律 `KEEP`、reason 一律 `pending-review`，P0 不做删除决定；status 为静态接线状态：ci-wired 1024 / script-wired 15 / not-wired 89。补录范围与分层计数见 §9）。由短脚本对 `git ls-files` 做确定性模式发现生成（只读，未执行任何测试）；TSV 路径集合与独立 `git ls-files` 多模式计数逐行比对一致。

**发现口径与限制**：仅文件级发现，不枚举测试函数/参数化用例，不含执行结果、耗时或历史失败类型；只覆盖已知名单（CI workflow 与 package.json 命令引用的模式 + `apps/_shared` 两处 tests 目录），命名不符这些模式的测试文件会漏报；fixtures/conftest/helper 不计入。P0 时点的 not-wired 14 个文件是 `apps/_shared/backend_runtime/tests`（8）、`apps/_shared/mask_utils/tests`（5）与 `scripts/image-reference-utils.test.mjs`（1）；P6 补录后的完整接线状态见 §9。

## 4. 计划第 3 节不变量 → 现有测试映射

层级：**U** 单元/纯函数 · **I** 后端集成 · **B** 浏览器 E2E。
**[V]** = 本工作树在 HEAD 用 `rg` 逐条确认函数/用例存在；**[A]** = 采纳 P0-A 静态读取。

### C1 平台身份不推导项目职责；能力不串用；未知角色拒绝

- [V] `apps/api/tests/test_project_access.py`：`test_access_capability_matrix`（L49）、`test_membership_refresh_beats_stale_identity_map`（L117）、`test_non_member_access_is_hidden`（L160）、`test_viewer_with_work_membership_fails_closed`（L172）、`test_project_export_denied_for_annotator_and_viewer`（L192）（I）
- [V] `test_employee_project_roles_acceptance.py`：`test_employee_annotates_a_reviews_b_and_cannot_access_c`（L16）、`test_top_level_bulk_annotation_requires_annotation_phase_capability`（L183）、`test_review_http_never_bypasses_self_or_unknown_evidence`（L124）（I）
- [A] B：`e2e/tests/employee-project-roles.spec.ts`（跨项目工作模式、反向操作拒绝、viewer 只读入口、无项目空态）；`workbench-secondary-permissions.spec.ts`
- [A] U：`src/hooks/useProjectAccess.test.tsx`（fixture 含 `"annotator"` 字符串——是合法项目职责用法的概率与平台角色残留待 P1 分类，见 §6-4）

### C2 自审禁止；证据冻结；未知证据不可伪造为可审核

- [V] `test_review_evidence_guard.py`：`test_valid_evidence_returns_frozen_set_and_submitter`（L50）、`test_unknown_or_incomplete_evidence_is_409`（L77）、`test_unrelated_actor_is_allowed`（L84）、`test_frozen_contributor_is_denied`（L88）、`test_round_submitter_is_denied`（L95）、`test_effective_annotator_is_denied`（L101）、`test_malformed_actor_id_is_denied`（L109）（I）
- [V] `test_project_member_concurrency.py::test_unknown_review_evidence_blocks_review_receiver`（L742）；[A] `test_batch_review_evidence_guard.py`
- [A] B：`review-approve-loop.spec.ts`、`review-feedback-loop.spec.ts`

### C3 撤权/停用/转移后长任务、导出、WS、离线重放重新校验授权

- [V] `test_project_member_concurrency.py`：`test_post_revocation_access_and_handoff_are_atomic`（L588）、`test_stale_actor_object_cannot_authorize_after_deactivation`（L975）、`test_ownership_change_after_preview_conflicts`（L418）、`test_receiver_role_change_after_preview_conflicts`（L462）、`test_handoff_is_project_scoped_and_preserves_history`（L511）（I，独立连接引擎）
- [V] `test_employee_project_roles_acceptance.py::test_notification_delivery_uses_actual_job_project_after_revocation`（L228）；[A] `test_self_deactivation.py`、`test_users_delete_transfer.py`、`test_project_transfer.py`、`test_task_actor_lifecycle_guard.py`（文件存在 [V]）
- [A] B：`employee-project-roles.spec.ts`（撤权拒绝排队草稿）
- [A] U：`Workbench/state/offlineQueue.test.ts`（事务完成前不 resolve/notify；失败读不覆盖已存操作）、`useWorkbenchOfflineQueue.test.tsx`（文件存在 [V]）

### C4 已确认标注不被切换/旧异步响应/取消/重试覆盖

- [A] U：`Workbench/state/useAnnotationHistory.test.ts`（undo/redo `applyLeaf` 分支、失败 redo 重试保留新 creation key）、`offlineQueue.test.ts`（损坏数据拒绝替换、并发入队保持顺序）
- [A] I：`test_tracker_final_write_guard.py`、`test_task_actor_lifecycle_guard.py`（文件存在 [V]）
- [A] B：`video-issue-context.spec.ts`（切换任务不恢复旧详情）、`guide-autosave.spec.ts`、`workbench-video-candidate-decisions.spec.ts`（文件存在 [V]）

### C5 任务锁、版本冲突、幂等键、锁顺序

- [V] `test_task_lock.py` `TestTaskLockFlow`（L122）：`test_full_state_machine_roundtrip`（L123）、`test_edit_endpoints_locked_in_review`（L200）、`test_withdraw_requires_assignee`（L245）、`test_reject_requires_reason_type_and_persists`（L268）、`test_state_transitions_emit_audit_logs`（L323）；[A] `test_task_lock_dedup.py`、`test_annotation_create_idempotency.py`、`test_batch_predict_idempotency.py`（文件存在 [V]）
- [V] `test_project_member_concurrency.py`：`test_same_version_race_and_busy_membership_rollback`（L246）、`test_lock_bounding_ignores_terminal_history_and_expired_locks`（L911）、`test_materialized_history_is_prelocked_with_nowait`（L1080）、`test_concurrent_duplicate_change_only_one_wins`（L771）（独立连接，非 SAVEPOINT）
- [A] U：`state/canEditMask.test.ts`、`state/maskPrimaryActions.test.ts`；B：`mask-lock-bypass.spec.ts`、`mask-session-guard.spec.ts`（文件存在 [V]）

### C6 通知与事务提交顺序；失败/取消/部分完成不混淆

- [V] `test_discussion_notifications_commit.py`：`test_real_commit_http_reply_routes_publish_after_commit_and_survive_redis_failure`（L321）、`test_real_commit_http_task_comment_mentions_publish_after_commit_and_survive_redis_failure`（L406）、`test_real_commit_http_task_comment_mention_rolls_back_without_publish`（L499）、`test_real_commit_http_reply_route_rolls_back_without_publish`（L572）（真实提交 + Redis 故障注入）
- [A] `test_notifications.py`、`test_discussion_notifications.py`、`test_notification_delivery_scope.py`、`test_task_reopen_notification.py`、`test_video_tracker_partial_review.py`（文件存在 [V]）
- **GAP [V]：`workers/signals.py` 信号兜底（`task_failure`/`task_revoked` → `_mark_failed`/`_mark_cancelled`）在 `apps/api/tests` 中零直接引用**（`rg` 无命中）；仅有间接取消链路测试 `test_mask_qc_m2.py::test_mask_qc_cancel_updates_generic_and_domain_ledgers`（L626）。→ P1 须先补最小直接测试，P4 才能重构。

### C7 图片/视频/点云/Mask 坐标、帧、工具、持久化

- [A] U 几何 30+：`stage/shared/geometry/*.test.ts` 家族、`state/transforms.test.ts`、`state/geometryTranslate.test.ts`、`state/samCandidateGeom.test.ts`、`stage/__tests__/polygonGeom.test.ts`、`shell/selectionCard/geometryMetrics.test.ts`
- [A] I 后端：`test_axis_convention.py`、`test_axis_sniffer.py`、`test_video_frame_service.py`、`test_video_sampling.py`、`test_video_sparse_timetable.py`、`test_video_canonical.py`、`test_pointcloud_box3d_annotation.py`、`test_pointcloud_import.py`、`test_pointcloud_manifest.py`、`test_point_cloud_quality_{api,evaluation,kernel}.py`、`test_raster_mask_write_gate.py`、`test_image_raster_mask_api.py`、`test_video_mask_corrections.py`、`test_mask_formats_m6.py`
- [A] B 真实画布（非 DOM 替身）：`workbench-image-konva-smoke.spec.ts`、`annotation-canvas-pixels.spec.ts`、8 个 `workbench-pointcloud-*.spec.ts`、`video-webcodecs-precise-frame.spec.ts`、`raster-mask-native.spec.ts`、`mask-advanced-operations.spec.ts`、`native-mask-ai.spec.ts`（文件存在 [V]）

### C8 不可逆迁移不承诺有损回滚；测试数据隔离

- [A] I：`test_alembic_drift.py::test_models_match_database`；14+ `test_migration_0NNN_*.py`
- [R] CI：`ci.yml` “alembic round-trip” 用 `scripts/alembic_reversible_floor.py` 找可回退层再 `alembic stamp`——**stamp 跳过不可逆迁移，不等于真实回退**（P0-B §2.2 与计划 §7.2 一致）
- **GAP [V]：`conftest._default_test_db_url()` 用 `except Exception: return` 回退到历史硬编码默认连接串（含占位凭据），静默吞掉配置错误**。解析本身是三层的：`TEST_DATABASE_URL` 环境变量优先（worktree 测试模式由此注入 `aap_wt_*` 自有库），其次按迁移配置派生的默认（库名 `annotation_test`），最后才是该硬编码回退（§1.1）。显式失败/日志化回退是 §5.3-8 的整改项；工作树内运行经 `dev:worktree` 注入即落在第一层，不触碰共享库。

**覆盖结论 [V/A]：8 条约束无未映射项；两处 GAP（C6-signals、C8-fallback）是新增保护，不是重写。**
映射验证方式：C1/C2/C3/C5/C6 的核心后端 ID 共 30 个由本工作树逐条 `rg` 复核存在；其余沿用 P0-A 静态读取并核对文件存在性。全量逐条复验归 P1。

## 5. CI 实际结果（60 次运行，2026-09-17 → 09-20）

**来源：校准后的 P0-B（权威源）。本工作树仅做只读复核，未重拉全部日志。**

### 5.1 复核通过的总体分类 [V：`gh run list --limit 60 --json` 重跑比对]

| 结论      | 数量 | 运行 ID（全部列出）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| success   |   49 | 35489557774, 35489557581, 35489557541, 35487217305, 35487217099, 35463403659, 35462032744, 35462032451, 35460824016, 35459669649, 35455695179, 35384407095, 35307181965, 35307181796, 35307181789, 35304318959, 35304318794, 35303642833, 35303043453, 35303043409, 35299692016, 35297546574, 35297546353, 35297546323, 35263272884, 35242418885, 35242418740, 35240950372, 35240949889, 35240949806, 35240737128, 35240736597, 35240736570, 35238549287, 35238549028, 35238548980, 35237786417, 35237785427, 35237785269, 35237785250, 35235248758, 35235248667, 35235248662, 35213807566, 35213807347, 35213807290, 35212224787, 35212224650, 35212224618 |
| failure   |    6 | 35455695341, 35459670108, 35460824153, 35235249148, 35303336087, 35303043405                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| cancelled |    4 | 35303643226, 35303336274, 35303043613, 35242419120                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| skipped   |    1 | 35455695155（`Automation`，PR opened）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

49+6+4+1 = 60，计数可加和（P0-A 初稿的 11+3+3+3=20 子集口径作废）。

### 5.2 修复链 6 次运行的首次失败分类 [R]

| 运行                     | 提交                   | 结论    | 首次失败分类                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 35455695341              | `840a1415`             | failure | 迁移门缺陷（round-trip `0174 not reversible`，直接日志证据，`scripts/alembic_reversible_floor.py` 当时不存在）+ bundle 预算超限（直接证据）+ 2 个证据不足 E2E 断言（bbox-center-out、mask-slice）+ 1 个测试使用已废弃平台角色（服务端 `400 非法平台角色: annotator`，直接证据）+ 1 个证据不足（video-tracker-local-review，首试与重试均红） |
| 35459670108              | `cbd8d620`             | failure | 疑似测试设计（`ProjectDataManagerPage.flow` 2/19 失败，vitest 1 failed \| 552 passed）+ 疑似 locator 脆弱（employee-project-roles strict mode 3 匹配）                                                                                                                                                                                      |
| 35460824153              | `fb9e5e97`             | failure | 单测级 90s 超时（filter-operational-lists `waitForResponse`/`selectOption`），根因未定                                                                                                                                                                                                                                                      |
| 35235249148              | `d47ad963`             | failure | 疑似产品/测试旧异步态（NotificationPreferencesPanel）+ 疑似路由契约漂移（`/dashboard` vs `/overview`）                                                                                                                                                                                                                                      |
| 35303336087、35303043405 | `3205d6a3`、`6d20084a` | failure | 文档死链（生成的 ADR 镜像链接；HEAD 已不复现，历史性）                                                                                                                                                                                                                                                                                      |

### 5.3 取消 / 跳过 / 重试 / 超时口径 [R]

- 取消 4 次：3 次为 PR `cancel-in-progress` 并发取代（其中 2 次底层还有真实文档死链失败）；`35242419120`（push，35.6 分钟）仅 `default-two` 被取消，来源日志不可见（外部/手动），**取消不是产品信号**。
- 唯一工作流级重试：`35487217305` attempt 1 因 worktree 隔离验收清理报“数据库仍有连接”失败（环境/清理竞争），attempt 2 通过——窗口内唯一“重试掩盖首执行抖动”实例。
- `maxFailures:1` 导致的首失败后未执行用例计为 not-run，不算通过。
- 超时归因：日志只确立单测 90s（filter-operational-lists）与 5s expect（video-tracker-local-review）两级；**不能**从日志证明无 suite 触及 15m/20m/30m 层。
- HEAD 基线 push `35489557774` 全绿：§5.2 的历史失败均已解决；但单次绿色不证明稳定，断言/超时家族仍是 P7 加固候选。

### 5.4 门禁结构事实 [V/R]

- workflow 清单与触发（12 个 workflow 文件 [V]）：`ci.yml`（push main + PR）、`e2e-run.yml`（workflow_call）、`e2e-extended.yml`（schedule/dispatch）、`visual-regression.yml`、`docs-validate.yml`、`docs-deploy.yml`、`docs-media-audit.yml`、`docs-acceptance.yml`（仅手动）、3 个 claude/automation workflow [R]。
- **`main` 无分支保护、无 ruleset [V]：legacy protection 404、`rulesets` 长度 0、`rules/branches/main` 长度 0（本工作树三项只读复核通过）。** 没有“必需检查”可盘点；是否新建远端保护必须先核实现行要求（P9.2 条件式）。
- planner 选择 [V]：PR 恒跑 7 个功能套件（无 docs-only 白名单，与计划 §6.3 目标不符）；`apps/web/` 全前缀匹配即追加 visual+layout-stress（含纯测试路径）；schedule/dispatch 仅 2 个扩展套件。

## 6. 改造候选（P0 盘点级；未做任何改动）

| #   | 候选                                                                                                             | 证据                                                                                                                                                              | 归属阶段                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `httpx_client_bound` 别名（conftest L203-204）                                                                   | [V] 69 个测试文件引用；`apps/api/app` 零命中                                                                                                                      | P2                                                                                                                                                                              |
| 2   | `_install_legacy_class_kwargs_shim`（conftest L76/101）                                                          | [V] 定义+调用点仅此两处                                                                                                                                           | P2                                                                                                                                                                              |
| 3   | `coalesce_legacy_into_tool_bindings`                                                                             | [A] 生产路由活跃调用（projects/project_templates/seed/factory）                                                                                                   | **保留**在兼容边界；仅去测试侧依赖（P2）                                                                                                                                        |
| 4   | 前端测试中 `"annotator"` 字符串命中（20 文件，候选清单）                                                         | [A]（含 `ProjectDataManagerPage.flow.test.tsx`）；`"annotator"` 仍是合法项目职责名（[V] `apps/web/src/types/index.ts` L15、`constants/roles.ts` `PROJECT_ROLES`） | **P1 逐条分类**（平台角色残留 → 修数据；项目职责合法使用 → 保留），P3 结构                                                                                                      |
| 5   | `signals.py` 重复生命周期（`_mark_failed`/`_mark_cancelled`）                                                    | [V] 225 行、结构重复；零直接测试（见 C6 GAP）                                                                                                                     | P4（先 P1 补保护）                                                                                                                                                              |
| 6   | 7 个 spec 内联 `ERR_ABORTED` 分类                                                                                | [V] 文件清单与共享 helper 并存                                                                                                                                    | P7 域（仅记录）                                                                                                                                                                 |
| 7   | 活动文件版本叙事（conftest/vitest.setup/vite.config/playwright.config/helpers.ts/signals.py/ci.yml/e2e-run.yml） | [A] 抽查命中（conftest L67“v0.10.22”、alias L203“v0.6.5” [V]）                                                                                                    | P6 + `CLAUDE.md` 指导修正                                                                                                                                                       |
| 8   | `useWorkbenchShellModel.tsx` 8919 行混合 model                                                                   | [V] 行数；领域模块已存在（`useWorkbenchTaskFlow`、`useMaskEditorSession`）                                                                                        | P5                                                                                                                                                                              |
| 9   | `ProjectDataManagerPage.flow.test.tsx` 946 行高 mock 流程测试                                                    | [A]                                                                                                                                                               | P3（REWRITE/MOVE_DOWN）                                                                                                                                                         |
| 10  | `test_v0_7_6.py`（版本命名测试文件）                                                                             | [V] 文件存在；内容未逐行审                                                                                                                                        | **P6 已关闭**：改名为 `test_project_attribute_schema_and_batch_reset.py`（内容用现行 fixture/模型，头部版本叙事删除；`docs-site/dev/concepts/batch-module.md` 与 TSV 同步更新） |

明确不是候选 [A]：`plan-e2e-suites.*`（有测试且被执行过）、`apps/_shared/backend_runtime`、SDK 测试、几何套件、worktree 脚本、`e2e-run.yml` 结构、快照/媒体（GEN）。

## 7. 已执行与未执行检查

本工作树（`worktree-agent-opt-p0`）实际执行：

- [V] `git rev-parse HEAD` / `git status` / 分支重命名（`worktree-agent-opt-p0`）。
- [V] 全部第 2、3 节文件计数与热点行数（`git ls-files`/`wc -l`/`rg`）。
- [V] 第 4 节 30 个核心测试 ID 逐条 `rg` 复核 + 全部映射文件存在性。
- [V] C6/C8 GAP 复核（`rg` 零命中、conftest 回退代码读取）。
- [V] `gh run list --limit 60` 分类与 ID 比对；`main` 保护/ruleset/适用规则三项只读 API 复核。
- [V] `scripts/alembic_reversible_floor.py` 在 HEAD 存在。
- [V] 计划文件入轨的 prettier 格式化与等价性校验（见第 8 节）。
- [V] 复审修正（本提交）：按 `TEST_DATABASE_URL` 优先序更正测试库解析表述（§1.1、§3、C8）；`"annotator"` 命中改判为待分类候选（§2、§4-C1、§6-4）；`check-bundle-size` 等 `apps/web/scripts` 测试接线归属更正（vitest 收集，§3/§8）。
- [V] 机器可读测试文件清单生成（`docs/research/data/26-repository-test-file-inventory.tsv`，1042 文件；只读 `git ls-files` 模式发现，未执行测试；行数/分层/接线计数经脚本输出、TSV 内容与独立 `git ls-files` 计数三方核对一致）。P6 补录后为 1125 文件，差异与原因见 §9。

明确未执行 **[GAP]**（留待对应阶段，不在 P0 冒充）：

- 后端 pytest、前端 vitest、Playwright 任何执行（需 `aap_wt_*` 自有库/e2e 隔离服务；本次授权为文档检查，不含共享库测试）。
- `node --test scripts/plan-e2e-suites.test.mjs` 复跑（协调方确认 P0-A 的 5/5 通过记录即可）。
- `--log-failed` 全量日志级复跑（采纳 P0-B 校准分类）。
- 未接入任何门禁/命令的测试文件（[V] 见 §3 机器可读清单 status 列）：`apps/_shared/backend_runtime/tests` 8 个、`apps/_shared/mask_utils/tests` 5 个、`scripts/image-reference-utils.test.mjs`——是否纳管留 P8 决定。
- 首次执行耗时 / 每测试历史失败类型的量化采集（P8 输入）。

## 8. 对 P0-A 初稿的校准记录

| 项                             | P0-A 初稿                           | 校准后（本文采用）                                                                                                                                                             |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 来源分支                       | “on `main`”                         | `feat/codebase_opt260920`（= 基线时点 origin/main）[V]                                                                                                                         |
| scripts node 测试              | “4 个”但列 5 个名字                 | `scripts/` 4 个（3 个入 CI，`image-reference-utils` 未接入）；`apps/web/scripts/` 5 个中 4 个被 vitest 收集（ci-wired）、`media-derivation` 走 npm script 的 `node --test` [V] |
| CI 计数                        | 11+3+3+3=20（子集，不可加和到全窗） | 60 次：49/6/4/1 [V 重跑比对]；失败运行补齐首次失败细节 [R]                                                                                                                     |
| `apps/_shared/backend_runtime` | “147 files”                         | `apps/_shared` 147，`backend_runtime` 20 [V]                                                                                                                                   |
| `apps/web/scripts/`            | 15                                  | 31 [V]                                                                                                                                                                         |
| web 测试文件                   | 643                                 | 口径依赖 glob：src 下 549；apps/web 全树 633 [V]（正文按 549 口径）                                                                                                            |
| SOUND 声明强度                 | 部分表述近似“已审”                  | 全文降为“清单级盘点 + 热点文件复核”，见第 0 节声明                                                                                                                             |

计划文件入轨说明：未跟踪的 `docs/plans/1789880018_repository-optimization-plan.md` 按协调方授权在本工作树执行 `prettier --write`（仅表格对齐空格），572 行不变；去空白 + 表格分隔行规范化后与原件哈希一致（`b9d3b944…`），措辞与语义零改动；原件检出未触碰。

## 9. P6 补录：测试清单缺口修复（2026-09-20，本提交）

P6 主工作包对 TSV 做了一次「全量 tracked 测试路径 ↔ 清单」双向比对（模式覆盖
`*.test.ts(x)` / `*.spec.ts(x)` / `*.test.mjs` / `test_*.py`，显式排除
`/vendor/`、`/fixtures/`、`conftest`、`__init__`、`/generated/`、`node_modules`、
`/checkpoints/`），据此补录 83 行，而不是按已知名单追加：

| 缺口                                                                                                                   | 行数 | 说明                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 五个 ML backend 的 `tests/test_*.py`                                                                                   |   70 | P0 发现已知名单未含 backend 本地 tests；P6 ML 阶段合并 2 个逐字节相同的 `managed_pool` 套件后，当前 tracked 为 70（grounded-sam2 19 / sam3 20 / yolo 16 / rapidocr 7 / onnxtools 8） |
| `apps/_shared/backend_runtime/tests/test_managed_pool_concurrency.py`                                                  |    1 | 由上述 2 个套件下沉而来，`replacement` 列记录 old → new 映射                                                                                                                         |
| `apps/_shared/protocol_v2/tests/test_*.py`                                                                             |    4 | `test_lifecycle` / `test_mask_codec` / `test_schemas` / `test_vocab`，P0 时点即未收录                                                                                                |
| `apps/api/tests/test_worker_signals.py`、`test_project_access_predicates.py`                                           |    2 | P1 / P4 阶段新增文件未回填清单                                                                                                                                                       |
| `apps/web/src/pages/Projects/ProjectDataManagerPage.schemaError.test.tsx`、`apps/web/src/test/apiRequestGuard.test.ts` |    2 | P3 阶段新增文件未回填清单                                                                                                                                                            |
| `apps/web/e2e/screenshots/*.spec.ts`（4 个）                                                                           |    4 | 截图捕获流水线的 Playwright spec，P0 只收录了 `_helpers/*.test.ts`                                                                                                                   |

补录后合计 **1125** 行，分层计数之和一致：backend-api 361 / docs-tooling 2 /
e2e-browser 67 / frontend-tooling 5 / frontend-unit 551 / mask-utils-shared 5 /
ml-backend 70 / ml-backend-shared 13 / ml-examples 2 / python-sdk 25 /
repo-scripts 4 / screenshots-tooling 12 / worktree-runtime 8。
接线状态：ci-wired 1021 / script-wired 15 / not-wired 89。

### 9.1 P6 收口复核（最终提交 HEAD）

在 P6 最终提交上按同一模式重跑「tracked 测试 ↔ 清单」双向比对，发现 2 个本阶段
自产但未回填的测试文件并已补录：`apps/api/tests/test_seed_demo_memberships.py`
（backend-api）与 `apps/web/src/pages/Review/reviewUrlState.test.ts`
（frontend-unit，纯 URL 规则）。两者均随 CI 的 backend pytest / 前端 vitest 运行，
状态 ci-wired。补录后合计 **1127** 行：backend-api 362 / docs-tooling 2 /
e2e-browser 67 / frontend-tooling 5 / frontend-unit 552 / mask-utils-shared 5 /
ml-backend 70 / ml-backend-shared 13 / ml-examples 2 / python-sdk 25 /
repo-scripts 4 / screenshots-tooling 12 / worktree-runtime 8；
接线状态 ci-wired 1023 / script-wired 15 / not-wired 89，分层与接线计数均可加和。

rebase 到已接受的 P7 root（`b8b45797e`）后再次比对，P7 新建的后端回归
`apps/api/tests/test_seed_owned.py`（owned 种子夹具契约，15 例）同样未回填，已补录为
backend-api / ci-wired。最终合计 **1128** 行：backend-api 363 / docs-tooling 2 /
e2e-browser 67 / frontend-tooling 5 / frontend-unit 552 / mask-utils-shared 5 /
ml-backend 70 / ml-backend-shared 13 / ml-examples 2 / python-sdk 25 /
repo-scripts 4 / screenshots-tooling 12 / worktree-runtime 8；
接线状态 ci-wired 1024 / script-wired 15 / not-wired 89，分层与接线计数均可加和。

**支持文件与可执行脚本口径**：清单沿用 P0 的「fixtures/conftest/helper 不计入」发现规则，
保留了 P0 时点已写入的 4 行测试支撑模块：
`apps/api/tests/{conftest,factory,_avatar_storage,__init__}.py`。它们是 P0 复核时人工登记的
测试基建行；双向比对在发现侧显式排除这 4 类路径，因此它们**不是缺口**，本阶段不改其归类。

与之相对，`scripts/test-orca-worktree-setup.py` **不是**支撑文件：它是可执行断言脚本
（文件头写明 `python3 scripts/test-orca-worktree-setup.py`），
`.github/workflows/ci.yml`「Worktree runtime and setup tests」步骤以
`uv run python ../../scripts/test-orca-worktree-setup.py` 直接运行它，**不经过**
`unittest discover`（该 discover 只匹配 `test_worktree*.py`）。它已在清单中登记为
`worktree-runtime` / `standalone python script` / `ci-wired`，是**真正的可运行测试入口**。
首版收口说明把它误列为「支持/入口脚本」，根因是发现侧模式只写了 `test_*.py`，漏了连字符形式
`test-*.py`；收口复核已把该模式补入发现规则，补入后双向比对仍为 **1127 行、0 缺口**，
多出的这一项不再出现在「清单独有」一侧。

接线状态仍是**静态读取**（workflow 与 `package.json` 检索），不是执行证据；
补录行的 CPU 可运行性证据见 `docs/research/34`（ML/shared）与 35。
`apps/_shared/protocol_v2` 的 CPU 测试结果见 `docs/research/35`。

## 10. P5/P6/P7 收口后的最新快照（2026-09-20，P6 收口；历史快照，最新状态见 §11）

> 本节只追加当前快照，不改写 §0–§9 的 P0 / P6 历史记录；历史计数与 P0 时点事实保持可比。
> 本节是 **P6 收口时点**的历史快照；其“P8 未接受 / P9·P10 未开始”的结论已被 §11（P8 接受与 P10 验证通道之后）取代。

- **接受提交**：P5 `9e34dfafb`（+ [33]，含 `canBatchConvert` / helpers 的有据 KEEP 与 R1/R2 清理）、P6 在 root `11d81d05c`（[34] ML/shared、[35] 剩余稳定域、UsersPage MSW 化 `0e90da462`、§7.2 迁移真实验证 [39]）、P7 `b8b45797e`（+ [31]）。P8 选择器 / 工作流修正**未接受**（[37]/[38] 为阶段产物）；P9/P10 未开始。**（上行是 P6 收口时点事实；后续 P8 修正已于 root `6c47d68de` 接受，含 [36] CI 选择/报告、[37] CPU 接线、[38] 核心 smoke；点云/lidar 消费者回归修复为 `112df2009`（[44]）；当前验收根 `e91ac8dfd`。P9 进行中、P10 pending。见 §11。）**
- **清单快照**：`docs/research/data/26-repository-test-file-inventory.tsv` 现 **1136 行 = 1132 可执行测试 + 4 测试支撑模块**（新增 `test-support` 层）。发现谓词（只读、确定性）：`git ls-files` 全量 ∩ 文件名匹配 `*.test.ts(x)` / `*.spec.ts(x)` / `*.test.mjs` / `test_*.py` / `test-*.py`；显式排除路径片段 `/vendor/`、`/fixtures/`、`/generated/`、`node_modules`、`/checkpoints/`、`/_fixtures/` 与文件名 `conftest.py`、`__init__.py`。双向比对后补录 8 行、0 缺口：
  - `apps/api/tests/test_conftest_db_url.py`（P2 测试库守卫纯规则 13 例，backend-api / ci-wired）
  - 6 个 P5 Workbench 测试：`state/{maskMutationPolicy,taskNavigation,trackerSeedPrompts,useBatchBackendSelection,useMaskMutationWorkflows}.test.ts` 与 `shell/SelectionCardContent.test.tsx`（frontend-unit / ci-wired）
  - `scripts/test_alembic_migration_policy.py`（§7.2 修订图 / 归属策略 33 例，repo-scripts / not-wired，待 P8 接入）
- **分层计数（可加和）**：backend-api 360 / frontend-unit 558 / repo-scripts 5 / test-support 4 / docs-tooling 2 / e2e-browser 67 / frontend-tooling 5 / mask-utils-shared 5 / ml-backend 70 / ml-backend-shared 13 / ml-examples 2 / python-sdk 25 / screenshots-tooling 12 / worktree-runtime 8 = 1136。
- **接线状态（静态读取）**：ci-wired 1031 / script-wired 15 / not-wired 90。**口径**：`not-wired` 的 89 个 ML/shared 测试经独立 CPU 审计证明**全部 CPU 可运行**（12 个需 CPU torch），执行入口为 `.github/workflows/ml-cpu-test.yml` + `scripts/run-ml-cpu-tests.sh`；PR caller 属 P8，未收口前不声称进入 PR 门禁，也不把它们归为“硬件专属”。
- **支撑文件口径**：`apps/api/tests/{conftest,factory,_avatar_storage,__init__}.py` 四个测试基建模块单独标记 `test-support`，与可执行测试分离；发现侧显式排除这四类路径，非缺口。
- **未决（P8/P9/P10）**：选择器 docs-only 白名单、报告区分 not-run/flaky、构建复用与门禁切换；阶段结论见 [37]/[38]。**（更新：[37]/[38] 为 P8 阶段产物，P8 修正与 CPU 接线已于 root `6c47d68de` 接受（[36]）；门禁切换属 P9（进行中），P10 pending。见 §11。）**

## 11. P8 接受与 P10 验证通道之后的最新快照（2026-09-20，P10 准备）

> 本节是 P6 收口快照（§10）之后的当前状态；只追加，不改写 §0–§10 的历史记录。P10 完整验收证据矩阵草稿见 [45](./45-repository-optimization-final-acceptance.md)。

- **接受提交（当前验收根 `e91ac8dfd`）**：P0–P8 全部接受；P8 修正在 root `6c47d68de`（CI 选择/报告 [36]、CPU 接线 [37]、核心 smoke [38]、迁移真实验证 [39]）；P10 验证通道 [40]（后端/SDK/ML 契约，`7efcb27a0`/`f90dea73e`）、[41]（前端 coverage/build/docs，`6fb6b13e6`/`b8897df28`）、[42]（渲染器资格，`5e2ad830e`/`ac2eae8d8`/`e91ac8dfd`）；点云/lidar 消费者回归修复 `d807b3482`/`e41e4973c`/`112df2009`（[44]）。
- **阶段状态**：P0–P8 **完成**；P9 **进行中**（由他处 lane 拥有 `docs/research/43`、`docs-site/dev/testing.md` 与 CI 门禁）；P10 **未开始（pending）**，仅产出草稿证据矩阵 [45]。
- **清单 delta（确定性发现，本文件在 `e91ac8dfd` 复核）**：发现 **1134 可执行测试 + 4 测试支撑 = 1138**；§10/TSV 记录 1136（1132 + 4）。差异为 P8 新增的 `scripts/audit-e2e-requirements.test.mjs`、`scripts/summarize-e2e-results.test.mjs` 两行尚未回填，且 `status` 列为 P6 静态口径。TSV 不在本轮 ownership；回填属 P10 终验（明细见 [45§5]）。
- **结构收敛（`9cec9751a`→`e91ac8dfd`，`git show`）**：`useWorkbenchShellModel.tsx` 8919→6646；`…helpers.ts` 480→306；`signals.py` 225→121；`ProjectDataManagerPage.flow.test.tsx` 946→401；`vite.config.ts` 163→141；`conftest.py` 311→317。
- **覆盖率口径**：阈值 `45/45/45/70` **未变**；前端实测 72.28/79.33/66.92/72.28（[41]），后端 line 73.61 / branch 55.33（[40]）；不存在为绿灯调低阈值。
- **版本叙事**：计划 §7.1 指定文件命中由 36 → 0（本文件在 `e91ac8dfd` 复核 `git grep`）。
- **未决**：P9 影子对比与门禁切换、候选远程 CI、P10 终验复跑与最终 docs 构建；见 [45§5]。
