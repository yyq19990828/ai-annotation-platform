---
name: shadcn
description: Compose, add, or update locally owned shadcn/Radix primitives in apps/web. Use for component API and theme integration, not unrelated frontend work or docs-site.
user-invocable: false
---

# Local shadcn components

## Project source of truth

Read `apps/web/components.json` and the relevant local primitive before changing it. This is a React/Vite SPA with `rsc: false`, Tailwind 4, the `new-york` style, Radix primitives, and Lucide icons.

- Owned primitives: `apps/web/src/components/shadcn/ui/` (`@/components/shadcn/ui`).
- Compatibility APIs: `apps/web/src/components/ui/`. Preserve adapters when callers rely on them; inspect the typed `Icon` and toast-store APIs before replacing them.
- Utilities: `@/lib/utils`. Runtime theme: `apps/web/src/styles/shadcn.css`.

Reuse installed components and their actual variants/props. Upstream examples do not prove a component is installed or that its API matches local modifications. Keep dialog titles, labels, focus handling, invalid/disabled states, and correct Radix trigger composition. Do not require unavailable components or refactor all forms/cards for uniformity.

## Updating components

The root already provides the shadcn CLI. From `apps/web`, use `pnpm exec shadcn --help` and the applicable subcommand help to check the installed version's options. Use `info` when configuration discovery is needed, `docs <component>` for an uncertain upstream API, and `add <component> --dry-run` / `--diff` to inspect an update before applying it. Do not fetch `@latest` for every local edit.

Use the configured or user-specified registry; ordinary upstream components can use the built-in registry. Ask only if choosing among materially different third-party blocks would change the result. Preserve local changes when merging updates. Preset/theme replacement must stay within the user's requested scope and existing authorization.

After adding code, inspect imports, required subcomponents, icons, dependencies, and theme integration. Follow [customization](customization.md) for this project's token mapping.

## Optional upstream references

Read only the relevant reference when local source does not answer the question. These are upstream examples, not additional project mandates: component availability, defaults, CLI options, and styling differ by version. The local implementation and project rules take precedence.

- [Forms](rules/forms.md), [composition](rules/composition.md), [Radix versus Base](rules/base-vs-radix.md): unfamiliar primitive composition.
- [Icons](rules/icons.md), [styling](rules/styling.md): upstream conventions; check local adapters/selectors first.
- [CLI](cli.md), [registries](registry.md), [MCP](mcp.md): requested registry/tooling work. Use installed CLI help before executing examples.

Run the token gate for styling changes and appropriate component/interaction checks. Do not apply this React skill to Vue/VitePress.
