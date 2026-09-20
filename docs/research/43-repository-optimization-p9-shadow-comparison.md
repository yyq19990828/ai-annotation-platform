# 仓库优化 P9：影子对照与 Frontend E2E 门禁切换

> 完成日期：2026-09-20 · 隶属计划：`docs/plans/1789880018_repository-optimization-plan.md`（P9 工作包 + §6.7）
> 首次对照候选（历史）：`dc972be08a42855c836023da178487469aae2fc9`（rebase 到已接受根 `e91ac8dfd`；app 输入与该根逐字节一致）
> 最终验证候选：`8985054699ac203c1ed2b5ebe68e6d6897bda724`（共享分支 `feat/codebase_opt260920`）
> 最终验证 lane：A `worktree-agent-opt-p9-final-lane-a`（smoke/visual/default-one/default-two）、B（default-three/four）、C（pointcloud/video-pipeline/mask×3/layout-stress）
> 阶段状态：**P9 进行中；`Frontend E2E` 最终门禁保持失败**——最终候选 `default-four` 未关闭（§6.2）
> 证据图例：**[V]** 本工作树实际执行/逐条核对；**[M]** 变异/负向探针；**[EXT]** 外部事实（只读核查）；**[GAP]** 未执行或留待 P10
> 历史边界：旧候选 `dc972be08` 的失败保留在显式的历史小节（§5.0、§6.1、§7），未回溯修改；最终候选结果单独列出，不把历史绿灯搬到新候选。

## 0. 结论

1. **门禁切换实现完成 [V]**：`Frontend E2E` 的矩阵现在执行 §6 计划选择（有界 smoke + 触发专项 + 保守放大 + 显式 full），`push`/夜间/手动 full 走全量，纯文档走带原因的显式跳过；每次运行都同时输出冻结旧选集与计划选集的对照，稳定检查名 `Frontend E2E` 未变。回退为仓库变量 `E2E_SELECTION_MODE=legacy`（空/未设置即计划模式，未知值报错）。
2. **核心 flaky 门禁落地 [V]**：有界 smoke 以 `--retries=0` 运行并带 `flakyPolicy=forbid`，必需套件审计在核心 flaky>0 时以 `core-flaky` 阻塞；非核心专项保留一次诊断重试且重试后通过仍单列 flaky。
3. **必需套件审计按“实际执行的门”生成 [V]**：manifest 与有效选集一致（计划模式=计划套件含策略；回退模式=旧 9 套件；docs-only 仅在计划模式产生带非空原因的显式跳过）。套件 ID 使用 planner 规范名（`smoke`、`visual`、`layout-stress`、`default-one`…`default-four`、`mask-readonly|native|ai-native`、`pointcloud`、`video-pipeline`）；逐套件状态产物按该 ID 采集。
4. **缺陷注入证据 [M]**：移除“未映射回退 + 共享 owner 放大”的变异使共享 Workbench state owner 从全量 12 静默缩到 smoke，且提交的回归测试对变异体失败（`node --test` 非零）；缺失/取消/setup-failure/格式错误/核心 flaky/docs-only 缺原因等审计探针均按预期非零。
5. **首次对照（历史）[V]**：旧候选 `dc972be08` 的 old9/new3 联合执行发现多处真实失败与清理残留，全部保留首次证据（§5.0），后续在集成根与最终候选上分别修复。
6. **最终候选（`8985054`）三 lane、12 个 raw 套件 [V]**：11 绿、1 失败——`default-four`（`workbench-layout.spec.ts:185`，CI `maxFailures` 提前停止，13 passed / 1 failed / 53 not run）。**门禁保持失败，P9 不声明完成**（§5.1、§6.2）。
7. **外部事实 [EXT]**：`main` 当前**没有**经典分支保护也没有 ruleset，因此不存在需要在远端同步的必需检查配置；切换只影响仓库内工作流逻辑，未做任何远端改动（§6.0）。

## 1. 冻结候选与身份

### 1.1 首次对照候选（历史，`dc972be08`）

| 项                   | 值                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 候选 SHA             | `dc972be08a42855c836023da178487469aae2fc9`（`worktree-agent-opt-p9`，基于 `e91ac8dfd`）                                                                                                                    |
| app 输入一致性       | `git diff --quiet e91ac8dfd dc972be08 -- apps/web/src apps/web/e2e apps/web/playwright.config.ts apps/web/package.json apps/api` 无差异 [V]                                                                |
| Node / pnpm          | v22.23.1 / 10.28.1 [V]                                                                                                                                                                                     |
| 构建 mode / 生成输入 | `pnpm build --mode e2e`，`OPENAPI_URL=apps/api/openapi.snapshot.json` [V]                                                                                                                                  |
| 指纹                 | `253b54a03c4f0fc663b26cd9038913bce188e6b7f772de67dad1a5ec616015e1`（sha 前缀去 `-` 后渲染为文件名）                                                                                                        |
| 构建产物             | `/tmp/opencode/web-e2e-dist-253b54a03c4f0fc663b26cd9038913bce188e6b7f772de67dad1a5ec616015e1.tar.gz`，sha256 `754d61b997f69491520245dabe714b5f60102edd4d44bc770d80d54027ab913f`，`SHA256SUMS` 同名目录 [V] |
| 完整性               | `grep -F <指纹 archive> SHA256SUMS \| sha256sum -c -` 通过；diff 断言 manifest 不含其他 archive（P8 已做篡改/多余 archive 拒绝探针）[V]                                                                    |

### 1.2 最终验证候选（`8985054`）

| 项                   | 值                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 候选 SHA             | `8985054699ac203c1ed2b5ebe68e6d6897bda724`（本地共享分支 `feat/codebase_opt260920`；三条 lane 分别建同名分支）                                                                                                                              |
| 构建方式             | 单次 `pnpm build --mode e2e`（`OPENAPI_URL=apps/api/openapi.snapshot.json`），显式 bash 下以 `rc=${PIPESTATUS[0]}` 立即取管道退出码；**BUILD_EXIT=0**，非零则中止（构建日志 `/tmp/opencode/p9-final-build.log`）[V]                         |
| 指纹                 | `b3fe3e8ca069357eff583944dbafedba177a143ce02eb307aef0ffa7e86face3`（按 `e2e-run.yml` 公式：SHA + lockfile + openapi snapshot + node + 排序 `VITE_*` + `.env`）                                                                              |
| 构建产物             | `/tmp/opencode/web-e2e-dist-b3fe3e8c….tar.gz`，sha256 `b5dbe24fc4bd8bf2e616e72ef6a209d8b89846f50c5289dd8119c2eadc7ed7da`；`dist/index.html` sha256 `aa91e1e95f020186c51b96adcdc7957696f6f732eada4b3b0783cedaf27e8515`；270 个 dist 文件 [V] |
| 字节一致性           | B/C 与 A 均解压同一 archive 并校验：archive sha256、`dist/index.html`、270 个逐文件 sha256 与 `diff -rq` 全部一致（未重建）[V]                                                                                                              |
| 证据目录（自有副本） | `/tmp/opencode/p9-final-evidence/`（35 文件 + `EVIDENCE-SHA256SUMS`），含两候选 archive 之外的最终 manifest、12 套件 raw JSON/log/status 与 lane handoff [V]                                                                                |

**构建产物观测方式**：worktree 模式下 `playwright.config.ts` 判定 `useIsolatedServers=true`，即使 `CI=1` 也会启动 `pnpm dev`，因此普通本地 E2E **不消费**指纹构建产物。P9 使用临时配置 `apps/web/playwright.preview.e2e.config.ts`（只覆盖 webServer：同一自有 API 命令 + `vite preview` 指定的 `--mode e2e` dist；projects/testDir/testMatch/grepInvert/retries/reporter 全部沿用真实配置），并派生 `playwright.preview-visual.config.ts` / `playwright.preview-stress.config.ts` 复用同一 webServer。这些临时配置在最终证据采集完成后从最终树移除。

## 2. 旧/新选择对照（同一候选、实际 CLI 输出）

| 场景                                                               | 旧（冻结）       | 新（计划）                                        | 差异解释                                                                    |
| ------------------------------------------------------------------ | ---------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| PR · app 代码（单域，如 mask 几何）                                | 9                | smoke + Mask×3                                    | 旧全跑；新只跑核心 + 受影响专项，Mask 配置不在 default 分片运行，故显式保留 |
| PR · 共享 Workbench state/shell owner                              | 9                | 全量 12                                           | 共享 owner 影响所有领域，放大到 smoke + 全部分片 + 全部专项 + extended      |
| PR · docs-site 可执行示例 / 未知路径 / 空 diff / 多域 / 重命名删除 | 9（或 7）        | 全量 12                                           | 保守放大，不静默漏选                                                        |
| PR · 纯文档（白名单 .md）                                          | 7                | `[]` + docs-only 原因                             | 显式允许跳过，汇总校验分类与原因，非任意 skipped                            |
| event `push`                                                       | 9                | 全量 12（smoke + 分片 + 专项 + extended）         | 合并后显式全量                                                              |
| 夜间 `E2E extended`                                                | 2（仅 extended） | 全量 12（`E2E_SCHEDULE_SCOPE=full`）              | §6.2 定时全量；显式 scope                                                   |
| 手动 `ci.yml` / `E2E extended`                                     | 2                | `e2e_scope`/`scope` 输入显式 `extended` 或 `full` | §6.7-5 不再用事件名隐含范围                                                 |

**契约对照**：旧 9 套件与新的同名套件命令/config/env 逐字节一致；新增仅 `smoke`、`video-pipeline`、`pointcloud` 三个命令。业务契约层面：C1–C8 的浏览器保护映射不变（P8 文档 §6 表），新选集在受影响路径上仍选中对应专项；未被选中的路径由保守放大覆盖，不存在静默漏选。

## 3. 门禁切换实现

- **planner**（`scripts/plan-e2e-suites.mjs`）：默认输出计划选集作为 `matrix`；同时输出 `legacy=`（冻结旧集）、`shadow=`（旧/新对照 + 分类/原因/警告）、`required=`（**有效门**的必需 manifest）、`run_suites`、`selection_mode`、`ml_cpu`。规范套件 ID 见 §0.3。
- **必需 manifest**：计划模式 = 计划套件（smoke 带 `flakyPolicy=forbid`）；回退模式 = 旧 9 套件（不含未执行的 smoke/video/pointcloud）；纯文档 = `{classification:"docs-only", reason, suites:[]}`。
- **ci.yml**：`e2e-suites` 仅在 `run_suites=true` 时执行；聚合 `Frontend E2E`（名称不变）下载逐套件状态产物并运行 `audit-e2e-requirements.mjs`；`run_suites=false` 时用空目录审计显式 docs-only 跳过。手动 `e2e_scope` 输入显式选择 full/extended。仓库变量 `E2E_SELECTION_MODE` 提供回退（空值归一为计划模式）。
- **夜间 caller**（`e2e-extended.yml`）：`E2E_SCHEDULE_SCOPE=full` 显式夜间全量，手动 `scope` 输入显式选择；新增聚合审计 job（保持 `Frontend extended ...` 命名约定）对计划 manifest 做同样的 fail-closed 记账。
- **core-flaky 门禁**：`audit-e2e-requirements.mjs` 在 `flakyPolicy=forbid` 且 `stats.flaky>0` 时写入 `core-flaky` 阻塞状态；`summarize-e2e-results.mjs` 保留首次失败（含 flaky 的首次失败尝试）与重试结果分类。

## 4. 缺陷注入与负向验证（实际输出）

| 探针                          | 命令/变异                                                                            | 实际结果                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 选择器变异（M）               | 临时副本删除 `unmappedAppPaths` 回退与共享 owner 放大                                | 真实选择器：共享 Workbench state owner → 全量 12；变异体 → 仅 `smoke`（静默漏选功能分片与 Mask/video/pointcloud）；对变异体运行提交的回归测试 `node --test` 退出码非零 [M] |
| docs 可执行示例               | `docs-site/dev/examples/protocol-demo.py`                                            | 计划 = 全量 12（不被当作纯文档跳过）[V]                                                                                                                                    |
| 未知顶层路径                  | `model-configs/weights.yaml`                                                         | 计划 = 全量 12 [V]                                                                                                                                                         |
| 重命名/删除                   | 删除/新增前端 spec 路径                                                              | 计划 = 全量 12（旧 = 9）[V]                                                                                                                                                |
| 共享 auth 客户端              | `apps/web/src/api/client.ts`                                                         | 计划 = 全量 12 [V]                                                                                                                                                         |
| 缺失/取消/setup 失败 artifact | CLI `audit-e2e-requirements.mjs`                                                     | 退出 1，输出 `missing`/`cancelled`/`setup-failure` 行 [V]                                                                                                                  |
| 格式错误/套件不匹配成功       | CLI                                                                                  | 退出 1（`malformed-success`/`suite-mismatch`/`unknown-outcome`）[V]                                                                                                        |
| 核心 flaky                    | `stats.flaky=1` + `flakyPolicy=forbid`                                               | 退出 1，`core-flaky` 阻塞；同 artifact 无 forbid 时通过 [V]                                                                                                                |
| docs-only 允许跳过            | `{classification:"docs-only", reason,...}` + 空目录                                  | 退出 0；原因空白 → 退出 1；app-code 无产物 → 退出 1 [V]                                                                                                                    |
| 有效门一致                    | CLI 子进程 push/PR-app/docs/手动 full/夜间，`E2E_SELECTION_MODE` 空/空白/legacy/未知 | 执行 ID 集合 == required ID 集合；`core-flaky` 只出现在被选中的 smoke；未知值报错 [V]                                                                                      |
| 构建产物完整性                | 指纹 archive + SHA256SUMS                                                            | `sha256sum -c` 通过；篡改/多余 archive 拒绝（P8 探针，机制未变）[V]                                                                                                        |

## 5. 同候选实际执行结果

### 5.0 历史：旧候选 `dc972be08` 的首次失败（历史证据，未回溯修改）

**已记录但归属他人的失败**：`employee-project-roles.spec.ts` dashboard 项目名（授权 P9 在冻结执行结束后修复该单测）、`markdown-authoring.spec.ts` 目标单元格内图片不可见（Markdown 独立工作流；仅记录图片未出现，不推测单元格缺失）、pointcloud `workbench-pointcloud-tools.spec.ts:379` 与相关清理（清理所有者负责）。以下为 P9 自有失败与验证边界。

同候选联合执行发现两处真实失败，均已保留首次证据、未放宽断言、未跳过保护：

1. **visual**：`apps/web/e2e/tests/workbench-layout.spec.ts:397` 在 `seed.owned()` 之后仍断言旧共享显示 id `T-E2E-000001`；owned 任务的显示 id 为命名空间形态。属 P7 迁移遗留的消费方缺陷，已请求 bounded separate fix（保留 `text-brand` 与文件名断言）。
2. **pointcloud（领域 worker）**：`workbench-pointcloud-tools.spec.ts:379` 双击多边形失败（retries 1 后仍失败，0 skip）；同次运行的 owned-cleanup 返回 500（residual users=3/projects=2）并在 global teardown 留 3 个用户。

旧候选各套件的原始结果（历史，不改写）：

| 套件                 | 结果（历史）                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| smoke（新，核心）    | **9 passed**，首过无 flaky，exit 0                                                                                                                                                            |
| visual（旧）         | **1 failed / 1 passed / 1 skipped，exit 1**：`workbench-layout.spec.ts:397` 硬编码旧显示 id；更早 13:07:30 启动仅因 reporter 切换被取消，记为 cancelled/not-complete                          |
| default-one（旧）    | **79 passed / 2 unexpected / 0 flaky / 0 skip，exit 1**：① dashboard 项目名 ② markdown 单元格图片                                                                                             |
| default-two（旧）    | **52 passed / 3 unexpected / 19 skipped / 0 flaky，exit 1**：① CI 条件 Worker 用例在 preview 装置下不适用（旧运行未设 `CI`）②③ `mask-slice` 生命周期夹具桶守卫过窄                            |
| default-three（旧）  | **53 passed / 4 unexpected / 30 skipped / 0 flaky，exit 1**：video-issue seed 超时 + 清理残留、workbench-discussion `seed.owned()` 失败、`workbench-context-toolbars` 旧前缀断言（已授权 P9） |
| default-four（旧）   | **64 passed / 3 unexpected / 0 skipped / 0 flaky，exit 1**：tool-dock `launchPersistentContext` SIGTRAP、topbar 800px 重叠、pointcloud-tools 379（清理残留）                                  |
| mask-readonly（旧）  | **2 passed + 11 skipped**（native 矩阵运行时跳过），exit 0                                                                                                                                    |
| mask-native（旧）    | **20 passed + 2 skipped**（readonly 矩阵运行时跳过），exit 0                                                                                                                                  |
| mask-ai-native（旧） | **7 passed**，exit 0                                                                                                                                                                          |
| layout-stress（旧）  | **6 passed / 0 failed / 0 skip，exit 0**                                                                                                                                                      |
| pointcloud（新）     | **37 first-attempt passed / 1 failed**（`workbench-pointcloud-tools.spec.ts:379` 双击多边形；含清理残留），exit 1                                                                             |
| video-pipeline（新） | **43 passed / 20 intentional skips**，但 cleanup/teardown 失败导致 **exit 1（不记为绿）**                                                                                                     |

**历史说明**：前三个套件在 JSON reporter 切换前完成（证据来自 line-reporter stdout 与进程退出码及派生状态记录）；旧运行普遍未设 `CI`，因此 `mask-advanced-operations.spec.ts:334` 的源码 Worker 用例表现为失败而非预期的跳过——这与最终候选的 `CI=true` 装置不同。软件渲染/pointcloud 为 SwiftShader；不主张 GPU/硬件资格验证。

### 5.1 最终候选 `8985054` 的 12 个 raw 套件

执行方式：三条 lane 各自新建分支于同一 SHA，各自 fresh disposable `--mode e2e`（migration head `0174`、残余 0），解压同一 archive 并逐字节校验；全部 `CI=true`、显式 `--retries=0`、`workers 1`、`fullyParallel false`，每套件独立 `E2E_STATUS_OUT` 状态产物。built 套件经 preview harness 消费指纹产物，`built:false` 的 Mask 套件走 dev server（与 CI 的 mask 矩阵一致）。**不使用 maxFailures 未执行用例充当通过**。

| 套件（规范 ID） | lane | 入口                                  | expected | unexpected | flaky | skipped    | exit | residual |
| --------------- | ---- | ------------------------------------- | -------- | ---------- | ----- | ---------- | ---- | -------- |
| smoke           | A    | preview e2e，9 例 grep，`--retries=0` | 9        | 0          | 0     | 0          | 0    | 0        |
| visual          | A    | preview-visual `--grep @visual`       | 2        | 0          | 0     | 1          | 0    | 0        |
| default-one     | A    | preview e2e `--shard=1/4`             | 83       | 0          | 0     | 0          | 0    | 0        |
| default-two     | A    | preview e2e `--shard=2/4`             | 53       | 0          | 0     | 20         | 0    | 0        |
| default-three   | B    | preview e2e `--shard=3/4`             | 58       | 0          | 0     | 30         | 0    | 0        |
| default-four    | B    | preview e2e `--shard=4/4`             | 13       | 1          | 0     | 53 not run | 1    | 0        |
| layout-stress   | C    | preview-stress `--grep @stress`       | 6        | 0          | 0     | 0          | 0    | 0        |
| mask-readonly   | C    | `test:e2e:mask-readonly`（dev）       | 2        | 0          | 0     | 11         | 0    | 0        |
| mask-native     | C    | `test:e2e:mask-native`（dev）         | 20       | 0          | 0     | 2          | 0    | 0        |
| mask-ai-native  | C    | `test:e2e:mask-ai-native`（dev）      | 7        | 0          | 0     | 0          | 0    | 0        |
| pointcloud      | C    | preview e2e `--project pointcloud`    | 38       | 0          | 0     | 0          | 0    | 0        |
| video-pipeline  | C    | preview e2e `video-*`                 | 43       | 0          | 0     | 20         | 0    | 0        |

**说明**：

- 合计 **11 绿 / 1 失败**（`default-four`）；全部套件无 `e2e_seed_cleanup_incomplete`、运行后 `@e2e.test` users/projects=0。
- `default-two` 的 20 个跳过 = `mask-advanced-operations.spec.ts:334` 的**有意 CI 跳过**（`CI=true` 且未选 Mask 矩阵，源码 `import "/src/..."` 无法由构建 preview 提供）+ 19 个矩阵门控的 raster-mask 跳过；该 Worker 路径的 native 覆盖由 `mask-native` 套件承担。这与旧候选未设 `CI` 的失败形成明确对照。
- 证据文件：`/tmp/opencode/p9-final-status/<suite>.json`（规范 ID）、`/tmp/opencode/p9-final-<suite>.json`、`/tmp/opencode/p9-final-<suite>.log`；自有副本与校验见 `/tmp/opencode/p9-final-evidence/`（`EVIDENCE-SHA256SUMS`）。
- 未采用“从旧候选字节一致复用”的说法：root 复核认定四个 Mask/stress 套件的相关输入（共享 Topbar 与 owned-seed 清理）已变化，不能主张逐字节复用，故在最终候选上**重跑为 raw 结果**。

## 6. 分支保护核查与失败归属

### 6.0 分支保护（只读，[EXT]）

| 检查                | 命令                                                                       | 结果                             |
| ------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| 经典保护            | `gh api repos/yyq19990828/ai-annotation-platform/branches/main/protection` | 404 `Branch not protected` [EXT] |
| 仓库 ruleset        | `gh api repos/.../rulesets`                                                | `[]` [EXT]                       |
| 分支生效规则        | `gh api repos/.../rules/branches/main`                                     | `[]` [EXT]                       |
| 仓库可见性/默认分支 | `gh api repos/...`                                                         | public / main [EXT]              |

结论：远端当前没有要求 `Frontend E2E` 的必需检查配置，因此切换门禁内部逻辑不存在“远端保护未同步”的外部阻塞；稳定检查名保留，任何后续需要的分支保护配置由协调方在具备本次对照证据后决定。未做任何远端写操作。

### 6.1 历史：旧候选阻塞项的定向修复（均已合并，历史证据）

四处已授权 fixture/消费方修复按原装置做定向复跑（原始失败证据保留在 §5.0）：

| 修复                  | 文件                                                                                                       | 定向结果                                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| visual 队列显示 id    | `apps/web/e2e/tests/workbench-layout.spec.ts`                                                              | 原装置（preview-visual，构建产物）**1 passed**（原 1 failed）                                                                                                                                                                           |
| dashboard 项目名      | `apps/web/e2e/tests/employee-project-roles.spec.ts`                                                        | 目标用例 **passed**（原 1 failed），保留角色卡/负向断言                                                                                                                                                                                 |
| context-toolbars 助手 | `apps/web/e2e/tests/workbench-context-toolbars.spec.ts`                                                    | 目标用例 **1 passed**（原 1 failed）；替换 PNG 现位于同一 owned 前缀，由 owned-cleanup 回收                                                                                                                                             |
| mask-slice 桶守卫     | `apps/web/e2e/fixtures/mask-slice-lifecycle.py` + 新回归 `apps/api/tests/test_mask_slice_fixture_guard.py` | 目标用例 **4 passed**（H4b-4 + H4b-5×3，原 failed）；守卫回归 **14 passed**（正例 + 共享/他方/畸形所有者、缺失/空清单所有者、跨模式清单、错库、错 MINIO 槽位、他 checkout、缺清单、未知模式、无模式旧 CI 规则与 `aap-wt-*` 拒绝等负例） |

复评修正（`0e97634a4`）：context-toolbars 清理改为从任务行派生并校验精确 owned 前缀与 taskId 文件名、恢复替换 PNG 与 ROI crop 的 `list_objects_v2` 缺失后置断言、复用单个 StorageService；守卫显式拒绝缺失/空清单所有者并校验清单模式与 checkout 身份。

原生浏览器缩放助手（历史，已修复）：`workbench-tool-dock.spec.ts:63` 的 `launchPersistentContext` SIGTRAP（~200ms）根因是**完整 Chromium 的 POSIX singleton 套接字路径**：`<TMPDIR>/org.chromium.Chromium.*/SingletonSocket`，77 字节 TMPDIR → 122 字节路径，超过本机 Linux 的 `sockaddr_un.sun_path` 上限（108）；owned 39 字节 `/tmp` TMPDIR → 84 字节路径，同参数通过。已排除单一 Playwright 参数、headless 变体、sandbox/GPU/zygote 与非 ASCII 路径本身；`strace` 显示内核态 `SIGTRAP {si_code=SI_KERNEL}`。修复：为浏览器子进程创建自有短临时目录并在 `close()` 两条路径删除；复跑原单测 **1 passed**，无残留。

### 6.2 未决：最终候选 `default-four` 失败（阻塞最终门禁）

- 失败用例：`apps/web/e2e/tests/workbench-layout.spec.ts:185`“图片布局预设、面板隐藏和浮动保留画布及未发送讨论草稿，刷新恢复已保存树”，断言在 `:289`：`panelCommand(page, "讨论", "停靠到底部")` 后 `expect.poll` 5s 内未观察到 discussion 分组重新停靠到底部。
- 运行事实：shard 4/4、67 tests、CI `maxFailures` 在首个失败后停止 → **13 passed / 1 failed / 53 not run**，`--retries=0`，240.8s；这是**失败**，53 个 not-run 不等同于 skipped 或 passed。
- 只读诊断（B lane）：停靠拖拽后未出现 preferences PATCH，discussion 仍留在 inspector 分组；疑为渲染 overlay 遮挡分组 dropzone，但 DOM 祖先关系不构成事件证据；已授权 B 在自有分支做聚焦的真实拖拽/hit-test 捕获与诊断性 CSS 正/负对照。
- 处置：**门禁保持失败**。仅在 B 的证据证明后，才由既有 owner 做最小 drag-lifecycle 修复；修复需自有新构建 + 聚焦 layout/真实对照/stress + **default-four 全量（含 53 not-run）** 复跑。不得新增 dock 菜单/超时/重试/弱化断言；不得用未执行用例冒充通过。
- **fail-closed 审计实证 [V]**：对冻结 campaign 的 12 个规范状态产物运行真实必需套件审计（`node scripts/audit-e2e-requirements.mjs required-suites.json suite-status`，required manifest 由 `GITHUB_EVENT_NAME=push node scripts/plan-e2e-suites.mjs` 的实际输出生成）实测 **退出 1**，唯一阻塞为 `default-four | failed`（13 expected / 1 unexpected / 53 not run），其余 11 套件 `passed`，无 `missing`/`cancelled`/`setup-failure`/`suite-mismatch`/`unknown-outcome`/`malformed-success`/`core-flaky`；证据 `/tmp/opencode/p9-failed-campaign-audit/`（`required-suites.json`、`planner-push.out`、`suite-status/`、`audit-output.log`、`audit-exit.txt`、`README.md`）。这不是从计数推断门禁失败，而是稳定聚合的实际 fail-closed 结果；修复后的审计将是独立、带自身来源的产物。

## 7. 保留与限制

- workers 1、重试/超时/覆盖率预算未放宽；核心不依赖重试。
- 门禁**未完成**：最终候选 `default-four` 未关闭，P9 保持进行中；最终报告不得把 53 not-run 写成 skip/pass。
- 首次对照候选（`dc972be08`）的失败保留在历史小节，未回溯改写；最终候选结果为独立 raw 证据。
- 不主张“字节一致复用”：相关输入变化的四个套件在最终候选上重跑；未变化行为的证据可在后续修复 follow-up 中以精确“变更触发点 + 验证范围”组合说明，而非整体重放 12 套件。
- [GAP] 远端 CI 未运行（不推送）；首次真实 runner 观察（构建复用、审计、ml-cpu）留待集成后。
- [GAP] 严格 WebGPU/WebCodecs 资格与渲染家族证据由 renderer 专项负责，本阶段不重复。
- [GAP] 发布候选完整验证记录入口在 P10 台账中明确；不声称已存在 release gate。
