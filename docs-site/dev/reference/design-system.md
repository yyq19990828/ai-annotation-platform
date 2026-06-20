---
type: reference
---

# Design System

The web app uses Tailwind CSS with shadcn/ui primitives. Runtime theme values live in `apps/web/src/styles/shadcn.css`; component styling should consume Tailwind semantic classes or `--sc-*` CSS variables.

## Theme Tokens

`shadcn.css` is the single source of truth for neutral surfaces, text, borders, radii, focus rings, and canvas-only theme values.

| Purpose | Token / class |
|---|---|
| Page background | `--sc-background` / `bg-background` |
| Card surface | `--sc-card` / `bg-card` |
| Popover surface | `--sc-popover` / `bg-popover` |
| Primary text | `--sc-foreground` / `text-foreground` |
| Secondary text | `--sc-muted-foreground` / `text-muted-foreground` |
| Muted surface | `--sc-muted` / `bg-muted` |
| Hairline border | `--sc-border` / `border-border` |
| Primary action | `--sc-primary` / `bg-primary text-primary-foreground` |
| Brand accent | `--sc-brand` / `text-brand bg-brand` |
| Danger status | `--sc-status-danger` / `text-status-danger bg-status-danger-soft` |
| Caution status | `--sc-status-caution` / `text-status-caution bg-status-caution-soft` |
| Positive status | `--sc-status-positive` / `text-status-positive bg-status-positive-soft` |
| Info status | `--sc-status-info` / `text-status-info bg-status-info-soft` |
| Info alternate | `--sc-status-info-alt` / `text-status-info-alt bg-status-info-alt-soft` |

Dark mode is driven by `<html data-theme="dark">`. `shadcn.css` redirects Tailwind's `dark:` variant to that attribute, so components should use `dark:` classes rather than a `.dark` class.

## Semantic Color

Neutral UI should stay neutral. Use color only for meaning:

| Meaning | Base hue | Utility |
|---|---|---|
| Failure / destructive | `rose` | `bg-status-danger-soft text-status-danger` |
| In progress / warning | `amber` | `bg-status-caution-soft text-status-caution` |
| Success / complete | `emerald` | `bg-status-positive-soft text-status-positive` |
| AI / model | `violet` | `bg-status-info-soft text-status-info` |
| Information / counts | `sky` | `bg-status-info-alt-soft text-status-info-alt` |

Status chips should use the semantic soft background, the matching status text utility, and a small `bg-current` dot when a quick scan cue helps. Do not write paired hue classes such as `text-rose-600 dark:text-rose-400`; the status utilities read theme tokens from `shadcn.css`.

## Rules

- Do not use bare color values in component class names: no `#hex`, `rgb(...)`, `oklch(...)`, or Tailwind arbitrary color utilities.
- Do not read legacy `var(--color-*)` tokens in CSS. CSS modules that remain should use `--sc-*`.
- Do not add one-off color meanings in a page. Reuse the semantic status utilities above.
- Use shadcn/ui primitives from `apps/web/src/components/shadcn/ui/` for low-level behavior where possible.
- Keep existing `@/components/ui/*` adapters only when they preserve the current app API; they should delegate to shadcn/Radix behavior or Tailwind classes internally.

## Validation

Run the web lint gate after styling changes:

```bash
rtk pnpm --filter @anno/web lint:css-tokens
rtk pnpm --filter @anno/web lint
```

The token gate checks Tailwind class names for bare colors and dark-mode pairing, warns when status colors are not using semantic utilities, and fails if CSS reads old `--color-*` variables.
