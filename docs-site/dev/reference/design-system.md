---
title: Design System
audience: [developer]
type: reference
status: stable
last_reviewed: 2026-07-11
---

# Design System

This page covers two related but separate systems: the **web app** (`apps/web`, Tailwind + shadcn — most of this page) and the **documentation site** (`docs-site`, VitePress — see [Documentation Site Tokens](#documentation-site-tokens-vitepress) at the end). They do not share a stylesheet.

The web app uses Tailwind CSS with shadcn/ui primitives. Runtime theme values live in `apps/web/src/styles/shadcn.css`; component styling should consume Tailwind semantic classes or `--sc-*` CSS variables.

Shared filter controls, applied URL state, and query/action scopes are described in [Filtering state and result scopes](./filtering.md).

## Theme Tokens

`shadcn.css` is the single source of truth for neutral surfaces, text, borders, radii, focus rings, and canvas-only theme values.

| Purpose         | Token / class                                                           |
| --------------- | ----------------------------------------------------------------------- |
| Page background | `--sc-background` / `bg-background`                                     |
| Card surface    | `--sc-card` / `bg-card`                                                 |
| Popover surface | `--sc-popover` / `bg-popover`                                           |
| Primary text    | `--sc-foreground` / `text-foreground`                                   |
| Secondary text  | `--sc-muted-foreground` / `text-muted-foreground`                       |
| Muted surface   | `--sc-muted` / `bg-muted`                                               |
| Hairline border | `--sc-border` / `border-border`                                         |
| Primary action  | `--sc-primary` / `bg-primary text-primary-foreground`                   |
| Brand accent    | `--sc-brand` / `text-brand bg-brand`                                    |
| Danger status   | `--sc-status-danger` / `text-status-danger bg-status-danger-soft`       |
| Caution status  | `--sc-status-caution` / `text-status-caution bg-status-caution-soft`    |
| Positive status | `--sc-status-positive` / `text-status-positive bg-status-positive-soft` |
| Info status     | `--sc-status-info` / `text-status-info bg-status-info-soft`             |
| Info alternate  | `--sc-status-info-alt` / `text-status-info-alt bg-status-info-alt-soft` |

Dark mode is driven by `<html data-theme="dark">`. `shadcn.css` redirects Tailwind's `dark:` variant to that attribute, so components should use `dark:` classes rather than a `.dark` class.

## Semantic Color

Neutral UI should stay neutral. Use color only for meaning:

| Meaning               | Base hue  | Utility                                        |
| --------------------- | --------- | ---------------------------------------------- |
| Failure / destructive | `rose`    | `bg-status-danger-soft text-status-danger`     |
| In progress / warning | `amber`   | `bg-status-caution-soft text-status-caution`   |
| Success / complete    | `emerald` | `bg-status-positive-soft text-status-positive` |
| AI / model            | `violet`  | `bg-status-info-soft text-status-info`         |
| Information / counts  | `sky`     | `bg-status-info-alt-soft text-status-info-alt` |

Status chips should use the semantic soft background, the matching status text utility, and a small `bg-current` dot when a quick scan cue helps. Do not write paired hue classes such as `text-rose-600 dark:text-rose-400`; the status utilities read theme tokens from `shadcn.css`.

## Type Scale

The app uses a compact type scale. Prefer named text utilities instead of arbitrary pixel classes:

| Class       | Size | Use                                             |
| ----------- | ---: | ----------------------------------------------- |
| `text-2xs`  | 10px | dense badges and compact metadata               |
| `text-xs`   | 11px | small labels, table headers, secondary metadata |
| `text-sm`   | 13px | default app copy, form controls, panel headings |
| `text-md`   | 15px | compact section headings                        |
| `text-stat` | 22px | dashboard metrics                               |

Rare exact-size utilities (`text-3xs`, `text-micro`, `text-ui`, `text-control-xl`) exist for migrated control details. Do not add `text-[Npx]` in component class names; add or reuse a named token in `shadcn.css` when a new size is genuinely required.

## Z-Index Scale

Use semantic z utilities instead of raw numeric z-index classes:

| Class                                        |       Value | Use                                                |
| -------------------------------------------- | ----------: | -------------------------------------------------- |
| `z-local-1` ... `z-local-6`                  |     1 ... 6 | tightly scoped canvas or 3D local stacking         |
| `z-base`                                     |          10 | page-local elevated elements                       |
| `z-dock` / `z-dock-control`                  |     14 / 15 | workbench docks and dock controls                  |
| `z-local-overlay`                            |          20 | local menus and resize handles                     |
| `z-popover` / `z-popover-elevated`           |     30 / 55 | popovers that must sit above local panels          |
| `z-dropdown`                                 |          50 | dropdown and select content                        |
| `z-modal`                                    |          50 | modal overlay/content using current Radix stacking |
| `z-floating`                                 |          50 | floating workbench panels                          |
| `z-tooltip`                                  |          50 | tooltip content and arrow                          |
| `z-drawer-backdrop` / `z-drawer`             |     60 / 61 | custom drawer backdrop and content                 |
| `z-notification-backdrop` / `z-notification` |   200 / 201 | notification popovers and badges                   |
| `z-workbench-modal`                          |        1000 | workbench-local blocking dialogs                   |
| `z-app-drawer-backdrop` / `z-app-drawer`     | 1099 / 1100 | app shell drawer overlay and content               |

## Rules

- Do not use bare color values in component class names: no `#hex`, `rgb(...)`, `oklch(...)`, or Tailwind arbitrary color utilities.
- Do not read legacy `var(--color-*)` tokens in CSS. CSS modules that remain should use `--sc-*`.
- Do not add one-off color meanings in a page. Reuse the semantic status utilities above.
- Do not add arbitrary pixel text sizes. Use the compact type scale, or define a named token in `shadcn.css`.
- Do not add raw numeric `z-N` / `z-[N]` classes. Use the semantic z utilities above.
- Use shadcn/ui primitives from `apps/web/src/components/shadcn/ui/` for low-level behavior where possible.
- Keep existing `@/components/ui/*` adapters only when they preserve the current app API; they should delegate to shadcn/Radix behavior or Tailwind classes internally.

## Filter presentation

Filtering entry points use the existing `Icon name="filter"` funnel, not a plus or settings icon. Use `components/filters/FilterTrigger` for an expandable filter and `FilterGroup` for inline scopes. Set explicit SVG size classes (`size-4` for ordinary controls, `size-3` for dense panels) because Button CSS can override numeric SVG dimensions. Keep the Icon adapter's stroke and semantic theme colors.

`FilterPanel` is a controlled, non-modal, trigger-attached Popover on desktop and a bottom Sheet on narrow screens. Its desktop geometry uses an 8px trigger gap and 12px viewport clearance; only the body scrolls. The owner retains drafts across the responsive branch. Give every panel an accessible title and distinguish explicit Apply/Cancel forms from immediate filters. Do not change global Modal positioning to restyle a filter.

Reuse `FilterToggle`, `FilterSelect`, `FilterSection` and `ActiveFilterChip` for compact options, labeled fields and applied summaries. Chip removal is a sibling action, never a nested button; invalid conditions need visible text as well as color. Keep native checkbox/select/range semantics when Workbench keyboard isolation relies on them. Preserve source/status color meanings and virtualized row measurements.

Keep high-frequency choices inline and complex Data Manager expressions below the toolbar. Search, sort, display columns, true navigation tabs and mutation scope controls remain distinct. The [state and result-scope contract](./filtering.md) still owns reset, history, pagination and action-scope rules.

## Icon semantics

The app keeps Lucide as its primary icon library. `components/ui/Icon.tsx` renders
both Lucide icons and the small annotation-specific set in `annotationIcons.ts`.
Local icons use Lucide's renderer, 24px grid, `currentColor`, and the adapter's
size, stroke, forwarded ref, and decorative accessibility behavior.

- Reuse an icon for the same action across pages (search, save, delete). Do not
  require globally unique icons.
- Give different choices in the same navigation or tool group distinct silhouettes.
  Color, selection backgrounds, and tiny badges alone do not establish identity.
- Consume existing owners: Sidebar navigation descriptors, `ToolMeta.icon` via
  `TOOL_REGISTRY` / `ALL_TOOLS`, and `TOOL_UNIT_GROUPS` for project configuration.
  Do not create a parallel registry or pick a new icon independently in a consumer.
- Image and video single-frame tools share geometry. Polygon/polyline trajectories
  add a trailing-frame outline; Mask trajectories combine it with a region contour.
  Rotated boxes use a tilted rectangle with a handle; keypoints use connected nodes.
- Mask painting uses a brush, smart scribble uses a marked stroke, and canvas comments
  retain the pencil. Scissors remain appropriate for cutting and point-cloud selection.
- Check local SVGs at 12px (configuration/task queue), 13px (tool hints), 16px
  (navigation), and 17px (dock). Inspect light/dark, selected, disabled, hover, and
  keyboard focus states in a real browser. Retain accessible button names and tooltips.

Generic decorative/action icons may still import Lucide directly. New dependencies
or broad icon-library migrations require a demonstrated coverage or design benefit.

## Validation

Run the web lint gate after styling changes:

```bash
rtk pnpm --filter @anno/web lint:css-tokens
rtk pnpm --filter @anno/web lint
```

The token gate checks Tailwind class names for bare colors and dark-mode pairing, warns when status colors, arbitrary text sizes, or raw z-index classes are not using semantic utilities, and fails if CSS reads old `--color-*` variables.

## Documentation Site Tokens (VitePress)

The documentation site (`docs-site`) runs VitePress with the default theme and does **not** import the web app's `shadcn.css`. It has its own two-layer token system so the brand landing page and the reading pages can share one brand source while using different intensities of color, type, and motion.

| Layer              | File                              | Scope                                            | Character                                                                                                                  |
| ------------------ | --------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Reading layer (L1) | `.vitepress/theme/docs-theme.css` | All content pages (user-guide / dev / ops / api) | Neutral fog-white / ink-black surfaces, royal-blue links, Chinese reading rhythm. Maps `--docs-*` onto VitePress `--vp-*`. |
| Brand layer        | `.vitepress/theme/docs-home.css`  | Home page brand components only                  | Strong royal blue / paper / ink / acid green + display serif (`--home-*`). Never overrides body reading tokens.            |

**Shared brand source.** Both layers derive from royal blue `#172cff`. The home page uses it as a full-bleed background; body pages collapse it to `--vp-c-brand-1` (link + active state). Keep this the single brand hue for the docs — do not introduce a second accent for body pages. Acid green `--home-acid` is home-only (AI / annotation nodes); it must not enter body reading pages.

**Dark mode.** VitePress toggles `html.dark` (not the app's `data-theme`). Dark overrides in `docs-theme.css` therefore use the `.dark` selector, and royal blue is lifted to `#93a0ff` for link contrast on the ink background.

**Fonts are local-only.** `--docs-font-sans` / `--docs-font-mono` / `--docs-font-serif` are pure system/local stacks. The docs site must not inject runtime web fonts (e.g. Google Fonts).

**Sync principle.** When the brand hue changes, update `--home-blue` in `docs-home.css` and `--docs-royal` (light) plus its dark lift in `docs-theme.css` together. When adding a body-reading token, add it under `--docs-*` in `docs-theme.css` rather than inline in a component.
