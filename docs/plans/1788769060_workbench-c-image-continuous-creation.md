# C · 图片连续创建（实施与验收记录）

> Status: Completed
>
> 创建日期：2026-09-07；代码核验基线：cd2521f1。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：C-1–C-5 已通过。

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

沿用用户在 B 阶段明确授权的 Playwright 浏览器路径，本步在独立 Chromium 中通过真实点击、按键和拖动执行下表，检查相关页面运行错误与 API 结果，不使用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均未用作本步验收服务。本步使用当前 worktree 的 3010 Web / 8011 API 与一次性数据库，已完成 Chromium/API 实测。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                                                    | 当前结果 |
| ---- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| C-1  | 开启连续创建并选一次 bbox 类，连续绘制 20 个对象，选类浮层次数为 0；刷新后数量、类别与工具单元正确。              | 通过     |
| C-2  | 分别用 Polygon、OBB、Polyline 和模板 Keypoints 连续创建两个对象，工具保持且每次只生成一个；Mask/AI 不进入该路径。 | 通过     |
| C-3  | 在不同工具单元的同名类别间切换；下一对象意图改变，已保存的选中对象不改类，region 不恢复 Mask。                    | 通过     |
| C-4  | 缺必填属性时保留几何并补字段，后一个对象不继承前一对象属性；Esc 先取消草稿，再退出模式。                          | 通过     |
| C-5  | 在请求失败、离线入队和快速切题场景操作；保存管线接收后才继续，旧请求不选择新题对象。                              | 通过     |

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
- 追加 `## Outcome

实施提交：`f9306f61`。`，记录实际改动、文档位置、测试结果、浏览器逐项结果与证据、清理情况；只有实际存在才记录提交号。更新 Epic 状态索引。

- 每次测试后清理本次中间产物和测试数据；保留明确交付的最小证据。停止本任务启动的进程，恢复浏览器缩放，清理临时配置，不修改共享 .env/依赖或停止主工作区服务。
- 本里程碑验收并提交后，按依赖继续下一份草案。版本与发布日期仍由维护者决定，本轮不作版本发布。

回滚：按本里程碑回退实现；保留已保存的标准标注/反馈数据及后续客户端可选读取字段，不清空用户数据。

## Outcome

2026-09-07 完成。实现与浏览器测试均来自 `/home/hehao/.codex/worktrees/0dc6/ai-annotation-platform`，分支 `codex/workbench-interaction-epic`，实施基线为 B 提交 `4a9e0397`；本步不发布版本。

### 实现与边界

类别面板提供会话级开关和按工具单元选择类别的入口，顶部显示当前创建意图与退出按钮。五种手工几何共用 `useWorkbenchAnnotationActions` 的创建事务，固定草稿 ID、任务、工具单元、类别与属性；保存中不接收下一对象，成功或 IndexedDB 持久接收后释放草稿。缺失必填项同步补全，默认值每对象独立生成，保留 `false` 与 `0`；正常确认路径使用相同 payload 生成器，关闭模式保留原绘制后偏好与外部点击处理。

连续模式下已保存几何不接管创建手势，避免重复绘制时误选或编辑旧对象。Esc 清除半成品顶点、关键点或正在拖出的框，第二次退出模式；锁定时也清除半成品。切项目、媒体类型、审核模式和绑定失效退出，同项目切题保留合法意图并清除旧题草稿。

底层创建 mutation 固定每次调用的任务和分段，修复等待 `onMutate` 或网络时切题造成请求/缓存归属变化的问题；回滚仅删除自身临时条目，成功去重补入。创建请求使用 `networkMode: always`，诊断 fetch 包装保留原生错误类型，使断网失败能进入既有离线管线。离线队列以原子读改写确认接收，旧接口保持兼容；不新增远端幂等协议，跨标签页同时 drain 或远端成功后本机提交失败的既有边界仍不能保证远端只执行一次。

用户文档更新了工作台概览、Bbox 与 Polygon 指南，开发者文档补充创建事务与队列合同，CHANGELOG Unreleased 记录新增功能。

### 浏览器逐项证据

使用 Playwright Chromium，Web `http://127.0.0.1:3010`、API `http://127.0.0.1:8011`，数据库 `annotation_workbench_0dc6_e2e`。新功能视口为 1440×1080，既有图片基线为 1280×800。每个场景由测试种子独立创建项目、`task-1.svg`、`task-2.svg` 和必要的视频任务；业务操作均使用这些一次性任务。

| 项目 | 结果                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-1  | 一次选 car 后绘制 20 个矩形框，DOM 观察到新增选类浮层次数为 0。刷新后 API 读回 20 条 bbox，类别、单元及 `unit / verified=false / count=0` 属性正确。                                                                                       |
| C-2  | Polygon、OBB、Polyline、模板 Keypoints 各创建两个对象，逐次只增加一条。Polygon 覆盖 Enter 和首点闭合；OBB 角度为 0；Keypoints 覆盖可见、Alt 遮挡、右键跳过，读回可见性为 `[2,1,0]`。                                                       |
| C-3  | 五个单元均配置同名 car，读回属性的 unit 与实际工具单元一致；选中对象在更换下一对象类别后保持原样。从 Mask 切回区域连续创建时激活 Polygon，新增 person 不改旧 car。工具绑定停用后正常重连刷新配置，退出并显示原因。                         |
| C-4  | 两个对象分别要求实例编号，输入后立即 Enter 分别保存新值；第二个对象不继承第一个的不可变属性。待属性、Polygon 点集、Keypoint 半成品和鼠标按住的矩形框均验证 Esc 分层取消，取消未写入。任务锁定后开关禁用；另验证审核入口无法开启。          |
| C-5  | 注入一次 HTTP 503 后保留草稿，按钮重试成功且仅一条。延迟第二次 POST，A→B→A→B 后旧响应不改变 B 的选择、草稿或数量。同项目切题保留 car 意图；切到视频退出。浏览器断网时持久接收，刷新读回 IndexedDB 操作仍在，恢复网络仅保存一次并清空队列。 |

正常场景不拦截业务 API。失败用例明确注入 HTTP 503、延迟传输以及浏览器断网；离线刷新时只阻断创建 POST，允许页面资源和只读 API 加载，随后恢复传输。测试用状态/绑定更新用于验证锁与失效边界，未模拟模型质量。7 项新增场景的 `pageerror` 均为空，既有 Konva 截图基线无需更新并通过。

### 检查与清理

- 15 个相关单测文件共 144 项通过：创建事务、任务归属、队列、属性表单、类别控件、弹层、快捷键、图片动作、Stage 接线和撤销历史。
- 新增 Chromium/API 7 项及既有图片画框基线 1 项通过。最终合跑 6 项功能场景与图片基线约 2.5 分钟；补充视频切换/审核入口用例约 8.8 秒。
- Web typecheck、完整 lint（包含 CSS tokens）、文档生成检查、计划时效与 diff 检查在提交前执行；远端 CI 不在本轮范围。
- 测试种子在各轮结束清理；最终确认 3010/8011 已停止，验证测试库归属与零连接后删除。测试浏览器均关闭，临时端口配置、报告、截图和运行日志在提交前清理；未修改共享 `.env` 或主工作区服务。

C 已完成，提交后按 Epic 顺序继续 D。
