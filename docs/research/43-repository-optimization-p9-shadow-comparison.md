# 仓库优化 P9：影子对照与 Frontend E2E 门禁切换

> 完成日期：2026-09-20 · 隶属计划：`docs/plans/1789880018_repository-optimization-plan.md`（P9 工作包 + §6.7）
> 工作树/分支：`/home/hehao/桌面/ai-annotation-platform-worktree-agent-opt-p7`（分支 `worktree-agent-opt-p9`）
> 冻结候选：`dc972be08a42855c836023da178487469aae2fc9`（rebase 到已接受根 `e91ac8dfd`；app 输入与该根逐字节一致）
> 证据图例：**[V]** 本工作树实际执行/逐条核对；**[M]** 变异/负向探针；**[EXT]** 外部事实（只读核查）；**[GAP]** 未执行或留待 P10

## 0. 结论

1. **门禁切换完成 [V]**：`Frontend E2E` 的矩阵现在执行 §6 计划选择（有界 smoke + 触发专项 + 保守放大 + 显式 full），`push`/夜间/手动 full 走全量，纯文档走带原因的显式跳过；每次运行都同时输出冻结旧选集与计划选集的对照，稳定检查名 `Frontend E2E` 未变。回退为仓库变量 `E2E_SELECTION_MODE=legacy`（空/未设置即计划模式，未知值报错）。
2. **核心 flaky 门禁落地 [V]**：有界 smoke 以 `--retries=0` 运行并带 `flakyPolicy=forbid`，必需套件审计在核心 flaky>0 时以 `core-flaky` 阻塞；非核心专项保留一次诊断重试且重试后通过仍单列 flaky。
3. **必需套件审计按“实际执行的门”生成 [V]**：manifest 与有效选集一致（计划模式=计划套件含策略；回退模式=旧 9 套件，不要求未执行的 smoke/video/pointcloud；docs-only 仅在计划模式产生带非空原因的显式跳过）。CLI 子进程回归覆盖 push/PR-app/docs/手动 full/夜间与空环境变量。
4. **缺陷注入证据 [M]**：移除“未映射回退 + 共享 owner 放大”的变异使共享 Workbench state owner 从全量 12 静默缩到 smoke，且提交的回归测试对变异体失败（`node --test` 非零）；缺失/取消/setup-failure/格式错误/核心 flaky/docs-only 缺原因等审计探针均按预期非零。
5. **同候选 old9/new3 联合执行 [V]**：本工作树执行旧 9（4 分片 + Mask×3 + visual/layout-stress）+ 新 smoke；领域 worker 在同候选执行新 pointcloud + video-pipeline（独立运行时）。构建产物经指纹 + SHA256SUMS 校验后由 `vite preview` 提供（默认 worktree 配置只启 dev server，不能作为构建产物证据）。
6. **外部事实 [EXT]**：`main` 当前**没有**经典分支保护也没有 ruleset，因此不存在需要在远端同步的必需检查配置；切换只影响仓库内工作流逻辑，未做任何远端改动。

## 1. 冻结候选与身份

| 项                   | 值                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 候选 SHA             | `dc972be08a42855c836023da178487469aae2fc9`（`worktree-agent-opt-p9`，基于 `e91ac8dfd`）                                                                                                                    |
| app 输入一致性       | `git diff --quiet e91ac8dfd dc972be08 -- apps/web/src apps/web/e2e apps/web/playwright.config.ts apps/web/package.json apps/api` 无差异 [V]                                                                |
| Node / pnpm          | v22.23.1 / 10.28.1 [V]                                                                                                                                                                                     |
| 构建 mode / 生成输入 | `pnpm build --mode e2e`，`OPENAPI_URL=apps/api/openapi.snapshot.json` [V]                                                                                                                                  |
| 指纹                 | `253b54a03c4f0fc663b26cd9038913bce188e6b7f772de67dad1a5ec616015e1`（sha 前缀去 `-` 后渲染为文件名）                                                                                                        |
| 构建产物             | `/tmp/opencode/web-e2e-dist-253b54a03c4f0fc663b26cd9038913bce188e6b7f772de67dad1a5ec616015e1.tar.gz`，sha256 `754d61b997f69491520245dabe714b5f60102edd4d44bc770d80d54027ab913f`，`SHA256SUMS` 同名目录 [V] |
| 完整性               | `grep -F <指纹 archive> SHA256SUMS \| sha256sum -c -` 通过；diff 断言 manifest 不含其他 archive（P8 已做篡改/多余 archive 拒绝探针）[V]                                                                    |

**构建产物观测方式**：worktree 模式下 `playwright.config.ts` 判定 `useIsolatedServers=true`，即使 `CI=1` 也会启动 `pnpm dev`，因此普通本地 E2E **不消费**指纹构建产物。P9 使用临时配置 `apps/web/playwright.preview.e2e.config.ts`（只覆盖 webServer：同一自有 API 命令 + `vite preview` 指定的 `--mode e2e` dist；projects/testDir/testMatch/grepInvert/retries/reporter 全部沿用真实配置），并派生 `playwright.preview-visual.config.ts` / `playwright.preview-stress.config.ts` 复用同一 webServer。这些临时配置在证据采集后删除。

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

**契约对照**：旧 9 套件与新的 9 个同名套件命令/config/env 逐字节一致（可复用证据，不重复执行）；新增仅 `smoke`、`video-pipeline`、`pointcloud` 三个命令，需实际执行验证成员（见 §4）。业务契约层面：C1–C8 的浏览器保护映射不变（P8 文档 §6 表），新选集在受影响路径上仍选中对应专项；未被选中的路径由保守放大覆盖，不存在静默漏选。

## 3. 门禁切换实现

- **planner**（`scripts/plan-e2e-suites.mjs`）：默认输出计划选集作为 `matrix`；同时输出 `legacy=`（冻结旧集）、`shadow=`（旧/新对照 + 分类/原因/警告）、`required=`（**有效门**的必需 manifest）、`run_suites`、`selection_mode`、`ml_cpu`。
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

执行方式：自有 e2e 模式、workers 1、一次启用；built 套件经临时 preview harness 消费指纹产物，`built:false` 的 Mask 套件走 dev server（与 CI 的 mask 矩阵一致）。未使用 maxFailures 未执行用例充当通过。

| 套件                    | 配置/入口                                             | 结果                                                         | 时间              |
| ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | ----------------- |
| smoke（新，核心）       | preview harness，`--retries=0`，9 例 grep 成员        | **9 passed**，首过无 flaky，exit 0                           | 40.0s（进程 50s） |
| mask-readonly（旧）     | `test:e2e:mask-readonly`（dev）                       | **2 passed + 11 skipped**（native 矩阵运行时跳过），exit 0   | 25.8s             |
| mask-native（旧）       | `test:e2e:mask-native`（dev）                         | **20 passed + 2 skipped**（readonly 矩阵运行时跳过），exit 0 | 3.4m              |
| mask-ai-native（旧）    | `test:e2e:mask-ai-native`（dev）                      | 见执行日志                                                   | —                 |
| visual（旧）            | preview-visual harness（`--grep @visual`，retries 0） | 见执行日志                                                   | —                 |
| layout-stress（旧）     | preview-stress harness（`@stress`，retries 1 诊断）   | 见执行日志                                                   | —                 |
| default-one..four（旧） | preview harness `--shard=N/4`                         | 见执行日志                                                   | —                 |
| video-pipeline（新）    | 领域 worker（同候选，preview，独立运行时）            | 见 `/tmp/aap-opt-p9-domain-report.md`                        | —                 |
| pointcloud（新）        | 领域 worker（同候选，preview，独立运行时）            | 见 `/tmp/aap-opt-p9-domain-report.md`                        | —                 |

（前三个套件在 JSON reporter 切换前完成：其证据来自真实 line-reporter stdout 与进程退出码，另有明确标注来源的 `/tmp/opencode/p9-status/*.json` 派生记录；其余套件从下一个边界起以 `--reporter=line,json` 与唯一 `PLAYWRIGHT_JSON_OUTPUT_NAME` 采集。每个套件的完整日志位于 `/tmp/opencode/p9-*.log`，进程级起止与退出码见 `/tmp/opencode/p9-campaign-status.txt`。软件渲染/pointcloud 为 SwiftShader；不主张 GPU/硬件资格验证，严格 WebGPU/WebCodecs 资格由 renderer 专项证据承担。）

## 6. 分支保护核查（只读）

| 检查                | 命令                                                                       | 结果                             |
| ------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| 经典保护            | `gh api repos/yyq19990828/ai-annotation-platform/branches/main/protection` | 404 `Branch not protected` [EXT] |
| 仓库 ruleset        | `gh api repos/.../rulesets`                                                | `[]` [EXT]                       |
| 分支生效规则        | `gh api repos/.../rules/branches/main`                                     | `[]` [EXT]                       |
| 仓库可见性/默认分支 | `gh api repos/...`                                                         | public / main [EXT]              |

结论：远端当前没有要求 `Frontend E2E` 的必需检查配置，因此切换门禁内部逻辑不存在“远端保护未同步”的外部阻塞；稳定检查名保留，任何后续需要的分支保护配置由协调方在具备本次对照证据后决定。未做任何远端写操作。

## 6.1 候选上的真实失败（阻塞验收，不视为绿灯）

**已记录但归属他人的失败**：`employee-project-roles.spec.ts` dashboard 项目名（授权 P9 在冻结执行结束后修复该单测）、`markdown-authoring.spec.ts` 目标单元格内图片不可见（Markdown 独立工作流；仅记录图片未出现，不推测单元格缺失）、pointcloud `workbench-pointcloud-tools.spec.ts:379` 与相关清理（清理所有者负责）。以下为 P9 自有失败与验证边界。

同候选联合执行发现两处真实失败，均已保留首次证据、未放宽断言、未跳过保护：

1. **visual**：`apps/web/e2e/tests/workbench-layout.spec.ts:397` 在 `seed.owned()` 之后仍断言旧共享显示 id `T-E2E-000001`；owned 任务的显示 id 为命名空间形态。属 P7 迁移遗留的消费方缺陷（与已修复的 pointcloud/lidar 同类），已请求 bounded separate fix（保留 `text-brand` 与文件名断言）。
2. **pointcloud（领域 worker）**：`workbench-pointcloud-tools.spec.ts:379` 双击多边形失败（retries 1 后仍失败，0 skip）；同次运行的 owned-cleanup 返回 500（residual users=3/projects=2）并在 global teardown 留 3 个用户。由独立诊断者定位根因；若落在 P7 seed/fixture 归属内，将以独立 fix + 回归提交。

上述两项修复前，P9 不得声明“全绿”或“完成”；`Frontend E2E` 的 fail-closed 汇总/审计语义不变（真实失败会照常阻塞）。

## 7. 保留与限制

- workers 1、重试/超时/覆盖率预算未放宽；核心不依赖重试。
- old/new 对照复用同名同配置套件证据，只对新增 `smoke`/`video-pipeline`/`pointcloud` 做实际成员验证（domain worker 承担后两者）。
- 纯文档跳过必须在汇总可审计；回退开关保留且经过 CLI 回归。
- [GAP] 远端 CI 未运行（不推送）；首次真实 runner 观察（构建复用、审计、ml-cpu）留待集成后。
- [GAP] 严格 WebGPU/WebCodecs 资格与渲染家族证据由 renderer 专项负责，本阶段不重复。
- [GAP] 发布候选完整验证记录入口在 P10 台账中明确；不声称已存在 release gate。
