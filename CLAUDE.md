# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. 提交前文档检查

**每次版本提交前，检查相关文档是否需要同步更新。**

涉及以下变更时，必须检查对应文档：
- 新增/修改 API → 检查 `docs-site/api/`、`README.md`
- 新增/修改功能 → 检查 `docs-site/user-guide/`、`CHANGELOG.md`
- 架构变更 → 检查 `docs-site/dev/`，必要时新增 ADR（`docs/adr/`）
- 环境变量变更 → 检查 `.env.example`、`DEV.md`

## 6. Plan 文件命名规范

**所有 plan 文件必须以 `yyyy-mm-dd-` 为前缀。**

示例：`2026-05-06-auth-refactor.md`、`2026-05-06-perf-optimization.md`

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## BUG 反馈查询

用户通过前端 BugReportDrawer 提交的 BUG 反馈存储在 PostgreSQL 的 `bug_reports` 表中。
由于本地 API 没有现成的认证 token，直接通过 Docker 内的 psql 查询：

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT display_id, title, severity, status, created_at FROM bug_reports ORDER BY created_at DESC LIMIT 20;"
```

如需查看完整详情（含描述、API 调用记录、console 错误等）：

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT display_id, title, description, severity, status, route, browser_ua, recent_api_calls, recent_console_errors FROM bug_reports WHERE display_id = 'B-1';"
```

---

## 项目文档索引

开发前务必阅读以下文档，了解项目全貌。

### 核心文档

- [README.md](README.md) — 仓库入口
- [DEV.md](DEV.md) — 快速参考（完整开发文档已迁移到 docs-site）
- [CHANGELOG.md](CHANGELOG.md) — 版本变更记录 + 待实现 Roadmap

### VitePress 文档站（docs-site/）

- [docs-site/user-guide/](docs-site/user-guide/) — 用户手册（标注员/管理员）
- [docs-site/dev/](docs-site/dev/) — 开发文档（架构/How-to/测试/规范）
- [docs-site/api/](docs-site/api/) — 后端 API 文档（基于 OpenAPI 自动渲染）

本地预览：`pnpm docs:dev` → http://localhost:5173

### 架构决策（docs/adr/）

- [README.md](docs/adr/README.md) — 写 ADR 的指南
- [0001-record-architecture-decisions.md](docs/adr/0001-record-architecture-decisions.md)

### 调研报告（docs/research/）

- [README.md](docs/research/README.md) — 调研报告摘要与总览
- [01-label-studio.md](docs/research/01-label-studio.md) — Label Studio 深度分析
- [02-adala.md](docs/research/02-adala.md) — Adala LLM Agent 框架分析
- [03-cvat.md](docs/research/03-cvat.md) — CVAT 深度分析
- [04-x-anylabeling.md](docs/research/04-x-anylabeling.md) — X-AnyLabeling 分析
- [05-commercial.md](docs/research/05-commercial.md) — 商业产品动向
- [06-ai-patterns.md](docs/research/06-ai-patterns.md) — AI 集成模式总结
- [07-production-capabilities.md](docs/research/07-production-capabilities.md) — 生产级能力对比
- [08-comparison-matrix.md](docs/research/08-comparison-matrix.md) — 功能对比矩阵
- [09-recommendations.md](docs/research/09-recommendations.md) — 落地建议
- [10-roadmap.md](docs/research/10-roadmap.md) — 路线图
- [11-references.md](docs/research/11-references.md) — 参考文献
