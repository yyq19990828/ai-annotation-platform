# D · Mask 阶段主动作（计划草案）

> Status: Ready
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：未开始；浏览器验收：未执行。

## 1. 交付范围与依赖

交付结果：Mask 阶段主动作。不重建 Mask 状态机；不扩展既有实例操作的通用 undo。新增 Slice 的原子恢复由 H4a/H4b 交付。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

保留现有 Mask phase、预览、高级操作和冲突恢复。从它们派生一个动作描述，统一主按钮、Enter、Esc 和 HUD；不新增平行状态机。

| 当前状态                 | 主动作                             | Esc / 次动作                                   |
| ------------------------ | ---------------------------------- | ---------------------------------------------- |
| 计算、提交中或条件不满足 | 展示进度/禁用原因，不重复提交      | 仅执行当前所有者支持的取消，不销毁不可取消事务 |
| 实例预览有效             | 提交 N 个实例                      | 取消实例预览，保留编辑会话                     |
| 区域预览有效             | 应用区域预览                       | 取消区域预览，保留此前像素草稿                 |
| 普通像素脏稿             | 保存 Mask                          | 通过既有未保存修改保护退出                     |
| 视频单帧或轨迹脏稿       | 保存当前帧 Mask / 保存当前帧关键帧 | 同一草稿保护；保持帧物化需明确写出             |
| 无脏稿                   | 已保存；无提交动作                 | 退出 Mask 编辑                                 |

实例与区域预览按现有互斥约束处理；若出现失效或冲突，主动作转为恢复动作，不能选择另一个提交路径。空结果的确认必须由按钮和键盘共享。工具仍按现有高级菜单组织，只补当前阶段路径、结果名称和对其它 Mask 的影响提示。

**验收**：区域“应用”只改变草稿，随后“保存”才持久化；实例提交次数为 1；取消预览不丢已有编辑；内存限制下 `canEdit=false`、`canCommit=true` 仍能保存；任务/帧/对象切换和错误恢复不会使用过期预览。既有实例操作的原子撤销缺口不在 D 暗中扩大；H 中新增 Slice 必须自带原子撤销。

修改 `MaskToolbar`、其调用方与 `useWorkbenchHotkeys.ts`，把已有动作解析与分派收在当前 Mask owner。扩展现有 MaskToolbar/快捷键测试和 `mask-session-guard` 交互回归。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/shell/MaskToolbar.tsx](../../apps/web/src/pages/Workbench/shell/MaskToolbar.tsx)
- [apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts](../../apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts)
- [apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx](../../apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                       | 当前结果 |
| ---- | ---------------------------------------------------------------------------------------------------- | -------- |
| D-1  | 产生区域预览，分别用按钮和 Enter 应用；第一次只改草稿，第二次保存才持久化。                          | 未执行   |
| D-2  | 产生两个实例预览，主动作显示实例数；重复点击/长按 Enter 只提交一次，刷新验证实例数量。               | 未执行   |
| D-3  | 已有笔画后打开预览，Esc 只取消预览；退出会话触发草稿保护。空结果的按钮与 Enter 使用相同确认。        | 未执行   |
| D-4  | 视频保持帧编辑时显示关键帧物化含义；无修改 Enter 不新建关键帧，有修改后仅当前帧成为人工关键帧。      | 未执行   |
| D-5  | 提交失败、版本冲突和受控内存限制时展示对应恢复动作；canEdit=false 且 canCommit=true 仍可保存原脏稿。 | 未执行   |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/mask-primary-actions.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/shell/MaskToolbar.test.tsx src/pages/Workbench/state/useWorkbenchHotkeys.test.ts
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/mask-editor.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/mask-session-guard.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/mask-advanced-operations.spec.ts --project=chromium
PLAYWRIGHT_RASTER_MASK_MATRIX=native pnpm --filter @anno/web test:e2e e2e/tests/mask-primary-actions.spec.ts --project=chromium
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
