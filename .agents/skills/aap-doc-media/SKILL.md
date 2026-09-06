---
name: aap-doc-media
description: Capture, update, or diagnose this project's documentation screenshots and videos, including seed isolation, manifests, and stale media-review records.
---

# Documentation media

Start with `pnpm docs:media:audit` for provenance/review failures, or the requested asset/flow for capture work. Distinguish a missing file, changed content hash, outdated generation source, and stale/unreachable review commit. Regeneration is not the default fix for every audit failure.

## Choose the evidence

- `apps/web/e2e/screenshots/outputs/manifest.json`: static image generation.
- `apps/web/e2e/screenshots/outputs/flow-manifest.json`: recordings and derived media.
- `docs-site/maintainers/media-reviews.json`: visual/content review evidence.
- `apps/web/e2e/screenshots/scenes/` and `flows/`: reproducible product interactions.

Read [capture](references/capture.md) when generating or rerecording assets. Inspect the actual image and, for video, its beginning, core interaction, ending, and poster. Verify the represented feature, loading state, real target geometry, and sensitive-data masking. Successful encoding is not visual acceptance.

## Repair provenance honestly

Review metadata and generation provenance answer different questions. After merge or rebase, check commit reachability, file hashes, associated paths, and actual review scope. Preserve valid records from both sides. Do not fabricate a clean generation commit, change hashes to silence failures, or relabel an unreviewed set as freshly reviewed.

Use `pnpm docs:media:approve -- --asset <repository-relative-path>` only after a new completed visual/content review within the user's authorization. It requires a clean tree and committed assets, and records current HEAD, time, and reviewer. Prepare authorized changes first; if review itself is missing, report that exact gap. Agent sampling is not a fresh human review of every asset.

For history-only repair after merge/rebase, do not run the approval command to manufacture freshness. Preserve the original review time and reviewer; repair a commit reference only with demonstrated equivalence of the reviewed asset and watched source scope. Otherwise retain the evidence gap.

Run the relevant audit mode: normal/strict validation for the requested change, `--release` when release provenance is required. Derive current counts from manifests and files. Do not rewrite unrelated assets or use blanket baseline regeneration to make CI green.

The detailed maintainer workflow is [update-screenshots.md](../../../docs-site/dev/how-to/update-screenshots.md). Keep published assets and provenance together; retain private capture masters until their requested backup is verified.
