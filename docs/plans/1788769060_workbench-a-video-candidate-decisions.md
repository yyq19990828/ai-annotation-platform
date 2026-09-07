# A · 视频候选决策与快捷键（实施与验收记录）

> Status: Completed
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 用户确认：2026-09-07 已明确确认 A；实施状态：已完成；浏览器验收：A-1–A-5 已通过。

## 1. 交付范围与依赖

交付结果：视频候选决策与快捷键。不改普通预测的接受粒度：`video_track_*` 仍按 prediction/shape_index 接受整个 shape；当前帧限定 A/D 的候选集合及自动前进；保留「全部」帧列表原有的显式按钮范围。追踪作业局部审阅不属于本步。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

**产品决策**

- 视频选中当前帧的普通待决 AI 候选时，A 接受、D 忽略；未选此类候选时，D 仍切 Smart Box，A 不执行候选决策。
- 人工轨迹、人工单帧对象、其它帧候选、已处理候选不触发 A/D 接受或拒绝。交互式 SAM 保留其 Enter/Esc/Tab；追踪作业候选仍按作业、目标和窗口审阅。
- 输入框、菜单、停靠标签、类别弹层和活跃工具自有按键先消费事件。按住按键不得重复提交同一候选。
- 自动前进只在当前帧未决集合内发生；失败保留当前候选，不能把未完成决策当作已决。

**实施落点**

在 `hotkeys.ts` 的 `DispatchCtx` 增加明确的当前候选上下文，由 `useWorkbenchHotkeys.ts` 基于过滤后的 `aiBoxes`、当前源帧和选中 ID 派生，不能用 `hasSelection` 代替。按钮与快捷键调用同一个候选决策入口，保持现有写入门控。修正图片 Polygon 备用键为 Alt+2；视频 Alt+2 仍为轨迹、Alt+3 仍为选择。

`useImageAnnotationActions.ts` 的接受/拒绝目前返回 `void`，因此本步还要让实际决策所有者返回“成功 / 失败 / 待补选类别”的可等待结果，统一处理 422 类别补选、在途 task/candidate 去重和拒绝失败后的候选恢复。只有同一上下文的成功结果才能推进选中；不能只修 dispatch 后继续使用当前的立即前进逻辑。

为受本轮影响的快捷键定义补上下文和目标信息，供提示与路由契约测试比较；只比较 `actionType=setTool` 不足以发现目标工具错误。保留现有帮助页搜索，更新 `docs-site/scripts/generate-hotkeys.mjs` 的解析与生成说明，不为所有历史手势引入新快捷键框架。

**验收**

- 路由矩阵包含图片/视频、待决候选/人工轨迹/无选中、当前帧/其它帧、输入焦点/类别弹层/SAM/Mask。
- A/D 每次只决策一个当前帧候选；开启自动前进后不会跳到其它帧；失败、连按和切题不会重复决策。
- tooltip、帮助页、设置说明、自动生成文档与实际 dispatch 一致；保留 J/K/L 播放及 O/Q/L/H 轨迹键位。

文件集中于 `state/hotkeys.ts`、`state/useWorkbenchHotkeys.ts`、`stages/image/useImageAnnotationActions.ts`、`state/workbenchSettingsFields.ts`、`shell/ToolDock.tsx` 和快捷键生成器。回归扩展现有热键及候选决策测试。

测试数据复用 `video-prediction-import.spec.ts` 的 seed.videoTask、AAP JSON 导入和任务状态推进；不使用仍被跳过的视频 smoke、无帧 injectPrediction 或 tracker staged 候选充当普通视频候选。

补齐卡片包装与补选类别路径：Shell model 中的接受/拒绝包装不能继续立即清选；422 类别补选必须延续同一个决定到最终成功/失败，不能当作新决定重复创建。当前帧范围限制 A/D 审阅入口与自动前进，普通轨迹 prediction 仍接受整个 shape。「全部」帧列表的显式按钮沿用已有操作范围，处理其它帧候选时不跳帧、不推进当前选择。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/state/hotkeys.ts](../../apps/web/src/pages/Workbench/state/hotkeys.ts)
- [apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts](../../apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts)
- [apps/web/src/pages/Workbench/stages/image/useImageAnnotationActions.ts](../../apps/web/src/pages/Workbench/stages/image/useImageAnnotationActions.ts)
- [apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx](../../apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx)
- [apps/web/src/pages/Workbench/state/workbenchSettingsFields.ts](../../apps/web/src/pages/Workbench/state/workbenchSettingsFields.ts)
- [apps/web/src/pages/Workbench/shell/ToolDock.tsx](../../apps/web/src/pages/Workbench/shell/ToolDock.tsx)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

实测使用当前 worktree 的 Web 3010 / API 8011 和独占测试数据库；8010 已被另一工作区占用，未停止该服务。可见 Chrome 视口为 1440×1000。完整环境与证据见本文件 Outcome 和 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                                                               | 当前结果 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A-1  | 用真实 AAP JSON 导入同帧两项候选、异帧一项候选，进入视频工作台，选当前帧候选按 A；保存成功后仅选择同帧下一未决候选，刷新验证仅一项被接受。   | 通过     |
| A-2  | 选候选按 D，验证忽略持久化且不切 Smart Box；分别选人工轨迹、人工单帧对象和清空选择，验证 D 仍切 Smart Box，A 不改变数据。                    | 通过     |
| A-3  | 导入不属于项目工具单元的普通类别以触发真实 422（不用后端放行的 \_\_unknown），接受后补选合法类别；完成前不推进，最终只创建一次。             | 通过     |
| A-4  | 在隔离请求上模拟拒绝失败、响应延迟和长按 A/D，验证候选恢复、失败不前进、重复输入只有一项在途决策；请求期间切题，迟到结果不清理新题选中。     | 通过     |
| A-5  | 分别在输入框、类别浮层、停靠标签、SAM 和 Mask 中输入相关键；应由当前控件消费。核对图片 Alt+2/Alt+3 和视频 Alt+2/Alt+3 的界面说明及实际动作。 | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（已创建并通过）：`apps/web/e2e/tests/workbench-video-candidate-decisions.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/state/hotkeys.test.ts src/pages/Workbench/state/useWorkbenchHotkeys.test.ts src/pages/Workbench/stages/image/useImageAnnotationActions.test.ts
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/video-prediction-import.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/workbench-video-candidate-decisions.spec.ts --project=chromium
pnpm docs:hotkeys
pnpm docs:settings
pnpm --filter @anno/web typecheck
pnpm --filter @anno/web lint
git diff --check
```

文档同步：docs-site/user-guide/workbench/hotkeys.generated.md、工作台设置生成说明、视频审阅指南和 CHANGELOG Unreleased。

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

- 完成日期：2026-09-07。代码位于 `codex/workbench-interaction-epic` 工作区，基线 `cd2521f1`；本记录随已验收实现提交，未发布或分配版本。
- 新增 `usePredictionDecisions.ts`，统一普通候选按钮、快捷键和批量入口的异步结果、任务/候选防重、422 补类与属性保留。失败保留候选；仅所属任务、帧和选择仍有效时，在成功后推进。切题往返后的在途请求与数据回填窗口同样防重，真实接受记录出现后撤销可再次采纳。
- 修复视频 D 被工具路由提前消费、图片 Polygon 备用键说明、卡片/画布/列表过早清选和视频类别弹层被浮窗遮挡。下拉框、菜单、停靠标签及 SAM 类别选择保留按键所有权。「全部」列表的显式操作保持原有范围，不跨帧自动前进。
- 正式文档：`docs-site/user-guide/ai/candidate-review.md`、`docs-site/user-guide/workbench/video-track.md`、`hotkeys.generated.md`、`settings.generated.md`；`CHANGELOG.md` Unreleased 已增加用户影响说明。

### 自动化结果

- 6 个相关单测文件共 130 项通过：hotkeys 76、useWorkbenchHotkeys 12、useImageAnnotationActions 17、AIInspectorPanel 15、ClassPickerPopover 1、WorkbenchOverlays 9。
- 新增 `workbench-video-candidate-decisions.spec.ts` 的两项 Chromium/API 用例通过，覆盖保存读回、503 拒绝失败重试、真实 422 补类、原生下拉框焦点、长按/连按、切题返回与迟到响应。相邻 `video-prediction-import.spec.ts` 的既有 Chromium/API 用例亦已通过。
- Web typecheck、lint（含 CSS token 检查）、快捷键与设置生成文档一致性检查通过。快捷键生成器读取 112 条定义，设置生成器读取 47 项配置。未运行远端 CI。

### 可见浏览器证据

服务代码目录为 `/home/hehao/.codex/worktrees/0dc6/ai-annotation-platform`；页面入口为 `http://127.0.0.1:3010`，API 为 `http://127.0.0.1:8011`。初次验收题 `T-E2E-VIDEO-648753`（task `1da3637b-1d17-4717-8ded-f670e1843fe1`），末轮边界复测题 `T-E2E-VIDEO-5b7327`（task `df58733d-f082-4195-be30-95cde37fafe7`）。正常保存使用实际 API；503 与响应延迟仅注入指定测试请求。

| 项目       | 实际结果与持久证据                                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A-1        | F0 car 按 A 后仅选择 F0 person；刷新并读取 API，car 仅创建 1 项。F10 候选未被自动选中。                                                                                                                                                                      |
| A-2        | F0 person 按 D 后忽略持久化，仍处于选择工具；人工单帧、人工轨迹和无选择时 D 切智能框，A 不发普通候选请求。                                                                                                                                                   |
| A-3        | 不匹配的普通类别触发实际 422；候选保留，点击 car 补类成功后只创建 1 项。修复后实际鼠标可点击弹层。                                                                                                                                                           |
| A-4        | 指定拒绝请求 503 后候选与选择保留，重试成功；延迟期间连续 A/A/D 只有 1 项请求，切到其它题选择人工对象后旧结果不改选择。末轮增加离开再返回同题，仍只有 1 项请求、1 项标注。可见浏览器使用连续真实按键，按住键产生 repeat 由 Chromium keyboard.down 回归验证。 |
| A-5        | 评论编辑器、原生下拉框、停靠标签与类别弹层不触发普通候选决策；Mask B/E 保留笔刷/擦除。实际 SAM2 返回 3 个候选，Tab/Enter/Esc 和补类期间 A/D 按键所有权正确，未提交 SAM 结果。图片和视频 Alt+2/Alt+3 与帮助说明一致。                                         |
| 全部帧按钮 | 展开 F10 行的「更多操作」后点击忽略，实际发出 1 项拒绝请求；仍在 F0，人工选择不变。刷新后全部列表不再出现该候选。                                                                                                                                            |

本轮只验证交互与保存语义，不报告 SAM 模型质量、渲染性能或新手成功率。Workbench 控制台有既有 Konva 图层数量警告；初次登录后的 Dashboard 有既有嵌套 button 警告，修复后的 Workbench 未发现新增运行时异常。

### 清理与后续

验收题、临时故障注入、日志、截图/报告、端口覆盖配置和本任务启动的 Web/API 均在验收后清理；浏览器视口恢复并关闭测试页。独占测试库在连接检查后删除。主工作区服务和共享 `.env` 未修改。

本工作区原有 Node 依赖软链接缺少必要的 dockview-react；仅将本工作区 root/web/docs 三处依赖链接改为本地目录，使用 frozen lockfile 安装，未修改包清单或锁文件。Python 使用本地虚拟环境。

A 已完成；按用户更新的执行要求提交后继续 B 及其余草案，完整 Epic 尚未完成。
