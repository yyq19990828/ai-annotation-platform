# 0023 — ProjectTemplate 与 "从已有项目复制" 并存

- **Status:** Accepted
- **Date:** 2026-05-18
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.10.11 已落「从已有项目复制配置」轻量形态（projects.py 中 `_CLONEABLE_PROJECT_FIELDS` 16 字段）—— 即「项目级一次性快照」：复制时刻把字段 deepcopy 进新项目，源项目后续改动不影响新项目，也无法跨组织共享。

ROADMAP §A「项目模板」长期项的目标是支持独立资产形态：模板可无源项目（手工建）、可跨组织共享、可被多个新项目引用并统计 usage。该决策由 2026-05-18 用户决定开做（独立 PR，~5-7d）。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A：保留 clone + 新增 ProjectTemplate 表** | 两种形态语义清晰；clone 链路 80% 场景保持兼容 | 字段同步两处；wizard 出现 3 个入口（从零 / 复制 / 模板） |
| B：把 clone 升级为 template 表自动写入 | 单一通路、概念精简 | clone 是匿名一次性, 强行落表会污染数据；批量旧项目回填工作量大 |
| C：仅 clone, 不做模板 | 0 改造 | 跨项目复用 / 跨组织共享 / usage 统计无法做 |

## Decision

**采用方案 A**：保留 v0.10.11 的 clone 链路不变，新增 `project_templates` 独立表。

实现要点：

- 表结构见 `apps/api/alembic/versions/0068_project_templates.py`；含 scope (`private` / `organization` / `public`)、organization_id (CASCADE)、created_by、source_project_id (SET NULL)、usage_count、display_id (`PT-N` 序列)、annotation_guide（Markdown 文本）；**不存** `guide_assets`（storage key 跨实例引用混乱、源项目删 asset 会让所有依赖模板的项目失效）。
- 共享白名单 `CLONEABLE_PROJECT_FIELDS` 抽到 `apps/api/app/services/project_clone.py`，由 projects + project_templates 两条链路共用。
- `ProjectCreate` 新增 `template_id: UUID | None`，与 `source_project_id` **互斥**（pydantic `model_validator` 校验，违反返 422）。
- 应用模板时把模板载荷 deepcopy 进 payload + 模板 `usage_count + 1`。
- 可见性：private 仅 `created_by`，organization 同组织成员，public 全部。Public 仅 `super_admin` 可创建。
- 编辑 / 删除权限：`created_by` 或 `super_admin`（首版不引入 org admin，KISS）。

## Consequences

正向：

- 模板可被多个项目共享 + usage_count 统计带运营信号。
- 与 clone 链路并存，clone 链路（v0.10.11 引入）继续承载 80% 场景，不强迫迁移。
- annotation_guide 整合：模板携带 markdown 文本但不携带 guide_assets，符合 [[v0.10.13 · E1 · annotation-guide]] 的资源隔离原则。
- 单一白名单 `CLONEABLE_PROJECT_FIELDS` 避免字段漂移（之前散落 projects.py 一份，未来再加同名字段时只需改一处）。

负向：

- 用户认知成本：Wizard 出现 3 个入口（从零 / 复制 / 模板），需要文档/UI 文案明确边界。
- 模板字段集合冻结到 v0.10.14 时刻；新增 Project 列 → 同步加到 `CLONEABLE_PROJECT_FIELDS` + 模板表迁移；漏改不会 break，但会让模板不携带新字段。
- guide_assets 跨项目复用没做（Stage 2 触发条件：客户大量在 guide 中用图且需要跨项目复用，再用 worker 异步 deepcopy 到新项目 storage namespace）。

## Alternatives Considered（详）

**方案 B（把 clone 升级为 template 自动写入）**：每次复制都自动落一行 ProjectTemplate。问题：clone 是匿名 / 一次性快照，自动落表会产生大量「无意义模板」（usage_count=1 的临时项）。即使加 `is_anonymous` flag 抹掉，UX 也别扭。否决。

**方案 C（不做模板）**：用户的 SaaS / 跨组织共享 / 公共模板需求无解。否决。

## Notes

- 实现代码位置：
  - 后端：`apps/api/app/db/models/project_template.py`、`apps/api/app/schemas/project_template.py`、`apps/api/app/api/v1/project_templates.py`、`apps/api/app/services/project_template.py`、`apps/api/app/services/project_clone.py`。
  - 迁移：`apps/api/alembic/versions/0068_project_templates.py`。
  - 前端：`apps/web/src/pages/ProjectTemplates/`、`apps/web/src/api/projectTemplates.ts`、`apps/web/src/hooks/useProjectTemplates.ts`、`apps/web/src/components/projects/CreateProjectWizard.tsx`（新增 templateId 入口）。
- 相关 ROADMAP / ADR：ROADMAP §A「项目模板」、[[v0.10.13 annotation-guide]]。
- 后续可能演进：
  - guide_assets 跨项目 deepcopy（Stage 2）—— 触发条件：E1 反馈表明客户在 guide 中大量用图且确需跨项目复用。
  - 模板版本号 / changelog —— 首版不做，PATCH 直接覆盖。
  - organization scope 的 admin 提交 public 模板审核流 —— 首版仅 super_admin 可建 public。
