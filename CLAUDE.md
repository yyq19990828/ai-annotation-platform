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

## 6. Frontend Color Rules (prevent dark-mode breakage)

**Single source of truth: `apps/web/src/styles/shadcn.css`.**

The app now uses Tailwind CSS plus shadcn/ui tokens. Neutral surfaces, text, borders, radius, focus rings, and canvas-only theme values live under `--sc-*`. Tailwind semantic classes are mapped from those runtime tokens in `@theme inline`.

Follow these rules when writing component UI:

1. **Use semantic classes first**: prefer `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-brand`, and the fixed semantic color palette documented in `docs-site/dev/reference/design-system.md`.
2. **Use `--sc-*` in CSS modules**: remaining CSS modules may read `var(--sc-*)`; they must not read legacy `var(--color-*)` variables.
3. **No arbitrary or bare colors in className**: do not write `bg-[#...]`, `text-[rgb(...)]`, `#hex`, `rgb(...)`, or `oklch(...)` in class names. Canvas/data-domain colors and shadow/overlay-specific rgba remain narrow exceptions.
4. **Pair semantic light/dark text**: status text such as `text-rose-600` must include the matching `dark:text-rose-400` unless it is a non-text fill/dot.
5. **Dark mode is data-theme driven**: use Tailwind `dark:` classes; do not introduce a `.dark` selector.

**CI gate**: `pnpm lint` includes `node scripts/check-tw-tokens.mjs`. Run it standalone with `pnpm lint:css-tokens`.

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

## 9. Documentation Writing Style (no user-visible version numbers)

**Docs must read as the CURRENT state of the system — not as a changelog.** A reader should never see a `vX.Y.Z`-style version number in the rendered page. When you update a doc after a code change, weave the change into the prose so the page describes how things work *now*; do not leave version annotations behind — neither changelog-style prefixes nor inline provenance:

- ❌ `v1.2.3: added the foo flag`
- ❌ `## v1.2.3` as a section heading in a guide/concept doc
- ❌ `端点 X（v0.14.11）` / `**邮箱验证（v0.12.0+）**` — inline "since version" provenance in prose, headings, or tables

If version provenance genuinely matters, record it where readers don't see it — an **HTML comment** or YAML **frontmatter** (both invisible in the rendered page):

- ✅ `The foo flag controls X. <!-- since v1.2.3 -->`
- ✅ frontmatter `since: v1.2.3`

**Exempt** (version content is fine there): `CHANGELOG.md`, `docs/adr/**`, `docs-site/dev/adr/**`, generated `*.generated.md`; HTML comments and frontmatter anywhere. Version tokens without a dot are not flagged (e.g. "requires Node v18+", a `/v1/` route, "the v2 protocol").

**Advisory check (does not block):** `scripts/check-doc-version-prefix.mjs` scans changed docs (`docs-site/**`, `README.md`, `DEV.md`) for this pattern. It runs as a `pre-commit` hook (`--staged`, prints a reminder, never fails) and in the `Claude Docs Impact` PR workflow (emits `::warning::` annotations + a `style_warnings` line in the PR comment). Run standalone: `node scripts/check-doc-version-prefix.mjs --staged`.

## 10. Version Bump (keep all sources in sync)

**`CHANGELOG.md` is the source of truth for the version number.** Several other files carry a copy of it and have historically drifted (they sat stale at `0.12.x` while CHANGELOG was already at `0.17.x`). When you cut a release, bump every copy to match CHANGELOG in the same commit.

Edit by hand:
- `CHANGELOG.md` — add the new `## [x.y.z] - date` section (the truth).
- `apps/api/app/config.py` — `app_version` (single runtime source: FastAPI title version **and** `/health` both read it).
- `apps/api/pyproject.toml` — `[project].version`.
- `apps/web/package.json` — `version`.

Regenerated, do **not** hand-edit:
- `apps/api/uv.lock` — `anno-api` version: refresh via `uv lock` (or `uv sync`) after editing pyproject.
- `apps/api/openapi.snapshot.json` + `docs-site/api/openapi.json` — `info.version`: regenerated by the pre-commit hook (do not run `dump-openapi.py` manually).

Verify the running stack actually serves the new number: `curl -s localhost:8000/health` should report it.

## Parallel Subagent Worktree Rule
- When dispatching any subagent (the `Agent` tool) that will **modify code**, always pass `isolation: "worktree"` so the agent works in its own git worktree (auto-cleaned if it makes no changes).
- Read-only / search-only subagents (e.g. `Explore`, pure lookups) do **not** need a worktree.
- **When the main process spots independent, parallelizable tasks, proactively split them out and dispatch subagents to run in parallel** — don't serialize work that could run concurrently. Put the independent (dependency-free) subagent calls in a single message so they actually run concurrently.
- **A code-modifying subagent MUST commit its work as a git commit before finishing** (a real commit on its `worktree-agent-*` branch, not just leftover uncommitted changes). State this explicitly in the subagent's prompt. This lets the main process merge/cherry-pick a clean branch instead of fishing uncommitted edits out of the worktree, and makes "what did this agent change" auditable via `git log`/`git diff`. The subagent should still report its commit hash + summary back.
- **Worktree base**: code-modifying subagent worktrees branch from the current local `HEAD` (set `worktree.baseRef: "head"` in `.claude/settings.json`), so they inherit unpushed local commits. Without this they default to `origin/HEAD` and silently start stale.
- **Subagent tests/validation run in the main process**: a code-modifying subagent edits files and commits its branch; it does **not** need to run `pnpm` / `uv run` checks. Run all validation in the **main process after** the branch is merged. (The subagent may still run `git` to commit — see above.)
- **No forced testing inside a worktree (when the env isn't there)**: a worktree often lacks the running environment (Docker stack, installed deps, dev servers, DB), so don't force tests/validation to run inside it just to "prove" the change — a failure there usually means "no environment", not "broken code", and burns time chasing a false signal. **Strongly prefer merging the branch back into the pre-fork `HEAD` branch first, then test there**, where the real environment lives. If you genuinely must validate before merging, say so and confirm the env exists rather than assuming the worktree can run it.
- **Worktree path-escape guard hook**: a `PreToolUse` hook (`.claude/hooks/guard-worktree-paths.mjs`, matcher `Edit|Write|MultiEdit|NotebookEdit`) denies any file write whose resolved target escapes the worktree subtree **only when the session cwd is inside `.claude/worktrees/`** — a safety net against harness path-resolution bugs leaking subagent edits into the main repo. Bash is intentionally NOT guarded (subagents need `git commit`, and an over-broad Bash ban also wedged the main agent). The main agent (cwd = repo root) is unaffected.
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

- [docs-site/user-guide/](docs-site/user-guide/) — user manual (by function: workbench / projects / review / superadmin), audience-separated in the sidebar
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
- [12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md) — large-dataset batching strategy
- [13-simplify-tolerance-eval.md](docs/research/13-simplify-tolerance-eval.md) — mask→polygon simplify tolerance evaluation
- [14-point-cloud-image-fusion.md](docs/research/14-point-cloud-image-fusion.md) — point-cloud + image joint annotation: fusion principles, tool comparison, and platform gap analysis
- [15-annotator-performance.md](docs/research/15-annotator-performance.md) — annotator performance benchmarking: metric taxonomy from CVAT/Label Studio source + 6 commercial products, gap analysis (IAA/honeypot/project scoping/export)
