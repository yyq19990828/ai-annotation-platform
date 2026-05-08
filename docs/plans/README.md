# Plans 归档约定

`docs/plans/` 下每个文件对应一次开发会话的实现计划。**Plans 是流水账与历史索引，不是知识载体。** 真正面向开发者/用户的内容必须沉淀到 `docs-site/` 与 `CHANGELOG.md`。

## 命名规范（CLAUDE.md §6）

所有 plan 文件以 `yyyy-mm-dd-` 为前缀；涉及版本以 `yyyy-mm-dd-vx.y.z-` 为前缀。

示例：

- `2026-05-08-docs-deep-optimization.md`
- `2026-05-08-v0.9.10-admin-feedback.md`

## 完成后必须执行

每个 plan 实施完成后，必须做 3 件事：

1. **在 plan 末尾追加 `## Outcome` 段**，列出已落地变更与对应正式文档路径（user-guide / dev / adr / changelog）。
2. **同步正式文档**：影响标注员/管理员/超管 → `docs-site/user-guide/`；影响开发者 → `docs-site/dev/`；架构决策 → `docs/adr/`；发版 → `CHANGELOG.md`。
3. **不要把知识只留在 plan 里**。如果一份 plan 之后没有任何正式文档更新，说明知识没有沉淀。

## `## Outcome` 段模板

```markdown
## Outcome

- 落地版本：vX.Y.Z（commit `xxxxxxx`）
- 用户文档：`docs-site/user-guide/admin/xxx.md`
- 开发文档：`docs-site/dev/troubleshooting/xxx.md`
- ADR：`docs/adr/00NN-xxx.md`
- CHANGELOG：vX.Y.Z 条目已添加
- 未尽事项：…（移交到下一个 plan / issue / TODO）
```

## CI 守护

`docs.yml` 中的 `validate` job 会扫描超过 30 天未补 `## Outcome` 段的 plan，输出 warning（不阻断合并）。如果某个 plan 注定无 outcome（探索性废案），请在文件顶部加 `> Status: abandoned` 说明。

## 索引页

`docs-site/dev/plans-index.md` 由 `docs-site/scripts/extract-completed-plans.mjs` 从本目录自动生成（每次 `pnpm docs:build` 触发），列出所有已完成 plan 的标题、日期与 outcome 摘要。
