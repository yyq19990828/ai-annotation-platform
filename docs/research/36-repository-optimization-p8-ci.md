# 仓库优化 P8：CI 选择影子化、契约套件接线、构建复用与运行诊断

> 完成日期：2026-09-20 · 隶属计划：`docs/plans/1789880018_repository-optimization-plan.md`（P8 工作包 + §6）
> 工作树/分支：`/home/hehao/桌面/ai-annotation-platform-worktree-agent-opt-p7`（分支 `feat/worktree-agent-opt-p8`，rebase 到根 HEAD `826fa042d`）
> 输入：`docs/research/31`（P7 实测收集/跳过数据）、P6 交接（`/tmp/aap-opt-p6-main-report.md`、`docs/research/34`/`35`）、计划 §6 全文
> 证据图例：**[V]** 本工作树实际执行/逐条核对；**[M]** 运行时探针；**[GAP]** 未执行/留待 P9

## 0. 结论

1. **影子选择先行 [V]**：`scripts/plan-e2e-suites.mjs` 在冻结的 legacy 门禁输出（`matrix=`，逐字节不变）之外，新增 `shadow=` JSON 与 `shared_contracts=` 布尔输出。影子选择实现 §6.2/§6.3：有界真实 smoke（登录、工作台进入+保存/刷新、提交→审核、权限拒绝、切换守卫，显式 spec 成员）、按路径触发的领域专项（Mask×3、video-pipeline、pointcloud、shared 契约×2）、显式 full 范围（push/nightly = smoke + 全部分片 + extended）。
2. **fail-closed 分类 [V]**：docs-only 走白名单（可执行示例、`.vitepress/config` 等一律算 app 代码）；空 diff/未知顶层路径 → 保守放大到全量；多域 → 加 extended 并记录原因；未知事件/缺 paths 抛错；app 代码变化而选择为空 → 抛错（非法选择不可能通过）。
3. **门禁不变 [V]**：`planE2ESuites` 由唯一权威 SUITE_CONTRACT 表的 `legacyGate` 标志派生，PR/push/schedule 输出与 P7 之前逐字节一致；shadow 差异（added/removed/原因/警告）由 planning job 记入 step summary，仅告警，不切门禁（P9 执行）。docs-only 白名单收窄为真实文档（根级 README/CHANGELOG 等、docs/**、docs-site/**），显式排除 `docs-site/dev/examples/**`、`docs-site/.vitepress/**`、docs-site 内可执行扩展名与 apps/packages/scripts 下的一切 .md（回归用例覆盖）。保守放大（空 diff/未知路径/多域）会额外选择**全部专项契约**（Mask×3、video-pipeline、pointcloud），因为 default 分片在运行时并不执行这些专用矩阵；共享 UI/API 依赖路径（`apps/web/src/{api,lib,stores,hooks}`、`apps/api/app/{api,services,core}`、deps.py）显式扇出到全部领域专项。
4. **指纹构建复用 [V]**：`e2e-run.yml` 新增 build job，按（commit + e2e mode + pnpm-lock sha + openapi.snapshot sha + node22）指纹命名 artifact；built 矩阵条目下载并 `sha256sum -c` 校验后解包，替代逐 job 重复构建；共享构建失败时 built/非 built 条目都拒绝运行（不测旧产物）。每 job 自带独立 services/数据库，不共享数据。`workflow_dispatch` 新增显式 `e2e_scope` 输入（extended | full），影子报告按输入区分，legacy 门禁不变。
5. **运行诊断 [V]**：`scripts/summarize-e2e-results.mjs`（4 例单测）替代内联 heredoc：新增首过/重试后过/超时/中断/未运行分类、准备与执行秒数、以及「required 套件报成功但无报告 → 步骤失败」的 fail-closed 检查。门禁语义不变。
6. **P6 交接接线 [V]**：采用独立 CPU 审计结论（`/tmp/aap-opt-p8-cpu-audit.md`，逐文件分类）：89 个未接线文件**全部 CPU 兼容**，12 个需要 CPU torch（grounded-sam2 9、sam3 3），无 GPU/真实权重/网络需求。执行委托给专用可复用工作流 `.github/workflows/ml-cpu-test.yml`（独立 CPU 接线工作者产出：`scripts/run-ml-cpu-tests.sh` + 每套件一次性 venv + 最小依赖集；实测 shared-backend-runtime 99、shared-mask-utils 41、shared-protocol-v2 163、yolo 224、rapidocr 83、onnxtools 70+3 预期上游 skip，均 exit 0）。本 planner 保留路径触发与契约登记（8 条目，`wired:false` 表示经 ml-cpu 工作流执行而非本 planner 调度），ci.yml 新增 `ML CPU contract tests` caller（`apps/_shared/**`、`apps/*-backend/**` 路径触发，`suites: "all"`）。根 Node 测试 `scripts/image-reference-utils.test.mjs`（3 passed）接入 ci.yml 的 node --test 列表。
7. **文档 [V]**：`docs-site/dev/testing.md` 更新共享包接线事实；`docs/research/31` 修正 default 表述（271 仅 list-only，补实跑 9 passed+19 skipped）、native 计数（11+9+2）、#2 映射（保留 8 邻域接线断言）、P5 授权说明。

## 1. 触碰范围

- 改：`scripts/plan-e2e-suites.mjs`、`scripts/plan-e2e-suites.test.mjs`、`scripts/summarize-e2e-results.mjs`（新）、`scripts/summarize-e2e-results.test.mjs`（新）、`.github/workflows/ci.yml`、`.github/workflows/e2e-run.yml`、`docs-site/dev/testing.md`、`docs/research/31`（仅本人 P7 行）、本文件。
- 不改：P6 的 docs26/27/TSV/README/历史链接；P5 Workbench 生产源码；产品/API 语义；重试次数/超时/覆盖率门槛（无任何放宽）。

## 2. 影子选择契约（对照 legacy）

| 场景                          | legacy（冻结门禁）         | shadow 提案                                  | 差异记录                               |
| ----------------------------- | -------------------------- | -------------------------------------------- | -------------------------------------- |
| PR · docs-only 白名单         | 7 功能套件 + 按需 extended | 无 app E2E（理由入 summary）                 | removed=全部 legacy                    |
| PR · app 代码（单域）         | 同上                       | smoke + 触发专项（如 Workbench → Mask×3）    | added=[smoke]；removed=[分片+extended] |
| PR · 空白 diff / 未知顶层路径 | 全量                       | smoke + 全部分片 + extended（保守放大）      | added=[smoke,分片,extended]            |
| PR · 多域                     | 同上                       | smoke + 触发专项 + 全部分片 + extended       | 逐条原因入 summary                     |
| push                          | legacy 全量                | smoke + 全部分片 + extended                  | —                                      |
| schedule                      | 仅 extended                | smoke + 全部分片 + extended（§6.2 定时全量） | added=全部非 extended 条目             |
| workflow_dispatch             | 仅 extended                | 仅 extended（显式标注）                      | —                                      |

## 3. 实际执行与结果

| 检查                                                                                  | 结果                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `node --test scripts/plan-e2e-suites.test.mjs scripts/summarize-e2e-results.test.mjs` | 18 passed / 0 failed [V]                                            |
| `uv run --extra test pytest -q`（apps/\_shared/protocol_v2）                          | 163 passed [V]                                                      |
| `uv run --extra test pytest -q`（apps/\_shared/mask_utils）                           | 41 passed [V]                                                       |
| `node scripts/check-workflow-names.mjs --strict`                                      | 全部合规 [V]                                                        |
| planner CLI（对 826fa042d 的实际 diff）                                               | matrix 与 legacy 一致；shadow diff 正确；shared_contracts=false [V] |
| `git diff --check`                                                                    | 干净 [V]                                                            |

## 4. 保留与边界

- `Frontend E2E` 门禁名与 planning/execution 聚合结构不变；影子选择仅在 summary 可见。
- 共享/ML 契约套件的执行委托给 `ML CPU contract tests`（调用 `ml-cpu-test.yml`），不进入 Frontend E2E 门禁（切换属 P9）；`ml_cpu` 路径触发标志由 planner 输出。
- `backend_runtime`（torch 仅 sys.modules stub）与 gs2/sam3 的 CPU-torch 子集按审计事实登记，均可在 CPU 执行；不保留任何「需要 GPU/真实权重」的不实标签。
- 无取消白名单/重试/超时/覆盖率的任何放宽；e2e-run 的失败即失败语义未变。
- [GAP] 影子与 legacy 的实际对比执行（同 SHA 双跑）属 P9；本阶段只有影子输出记录。
- [GAP] `ML CPU contract tests` caller 引用的 `ml-cpu-test.yml` 来自独立 CPU 接线工作者的分支，需其先并入 root（协调方负责集成顺序），本分支 rebase 后生效。
- [GAP] CI 上 ml-cpu 首跑需在集成后观察（本地审计实测：163/41/99/224/83/70+3 全部通过）。
