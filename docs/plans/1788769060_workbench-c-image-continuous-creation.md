# C · 图片连续创建（计划草案）

> Status: Ready
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：未开始；浏览器验收：未执行。

## 1. 交付范围与依赖

交付结果：图片连续创建。仅会话级状态；不增加管理员预设、跨设备同步或自动继承对象属性。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

**首版范围**：图片手工 bbox、OBB、polygon、polyline 和按模板完成的 keypoints。Mask 保存与 AI 接受继续使用各自会话，分别由 D/E 改善；不自动套入普通几何连续提交。

**类别和工具合同**

1. 默认保留安全确认，标注员在工作台显式开启“连续创建”。会话态由现有 Workbench owner 管理，不新增服务端 preferences 字段或管理员配置。
2. 创建意图按 `(tool_unit_id, class_name)` 标识，类别面板按工具单元提供入口。同名单元不能串类；只恢复 C 首版允许集合中的最近手工工具，`region` 因而使用 Polygon，不恢复 Mask 或启动 AI。目标工具不可用时停止连续创建并给出原因。
3. 同项目切题可保留模式和合法类别/工具意图，但清除几何、属性草稿和原题提交状态；每题重新校验绑定。切项目、媒体类型、进入只读审核或权限失效时退出连续模式。
4. 切换类别只改变下一对象的创建意图，不修改已保存的选中对象。已有草稿时先通过现有取消/保存流程，不能把未完成几何静默归给新类别。

**创建与退出合同**

- 所有几何仍走 `useWorkbenchAnnotationActions` 的共同创建入口。补齐创建草稿的属性参数，复用属性默认值与 `AttributeForm` 的 `getMissingRequired`；首版不继承上一对象属性。
- 类别合法且必填属性齐全时直接创建；缺必填项时只展示缺失字段并保留几何，不重新要求选择已确定的类别。不可变属性不能从上一个对象静默复制。
- 下一对象只能在现有保存管线成功接收后开始：在线创建成功，或现有离线队列已持久化接收。请求失败保留草稿并允许重试，避免连续输入绕过提交状态。
- 顶部短状态显示“连续创建 · 类别 · 工具”，有明确退出按钮。Esc 先交给弹层/工具取消当前草稿；没有草稿时 Esc 退出连续模式并回选择工具。

**验收**

一次选类后完成 20 个同类 bbox，额外选类浮层次数为 0；Polygon 完成后可继续同类下一对象。覆盖跨单元同名类别、工具被禁用、必填/不可变属性、任务锁、只读审核、网络失败、离线队列及快速切题。生成的 geometry、class、tool unit 和 attributes 与安全确认路径一致。

改动入口为 `state/useWorkbenchState.ts`、`state/useWorkbenchAnnotationActions.ts`、`state/useWorkbenchShellModel.tsx`、`shell/ClassPalette.tsx`、`shell/ClassPickerPopover.tsx` 和相应 Stage 调用方。文档解释会话边界，避免让用户误以为模式会跨设备同步。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/state/useWorkbenchState.ts](../../apps/web/src/pages/Workbench/state/useWorkbenchState.ts)
- [apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts](../../apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts)
- [apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx](../../apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx)
- [apps/web/src/pages/Workbench/shell/ClassPalette.tsx](../../apps/web/src/pages/Workbench/shell/ClassPalette.tsx)
- [apps/web/src/pages/Workbench/shell/ClassPickerPopover.tsx](../../apps/web/src/pages/Workbench/shell/ClassPickerPopover.tsx)
- [apps/web/src/pages/Workbench/shell/AttributeForm.tsx](../../apps/web/src/pages/Workbench/shell/AttributeForm.tsx)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

在可见 Chrome 中通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。Browser 已连接 Chrome；本次尚未开始功能实测。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                                    | 当前结果 |
| ---- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| C-1  | 开启连续创建并选一次 bbox 类，连续绘制 20 个对象，选类浮层次数为 0；刷新后数量、类别与工具单元正确。              | 未执行   |
| C-2  | 分别用 Polygon、OBB、Polyline 和模板 Keypoints 连续创建两个对象，工具保持且每次只生成一个；Mask/AI 不进入该路径。 | 未执行   |
| C-3  | 在不同工具单元的同名类别间切换；下一对象意图改变，已保存的选中对象不改类，region 不恢复 Mask。                    | 未执行   |
| C-4  | 缺必填属性时保留几何并补字段，后一个对象不继承前一对象属性；Esc 先取消草稿，再退出模式。                          | 未执行   |
| C-5  | 在请求失败、离线入队和快速切题场景操作；保存管线接收后才继续，旧请求不选择新题对象。                              | 未执行   |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/workbench-image-continuous-creation.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/state/useWorkbenchAnnotationActions.test.ts src/pages/Workbench/shell/ClassPickerPopover.test.tsx src/pages/Workbench/shell/AttributeForm.test.tsx
pnpm --filter @anno/web test:e2e e2e/tests/workbench-image-konva-smoke.spec.ts --project=chromium
pnpm --filter @anno/web test:e2e e2e/tests/workbench-image-continuous-creation.spec.ts --project=chromium
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
