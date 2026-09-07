# E1 · AI 交互顶栏主次层（实施与验收记录）

> Status: Completed
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：E1-1–E1-4 通过。

## 1. 交付范围与依赖

交付结果：AI 交互顶栏主次层。不改变 Inspector 的阶段展开，不增加模型或后端；E1 可独立于 A/D 使用。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

仅交付交互式 AI 顶栏主次层。主层保留提示方式、正负极性、输出类型、当前必需文本、候选序号与决策动作；高级区容纳后端、模型、variant 和诊断。能力协商状态与本轮推理状态分别来自各自 owner，不能互相代替。必要输入和可恢复错误不能因折叠而隐藏。配置仍由现有 owner 保存，面板移动/隐藏不取消请求；不改 Inspector 阶段或推理执行流程。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/shell/InteractiveToolBar.tsx](../../apps/web/src/pages/Workbench/shell/InteractiveToolBar.tsx)
- [apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx](../../apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

使用用户已授权的 Playwright 独立 Chromium，通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                                                   | 当前结果 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| E1-1 | 在图片进入 Smart Point、Box、Exemplar、Scribble，视频进入现有 Point、Box、Exemplar；高级区折叠时仍能填写当前必需输入并完成提示。 | 通过     |
| E1-2 | 展开高级区切后端、模型和 variant 再折叠；选值保持，实际请求使用该配置，折叠不重新发起推理。                                      | 通过     |
| E1-3 | 切换多实例候选、接受与取消；主层序号/总数跟随真实会话，刷新核对原生 Mask 像素。                                                  | 通过     |
| E1-4 | 分别制造能力协商失败和本次推理失败；错误来源正确，必要配置入口可达。                                                             | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/workbench-ai-toolbar-layers.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/shell/InteractiveToolBar.exemplar.test.tsx
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/native-mask-ai.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/workbench-ai-toolbar-layers.spec.ts --project=chromium
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

E1 已完成。工作目录为 `/home/hehao/.codex/worktrees/0dc6/ai-annotation-platform`，基线为 D 提交 `11eb762f`，本记录对应该基线上的本步实现。

### 实际改动

- `InteractiveToolBar` 主层保留提示、极性、输出、文本、候选序号与决策；高级配置通过本地展开状态和 `hidden` 展示后端、模型、variant、阈值与诊断。控件不会因折叠重建，也不会调用配置 setter 或取消请求。
- 能力错误和重试来自既有 setup query，推理错误来自原请求代次；全部协商失败时显示独立恢复条。不可重试的推理错误仍有文字提示，旧响应不会覆盖新 owner 的状态。
- 图片和视频的按钮与 Enter 共用原类别选择入口；控件、原生 select、弹窗、IME 和长按事件由候选与主快捷键监听一起让出。视频自定义 variant 经既有参数规范化函数进入 `model_variants`。
- 浏览器发现并修正视频 Exemplar 接受 Mask 后，选中保存对象导致剩余候选被清空的问题：已存 Mask 身份只参与精修提示的会话作用域。
- 新浏览器 spec 使用现有 API 创建第二个测试后端；测试清理明确覆盖两个固定夹具 URL，保持其它后端不变。仅修改测试 seed 路由，没有新增公开 API、模型能力或生产后端。
- 同步 [AI 工具指南](../../docs-site/user-guide/workbench/sam-tool.md)、[工作台状态合同](../../docs-site/dev/concepts/workbench-shell.md) 和 CHANGELOG Unreleased。

### 浏览器验收

使用用户授权的 Playwright Chromium，当前工作树 Web `http://127.0.0.1:3010` / API `http://127.0.0.1:8011`，独立库 `annotation_workbench_0dc6_e2e`。新场景视口 1440×1080；相邻原生 Mask 回归使用其现有 Chromium 配置。图片为 64×48 的 `task-1.svg`，视频为 1440×810 的 `native-mask.webm`，验证当前 F0。任务均由 `seed.reset` 临时创建；最终重测视频项目为 `d6ca575d-8aeb-4f28-bdef-add6c73e132d`，配置重测图片项目为 `92b9d131-ba09-4300-b758-237e56974e1a`。

| 编号 | 实际证据                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1-1 | 图片 Point、Box、Exemplar、已存 Mask Scribble，以及视频 Point、Box、Exemplar 均用真实点击/拖动完成提示；折叠时极性、输出与 Exemplar 文本仍可操作。视频未新增 Scribble 工具。                                            |
| E1-2 | 在有项目写权限的账户下切换两个测试后端、模型及 `size` 档位；读取实际 JSON / multipart 请求确认 backend、`model_id` 与 `model_variants.size`，刷新核对用户偏好和项目配置。折叠不增加用户提示请求；现有静默预热单独识别。 |
| E1-3 | 主层前后切换 3 个候选；Exemplar 接受第二个后余 2 个，取消后为 0；原生接纳请求经真实 API 保存，图片和视频刷新后 RLE 与第二个签名候选逐项相同。顶栏按钮 Enter 与原生 select 的 Tab 未触发背景采纳或候选切换。             |
| E1-4 | 分别注入 setup 503 与当前提示 503；能力恢复不触发用户提示，推理重试保持同一上下文，错误摘要互不混用；负笔迹重试后原位更新源 Mask，刷新核对像素。                                                                        |

`workbench-ai-toolbar-layers.spec.ts` 新增 6 项；`native-mask-ai.spec.ts` 原有 6 项均通过。合计 12 项：完整一轮 11 通过、1 项因视频轨迹行使用图片定位器失败；仅修正该断言后，将视频候选场景与受清理变更影响的两个配置场景重跑，3 项通过。两轮使用同一份最终产品代码，第二轮同时验证更新后的测试清理。确定性能力/ML 返回、503 和原有网络故障场景均为显式夹具，不代表真实模型质量或吞吐验证。实际保存、配置与内容读回没有伪造响应。

### 检查与清理

- 前端 239 项定向单测通过：能力路由 30、单后端能力 12、推理 53、顶栏 17、图片 actions 45、主快捷键 47、VideoKonvaStage 21、交互边界 14。
- Python 测试 `test_seed_cleanup_is_idempotent_and_preserves_non_e2e_data` 通过，验证第二测试后端清理、重复清理与保留其它数据；使用当前工作树虚拟环境和同一已验证的一次性库。
- 完整 Web typecheck、lint（含 CSS tokens）、固定版本 Ruff、文档 codegen、计划新鲜度与 `git diff --check` 通过。
- 全局 seed teardown 成功；再次查询确认两个固定测试后端均为 0。3010/8011 服务已退出，核对数据库所有者与连接数后删除隔离库，清理报告、截图、临时配置、脚本和 pytest 缓存。没有修改共享 `.env`，没有操作用户 Chrome 的缩放。
- 三个隔离实现分支已核对内容等价；主分支另加顶栏宽度适配。提交后移除本步干净的工作树。
