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

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## 项目文档索引

开发前务必阅读以下文档，了解项目全貌。

### 核心文档

- [DEV.md](DEV.md) — 项目结构、技术栈、快速启动、开发指南
- [CHANGELOG.md](CHANGELOG.md) — 版本变更记录 + 待实现 Roadmap

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
