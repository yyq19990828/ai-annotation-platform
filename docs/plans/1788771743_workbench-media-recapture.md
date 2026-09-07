# Workbench media recapture after dockable layouts

> Status: first representative batch complete on 2026-09-07; remaining migration groups are planned and not yet completed.
> Baseline: `af2eb6ab`, 2026-09-07. No release milestone is assigned.

## Goal and acceptance

Update the documentation media to teach the current dockable workbench: task-appropriate presets, movable panels, tabs, hiding/restoring, canvas focus, and the 3D camera/tri-view modes. Preserve correct business demonstrations and real model outputs. Re-plan the shots before recording so that the action, its controls, and its result remain visible together.

The user's latest feedback accepts the basic content of the real SAM3 candidate demonstration, while identifying the larger layout migration. This is content feedback, not a completed per-asset review of the media registry.

Completion means every asset in the inventory has a recorded keep/recapture decision, all selected replacements show the current UI, missing generation evidence is repaired through actual capture, documentation and derivatives agree, and the final media review is performed against the committed files. A passing interaction test alone does not certify the published crop or poster.

## Evidence and scope

The UI source of truth is `apps/web/src/pages/Workbench/layout/`: `workbenchLayoutSnapshot.ts`, `workbenchLayoutPresets.ts`, `WorkbenchDockWorkspace.tsx`, and `workbenchPanelRegistry.tsx`. ADRs 0072 and 0073 describe the accepted boundaries. Current source has nine panel IDs, six annotate/review × image/video/3D contexts, and workspace schema 5. Do not copy historical schema numbers from older plans.

### Inventory, counted by current references

| Group                                       | Recording content groups | Dynamic derivative files | Static screenshots | Hero derivatives |
| ------------------------------------------- | -----------------------: | -----------------------: | -----------------: | ---------------: |
| Image basics                                |                       10 |                       19 |                  2 |                0 |
| AI and review, including cross-page stories |                       16 |                       47 |                  6 |                1 |
| Video                                       |                       18 |                       36 |                  1 |                1 |
| 3D                                          |                        5 |                       10 |                  1 |                1 |
| Total                                       |                       49 |                      112 |                 10 |                3 |

The **125 files are an inspection scope, not a blanket replacement list**. A content group may supply a video, poster, GIF, and homepage encodings; those are not independent recordings. Reuse one qualified source for its registered derivatives.

At planning time, the existing audit reported 199 referenced files. Its manifests contain 193 files: 132 flow artifacts and 61 screenshots. Two `ai-tracker-panel` artifacts are currently unreferenced; eight referenced artifacts lack generation entries: `docs-site/public/media/workbench/bbox-draw.mp4`, its poster, and the MP4/poster pairs under `docs-site/public/media/sam/` for smart-point, smart-box, and exemplar. The four Hero images are referenced through relative imports and are outside the current audit collector; three belong to this scope. Thus the broader actual reference inventory is 203 files, with 78 outside this workbench migration.

The earlier 135 stale review records are a dependency-based review result. They must not be substituted for this content inventory or automatically renewed.

### Immediate static-image decisions

| Action                                          | Exact assets                                                                                                                                                                                             | Reason                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Recapture                                       | `docs-site/user-guide/images/workbench/video-real-scene.png`, `pointcloud-real-scene.png`, `ocr-real-scene.png`; `docs-site/user-guide/images/review/workbench.png`                                      | Inspected full-workbench images still show the previous sidebars or tool-window arrangement. |
| Derive again after source replacement           | `docs-site/.vitepress/theme/assets/home/hero/video-track.webp`, `pointcloud.webp`, `review.webp`                                                                                                         | These embed the affected video, 3D, and review screenshots.                                  |
| Keep                                            | `docs-site/user-guide/images/workbench/layout-overview.png`                                                                                                                                              | Already recaptured with Dockview in this session.                                            |
| Inspect, then keep if the actual controls match | `docs-site/user-guide/images/mask-brush/toolbar-overview.png`; `docs-site/user-guide/images/sam/smart-point-toolbar.png`, `interactive-toolbar.png`, `magic-box-toolbar.png`, `exemplar-output-mode.png` | These crops do not expose the changed surrounding layout.                                    |

Retain the recently validated candidate-keyboard-review, e2e-quickstart, large-image-progressive, large-image-pyramid-recovery, and hotkey-cheatsheet media when their current composition fits the assigned profile. Re-record them only for an identified shot or interaction mismatch. Preserve their real inference evidence and existing validated behavior.

## Recommended approach

Use **four representative recordings to establish composition and interaction rules, then migrate the remaining affected content by task family**. The minimal alternative is rerunning all existing scripts unchanged. Reject it: those scripts can successfully reproduce an outdated composition, cannot teach the new layout features, and in two cases still inject inference results.

Use the application's existing presets and layout menu. Extend the existing recorder and source/derivative manifests; add no second layout engine, service, dependency, account, or public command. This is a broad media change involving more than eight files: approximately 49 existing content groups, selected screenshots, new layout stories, recorder helpers, and their documentation references. Work in independently reviewable batches.

The most fragile assumption is that an old script passing means its published composition is suitable. Remove that assumption by validating panel geometry and inspecting each actual clip and poster before publishing the batch.

### Composition profiles

| Profile           | Starting layout and visible controls                                                                                          | Use                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Image annotation  | Standard annotation; task queue and class palette visible; canvas unobscured                                                  | Box, polygon, polyline, mask, and onboarding. Use the real focus command only when the story benefits from it.                           |
| Image AI review   | Image AI review preset; current-task AI and inspector share the intended group; switch the active tab as the story progresses | Real inference, candidate review, and attributes. Hide unused discussion through its real command when additional canvas area is needed. |
| Human review      | Review collaboration; wider inspector and discussion below                                                                    | Review and rejection stories, using the reviewer role.                                                                                   |
| Video tracking    | Video tracking preset; tracker/inspector grouped; timeline and selected frame remain visible                                  | Seeds, range selection, prediction review, propagation, and mask editing.                                                                |
| 3D box refinement | Standard workspace plus the existing box-refinement mode; tri-view visible                                                    | Main-view/tri-view editing with shared geometry and selection.                                                                           |
| 3D sensor fusion  | Sensor-fusion mode; explicitly demonstrate all-camera floating/docked switching                                               | Projection, camera-seeded boxes, and camera selection. Use the gallery's real responsive grid/scroll behavior.                           |

Do not treat the selected-object information card as a Dockview panel: it remains an independent overlay. Collapse or reposition it through its actual supported UI when it hides the target. The canvas is menu-repositioned/maximized; it cannot be closed, floated, or tabbed. Cameras switch as a whole group; the docked gallery is not a third kind of independent floating window.

Document videos retain a consistent desktop composition and dark theme. Use the existing docs profile and measured source frame rate; never advertise repeated frames as 60fps. Homepage replacements retain the existing qualified marketing-master requirements. Review loading only outside the core action; preserve the causal sequence from input to result.

## First representative batch

| Order | Flow and status                                                        | Shot sequence                                                                                                                                                                                               | Required evidence                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `ai-tracker-panel` — reuse and reintroduce its already migrated script | Open tracker → float → dock right → hide → reopen → open current-task AI → combine tabs → return to tracker. Target 18–24 seconds with readable pauses.                                                     | Single instance for each panel; populated form/selection survives hiding and grouping; no model-inference claim because this story dispatches no job. Place it in the workbench layout guide. |
| 2     | `current-task-image-inference` — reframe existing live OCR story       | Apply image AI review → show current-task configuration → dispatch → show real candidates → switch to inspector → accept one → show saved annotation. Target 20–30 seconds excluding pre-interaction setup. | Real job and model result, correct candidate index, accept response and reload count; AI panel and target stay visible.                                                                       |
| 3     | `video-track` — reframe existing video overview                        | Establish video layout → play/pause → choose frame → draw or select the subject → inspect the timeline/track → show the saved result. Target 15–25 seconds.                                                 | Correct task/frame, actual media rectangle, visible timeline, real annotation state. A tracking inference is required only if the final storyboard claims one.                                |
| 4     | `pointcloud-camera-seed-3d-box` — migrate camera presentation          | Establish sensor-fusion mode → show docked camera gallery → choose front camera → seed a box → show main 3D and tri-view correspondence → save. Target 20–30 seconds.                                       | Official nuScenes fixture/pose, correct camera role, projection and pointer alignment, shared selection and saved geometry. Validate on the real rendering host.                              |

These establish layout teaching, AI review, video, and 3D composition. The four clearly outdated static views are recaptured with their corresponding profile in the same batch. Update only the references delivered by that batch.

## New layout teaching stories

Create these after the representative layout clip has established the visual pacing. Each story is independently useful and can be published without waiting for all old videos.

| Planned flow ID                | Target and placement                                                                                | Story and acceptance                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-layout-basics`      | `docs-site/public/media/workbench/layout-basics.mp4` plus poster; workbench index, layout section   | Standard preset → resize a divider → combine tabs → title-bar hide → restore from layout menu → focus canvas → restore. Keep the same canvas instance, current task/tool, selected annotation, and any unsent discussion draft during rearrangement. |
| `workspace-layout-persistence` | `docs-site/public/media/workbench/layout-persistence.mp4` plus poster; workbench settings           | Adjust and save layout → switch task/context and return → reload → enter/leave compact width. Verify the real preferences PATCH/GET, context separation, and restored desktop tree. Do not promise unsent discussion drafts survive a full reload.   |
| `pointcloud-panel-layout`      | `docs-site/public/media/pointcloud/panel-layout.mp4` plus poster; 3D box and pointcloud-view guides | Move/float/redock tri-view as one panel → switch all cameras floating/docked → hide/restore → switch frame. Verify rendered backgrounds, picking, synchronized selection, and stable camera roles.                                                   |

Planned IDs are not currently executable recording selections. Register their requirements, recipes, and assertions before using the existing recording CLI with them.

## Recorder changes before bulk capture

1. Extend `flows/_workbench-layout.ts` to select the real task-specific presets and wait for the expected visible panels, active tabs, and bounds. Retain one preferences sandbox for composition-only flows. Stop clearing workspace and driving every recording through legacy `both`/`none` settings.
2. For layout persistence, use the existing isolated screenshot account with the real preferences API. Preserve and restore that account's starting preferences in teardown. An intercepted in-memory PATCH is not persistence evidence. Reuse assertions from `workbench-layout.spec.ts`, `workbench-ai-tracker-layout.spec.ts`, and the 3D layout tests.
3. Keep media coordinates relative to `renderedMediaBounds`. Replace fixed selected-card positions, retired `triViewFloat` settings, fragile parent-chain selectors, and camera locators tied exclusively to `[data-floating-panel]`. Locate the explicit camera mode/role and `[data-workbench-panel="camera-view"]` when docked. Native floating camera mode remains valid when that is the story being taught.
4. Convert `candidate-review-lifecycle` to real model results with original prediction IDs and shape indices, reusing `prepareLiveCandidateReview`. Remove `smart-scribble` setup/inference response interception from its published real-model story; use the advertised live scribble capability. If the required backend rejects the real operation, fail and diagnose that flow rather than substituting fixture output.
5. Distinguish **backend availability** from **performed inference** in recording declarations/evidence. A panel-only demonstration may need model capabilities but performs no inference. Archive real job/model/result evidence for inference stories and mark non-inference stories accordingly. Keep standard versus marketing quality independent of that distinction.
6. Put per-flow preparation and recording metadata with the individual flow modules; keep the common runner stable. Newly completed reviews should watch the actual flow, shared helpers, and consuming documentation. Do not retroactively remove watched paths or move verification commits just to clear old failures.
7. Repair the eight referenced-but-unrecorded manifest entries through actual source capture/derivation. Include the three workbench Hero imports in the maintained inventory and review workflow; keep the unrelated data-manager Hero. Align the media collector with actual static imports so its published-file total includes them.

## Remaining recording groups

The following are executable flow names unless noted. Final target mappings are owned by `apps/web/scripts/derive-doc-media.mjs`, not a second hand-written output-path registry.

| Family            | Existing flows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Work                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Image basics (10) | `bbox-draw`, `rotated-bbox`, `polygon-draw`, `polyline-draw`, `mask-draw`, `large-image-progressive`, `large-image-pyramid-recovery`, `large-image-mask-limit`, `hotkey-cheatsheet`, `e2e-quickstart`                                                                                                                                                                                                                                                                                                                  | Reframe older full-workbench shots; retain recently validated current-layout captures; add missing bbox generation evidence.           |
| AI/review (16)    | `sam-interactive`, `sam-tool-smart-point`, `sam-tool-smart-box`, `sam-tool-exemplar`, `ocr-inference`, `candidate-keyboard-review`, `candidate-review-lifecycle`, `current-task-image-inference`, `secondary-inference-attribute`, `ai-prediction-import`, `review-reject`, `pipeline-apply-project`, `jobs-retry-recovery`, `project-ml-routing`, `smart-scribble`, `ai-preannotate`                                                                                                                                  | Use the AI/review profiles and real result lineage. Reframe workbench endings in cross-page stories as well as direct workbench flows. |
| Video (18)        | `current-frame-video-inference`, `video-tracker-job-states`, `video-mask-correction-propagate`, `video-mask-track-edit`, `video-timeline-prediction-navigation`, `video-propagate-track-vs-copy`, `video-track-batch-propagate`, `video-tracker-box-seed`, `video-tracker-combo-discovery`, `video-tracker-cross-frame-points`, `video-tracker-positive-negative`, `video-tracker-range`, `video-tracker-text-discovery`, `video-chapter`, `video-draw`, `video-timeline-zoom`, `video-track-carryover`, `video-track` | Keep panel, timeline, target and decisions visible; preserve real seed frame/range and accepted track identities.                      |
| 3D (5)            | `pointcloud-billboard-label`, `pointcloud-camera-seed-3d-box`, `pointcloud-controls`, `pointcloud-crossframe-track`, `pointcloud-view`                                                                                                                                                                                                                                                                                                                                                                                 | Migrate presentation-specific locators and obsolete controls; show the new compact toolbar and menu-driven modes.                      |

Aliases: `sam-interactive` produces asset `ai-assisted-annotation`; `ocr-inference` produces `ocr-real-scene`; `sam-tool-*` produces `sam-tools/*`. Their homepage/document variants are derived from the corresponding source, rather than separately reenacted. The two existing unreferenced `ai-tracker-panel` files are outside the 125-file baseline; publishing the new layout story introduces references to them.

Keep the 13 non-workbench flows: `background-export-download`, `storage-connector-create-test`, `jobs-bell-active`, `pipeline-template-create`, `ai-pre-variant-selector`, `batch-bulk-actions`, `project-create-existing-resources`, `project-actions-menu`, `model-market-gpu-resource-overview`, `model-market-runtime-partial-failure`, `model-market-runtime-pool`, `model-market-video-pool`, and `platform-overview`. Keep unrelated authentication, administration, project/data management and settings screenshots. Review `settings/workbench-prefs.png` for actual settings changes only.

## Execution and verification

Use the existing local Python virtual environment and screenshot runtime. The verified disposable database is `annotation_screenshots_test`; the development services remain separate. Capture API and dedicated `screenshots@` workers must use identical database and Redis DB 15 settings, including migration/broker overrides. Port 3001 is occupied on this machine; use the established capture web port 3020 and API port 8010. No credentials are copied into plans, logs, or media.

Preflight already confirmed the installed ffmpeg, X11 display socket, and reachable SAM3, YOLO and RapidOCR health endpoints. The dedicated capture API/workers are started only for the selected batch and stopped after verification. Before each run, verify actual mounts, service targets, exclusive seed ownership, live capabilities and media access. Marketing qualification still needs its existing display/cadence checks; availability of a GPU alone does not qualify a master.

For each independently publishable batch:

1. Establish the declared layout and source requirements; use `screenshots:record -- --list` and the selected flow's `--plan`. Enroll unsupported flows before selecting them. Complete scoped interaction validation before bulk encoding.
2. Record the real flow, checking recent API failures and browser console errors. Verify successful paths and relevant edge cases: hidden/tabbed panel restore, no duplicate instances, saved decisions, task/frame switching, compact round-trip, and failed preferences recovery for the persistence story.
3. Inspect the source beginning, core action and ending. Derive only the selected registered targets with `docs:media:derive`; standard sources require an explicit inspected clip. Regenerate associated posters and Hero derivatives from their new source.
4. Review the actual published beginning/core/end/poster, then run `screenshots:record:test`, `screenshots:docs-media:test`, relevant locator/assertion tests and `screenshots:lint`. Run type/lint checks for changed scripts and `git diff --check`; do not repeat unrelated application acceptance tests for media-only edits.
5. Update affected user-guide references/captions, `docs-site/maintainers/image-checklist.md`, generation manifests, and CHANGELOG in the same batch. Commit before final per-asset human review. Run strict media audit against the resulting commit. A release audit is required only for a requested release.
6. Clean generated test data/intermediates and stop the dedicated runtime when finished. Retain the verified private source archive until its requested backup is confirmed. Publish/push only within the user's existing authorization.

If one model/backend fails, keep that batch's previous published assets and diagnose the failed flow; other completed batches remain useful. A failed derivative must leave its previous target untouched. Rollback is a Git revert of the affected recording scripts, media, manifests and references; production annotation data is outside this work. Restore the isolated recording account's preferences and clean its jobs/annotations regardless of success.

## Completion record

At implementation completion, append an Outcome section with actual commits, delivered documentation and remaining per-asset review gaps. This proposed plan does not mark any asset reviewed, approve a push, or assign a release version.

## Outcome: first representative batch

Delivered four real-browser recordings with their four posters, four updated workbench/review screenshots, and three regenerated homepage Hero images (15 published files). All four recording tests and all four selected desktop-dark screenshot scenes passed. Published video beginnings, core operations, endings and posters were inspected; all 15 assets loaded successfully in the browser preview. Documentation build, web typecheck, focused script lint, recording unit tests and static reference/manifest checks passed.

- `ai-tracker-panel`: 21.4 seconds; floating, docking, hiding/restoring and tab grouping preserve the bidirectional 60-frame configuration. This panel demonstration performs no model inference.
- `current-task-image-inference`: 18 seconds; real RapidOCR results, prominent heading selection, original prediction/shape identity, manual acceptance, and persistence after reload. The source archive contains the actual job and prediction evidence.
- `video-track`: 21.2 seconds; verified forward/backward frame stepping, real playback/pause, a manually drawn truck keyframe, saved track selection and reload verification. The poster shows the saved track and timeline.
- `pointcloud-camera-seed-3d-box`: 20.667 seconds; docked cameras, real mouse-based seed geometry, double-click focus and the box-refinement preset. Hardware capture measured 59.97 fps with 66 unique frames out of 67 calibration frames. The 2592×1458 capture was resampled into a 4K master; it is not native 4K capture and performs no model inference.

The source recordings used live browser time to match API lease timestamps. Ordinary deterministic screenshots retain the fixed-clock default, while the four live workbench scenes explicitly select live time. Source and derivation commit/dirty state are recorded separately for Hero assets. Annotation cleanup registers saved IDs before subsequent UI assertions can fail.

Relevant integrated commits: `3b0a8a84` (tracker/video recording assertions), `04a3e15e` (persisted annotation identity for discussion), and their merges `ee0e0550` / `a6044bbf`. The four screenshots and final recordings were captured from `a6044bbf` with local recording changes; their dirty provenance is intentional and preserved. This outcome accompanies the media batch commit rather than inventing a clean capture commit. Final source archives were copied outside the checkout and verified by SHA-256 before intermediate cleanup.

The collector now includes all four statically imported homepage Hero images and the two reintroduced panel-demo references: 205 published files in the broader inventory. No human review record was renewed. Missing historical generation evidence, affected historical review records, the remaining content families, and the three planned dedicated layout stories still need the subsequent batches described above. The 49-group / 125-file planning scope must not be reported as fully recaptured. No release version or push approval is implied by this batch.
