---
name: aap-release
description: Prepare or verify an explicitly requested application release, synchronizing changelog, package versions, lockfile, and OpenAPI artifacts in this repository.
---

# Application release

First check the requested version, current branch, dirty work, and already completed acceptance evidence. Resume remaining work without repeating old release verification. A normal feature, commit, or SDK-only release does not imply an application version bump.

## Synchronize the release

1. Promote the top `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z] - YYYY-MM-DD` and add a fresh empty Unreleased section above it.
2. In the same release change, update `app_version` in `apps/api/app/config.py`, `[project].version` in `apps/api/pyproject.toml`, and `version` in `apps/web/package.json`.
3. From `apps/api`, run `uv lock` or `uv sync` to regenerate the `anno-api` lock entry. Do not hand-edit `uv.lock`.
4. Let the commit hook regenerate `apps/api/openapi.snapshot.json`, including `info.version`; use root `pnpm openapi:export` when the hook is unavailable, then `pnpm openapi:check`. Do not hand-edit the snapshot or use `dump-openapi.py` for it. The docs build copies it to `docs-site/public/openapi.json`.
5. Regenerate frontend clients with `pnpm codegen` when the API contract changes. Compare current source and snapshot before interpreting missing generated types as an API defect.
6. Verify the intended running API's `/health` reports the new version (default host URL: `http://localhost:8000/health`). Check that it serves this checkout; report explicitly if no API is available.

## Finish the authorized release workflow

Check affected user/API/architecture documentation and changelog entries. If archiving plans or ADRs is part of the release, follow the requested cutoff exactly and fix inbound links and indexes; do not infer a broader archive boundary.

Run required release checks in the equipped environment. If CI fails, inspect the actual failed step and later steps newly exposed after a fix. Report local completion separately from remote publication. Complete already requested commit/push/PR actions, but a release version change does not by itself authorize merging, tagging, or publishing externally.

Python SDK versions are independent; use [aap-sdk-contracts](../aap-sdk-contracts/SKILL.md) when that package is in scope.
