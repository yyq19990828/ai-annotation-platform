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

Dark mode is driven by `<html data-theme="dark">`. `shadcn.css` redirects Tailwind's `dark:` variant to that attribute, so components should use `dark:` classes rather than a `.dark` class.

## Semantic Color

Neutral UI should stay neutral. Use color only for meaning:

| Meaning | Tailwind hue | Example |
|---|---|---|
| Information / counts | `sky` | `bg-sky-500/10 text-sky-600 dark:text-sky-400` |
| Success / complete | `emerald` | `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400` |
| AI / model | `violet` | `bg-violet-500/10 text-violet-600 dark:text-violet-400` |
| In progress / warning | `amber` | `bg-amber-500/10 text-amber-600 dark:text-amber-400` |
| Failure / destructive | `rose` | `bg-rose-500/10 text-rose-600 dark:text-rose-400` |

Status chips should use a soft background, paired light/dark text, and a small `bg-current` dot when a quick scan cue helps.

## Rules

- Do not use bare color values in component class names: no `#hex`, `rgb(...)`, `oklch(...)`, or Tailwind arbitrary color utilities.
- Do not read legacy `var(--color-*)` tokens in CSS. CSS modules that remain should use `--sc-*`.
- Do not add one-off color meanings in a page. Reuse the semantic hues above.
- Use shadcn/ui primitives from `apps/web/src/components/shadcn/ui/` for low-level behavior where possible.
- Keep existing `@/components/ui/*` adapters only when they preserve the current app API; they should delegate to shadcn/Radix behavior or Tailwind classes internally.

## Validation

Run the web lint gate after styling changes:

```bash
rtk pnpm --filter @anno/web lint:css-tokens
rtk pnpm --filter @anno/web lint
```

The token gate checks Tailwind class names for bare colors and dark-mode pairing, and it fails if CSS reads old `--color-*` variables.
