# Plans 归档约定

`docs/plans/` 下每个文件对应一次开发会话的实现计划。**Plans 是流水账与历史索引，不是知识载体。** 真正面向开发者/用户的内容必须沉淀到 `docs-site/` 与 `CHANGELOG.md`。

## 命名规范

新建 plan 文件统一使用 `<unix-seconds>_<topic>.md`，根目录和 `backlog/` 均适用：

- `unix-seconds` 为创建时的 **10 位 Unix 秒级时间戳**，可用 `date +%s` 获取；不用毫秒时间戳，也不固定以 `17` 开头。
- 时间戳与主题之间使用一个下划线 `_`；主题使用小写英文单词，以连字符 `-` 分隔，不含版本号。
- 同一秒创建不同主题的计划可以共用时间戳；若完整文件名冲突，补充能区分范围的主题词，不覆盖已有文件。
- 后续编辑、转定稿和归档保留文件名。已有日期或版本前缀的历史文件保留原名和引用，不批量迁移；旧草案转定稿时按下文规则改名。

示例：

- `1788739200_docs-deep-optimization.md`
- `1788739201_admin-feedback.md`

## 发版里程碑

计划按主题、范围、依赖和验收条件组织，不预先绑定版本号。发版里程碑、所属版本和发布时间由维护者确定；代理不得自行分配版本，也不得从文件名、计划顺序或阶段划分推导发版安排。维护者已确认的里程碑可以记录在正文，文件名仍不带版本号。

## 活跃计划与归档

`docs/plans/` 根目录保留当前实施、待批准及仍约束后续工作的计划。计划完成、废弃或被替代后可移入 `docs/plans/archive/`，并同步修正所有 Markdown 引用；不再按 minor 版本切换自动划定归档范围。维护者指定归档范围时按其要求执行。

已有归档保持原位。不能只按时间戳或日期归档：仍约束后续工作的 Epic 留在根目录，已完成、废弃或被新计划替代后再移动。

尚未排期、实施前必须重新核对仓库的研究草案放在 `docs/plans/backlog/`。这类文件不占版本号、不代表已批准实施，也不参与根目录的陈旧计划检查；开始实施前必须按 [`backlog/README.md`](backlog/README.md) 的“转定稿门”重新审计，并移动为根目录中的当前计划。不得直接照着 backlog 草案编码。

## 完成后必须执行

每个 plan 实施完成后，必须做 3 件事：

1. **在 plan 末尾追加 `## Outcome` 段**，列出已落地变更与对应正式文档路径（user-guide / dev / adr / changelog）。
2. **同步正式文档**：影响标注员/管理员/超管 → `docs-site/user-guide/`；影响开发者 → `docs-site/dev/`；架构决策 → `docs/adr/`；发版 → `CHANGELOG.md`。
3. **不要把知识只留在 plan 里**。如果一份 plan 之后没有任何正式文档更新，说明知识没有沉淀。

## `## Outcome` 段模板

```markdown
## Outcome

- 落地提交：`xxxxxxx`
- 发版里程碑：仅记录维护者已确认的安排；未确定时写“尚未确定”
- 用户文档：`docs-site/user-guide/admin/xxx.md`
- 开发文档：`docs-site/dev/troubleshooting/xxx.md`
- ADR：`docs/adr/00NN-xxx.md`
- CHANGELOG：Unreleased 条目已添加（已发版时记录实际版本）
- 未尽事项：…（移交到下一个 plan / issue / TODO）
```

## CI 守护

`docs-validate.yml` 中的 `validate` job 会扫描超过 30 天未补 `## Outcome` 段的 plan，输出 warning（不阻断合并）。如果某个 plan 注定无 outcome（探索性废案），请在文件顶部加 `> Status: abandoned` 说明。

`docs-site/scripts/check-plans-freshness.mjs` 只扫描根目录中的活跃计划，归档文件不再参与陈旧计划提醒。
