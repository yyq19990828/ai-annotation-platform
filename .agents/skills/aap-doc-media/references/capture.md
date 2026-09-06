# Isolated capture and visual checks

Use `apps/web/playwright.screenshots.config.ts` and the existing screenshot catalog/flows. The maintained human guide is [update-screenshots.md](../../../../docs-site/dev/how-to/update-screenshots.md).

## Environment and fixtures

Default screenshot isolation uses database `annotation_screenshots_test`, API port 8010, web port 3001, and Redis DB 15. Verify actual configuration and availability before launching processes. API and dedicated worker must share that test database and isolated Redis; everyday workers must not consume capture jobs.

Pin or clear `MIGRATION_DATABASE_URL` and `CELERY_BROKER_URL` in each capture process as well as setting `DATABASE_URL` and `REDIS_URL`. In `app/config.py`, those overrides take precedence for migrations and Celery broker/results. Check the effective targets, including host/port/database, without printing credentials. The database-preparation suffix guard does not protect a separately invoked Alembic command from an inherited migration URL.

Use `apps/api/scripts/prepare_e2e_db.py`, Alembic, and `apps/api/scripts/seed.py --profile screenshots --repair --ml-backend-mode <live|stub>` in the isolated environment. Preserve the test-database suffix guards. Keep `E2E_SEED_ENABLED` process-local. Do not repair seed while a capture matrix is using its catalog snapshot.

Resolve project/task/backend IDs through the catalog, not copied UUIDs. Check logical fixture keys and media readiness. Coordinate anchors use the media's actual rendered rectangle, excluding letterboxing. nuScenes scenes, camera roles, coordinate conventions, and targets must agree with current seed metadata; do not carry old synthetic box positions into a new dataset.

Protocol stubs are appropriate for supported ordinary screenshot/GIF validation. They are not evidence of real-model inference or replacements for live-model marketing masters.

## Capture the requested output

Use targeted `--grep`/project selection and `SCREENSHOT_VALIDATE_ONLY=1` when only validating navigation and locators. Existing commands include `screenshots`, `screenshots:matrix`, `screenshots:flows`, and `screenshots:regression` in `apps/web`.

Documentation MP4/poster derivatives and private marketing masters are separate outputs. `pnpm docs:media:derive` uses the existing master manifest; marketing capture has its own X11/NVIDIA/60fps requirements. Do not claim a macOS 720p/30fps recording is a new 4K60 master or bypass capture-quality gates.

Trim loading only before the core interaction; do not cut off the action or pad footage with repetition. Keep manual `auto: false` images intact unless explicitly updating them. Regenerate affected homepage derivatives after their source screenshots change.

## Diagnose a failing visual test

Open the trace from the actual failing test and build/platform. A geometry save may succeed while a preferences PATCH fails; inspect the request rather than guessing from a screenshot. Check float bounds normalization, canvas readiness, selected annotation identity, and floating overlays/pets intercepting clicks.

Update intentional screenshot baselines for the relevant platform, then rerun without update mode. Missing locators should fail, not fall back to a full-page screenshot. Use real annotation save/accept responses as evidence, not only the last frame.
