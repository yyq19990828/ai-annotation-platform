# v0.23.2 Legacy Service Import Elimination — Implementation Plan

## Context

v0.23.1 is released (all version sources at 0.23.1, `/health` returns 0.23.1, OpenAPI diff is version-only). All 23 legacy facade modules exist as pure re-export files. This plan physically deletes them and establishes permanent negative guards.

**Key finding from exploration:** Only `gpu_arbiter` (1 of 23) still has active first-party importers (9 production files, 17 test files, 1 script). The other 22 modules are already clean from production code — their only remaining references are in the two guard test files, `.github/docs-impact-map.json`, and historical docs. One logger namespace (`exporting/video.py:28` → `"app.services.export_video"`) needs migration.

## Phases (each is one commit)

### D0 · Tooling + manifest + cutover doc (no deletions)

**Files to create:**
1. **`apps/api/tests/_fixtures/removed_service_modules.json`** — machine-readable manifest of all 23 removed modules. Each entry: `{facade_module, public_module, exports (grouped by source module), consumer_modules, frozen_symbols}`. Derived from the existing `FACADE_SPECS` (22 entries) + new `gpu_arbiter` entry (the 23rd, with its ~27 public re-export symbols mapped to their exact source sub-modules).
2. **`scripts/check_removed_service_modules.mjs`** — repo-wide scanner (Node, deny-by-default over `git ls-files`). Checks: (a) no exact `app/services/<name>.py` / `.pyi` files exist, (b) no active import/string references outside the manifest + named historical allowlist, (c) `--historical-links` mode checks Markdown links pointing at deleted files. Runs in CI.
3. **`scripts/check_removed_service_modules.py`** — artifact scanner (Python, run inside production Docker image via `--artifact-root`). Checks exact source/stub/bytecode absence + cold import failure of all 23 paths.
4. **`.dockerignore`** (repo root) — excludes `**/__pycache__/`, `**/*.py[cod]`, `apps/api/.venv/`, `**/.pytest_cache/`, `**/.coverage`, `**/dist/`.
5. **`docs/migration/2026-07-17-v0.23.2-service-import-cutover.md`** — full old symbol → exact defining module migration table for all 23 modules.

**Files to modify:**
6. **`apps/api/tests/test_compat_facades.py`** — add `gpu_arbiter` as the 23rd FacadeSpec (freeze its public re-export symbols with per-symbol source binding). This completes the 23-module manifest before any deletion. Update symbol count assertion.

**Verification:** Guard tests pass (102+), new scanner runs clean against current state (all 23 still exist), synthetic negative tests prove the scanner detects all 5 import forms + patch strings.

### D1 · Active import + logger namespace cleanup (no deletions)

**Files to modify:**
1. **Migrate all 9 production `gpu_arbiter` importers** to specific `gpu_arbitration.*` sub-modules: `deps.py`, `admin_ml_integrations.py`, `ml_backends.py`, `tasks/annotations.py`, `ml_backend.py`, `secondary_inference.py`, `video_tracking/runner.py`, `video_tracking/adapters.py`, `ml_health.py`. Each multi-symbol import block is split by target sub-module (contracts/policy/fences/proofs/reconciliation/retirement/diagnostics).
2. **Migrate `scripts/validate_gpu_arbitration.py`** — `from app.services.gpu_arbiter import GPUArbiterDispatchError, GPUDispatchRequest` → from contracts.
3. **Migrate all 17 test files** that import from `gpu_arbiter` — repoint to specific sub-modules. Includes function-local imports in `test_failed_predictions.py`, `test_prediction_jobs_worker.py`, `test_video_tracker_worker.py`, and the `gpu_arbiter_service` module alias in `test_gpu_arbiter_proof_recovery.py`.
4. **Migrate logger namespace** `exporting/video.py:28`: `"app.services.export_video"` → `"app.services.exporting.video"`. Remove the `_LEGACY_CALL_REFERENCE_ALLOWLIST` entry in `test_domain_package_architecture.py`.
5. **Update `test_task_views_filter.py:3` docstring** mention of `app.services.task_views`.
6. **CHANGELOG** — add Unreleased/Changed entry.

**Verification:** Full test suite passes with all facades still in place. First-party code has zero `app.services.gpu_arbiter` (and zero other legacy) imports. The architecture guard's `_legacy_references` scanner confirms zero active hits.

### D2 · Delete Data Manager facades (6 modules)

Delete: `data_manager.py`, `task_views.py`, `data_manager_cursor.py`, `data_manager_entities.py`, `data_manager_entity_filter.py`, `data_manager_tracks.py`.

In the same commit: move these 6 from `ACTIVE_FACADES` to `REMOVED_MODULES` in the manifest; add negative-import tests (cold subprocess: `import` fails, `from import` fails, `find_spec is None`, `app.services` has no attribute); remove the 6 Data Manager matchers from `.github/docs-impact-map.json`; fix any directly-linked docs.

**Verify:** Data Manager API, Task Views, cursor/entity/track tests, full pytest.

### D3 · Delete Video facades (3 modules)

Delete: `video_tracker_adapters.py`, `video_tracker_job_service.py`, `video_tracker_runner.py`. Same pattern as D2. Remove Video matchers from docs-impact-map.

**Verify:** Video tracker API, worker registration, runner, WebSocket publisher, full pytest.

### D4 · Delete Export facades (6 modules)

Delete: `export.py`, `export_packaging.py`, `export_cache.py`, `export_video.py`, `export_lidar.py`, `export_davis.py`. Remove Export matchers from docs-impact-map.

**Verify:** Export API, cache, worker, image/video/LiDAR/DAIS products, full pytest.

### D5 · Delete GPU leaf facades (3 modules)

Delete: `gpu_admission_signer.py`, `gpu_arbiter_rollout.py`, `gpu_collector_database.py`. GPU docs-impact matchers remain until D6.

**Verify:** Signing, rollout state, collector, ml_client, health/gpu.control worker, Lua golden, full pytest.

### D6 · Delete GPU high-level facades (5 modules, gpu_arbiter last)

Delete in order: `gpu_dispatch_authority.py`, `gpu_membership_activation.py`, `gpu_rollout_control.py`, `gpu_arbiter_store.py`, `gpu_arbiter.py` (last). Remove all GPU matchers from docs-impact-map when `gpu_arbiter` is deleted. After D6: `ACTIVE_FACADES` is empty, `REMOVED_MODULES` = 23.

**Verify:** GPU dispatch, membership, rollout, ledger, all GPU tests, Lua golden, SCC, cold start, full pytest.

### D7 · Final docs + release gate

1. Fix all Markdown links to deleted files in active docs (ADR-0045, backend-layers.md, etc.); historical materials enter named allowlist.
2. Transform `test_compat_facades.py` fully into a permanent removed-module negative guard (all 23 entries assert unimportable).
3. Unify `CURRENT_COMPAT_FACADES` in architecture test → `REMOVED_MODULES` (23 items), permanently preventing reflow.
4. Update `backend-layers.md`, `overview.md`, ADRs to remove facade-as-current-architecture descriptions.
5. CHANGELOG fold Unreleased → v0.23.2, bump version sources, refresh uv.lock + OpenAPI snapshot.
6. Run full release gate matrix.

## Approach notes

- **D0 scanner is the keystone.** The Node scanner (`check_removed_service_modules.mjs`) uses `git ls-files` + AST for `.py` and regex for `.md`/`.json`/`.yml`. It reads the manifest JSON to know the 23 targets. Historical allowlist is per-file, per-line, with reason.
- **Negative import tests** reuse the existing cold-subprocess scaffolding from `test_compat_facades.py` but flip assertions: `import app.services.<legacy>` must raise `ModuleNotFoundError` with `.name == old_path`; `find_spec()` must return `None`; positive controls (new modules + consumers) must still import.
- **Deletion order** follows the plan's dependency DAG: Data Manager → Video → Export → GPU leaf → GPU high-level. Each domain is one self-contained commit.
- **No behavior change:** OpenAPI, Celery task names, SQL, Redis/Lua, lock order all frozen. Only logger namespace for `export_video` changes (allowed by plan §14).
