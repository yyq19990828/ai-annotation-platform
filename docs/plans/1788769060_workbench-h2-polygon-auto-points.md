# H2 · Polygon 自动落点（计划草案）

> Status: Done
>
> 创建日期：2026-09-07；代码核验基线：5ffd4bdf。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：通过。

## 1. 交付范围与依赖

交付结果：Polygon 自动落点。不实现曲率/智能剪刀或沿边追踪；与 C 联合验收是集成项，不构成硬依赖。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

在现有 `PolygonTool` 草稿内增加 Shift 拖动，按累计 8 CSS px 屏幕距离重采样，相邻输入样本间可生成多个点，按动画帧合并草稿更新并保留终点；不让鼠标事件频率决定采样密度。松开后继续同一草稿，Backspace 删除最后一点，Esc 取消草稿，Enter 保持现有闭合语义。普通单击与既有吸附优先级保持，首版不引入曲率算法。

阈值按视口尺度换算，保持屏幕上的点间距；保留现有几何校验。自动采样在草稿达到 20,000 点时暂停并提示，保留已有点且不自动提交或截断；这是固定交互预算，不新增设置。验证缩放下屏幕采样密度一致、零移动/重复点不膨胀、快捷键与图片平移不冲突，并与 C 连续创建协同。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/stage/tools/PolygonTool.ts](../../apps/web/src/pages/Workbench/stage/tools/PolygonTool.ts)
- [apps/web/src/pages/Workbench/stage/ImageStage.tsx](../../apps/web/src/pages/Workbench/stage/ImageStage.tsx)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                  | 当前结果 |
| ---- | ----------------------------------------------------------------------------------------------- | -------- |
| H2-1 | 不同画布缩放下按相同屏幕路径 Shift 拖动，约 8 CSS px 点距；不同输入速度不改变固定距离采样语义。 | 通过     |
| H2-2 | 松开 Shift 后补单点，Backspace 撤一点、Enter 闭合；刷新检查最终轮廓。                           | 通过     |
| H2-3 | 零移动和重复样本不膨胀顶点；Space 平移不会写入草稿。                                            | 通过     |
| H2-4 | 用受控长路径到达 20,000 点，页面显示暂停采样且保留草稿，可撤销/取消，不自动保存或截断。         | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/polygon-auto-points.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/stage/tools/PolygonTool.test.ts src/pages/Workbench/state/useWorkbenchHotkeys.test.ts
pnpm --filter @anno/web test:e2e e2e/tests/workbench-image-konva-smoke.spec.ts --project=chromium
pnpm --filter @anno/web test:e2e e2e/tests/polygon-auto-points.spec.ts --project=chromium
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

提交：`89849018`（`feat(workbench): sample polygon vertices during Shift dragging`）。

- 实施基线：`5ffd4bdf`。H2 已实现并完成浏览器验收；本节随实现提交，不预写不存在的提交号。版本安排仍由维护者决定。
- `PolygonTool` 在 Shift 左键路径中调用 `usePolygonAutoPoints`，按累计 8 CSS px 重采样，保留跨事件余量，一次输入可产生多个点，按动画帧合并追加；松手或释放 Shift 追加最终端点。普通单击、吸附和 Alt 关闭吸附保留既有优先级。
- `usePolygonDraftPoints` 在现有 AnnotationActions owner 内同步发布点集引用；追加批次必须匹配原引用。快捷键在 Enter / Backspace 前刷新当前笔迹并读取最新点集。图像、工具、视口、许可变化和取消会使旧笔迹失效；首批被拒绝时不留下指针监听。
- 达到 20,000 点显示暂停提示并保留草稿；不自动提交或截断。大于 500 点时通过一个 Konva Shape 绘制全部顶点，不简化存储点集。真实长路径显示暂停提示，继续拖动仍为 20,000，Backspace 后为 19,999，Esc 后为 0，全程没有创建请求；已检查暂停界面截图。
- 实测发现并修复 Konva 将 Shift 拖动或位置不同的快速点击算作双击的问题：Polygon 双击闭合需连续两次普通点击且屏幕位置相距不超过 4 px。普通双击、Shift 拖动中 Enter 和后续选类保存均实测通过。已选对象仍保留顶点编辑优先级，比较采样路径前通过原 Esc 入口取消其选中；不改变既有对象编辑规则。
- 用户指南：`docs-site/user-guide/workbench/polygon.md`；开发合同：`docs-site/dev/concepts/workbench-shell.md`；CHANGELOG Unreleased Added 已同步。没有新增 API、用户设置或版本号。

### 浏览器验收证据

运行目录为当前 worktree `/home/hehao/.codex/worktrees/0dc6/ai-annotation-platform`，隔离启动配置明确以本目录 `apps/web` / `apps/api` 为 cwd，Web `http://127.0.0.1:3010`、API `http://127.0.0.1:8011`；未使用 3000/8000 主工作区服务。Chromium `147.0.7727.15`，新场景视口 1440×1000、DPR 1；原图像基线视口 1280×800。通过 Playwright 原生鼠标、滚轮和键盘输入操作真实 Chromium 与 API，未使用 DOM dispatch、业务 API 拦截、内部 store 注入或模型响应夹具。

| 项目     | 实测结果与持久证据                                                                                                                                                                                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H2-1     | 两个实际画布缩放、每段 1 / 40 个移动样本，均按 403 CSS px 路径得到 52 点；逐点换算回屏幕坐标与 8 px 累计距离一致，最后 3 px 终点保留。4 个 Polygon 保存并刷新逐点读回一致。任务 `305d6d18-d743-45d8-919a-f55b36743bc8`，项目 `afd392c4-6d7c-455f-803c-6d61b3e8187b`。                                                       |
| H2-2     | 23 点草稿松开 Shift 后补单点为 24，Backspace 回到 23，再补点、Enter、选类保存为 24 点；原连续创建开关与区域单元下自动保存后连续创建另两个 35 点 Polygon，三个对象刷新读回一致，逐对象保留 `verified=false` / `count=0` 默认属性。任务 `ad9696be-9671-4e00-8ac8-e6bdb08faf9e`，项目 `801d4447-eeab-4ec3-8f89-4c96446f2416`。 |
| H2-3     | 零移动、重复起止点保持 1 点；Space 拖动后仍为 1 点，Esc、拖动中 Esc 与切工具均清空草稿且不复活，零写入。任务 `e6703fb6-ccfd-4650-b95d-ceb3224624b6`，项目 `c64855ed-b9c4-4795-b5ad-20cb24f26095`。                                                                                                                          |
| H2-4     | 真实鼠标在受控重复屏幕路径上推进到 20,000 点；确认暂停提示、继续拖动不增长、不自动保存、撤一点到 19,999、取消到 0。任务 `204a1124-493c-4313-82c4-7f08fc81652f`，项目 `d9f47607-86fb-4ebe-b2dc-c6e86190abe5`。该重复路径只验证交互预算，未作为有效闭合几何提交；不作帧率或性能提升结论。                                     |
| H2-5     | 原普通双击闭合保存；Shift 拖动尚未松手时 Enter 包含 28 点及实际终点。两个 Polygon 刷新读回一致，已检查最终画面。任务 `2068b76e-0bf3-4973-a79e-90510df92b99`，项目 `2578f655-0896-4899-8cd0-436a561908d5`。                                                                                                                  |
| 既有基线 | `workbench-image-konva-smoke.spec.ts` 通过（7.4 秒），未更新基线截图。                                                                                                                                                                                                                                                      |

验收分轮完成：首轮发现交互问题；第二轮 H2-1/3/4 通过（H2-2 尚失败）；补齐普通点击位置判定后 H2-5 通过，H2-2 的补点与保存已通过但连续开关定位错误；修正为已有 switch/combobox 原生 UI 后，H2-2 最终单独运行于 2026-09-08 11:30，1 passed、0 failed/skipped/flaky。五项有效通过证据均无页面异常或非预期 API/控制台错误；仅列出导航清理时特定 GET 与 heartbeat 的 `ERR_ABORTED`，不忽略标注写入错误。后续修正只收紧普通双击和拒绝首批时的监听清理，不影响已通过的 Shift 采样与预算分支。

### 检查与清理

- 定向 Vitest：5 个文件、80 项通过，包括 PolygonTool 7、采样几何 3、手势生命周期 5、快捷键 53、AnnotationActions 12；首批拒绝监听的回归先失败后修复通过。
- `pnpm --filter @anno/web exec tsc -b --noEmit`、Web 全量 lint（含 CSS token 检查）、E2E 独立 strict TypeScript 检查、docs `check:plans` / `check:codegen`、`git diff --check` 通过。
- 每次浏览器测试均使用经过所有者标记核验的一次性数据库 `annotation_workbench_0dc6_e2e`，结束时 seed reset，进程退出后核对零连接再删除数据库。原始 trace、截图、JSON、临时端口配置、类型和 Vitest 缓存及专用 Redis 在本步提交收尾时清理；不改共享 `.env` 或依赖，不停止主工作区服务。
- 继续 H3：沿已有 Polygon 边界追踪；Slice 保留在 H4a/H4b。
