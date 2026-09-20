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
