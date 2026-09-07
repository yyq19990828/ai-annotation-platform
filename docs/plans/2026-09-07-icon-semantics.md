# Icon semantics improvement

> Status: implemented and verified. The initial draft was recorded before implementation.

## Decision and scope

Keep Lucide as the app icon library. Distinguish adjacent business choices by silhouette,
preserve repeated universal actions, and add a small local SVG vocabulary for annotation
concepts that need it. Preserve all routes, permissions, tool IDs, shortcuts, layout,
theme tokens, disabled states, and annotation behavior. No dependency or API changes.

Tabler is the closest migration alternative, but changing libraries does not resolve
semantic assignment. Phosphor's weight variants do not resolve tool identity either.

## Layer 1: navigation

- Extend `apps/web/src/components/ui/Icon.tsx` with statically imported Lucide icons.
- Update `apps/web/src/components/shell/Sidebar.tsx`: folder kanban for projects,
  layers for datasets, chart for offline analytics, list/video execution for training,
  activity for health, gauge for personal performance, user permissions for user
  administration, and user statistics for annotator performance.
- Inspect the actual Sidebar component in Chromium in light/dark themes and a narrow
  viewport, including role visibility, active link, focus, and hover.

## Layer 2: annotation tools

- Add a small local icon-node module compatible with Lucide's renderer and the existing
  `Icon` adapter. Use the existing size/stroke/currentColor/ref/accessibility contract.
- Give rotated boxes a tilted rectangle with handle, keypoints a connected skeleton,
  polygon/polyline tools closed/open node geometry, and trajectory tools matching
  geometry with a simple trailing-frame cue.
- Use Brush for mask painting, retain Pencil for canvas comments, use a marked scribble
  for smart scribble, and Box for 3D box creation. Keep each ordinary/AI tool distinct.
- Update the existing tool metadata and `ToolDock` descriptors; reuse `ALL_TOOLS` and
  `imageToolIcon` rather than introducing a second tool registry.
- Check the 13px interactive-toolbar and 17px dock sizes, light/dark, selected, disabled,
  hover, keyboard focus, and callback behavior. Extend existing ToolDock regressions
  for shape distinction and image/video consistency, without snapshotting SVG paths.

## Layer 3: documentation and final verification

- Document icon semantics in `docs-site/dev/reference/design-system.md` and the relevant
  workbench guide. Add an Unreleased changelog entry for user-visible distinctions.
- Run web typecheck, lint (including CSS tokens), focused ToolDock/tool tests, and
  `git diff --check`. Review the final diff.
- Capture and inspect final Chromium evidence using production components. Browser
  plugin discovery is unavailable in this session; use the installed Playwright
  Chromium fallback. Use isolated fixtures only, never seed the everyday database.
- Remove temporary harnesses, test reports/caches created by this task, and stop its
  servers. Retain only intentional final visual evidence and implementation files.

## Acceptance and rollback

Each layer is independently usable and can be reverted independently. Full scope is
expected to touch more than eight files because tool metadata owns its own icon.
No new command, service dependency, credential, migration, or feature flag is required.
Repeated adjacent icons must be removed where they represent different tools; shared
actions remain consistent. All visible labels, shortcuts, permissions and callbacks
must retain their behavior. Small-size readability is the main visual risk: simplify
the SVG geometry if its distinguishing feature disappears at 13px.

Browser component/fixture checks and real backend end-to-end checks must be reported
separately. This work does not certify video decoding or point-cloud GPU rendering.

## Outcome

- All three layers implemented. Seven sidebar choices now have distinct business
  silhouettes; eight local annotation icons share Lucide's renderer and the existing
  adapter contract. A visual iteration changed the polygon from a quadrilateral to
  an irregular pentagon because it resembled the rotated box at small sizes.
- Synchronized image/video metadata, Mask toolbar, 3D task queue, project tool-unit
  settings, and project-template cards. Existing routes, permissions and shortcuts
  are unchanged. No package manifest or lockfile change.
- Developer guidance: [design system](../../docs-site/dev/reference/design-system.md).
  User guidance: [workbench](../../docs-site/user-guide/workbench/index.md).
  User-visible entry: [Unreleased changelog](../../CHANGELOG.md).
- Verification: 387 Vitest files / 3,251 tests passed. After the final template mapping
  adjustment, both template suites passed again (10 tests). Web typecheck and lint
  passed, including `check-tw-tokens`; final diff and formatting checked.
- Production-component browser fixtures: five user roles, unique visible navigation
  silhouettes, image/video/3D selection, Space activation, disabled keypoints and
  unsupported Exemplar, tooltips, and 12/13/16/17px light/dark rendering. No console or
  request errors in this fixture check.
- Full application browser validation used this checkout at port 3017, its API at
  8017, newly created `annotation_icon_review_20260907_test`, and the dedicated
  `icon-review-20260907` object bucket. Inspected dashboard navigation, image/video
  workbenches, rendered point cloud with cube selection, template cards, real theme
  controls and the 375px navigation drawer. The point-cloud capture used SwiftShader
  after removing SSH-forwarded DISPLAY; it is not a GPU performance qualification.
- The seeded mock ML backend returned 502 for setup/capabilities during image/video
  navigation. These are fixture limitations; inference was not tested. No page
  exceptions occurred. The isolated point-cloud follow-up had no console or request
  errors. Existing published documentation media were not regenerated.
- Final session-local screenshots are retained in `/tmp/aap-icon-review-final/`.
  Temporary browser harnesses, test caches, database, object bucket and servers are
  cleaned up after verification. Local Node dependencies were installed from the
  frozen lockfile after detaching incomplete links to the primary checkout.
- A local commit was requested after visual acceptance. No release, push or remote CI
  run was requested or performed.
