# H1 · 中心向外创建 bbox（计划草案）

> Status: Done
>
> 创建日期：2026-09-07；代码核验基线：ed5a1c81。
>
> 所属 Epic：[图片与视频工作台交互改进](1788766038_image-video-workbench-interaction-epic.md)。
>
> 执行授权：2026-09-07 用户已要求按草案逐步实施，实测后提交；实施状态：已完成；浏览器验收：2026-09-08 通过，见 Outcome。

## 1. 交付范围与依赖

交付结果：中心向外创建 bbox。仅普通 bbox 中心创建，不改已有中心缩放，不迁移为 Konva Transformer；与 C 的联合验收不构成硬依赖。

硬依赖：无硬依赖；按 Epic 优先 A–D 的顺序排队。

## 2. 设计与实现合同

仅增加普通 bbox 创建，保持现有 Alt 中心缩放。空白画布 Alt 拖动以起点为中心；另提供当前 bbox 工具的“角点 / 中心”会话选项，适用于系统截获 Alt 的环境。Ctrl/Cmd 保留当前 SAM 候选选择用途。临时修饰键在 pointerdown 锁存，边界处对称限制半径，不能裁一边后移动中心。

[Konva 官方](https://konvajs.org/docs/select_and_transform/Centered_Scaling.html)已有 Transformer 中心缩放能力，但当前实现使用自定义 `ResizeHandles` 且已支持同类交互，因此复用现有手柄与创建路径，不迁移编辑内核。[Supervisely 固定文档](https://raw.githubusercontent.com/supervisely/docs/846b10b4a903300dc4cffc7cf785ad95723a0cb4/labeling/labeling-tools/bounding-box-rectangle-tool.md)的中心保持机制作为交互参考。

验收中心不漂移、反向拖动与图像四边一致，零面积拒绝沿用现有漏斗；C 连续创建可直接使用。测试扩展 `ResizeHandles.test.ts` 及 ImageStage 创建交互。

## 3. 主要实现位置

- [apps/web/src/pages/Workbench/stage/ImageStage.tsx](../../apps/web/src/pages/Workbench/stage/ImageStage.tsx)
- [apps/web/src/pages/Workbench/stage/ResizeHandles.tsx](../../apps/web/src/pages/Workbench/stage/ResizeHandles.tsx)

新增内部模块只服务本步职责；不得复制完整 Workbench/Mask/SAM/tracker 状态树。公共边界、失败语义和回滚约束沿用本文件设计及 Epic 跨步骤不变量。

## 4. 浏览器实测验收

每个里程碑必须同时具备真实浏览器交互与持久结果证据，不能用单测、截图存在或 API 成功替代整条用户路径。使用当前 worktree 的 Web/API 和经验证的一次性测试数据库；记录 URL、实际代码目录/提交、浏览器、视口、测试任务与逐项结果。正常路径不拦截业务 API；确定性 ML 夹具或人为注入的失败必须明确标注，不能称为真实模型质量验证。

按用户已确认的 Playwright Chromium 方案，通过真实点击、按键和拖动执行下表，检查相关控制台与 API 错误。新增自动化场景使用真实 Chromium 与 API，禁止用 DOM dispatchEvent 替代用户输入。涉及保存的步骤刷新后读回；涉及性能的步骤对同一数据做前后比较。

本机环境已核验：3000/8000 服务来自主工作区，3001 是 Grafana，均不能当作当前 worktree 的验收服务。本步已使用下述隔离端口完成 Chromium 实测，证据见 Outcome。A 实测使用 3010 Web / 8011 API；本步实施时重新检查端口占用并启动当前 worktree 的隔离服务。完整启动、端口覆盖与清理约定见 Epic 的“浏览器实测环境”段。

| 编号 | 操作与通过条件                                                                  | 当前结果 |
| ---- | ------------------------------------------------------------------------------- | -------- |
| H1-1 | 在图中央 Alt 向四个方向拖框，保存后的中心均等于 pointerdown；普通角点创建不变。 | 通过     |
| H1-2 | 靠近图像四边拖出界，半径对称限制，中心不漂移；零移动不创建对象。                | 通过     |
| H1-3 | 通过工具中心模式完成同样操作；拖动中松 Alt 不改变已经锁存的创建方式。           | 通过     |
| H1-4 | 回归已有 Alt 中心缩放和 Ctrl/Cmd 选 SAM 候选；C 已交付时再验证连续中心创建。    | 通过     |

## 5. 自动化检查与文档

下面列的是仓库标准命令；本机执行 E2E 时按 Epic 环境约定附加临时端口覆盖配置，不直接占用 Grafana 的 3001。只运行本步相关套件；Mask native 场景使用 `PLAYWRIGHT_RASTER_MASK_MATRIX=native`，按既有配置启用原生写入。

新增功能 spec（实施时创建）：`apps/web/e2e/tests/bbox-center-out.spec.ts`。现有 spec 只提供夹具和相邻回归，不证明本步新行为已覆盖。

```bash
pnpm --filter @anno/web test src/pages/Workbench/stage/ResizeHandles.test.ts src/pages/Workbench/stage/ImageStage.helpers.test.ts
pnpm --filter @anno/web test:e2e e2e/tests/workbench-image-konva-smoke.spec.ts --project=chromium
pnpm --filter @anno/web test:e2e e2e/tests/bbox-center-out.spec.ts --project=chromium
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

- 已提交：`5ffd4bdf`（`feat(workbench): create image boxes from their center`），正常 pre-commit 检查全部通过。

2026-09-08 完成 H1。图片普通矩形框可在按下时通过 Alt 或“画框起点 · 中心”选择中心创建。会话选项由原工作台状态持有；工具在按下时锁存选择，预览和提交共用同一几何函数，对称限制半径而不移动中心。松手使用最终指针坐标，避免最后一次 move 尚未渲染时漏掉终点。过小、零面积、类别和属性仍进入既有创建校验及保存流程；连续创建沿用同一入口。没有 API、数据库迁移、偏好持久化或版本变化。

### 浏览器验收

使用基于 `ed5a1c81` 的本 checkout Web/API，地址为 `http://127.0.0.1:3010` / `http://127.0.0.1:8011`。运行时核对 API 与 Web 进程目录分别是本 worktree 的 `apps/api`、`apps/web`。Chromium `147.0.7727.15`，视口 1440×1000、DPR 1；图片基线使用其固定 1280×800 配置。普通几何夹具为真实可访问的 64×48 SVG，保存全部走正式 API。

10:54–10:55 的批次通过 4 个新功能场景和原有图片画布基线；候选夹具修正后于 11:02–11:03 定向通过最后 1 个场景。最终同一生产实现对应 5 个功能场景加 1 个图片基线均通过，无跳过或不稳定重试；未重复已通过的四条几何路径。

| 验收 | 操作与持久证据                                                                                                                                            | 任务 ID                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| H1-1 | Alt 向四个方向拖框，保存后的中心等于真实 mousedown 位置；普通角点创建仍由起点到终点，5 个对象刷新读回一致。                                               | `6521e60d-0562-43e6-a948-d2d21805a203` |
| H1-2 | 靠近四边拖出图像，两侧半径对称受限，中心保持且几何在界内；零移动无表单、无额外写入；4 个对象刷新保留。                                                    | `66d34b14-ab38-4096-a39b-3450ca7c29a1` |
| H1-3 | 会话中心选项无需 Alt；按下后松 Alt 仍居中，后按 Alt 不改角点语义；换工具保留选项，刷新回角点，3 个对象读回一致。                                          | `dee67a11-bcc2-4da4-bbea-65e1fb8fc5a9` |
| H1-4 | 原有已保存框 Alt 手柄缩放保持中心，正式 PATCH 后进入连续创建；连续保存 3 个中心框，无额外选类，类别与 false/0 默认属性正确，刷新读回 4 个对象。           | `1cf7dd90-13dc-425b-babf-edcdf195dcce` |
| H1-4 | 保留中心选项后进入 SAM，真实工具条选择当前候选，核对其已渲染前景像素；Ctrl/Cmd 点击当前候选不新增推理提示或矩形，正式采纳第二候选并刷新读回相同原生 RLE。 | `4c22d046-5671-4f2a-bf25-adddc3822ea7` |

第一条项目 ID 为 `73829c59-ca7c-450f-9c37-74fd533e8692`。几何预期来自独立捕获的 mousedown / pointerup 事件及实际媒体变换，考虑浏览器 MouseEvent 整像素量化；未用保存结果反推预期中心。图片画布截图基线通过，并人工查看已保存的中心框渲染。

SAM 使用明确标注的确定性 setup/capabilities/inference 夹具；候选签名、采纳和内容读回均为真实 API。现有策略只解码当前原生候选，切换提示工具会取消原会话；测试按这一既有行为验证当前候选的修饰键命中，不将其描述为任意未解码候选的像素选择。各最终用例的未预期控制台、HTTP 和失败请求均为 0；换页取消的指定读取及心跳单独记录，业务写入错误不忽略。

### 检查、文档与清理

- 5 个单测文件共 96 个用例通过，覆盖中心几何、四边、普通工具/只读/草稿准入、原有缩放、创建事务与快捷键。
- 完整 Web TypeScript、E2E 定向 TypeScript、ESLint、CSS token 检查通过；最终 diff 检查通过。本地检查不代表远端 CI。
- Bbox 用户指南、工作台创建实现合同和 CHANGELOG Unreleased 同步。该会话功能没有新增数据库、API 或设置字段。
- 种子按用例清理，最终专属数据库 `annotation_workbench_0dc6_e2e` 核对所有者与零连接后删除。停止测试 Redis；Web/API 随验收退出。临时端口配置、缓存和原始报告清理，最小证据保留在本 Outcome；未改共享环境或依赖。
- 验收后提交此里程碑，实际提交记录以 Git 为准；随后继续 H2。
