---
title: Writing documentation
description: Page structures, stable anchors, media placement, and canonical sources for docs-site contributions
audience: [dev]
type: how-to
status: stable
last_reviewed: 2026-09-12
---

# Writing documentation

Use this guide when adding or reshaping a page in `docs-site`. The goal is a page that answers one kind of question quickly, keeps its public links stable, and points readers to the source that owns each fact.

## Choose the page shape

Start by choosing the reader's job. Keep one page focused on one of these shapes:

| Shape       | The page should lead with                                    | Typical location                |
| ----------- | ------------------------------------------------------------ | ------------------------------- |
| Tutorial    | an outcome, prerequisites, and a guided path                 | `dev/tutorials/`, `user-guide/` |
| How-to      | the task and the shortest safe procedure                     | `dev/how-to/`, `ops/runbooks/`  |
| Reference   | a lookup map, exact fields, and compatibility rules          | `dev/reference/`, `api/guides/` |
| Explanation | the relationships and decisions a reader needs to understand | `dev/concepts/`                 |
| Runbook     | symptoms, inspection, recovery, and verification             | `ops/runbooks/`                 |

Do not copy a whole page into a second section to make it easier to find. Put the canonical explanation in the page that owns it and link to that page from hubs and related articles.

## Open with the reader's next action

Use one H1 and a short lead paragraph. For tutorials and how-to pages, put the result and prerequisites before optional screenshots, background, or advanced variants:

```md
# Import an image dataset

After this guide, your image files are available as tasks in a project.

## Before you start

- Confirm the project and storage permissions.
- Prepare the supported file format.

## Import the dataset

1. Open the project.
2. Select the dataset source.
3. Check the preview and start the import.
```

Use native ordered lists for procedures. Put the expected result beside the step that produces it, and keep required warnings visible in the flow. A page can use deeper headings for operations, but readers should reach the first useful step without passing a large media block.

## Keep headings and anchors stable

Headings become public fragment URLs. Treat an existing heading ID as part of the page contract:

- Keep the current heading text when it still describes the section.
- If renaming a section changes its generated ID, preserve the old ID with a custom anchor or a nearby alias. Relevelling alone normally keeps the ID; compare the rendered output before adding an alias.
- Use a unique, descriptive ID for each explicit anchor. Do not create two elements with the same ID.
- Do not add release versions to current page headings; record historical provenance in `CHANGELOG.md`, an ADR, or a comment.

For example:

```md
<span id="old-section-name" aria-hidden="true"></span>

## Current section name
```

Prefer relative links within the same domain, such as `../how-to/add-page`. Use a root path for an intentional cross-domain link, such as `/api/guides/tasks-and-annotations`. Check that a moved page keeps its canonical route and that old deep links still land on the relevant section.

## Place media beside the operation

Use the existing image, video, diagram, and lightbox components. Put media immediately after the operation or decision it explains, and write alt text or a caption that tells the reader what to inspect. Keep required limitations in normal prose.

Do not show light and dark screenshots of the same operation consecutively. When both variants exist, place exactly two Markdown images in `doc-theme-images`, light first and dark second. The existing `html.dark` theme then shows only the matching image, including in image zoom:

```md
<div class="doc-theme-images">

![Login](./images/login.png)

![Login in dark mode](./images/login.dark.png)

</div>
```

Use one representative screenshot when no theme pair is needed. Device layouts and different loading, empty, or error states should remain separate only when they explain a useful difference.

Use `<details>` for optional variants that would interrupt the main path, such as dark-theme, mobile, password-recovery, or long troubleshooting examples:

```md
<details>
<summary>Show the mobile example</summary>

![The same form on a narrow screen](./images/example.mobile.png)

</details>
```

Move a reference only when the destination remains a real, published use of the asset. Keep source files, manifests, and review metadata unchanged; documentation layout edits do not approve a new capture or alter its provenance.

## Use native containers for meaning

Use VitePress Markdown containers for short, semantic callouts:

```md
::: tip
This shortcut is optional and only changes navigation speed.
:::

::: warning
This action changes the next task's state; verify the queue before continuing.
:::
```

Use `<details>` for optional material, never for a mandatory step or a warning that changes the reader's next action. Use code groups only for genuinely alternative commands, not to hide sequential commands:

````md
::: code-group

```bash [pnpm]
pnpm docs:build
```

```bash [npm]
npm run docs:build
```

:::
````

Tables are appropriate for parameter matrices and state comparisons. On narrow screens, let the table scroll locally instead of widening the entire article.

## Respect canonical sources

Before editing a value, identify the source that owns it:

- API routes and schemas come from the application code and the tracked OpenAPI snapshot. Regenerate API artifacts after a contract change.
- Generated pages and indexes are refreshed by their scripts; do not hand-edit a generated file when its source is available.
- Environment variable documentation follows `.env.example` and the environment-variable generator.
- Architecture decisions belong in `docs/adr/`; the docs-site mirror is a build-time view.
- Screenshots, videos, diagrams, and their manifests keep their existing owners and review records.

Link to the authoritative page or source instead of restating a value that can drift. When a factual correction crosses an API, runtime, or deployment boundary, check the implementation and update the affected documentation together.

## Run the focused checks

For a normal Markdown edit, run the checks that cover the changed surface:

```bash
pnpm exec prettier --check docs-site/dev/how-to/write-documentation.md
pnpm --filter @anno/docs-site check:frontmatter
pnpm --filter @anno/docs-site check:codegen
pnpm docs:build
git diff --check
```

If you moved media references, also run the orphan-image and media-audit checks described in [Updating documentation screenshots](./update-screenshots). If you changed navigation or a public route, run the navigation coverage check and open the affected deep links in the local preview.

For a reading-layout or multi-page reorganization, capture the old article IDs before editing, then verify the finished preview against that baseline:

```bash
node docs-site/scripts/check-reading-layout.mjs capture http://127.0.0.1:5173/ /tmp/docs-reading-anchors.json
node docs-site/scripts/check-reading-layout.mjs verify http://127.0.0.1:5173/ /tmp/docs-reading-anchors.json
```

Use the URL printed by the preview server, including any deployment prefix. Capture refuses to overwrite a baseline. Verify checks the ten representative routes, legacy IDs, widths, active navigation, and both color modes. Keep the baseline with the change's acceptance evidence; do not recreate it from the modified pages.
