# Repository instructions

`AGENTS.md` links to this file. Keep that link and maintain one shared set of instructions. Write this file in English; replies may use the user's language, and other files follow project conventions.

## Execution and decisions

- Complete the requested outcome, including implementation, relevant docs, and verification. For multi-step work, state a brief plan with observable success criteria; execute small tasks directly.
- Resolve routine, reversible choices from context and state consequential assumptions. Ask only when missing information materially changes correctness, scope, or authorization; continue independent work meanwhile.
- Carry existing authorization forward. If approval is still needed, first prepare the authorized work for review. Do not add approval steps for hypothetical risks.
- Subject to system and developer instructions, explicit user requests override this file and skill guidance. If a skill blocks progress, cite its exact file and instruction and explain why it applies.
- Incorporate corrections and answer side questions while retaining the active objective, unless the user cancels or replaces it.
- Report the result first, then relevant validation and remaining limitations. Use concise, plain language and readable agent messages; avoid repetitive updates and unnecessary formatting.

## Understand before editing

- Read the affected code and relevant docs. Trace callers and shared behavior before fixing a bug; fix the cause where the affected paths converge.
- Design for extensibility as well as current requirements. Reuse existing helpers, patterns, standard libraries, and installed dependencies when they fit; the smallest implementation is not always the preferred design.
- Over-engineering is allowed to expand capabilities: introduce forward-looking abstractions, extension points, modular layers, and configuration even before multiple implementations or consumers exist. Briefly explain which extensions the design enables and its maintenance cost.
- Keep added complexity connected to extension goals. Preserve compatibility, required validation, security, accessibility, and protection against data loss.
- Refactoring and structural changes needed for the intended extension architecture are in scope. Match existing style, preserve unrelated work, and remove only imports, variables, or functions made unused by your changes. Mention relevant unrelated problems without silently fixing them.
- Use `rg` / `rg --files` for focused searches. Read the documentation index below as a routing map, not a requirement to load every document.

## Verification and completion

- Use checks that exercise changed behavior. For bugs and non-trivial logic, add or adapt the smallest meaningful regression check using existing test infrastructure.
- For low-impact edits, inspect the diff and run applicable lightweight checks. Do not add tests that merely repeat the implementation.
- Run required checks. Expand or repeat validation only after changes, failures, or unresolved concerns.
- Check `git diff --check` and review the final diff for accidental changes. Distinguish passing checks from checks blocked by missing dependencies or services; never claim unrun checks passed.
- The task is complete when the requested behavior, related docs, and relevant checks are handled. Report any remaining blocker precisely.

## Parallel subagents and worktrees

- Proactively delegate independent, bounded tasks when parallel work saves time or improves quality. Dispatch independent tasks together and keep useful work in the main process. Avoid duplicating the same investigation.
- Read-only agents can share the checkout. Every code-modifying agent must have a separate worktree based on the current local `HEAD`, including unpushed commits.
- Use native worktree isolation when available: in Claude Code, `isolation: "worktree"` and `.claude/settings.json` with `worktree.baseRef: "head"`. Otherwise, create the worktree explicitly before dispatch, give the agent its absolute path, and require all edits there. If isolation cannot be provided, do the edits in the main process.
- Give each modifying agent a bounded scope and require a real commit on its `worktree-agent-*` branch before finishing. Its report must include the commit hash and summary.
- The main process integrates those commits into the originating branch and runs validation in the environment that has the dependencies and services. Do not force `pnpm` / `uv run` checks in unequipped agent worktrees; verify that an environment exists if checks must run before integration.
- `.claude/hooks/guard-worktree-paths.mjs` guards edit-tool writes only for Claude sessions inside `.claude/worktrees/`; it does not guard shell writes or other runtimes. Keep every agent's writes inside its assigned worktree regardless of hook coverage.
- After successful integration, remove only the task's clean worktrees and merged branches with `git worktree remove`, `git worktree prune`, and `git branch -d`. Preserve unmerged or uncommitted work.

## Frontend theme rules

The token source is `apps/web/src/styles/shadcn.css`; the palette reference is [design-system.md](docs-site/dev/reference/design-system.md). Tailwind semantic classes map to runtime `--sc-*` tokens through `@theme inline`.

1. Prefer semantic classes such as `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, and `text-brand`.
2. CSS modules may read `var(--sc-*)`, never legacy `var(--color-*)` variables.
3. Do not put arbitrary or bare colors in `className`, including hex, `rgb(...)`, or `oklch(...)`. Canvas/data-domain colors and shadow/overlay-specific rgba are narrow exceptions.
4. Use theme-aware status utilities such as `text-status-danger bg-status-danger-soft`. Status tokens already cover both themes; do not substitute paired hue classes such as `text-rose-600 dark:text-rose-400`.
5. Dark mode uses `data-theme` and Tailwind `dark:` variants. Do not introduce a `.dark` selector.

`pnpm lint` includes the token gate. Run it separately with `pnpm --filter @anno/web lint:css-tokens` (`apps/web/scripts/check-tw-tokens.mjs`).

## Documentation and changelog

Before each commit, check documentation impact and update affected docs in the same change:

| Change                      | Documentation to check or update                                    |
| --------------------------- | ------------------------------------------------------------------- |
| API                         | `docs-site/api/`, `README.md`                                       |
| Feature or user-visible fix | `docs-site/user-guide/`, `CHANGELOG.md`                             |
| Architecture                | `docs-site/dev/concepts/`; add an ADR in `docs/adr/` when warranted |
| Environment variable        | `.env.example`, then `pnpm docs:gen-env-vars`; check `DEV.md`       |
| Removed or renamed symbol   | Search all `*.md` for its old name and fix affected references      |

Docs describe the current system. Do not expose `vX.Y.Z` provenance in rendered prose, headings, or tables; use HTML comments or YAML frontmatter if needed. Exceptions: `CHANGELOG.md`, `docs/adr/**`, `docs-site/dev/adr/**`, and `*.generated.md`. Undotted versions such as Node v18+, `/v1/` routes, and the v2 protocol are allowed.

`node scripts/check-doc-version-prefix.mjs --staged` is advisory, not a blocking gate.

`CHANGELOG.md` follows Keep a Changelog 1.1.0:

- Put routine features and user-visible fixes under the top `## [Unreleased]` in the same commit as the change. Pure refactors, tests, formatting, and other work with no user impact may skip an entry.
- Group entries in this order, omitting empty groups: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` (level-three headings).
- Explain what changed and why it matters; a fix names the user-visible symptom. Keep released sections newest first as `## [x.y.z] - YYYY-MM-DD`, without repeating version numbers in entry text.

When creating a plan file in plan mode, use `yyyy-mm-dd-<topic>.md`; for version-related plans, use `yyyy-mm-dd-vx.y.z-<topic>.md`.

## Releases

Only perform a version bump as part of a requested release. `CHANGELOG.md` is the version source of truth.

1. Promote `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD` and add a fresh empty `## [Unreleased]` above it.
2. In the same release commit, update `app_version` in `apps/api/app/config.py`, `[project].version` in `apps/api/pyproject.toml`, and `version` in `apps/web/package.json`.
3. Regenerate the `anno-api` version in `apps/api/uv.lock` with `uv lock` or `uv sync` from `apps/api`; do not edit the lockfile by hand.
4. Let the pre-commit hook regenerate `apps/api/openapi.snapshot.json`, including `info.version`; use `pnpm openapi:export` if the hook is unavailable, and verify with `pnpm openapi:check`. Do not hand-edit the snapshot or invoke `dump-openapi.py` for it. The docs build copies it to `docs-site/public/openapi.json`.
5. Verify the running API reports the new version via `curl -s localhost:8000/health`; both FastAPI metadata and `/health` read `app_version`.

## Local runtime: reload, restart, or rebuild

Check the actual Compose services and mounts before acting. Code mounted into a container needs a process restart; code and dependencies baked into an image need a rebuild.

| Change                                                                                                                   | Action in the development environment                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Host API code under `apps/api/**`                                                                                        | `uvicorn --reload` reloads Python code                                                                         |
| Frontend under `apps/web/src/**`                                                                                         | Vite HMR applies changes                                                                                       |
| Source used by Celery                                                                                                    | Restart affected running workers and beat as applicable; Celery does not auto-reload                           |
| Runtime `.env` values                                                                                                    | Recreate affected containers with `docker compose up -d <services>`; restart affected host processes           |
| Alembic migration                                                                                                        | Apply `alembic upgrade head` in the configured API environment; restarting alone does not migrate the database |
| Dependency manifests/locks, Dockerfile, `.dockerignore`, base image, build configuration, or source copied into an image | Rebuild and recreate affected services                                                                         |

Celery services mount `./apps/api:/app`, install dependencies outside that source mount, and mask the host `.venv` with an anonymous `/app/.venv` volume. Check `docker-compose.yml` for the affected default, GPU, CPU, export, image-pyramid, or GPU-control workers. Shared worker code can require restarting several services, not just `celery-worker`.

```bash
# Example for the default worker; select every affected service.
docker compose restart celery-worker

# When image contents change:
docker compose build celery-worker
docker compose up -d celery-worker
```

After changes under `apps/api/app/workers/`, restart affected running workers and verify the changed task or signature inside the running container. A dispatch-time `TypeError` about new keyword arguments can mean the worker still runs old code.

## Frontend bug investigation

Use Chrome DevTools MCP when available, or the available browser tooling, to inspect recent API calls and console errors along with the affected flow.

Reports from `BugReportDrawer` live in PostgreSQL's `bug_reports` table. If no API token is available, use read-only queries in the active local Compose project:

```bash
docker compose exec -T postgres psql -U user -d annotation -c \
  "SELECT display_id, title, severity, status, created_at FROM bug_reports ORDER BY created_at DESC LIMIT 20;"

docker compose exec -T postgres psql -U user -d annotation -c \
  "SELECT display_id, title, description, severity, status, route, browser_ua, recent_api_calls, recent_console_errors FROM bug_reports WHERE display_id = 'B-1';"
```

## Documentation index

Consult only the entries needed for the task:

- [README.md](README.md): product overview and setup; [DEV.md](DEV.md): local commands and development workflow; [CHANGELOG.md](CHANGELOG.md): unreleased and released changes.
- [docs-site/user-guide/](docs-site/user-guide/): workbench, projects, review, and administration behavior.
- [docs-site/dev/](docs-site/dev/): tutorials, concepts, how-to guides, references, and troubleshooting. Architecture lives in `dev/concepts/`; protocol and environment specifications in `dev/reference/`.
- [docs-site/ops/](docs-site/ops/): deployment, observability, security, and runbooks; [docs-site/api/](docs-site/api/): generated API reference.
- [docs/adr/README.md](docs/adr/README.md): architecture decisions; [docs/plans/README.md](docs/plans/README.md): implementation plans.
- [docs/research/README.md](docs/research/README.md): research index for annotation tools, AI integration, datasets, multimodal fusion, and annotator performance.

Preview the documentation with `pnpm docs:dev` (normally `http://localhost:5173`).

<!-- Behavioral guidance adapted from https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra, reviewed 2026-09-05. Project rules are maintained against this repository. -->
