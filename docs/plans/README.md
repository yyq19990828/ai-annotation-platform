# Plans 归档约定

`docs/plans/` 下每个文件对应一次开发会话的实现计划。**Plans 是流水账与历史索引，不是知识载体。** 真正面向开发者/用户的内容必须沉淀到 `docs-site/` 与 `CHANGELOG.md`。

## 命名规范（CLAUDE.md §6）

所有 plan 文件以 `yyyy-mm-dd-` 为前缀；涉及版本以 `yyyy-mm-dd-vx.y.z-` 为前缀。

示例：

- `2026-05-08-docs-deep-optimization.md`
- `2026-05-08-v0.9.10-admin-feedback.md`

## 活跃计划与归档

`docs/plans/` 根目录只保留当前 minor 版本及尚未被替代的无版本 Epic / 草案。开始下一个 minor 版本时，把此前 minor 及更早的版本计划移入 `docs/plans/archive/`，并同步修正所有 Markdown 引用。

当前归档线包含 v0.24.x 及以前的版本计划。无版本号文件不能只按日期归档：仍约束后续版本的 Epic 留在根目录，已完成、废弃或被新计划替代后再移动。

尚未排期、实施前必须重新核对仓库的研究草案放在 `docs/plans/backlog/`。这类文件不占版本号、不代表已批准实施，也不参与根目录的陈旧计划检查；开始实施前必须按 [`backlog/README.md`](backlog/README.md) 的“转定稿门”重新审计，并移动为根目录中的当前计划。不得直接照着 backlog 草案编码。

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

`docs-validate.yml` 中的 `validate` job 会扫描超过 30 天未补 `## Outcome` 段的 plan，输出 warning（不阻断合并）。如果某个 plan 注定无 outcome（探索性废案），请在文件顶部加 `> Status: abandoned` 说明。

`docs-site/scripts/check-plans-freshness.mjs` 只扫描根目录中的活跃计划，归档文件不再参与陈旧计划提醒。
