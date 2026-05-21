# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 0. Write in English

**All content in this file (CLAUDE.md) must be written in English.** Do not mix in other languages. This rule applies only to CLAUDE.md itself — other docs, code comments, and commit messages follow the project's existing conventions, and replying to the user in their language is fine.

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

## 5. Pre-Commit Documentation Check

**Before every versioned commit, check whether related docs need to be updated in sync.**

When the following changes occur, you must check the corresponding docs:
- Added/changed API → check `docs-site/api/`, `README.md`
- Added/changed feature → check `docs-site/user-guide/`, `CHANGELOG.md`
- Architecture change → check `docs-site/dev/concepts/`, add an ADR if needed (`docs/adr/`)
- Environment variable change → update `.env.example`, run `pnpm docs:gen-env-vars`, check `DEV.md`

## 6. Frontend Color Token Rules (prevent dark-mode breakage)

**Single source of truth: `apps/web/src/styles/tokens.css`.**

The shared root cause of past bugs B-32/B-36/B-38/B-39: component CSS used variable names that "felt right" but didn't exist (`var(--color-text, #1f2937)`, `var(--color-primary, ...)`); the browser couldn't find them and fell back to a hardcoded light color → unreadable in dark mode.

Follow 3 hard rules when writing component CSS:

1. **No inventing names on the spot**: only use `--color-*` already defined in `tokens.css`. If you need a new semantic, first add both light + dark definitions in `tokens.css`, then use it.
2. **No fallbacks**: never write `var(--color-foo, #xxx)` / `var(--color-foo, rgba(...))`; write `var(--color-foo)` directly. A fallback is a back door for invented names and silently reverts to light when a token is renamed.
3. **No hardcoded colors**: don't write `#hex` / `rgb()` / `oklch()` in component CSS (shadow / overlay-specific rgba are exceptions). All colors come from tokens.

**CI gate**: `pnpm lint` includes `node scripts/check-css-tokens.mjs`, which scans all `apps/web/src/**/*.css` and fails on violations of rule 1 or 2; run it standalone with `pnpm lint:css-tokens`.

**Compatibility aliases**: the bottom of `tokens.css` maintains a set of legacy aliases (e.g. `--color-primary` → `--color-accent`), kept only for historical CSS compatibility. New code should use the canonical names on the right.

## 7. Plan File Naming Convention (in /plan mode)

**All plan files must be prefixed with `yyyy-mm-dd-`. If version-related, prefix with `yyyy-mm-dd-vx.y.z`.**

Examples: `2026-05-06-auth-refactor.md`, `2026-05-06-perf-optimization.md`

## 8. Docker: rebuild vs restart

**Rule of thumb: if the change lives inside the image, rebuild. If it lives in a mounted volume, just restart (or do nothing).**

### No rebuild needed (restart only, or hot-reload)

| Change | Action |
|---|---|
| Python business code under `apps/api/**` incl. `app/**` and `alembic/**` | dev API runs on host (`uvicorn --reload`) and auto-reloads. Since v0.10.25 the Celery `worker`/`beat` mounts `./apps/api:/app` source into the container (deps installed with `--system`, not under `/app`; an anonymous volume `/app/.venv` shadows the host venv), so **editing worker business code / adding an alembic migration only needs `docker restart`, no rebuild**. Celery has no `--reload`, so you still must restart after editing code. |
| Frontend `apps/web/src/**` with vite dev server | HMR handles it |
| Runtime env vars in `.env` | `docker compose up -d` (recreates container, does not rebuild image) |
| DB schema changes via alembic | `docker exec ... alembic upgrade head` |

### Rebuild required (`docker compose build` or `up --build`)

| Change | Reason |
|---|---|
| `pyproject.toml` / `uv.lock` / `requirements.txt` | Dependencies are baked into image layers |
| `package.json` / `pnpm-lock.yaml` | Same |
| `Dockerfile`, `.dockerignore` | Build steps changed |
| Base image version (`FROM python:3.x`) | Base layer changed |
| `docker-compose.yml` `build:` block, build args, `COPY` paths | Build context changed |
| Code is NOT volume-mounted (production-style image with `COPY` of source) | Image holds a frozen snapshot |

### Quick reference

```bash
# Business code only (dev with volume mount)
docker restart ai-annotation-platform-celery-worker-1

# Dependency or Dockerfile change
docker compose build celery-worker && docker compose up -d celery-worker

# Verify the running container actually has the latest code
docker exec ai-annotation-platform-celery-worker-1 \
  python -c "import inspect, app.workers.tasks as t; print(inspect.signature(t.batch_predict))"
```

**Common pitfall:** Celery workers silently run stale code after editing a task signature, because Celery has no `--reload` equivalent. Symptom is dispatch-time `TypeError` on new kwargs while source on disk looks correct. Always restart the worker container after editing files under `apps/api/app/workers/`.

## Parallel Subagent Worktree Rule
- When dispatching any subagent (the `Agent` tool) that will **modify code**, always pass `isolation: "worktree"` so the agent works in its own git worktree (auto-cleaned if it makes no changes).
- Read-only / search-only subagents (e.g. `Explore`, pure lookups) do **not** need a worktree.
- **When the main process spots independent, parallelizable tasks, proactively split them out and dispatch subagents to run in parallel** — don't serialize work that could run concurrently. Put the independent (dependency-free) subagent calls in a single message so they actually run concurrently.
- **A code-modifying subagent MUST commit its work as a git commit before finishing** (a real commit on its `worktree-agent-*` branch, not just leftover uncommitted changes). State this explicitly in the subagent's prompt. This lets the main process merge/cherry-pick a clean branch instead of fishing uncommitted edits out of the worktree, and makes "what did this agent change" auditable via `git log`/`git diff`. The subagent should still report its commit hash + summary back.
- **Worktree base**: code-modifying subagent worktrees branch from the current local `HEAD` (set `worktree.baseRef: "head"` in `.claude/settings.json`), so they inherit unpushed local commits. Without this they default to `origin/HEAD` and silently start stale.
- **Path-escape guard**: a `PreToolUse` hook (`.claude/hooks/guard-worktree-paths.mjs`, matcher `Edit|Write|MultiEdit`) denies any write whose resolved target escapes the session cwd **when that cwd is inside `.claude/worktrees/`** — a safety net against harness path-resolution bugs leaking subagent edits into the main repo. The main agent (cwd = repo root) is unaffected and can still write outside the repo (auto-memory, global config).
- **After a subagent's branch is merged back into the main branch, remember to delete its local worktree** (`git worktree remove <path>`, plus `git worktree prune` and deleting the `worktree-agent-*` branch if needed) to avoid piling up locked leftovers under `.claude/worktrees/`.

## Keep Docs in Sync
- When code changes affect documented behavior, update the relevant docs **in the same change** — not in a follow-up.
- Removed/renamed symbols → grep all `*.md` for the old name and fix every reference. Stale doc links are bugs.
---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## BUG Report Queries

BUG reports submitted by users via the frontend BugReportDrawer are stored in the PostgreSQL `bug_reports` table.
Since the local API has no ready-made auth token, query directly via psql inside Docker:

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT display_id, title, severity, status, created_at FROM bug_reports ORDER BY created_at DESC LIMIT 20;"
```

To view full details (including description, API call log, console errors, etc.):

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT display_id, title, description, severity, status, route, browser_ua, recent_api_calls, recent_console_errors FROM bug_reports WHERE display_id = 'B-1';"
```
For frontend bugs, make good use of the chrome devtools MCP to inspect recent API calls and console errors to help locate the problem.
---

## Project Documentation Index

Read the following docs before development to understand the whole project.

### Core Docs

- [README.md](README.md) — repository entry point
- [DEV.md](DEV.md) — quick reference (full dev docs have moved to docs-site)
- [CHANGELOG.md](CHANGELOG.md) — version change log + planned Roadmap

### VitePress Documentation Site (docs-site/)

Organized by the [Diátaxis](https://diataxis.fr/) framework, layered by role × task.

- [docs-site/user-guide/](docs-site/user-guide/) — user manual (by role: for-annotators / for-project-admins / for-reviewers / for-superadmins)
- [docs-site/dev/](docs-site/dev/) — dev docs (tutorials / concepts / how-to / reference / troubleshooting)
- [docs-site/ops/](docs-site/ops/) — deployment & ops (deploy / observability / security / runbooks)
- [docs-site/api/](docs-site/api/) — backend API docs (auto-rendered from OpenAPI)

Key paths:
- Architecture docs: `docs-site/dev/concepts/` (formerly `dev/architecture/`)
- Protocol specs: `docs-site/dev/reference/` (includes env-vars.md / ml-backend-protocol.md)
- Environment variable changes → update `.env.example` in sync, then run `pnpm docs:gen-env-vars` to regenerate `dev/reference/env-vars.md`

Local preview: `pnpm docs:dev` → http://localhost:5173

### Architecture Decisions (docs/adr/)

- [README.md](docs/adr/README.md) — guide to writing ADRs
- [0001-record-architecture-decisions.md](docs/adr/0001-record-architecture-decisions.md)

### Research Reports (docs/research/)

- [README.md](docs/research/README.md) — research report summaries and overview
- [01-label-studio.md](docs/research/01-label-studio.md) — Label Studio deep dive
- [02-adala.md](docs/research/02-adala.md) — Adala LLM Agent framework analysis
- [03-cvat.md](docs/research/03-cvat.md) — CVAT deep dive
- [04-x-anylabeling.md](docs/research/04-x-anylabeling.md) — X-AnyLabeling analysis
- [05-commercial.md](docs/research/05-commercial.md) — commercial product trends
- [06-ai-patterns.md](docs/research/06-ai-patterns.md) — summary of AI integration patterns
- [07-production-capabilities.md](docs/research/07-production-capabilities.md) — production-grade capability comparison
- [08-comparison-matrix.md](docs/research/08-comparison-matrix.md) — feature comparison matrix
- [09-recommendations.md](docs/research/09-recommendations.md) — adoption recommendations
- [10-roadmap.md](docs/research/10-roadmap.md) — roadmap
- [11-references.md](docs/research/11-references.md) — references
