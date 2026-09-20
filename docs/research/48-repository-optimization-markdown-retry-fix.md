# 仓库优化 P9 Markdown 表格单元格图片重试：原因分析与最小边界

> 完成日期：2026-09-20 · 隶属 P9 同候选全域执行的 markdown 缺陷通道
> 分支：`worktree-agent-opt-p9-markdown-fix`（自冻结候选 `dc972be08` 建立；原 doc46 分支 `worktree-agent-opt-p9-domains` 保留）
> 状态：**原因分析完成、修复未实施**（等待 root 授权 + 旧 e2e 模式诊断占用解除）
> 证据图例：**[V]** 已核对；**[HYP]** 代码一致的机制假设，尚未复现

## 1. 失败事实 **[V]**

来源：`/tmp/opencode/p9-default-1-preview.json`（expected 79 / unexpected 2 / duration 445.6s）与 `/tmp/opencode/p9-default-1-preview.log`。

- 目标用例：`apps/web/e2e/tests/markdown-authoring.spec.ts:777`「a failed table-cell image upload retries inside the same cell」。
- 失败点：第 815 行点击错误面板「重试」后，第 816 行 `targetCell.getByRole("img", { name: "表格重试.png" })` 在 15s 内 **not found**（不是可见性超时后的错误提示，而是元素不存在）。
- 失败发生在**另一 worktree**（日志中的 trace/error-context/screenshot 指向 `ai-annotation-platform-worktree-agent-opt-p7`，该目录当前已不存在对应产物），因此我没有可用的 DOM 快照；未臆造证据。
- 同 run 的另一失败（`employee-project-roles.spec.ts`）属 P9 owner 的 fixture，未触碰。

## 2. 代码路径与机制 **[V]/[HYP]**

`apps/web/src/components/markdown/MarkdownEditor.tsx`：

1. `retryUpload(id)`（~944-1007）先尝试「原位重试」，条件为 `existing.failed && existing.nodeKey && existingEditor && rootRef.contains(existingRoot)` 且在该编辑器状态中 `$getNodeByKey(nodeKey)` 仍是 src 匹配的 ImageNode（~969-983）。
2. 条件不成立时走「取消并重插」分支：新建 pending（新 placeholder source）并调用 `insertPlaceholderAtAnchor`（~985-1005）。
3. `insertPlaceholderAtAnchor`（~920-942）完全依赖 `pending.anchor.before/after` 在**根 markdown** 中定位插入点；两段文本都找不到时**追加到文档末尾**。
4. `anchor` 在错误发生时由根 markdown 惰性推导（`handleEditorChange` 内 ~1030 → `pendingImageAnchor` ~267-280）。
5. 表格单元格是独立嵌套 Lexical 编辑器，编辑经 `TABLE_CELL_DRAFT_SYNC_DELAY_MS = 250` 的 debounce 才导出到根 markdown（~300 起）。

**机制假设 [HYP]**：表格单元格上传失败后，待定 ImageNode 位于嵌套单元格编辑器内；当重试时持有的 editor/nodeKey 已非活体（根同步/单元格重建后），`retryUpload` 落入取消重插分支；此时根 markdown 可能尚未包含该 pending 标记（或 anchor 已不可定位），于是占位符被追加到表格之外，图片不会出现在 `targetCell` 内——与「元素不存在」完全吻合；同时第 10 步保存断言（要求图片落在「新前/后」之间）也会失败。

**未能确证的环节**：retryInPlace 判定为何失效（stale nodeKey 还是 editor 被重建）、以及 anchor 是否确实缺失；需要活体复现（单元或 E2E）。

## 3. 最小边界（待授权） **[V]**

- 允许改动：仅 `MarkdownEditor.tsx` 的重试路径（表格单元格原位判定 / 嵌套编辑器的 anchor 推导），如需可加直接 markdown-owned helper；测试仅 `MarkdownEditor.test.tsx` + 报告中单条 E2E。**不做**样式/无关改写、不放宽断言、不加 sleep/超时/重试兜底、不改 skip/retry。
- 修复前必须复现（test-first：先失败后通过），并保留失败上传→同格重试→图片→保存/重载断言，以及输入/撤销/组合输入/选区契约。
- 复现需要：root 确认 seed 清理诊断（ctx e822 / term 2726）已完成只读取证 → 我以自有 launcher 清理旧模式并用已验证共享产物 `253b54a0`（SHA `754d61b9`）+ 预览配置重建一次性模式；若改产品源码则**重新构建**本模式 e2e 产物，绝不复用旧产物声称已修复。

## 4. 本地已执行（无需 DB） **[V]**

- `pnpm vitest run src/components/markdown/MarkdownEditor.test.tsx` → **7 passed**（既有纯 helper 覆盖，不含富文本表格重试路径）。
- 未有任何源码改动；`git status` 干净。

## 5. 当前阻塞

1. root 授权实际修复（本通道只做诊断，未获授权不写产品代码）。
2. 旧 `de57` e2e 模式被 seed 清理诊断线程占用，禁止 mutate/cleanup/reset/destroy 或在其上跑浏览器。

## 6. 边界

无性能/资格声明；未做宽泛单测/后端/文档复跑；未 push；未触碰其他 worker 的共享产物与临时目录。

---

## 7. 复现确认与修复（本通道最终结果）

**复现 [V]**：在全新自有 e2e 模式（一次性库、共享产物 `253b54a0`、预览配置）上以 `--repeat-each=3 --retries=0` 运行单测用例，**3 次中 1 次失败**（第 3 次，18.2s）；失败时的 error-context DOM 快照**直接证明**：`img "表格重试.png"` 确实存在（alt 已正确解析），但位于目标表格行/单元格**之外**。当时把该现象归因为「重试落入『取消并重插』分支后 anchor 缺失、占位符被追加到文档末尾」；该归因在 §9 被探针证据推翻（图片在重试之前就已经落在表格之外）。此前单测与整文件运行各 1 次通过，说明该缺陷是**间歇性时序缺陷**，而非稳定复现。

**最小修复 [V]**（仅 `apps/web/src/components/markdown/MarkdownEditor.tsx` 的 `retryUpload`）：在判定「原位重试」之前调用既有的 `flushActiveTableCell()`，先把活动表格单元格的待定 ImageNode 导出/可见化，使重试能命中现有节点并走原位调和路径；不改变任何断言、超时或重试策略，不新增 sleep。该改动只影响重试的归属判定顺序，不改变成功/失败语义。

**验证 [V]**：

- 修复前（同一构建产物）：`--repeat-each=3` → 2 passed / 1 failed（退出码 1）。
- 修复后（源码经 dev server）：`--repeat-each=3` → 3 passed；`--repeat-each=6` → 6 passed；连续 9/9 通过，退出码 0。
- `MarkdownEditor.test.tsx` 7 passed；`tsc --noEmit` 干净。

**边界 [GAP]**：修复后的**预览产物**（preview-artifact）E2E 需针对修正代码**重新构建** e2e 产物后运行；本通道未把旧产物 `253b54a0` 的结果当作修复证据。未改动 skip/retry、未放宽断言、未触碰其他 worker 路径。

## 9. 生产路径复核：真实根因是「粘贴归属」而非重试判定 [V]

**复核动机**：§7 的 flush 修复在重现生产预览产物后仍失败 3/3；此后 `f5b5bf049` 记录曾在生产预览 3/3 通过，但其中的「无可用锚点即原位重试」分支被 root 以「无锚点不等于活体节点，可能重传已删除节点」为由拒绝。为确认真实原因，本次在**最终源码上加入临时诊断探针**并针对新构建的预览产物重复运行取证；结论与 §7 / 旧 §9 的假设均不同。

**真实根因 [V]**：图片粘贴 / 拖放发生在表格单元格刚获得焦点、但浏览器 `selectionchange` 尚未把「活动编辑器」归属给嵌套单元格的窗口内。MDXEditor 的 PASTE / DROP 处理器注册在「最近一次发布 `SELECTION_CHANGE_COMMAND` 的编辑器」上；此刻它仍是根编辑器，于是 `ImageNode` 被插入根编辑器，直接渲染在表格之外。失败 run 的探针为 `MD_BEGIN_UPLOAD {activeIsCell:false}` → `MD_RECONCILE_OWNER {isCell:false, parentTag:"DIV"}`；通过 run 为 `MD_BEGIN_UPLOAD {activeIsCell:true}` → `MD_RECONCILE_OWNER {isCell:true, parentTag:"TD"}`。也就是说 `retryUpload` 的重试判定一直正确（三组探针均为 `retryInPlace:true`），越界在**粘贴落点**时已经确定；旧 §9 把根因归到重试分支的说法不成立。

**最终修复**（`apps/web/src/components/markdown/MarkdownEditor.tsx`，不再改动其他文件）：

1. 在根容器**捕获阶段**监听 `paste` / `drop`，用 Lexical 的 `getNearestEditorFromDOMNode(event.target)` 找到事件目标真正所属的编辑器；若它是本编辑器内、且尚未成为活动编辑器的嵌套表格单元格，则 `dispatchCommand(SELECTION_CHANGE_COMMAND)`，让 MDXEditor 的 active-editor 订阅在它处理粘贴 / 拖放之前先完成归属。仅 `focus()` 不会对未变更的 range selection 重新派发该命令，这正是归属缺失的原因。
2. 保留一处最小重试稳健性：当记录的 `editor/nodeKey` 已失效、但当前文档仍含该上传标记时，原位复用现有 pending，而不是按锚点重插。

未新增 sleep、未放宽断言、未改动跳过 / 超时 / 重试策略。

**负向对照 [V]**：临时停用上述 `SELECTION_CHANGE_COMMAND` 归属（仅源码一处改动）后重新构建，新增回归用例 `markdown-authoring.spec.ts:837`（同一任务内 `focus()` + 派发粘贴，强制制造归属竞态）以 `--retries=0 --repeat-each=3` 运行 → **3 failed**；恢复该行后同一用例 → **3 passed**。证明该用例确实覆盖此缺陷。

**生产构建验证 [V]**：最终源码（HEAD `f5b5bf049` + 本次修复）经 `OPENAPI_URL=apps/api/openapi.snapshot.json` 执行 `pnpm build --mode e2e`（`BUILD_EXIT=0`），产物指纹 `f425d402…`、tar sha256 `35cf2671…`（与旧 `8f20a72d…` / `94727c15…` 明确不同；恢复修复后重建指纹可复现为同一 `f425d402…`）；`pnpm openapi:check` 通过（快照与当前路由一致）；经 `playwright.preview.e2e.config.ts`、`--retries=0`、`--repeat-each=3` 运行 `markdown-authoring.spec.ts:777`：**3 passed，退出码 0**；同一产物运行整份 `markdown-authoring.spec.ts`（19 用例）：**19 passed，退出码 0**（含失败保存重试、源码模式重试、撤销 / 取消上传、表格粘贴，以及本次新增的「同一任务内 focus + 粘贴归属」与「删除失败待重试图片后不再重传」用例）。

**负向语义保持 [V]**：新增 `markdown-authoring.spec.ts:889`「删除失败的表格图片后取消重试且不再重传」：`--retries=0 --repeat-each=3` → **3 passed**，确认删除待重试节点的取消路径未被本次修复破坏（未新增 sleep / 超时 / 重试放宽）。

**证据链（保留原始失败，不追认早期通过）**：初始预览 2/3 失败 → dev 9/9（非验收）→ flush 修复生产预览 3/3 失败 → `f5b5bf049` 记录预览 3/3 通过（含已被拒绝的无锚点捷径；本次以相同产物时机重复观察到 1/3~2/3 失败，说明该次通过具有偶然性）→ 本次复核证实粘贴归属竞态 → 修复后生产预览 3/3 通过，且负向对照 3/3 失败。
