# 仓库优化改造台账（P0–P10）

> 隶属计划：`docs/plans/1789880018_repository-optimization-plan.md` · 基线与证据：`docs/research/26-repository-optimization-baseline.md`
> 状态日期：2026-09-20。维护约定：每个阶段落地后更新本表，写明实际执行的验收命令与结果；未完成项不得标成完成。

## 1. 阶段台账

| 阶段                  | 范围                                                                                         | 依赖                | 状态                                 | 验收门（详见计划 §8；证据落本表）                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 清单与基线         | 全仓目录分类、测试清单、CI 实证、不变量映射                                                  | 无                  | **完成**（a24fb644e + 复审修正提交） | 每个受管目录有分类结论 [26§2]；CI ≥20 次实际结果且计数可加和 [26§5]；8 条约束全部映射测试 ID，缺口显式列出 [26§4]；机器可读测试文件清单 1042 项 [26§3 + `data/26-…tsv`]；已执行/未执行检查分列 [26§7] |
| P1 固化契约           | 分类并按需修正 `"annotator"` 字符串命中（候选 [26§6-4]）；补 `signals.py` 直接测试；负向验证 | P0                  | 未开始                               | 不变量映射零缺口；命中逐条分类有记录；负向验证记录（破坏→失败→恢复）；不恢复旧平台角色语义                                                                                                            |
| P2 后端 fixture       | 迁移旧 kwargs fixture；删 ORM shim 与 `httpx_client_bound`；收敛 factory                     | P1                  | 未开始                               | `rg` 命中归零；后端套件绿（`aap_wt_*` 自有库）；生产 `coalesce_legacy_into_tool_bindings` 不动                                                                                                        |
| P3 前端测试边界       | vitest.setup/vite.config/test/mocks、data-manager 流程样板                                   | P1                  | 未开始                               | 目标流程保留；纯规则下沉；覆盖率阈值 45/45/45/70 不放宽                                                                                                                                               |
| P4 后端规则归属       | `signals.py` 封闭分派；权限推导审计                                                          | P2                  | 未开始                               | `partial`/`rollback_failed` 语义不变；无第二套权限矩阵；未知角色拒绝保持                                                                                                                              |
| P5 工作台收敛         | 装配 model 瘦身、纯策略先行                                                                  | P3（后端耦合处 P4） | 未开始                               | 切换/取消/拒绝/刷新回归绿；无循环依赖；不是搬进更大 helper                                                                                                                                            |
| P6 残留与注释         | §7 文件清单、版本叙事、候选 #10                                                              | P2–P5 稳定后        | 未开始                               | 候选逐一关闭或记录保留理由；`pnpm docs:build`；`check-doc-version-prefix`                                                                                                                             |
| P7 E2E 下沉与隔离     | 错误分类器统一、fixture 命名空间隔离、超时/断言家族分诊                                      | P1                  | 未开始                               | 列表内测试连续 2 次不靠 retry 通过；允许/禁止两侧负向测试；隔离验收前保持 `workers:1`                                                                                                                 |
| P8 CI 选择与报告      | planner docs-only 白名单、构建复用、报告区分 not-run/flaky                                   | P7                  | 未开始                               | planner 全分支有测试；非法选择不空跑；必需 suite 缺失不能过汇总                                                                                                                                       |
| P9 影子验证与门禁切换 | 新旧选择对照、条件式必需检查                                                                 | P8                  | 未开始                               | 差异可解释；不未经核实要求新建远端保护（`main` 现状无保护 [26§5.4]）                                                                                                                                  |
| P10 完整验收          | before/after 指标、迁移门硬化、台账关闭                                                      | P0–P9               | 未开始                               | 计划 §10 清单全关；stamp 语义硬化；保留项有理由                                                                                                                                                       |

## 2. 当前有效决定

1. CI 证据以校准 P0-B 为权威源（60 次运行、49/6/4/1）；断言差异类失败一律“证据不足/疑似”，修复归属按提交主题仅作线索。
2. `main` 无分支保护/ruleset（三项只读检查一致）；是否新建保护须先核实现行要求，不作为本计划的默认交付。
3. 本工作树运行后端/E2E 测试只允许 `pnpm dev:worktree` 供给的 `aap_wt_*` 自有数据库（经 `TEST_DATABASE_URL` 注入，conftest L117-118 环境变量优先 [26§1.1]）；共享遗留库 `annotation_test`/`annotation_e2e` 禁止。conftest 本身的剩余缺口是 `_default_test_db_url` 异常回退静默吞错（P2 整改），不是“库名固定”。
4. 真实缺陷独立提交“缺陷修复 + 回归测试”，不夹带在重构内；不得放宽断言、覆盖率、重试或预算。
5. 计划文件按原件入轨：入轨时仅 prettier 表格对齐 + 去除尾随空格（仓库 pre-commit `trailing-whitespace` 钩子要求）；去空白规范化后哈希一致 `b9d3b944…`。
6. `"annotator"` 字符串命中（20 个前端测试文件）是**候选**而非既证废弃角色：该字符串仍是合法项目职责名（`apps/web/src/types/index.ts` `ProjectRole`、`constants/roles.ts` `PROJECT_ROLES`）；P1 逐条分类后再决定修数据或保留。
7. 测试文件清单以机器可读 TSV 为准：`docs/research/data/26-repository-test-file-inventory.tsv`（1042 文件；`git ls-files` 确定性发现，列 path/layer/runner/dependency/decision/reason/replacement/status；P0 一律 KEEP + pending-review，接线状态为静态读取而非执行证据）。

## 3. 未决事项

- 无任何门禁/命令接线的测试文件（[26§3 清单 status 列]）：`apps/_shared/backend_runtime/tests` 8 个、`apps/_shared/mask_utils/tests` 5 个、`scripts/image-reference-utils.test.mjs`——是否纳管由 P8 决定。
- `test_v0_7_6.py` 等版本命名文件的内容级审阅（P2/P6）。
- 断言/超时失败家族（filter-operational-lists、employee-project-roles、auth、bbox-center-out、mask-slice、video-tracker-local-review、NotificationPreferencesPanel）首败分诊（P7.1）。
- 首次执行耗时与每测试历史失败类型量化（P8 输入）。

## 4. 未执行检查记录

截至本台账更新：后端 pytest、前端 vitest、Playwright、迁移类检查均未执行（需工作树自有 `aap_wt_*` 数据库或 e2e 隔离服务，本轮授权仅覆盖文档检查）；`plan-e2e-suites.test.mjs` 未复跑（沿用 P0-A 执行记录，协调方确认无需重复）。P1 起各阶段验收须在对应隔离环境实际执行并回填第 1 节。

## 5. P0 交付与检查记录（持久，替代 /tmp 报告）

- **交付提交**：初审 `a24fb644e`（基线 + 台账 + 计划入轨）；复审修正为本节所在提交（更正测试库解析表述、`"annotator"` 候选定性、`apps/web/scripts` 测试接线归属，并新增机器可读测试文件清单）。
- **实际执行的检查与结果**：全仓 `prettier --check .`（初审与复审均通过）；`pnpm docs:build`（初审通过，32.45s；复审未改 `docs-site/`，无导航风险，未重建）；`node scripts/check-doc-version-prefix.mjs --staged`（无发现）；`git diff --check`（干净）；提交时 pre-commit 钩子全部通过（trailing-whitespace / end-of-file / prettier / large-files / merge-conflict）；清单行数校验（TSV 1042 数据行 = 分层计数之和：backend-api 359 + frontend-unit 549 + e2e-browser 67 + screenshots 8 + frontend-tooling 5 + repo-scripts 4 + worktree-runtime 8 + python-sdk 25 + ml-examples 2 + ml-backend-shared 8 + mask-utils-shared 5 + docs-tooling 2；且 TSV 路径集合与独立 `git ls-files` 多模式计数逐行比对一致；发现初版漏掉根 `scripts/*.test.mjs` 4 行，已修正）。
- **复审产生的接线更正**：`apps/web/scripts/` 5 个测试文件中 4 个（check-bundle-size、video-bench、video-request-errors、video-timeline-seek）由 vitest 收集、随 CI Frontend verification 运行（`vite.config.ts` test.exclude 及其注释 [V]）；`media-derivation.test.mjs` 为 npm script `node --test`（script-wired）。真正无接线的只有 `apps/_shared` 两个 tests 目录（13 个）与根 `scripts/image-reference-utils.test.mjs`。
- **证据留存**：工作树运行时与一次性数据库身份、conftest 解析三层行为已固化于 [26§1.1]，不再依赖 /tmp 交接文件；CI 失败/取消/重试/超时口径在 [26§5]；计划文件等价性证据（规范化哈希 `b9d3b944…`）在 [26§8] 与本表决定 5。
