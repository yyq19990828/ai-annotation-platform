---
name: redesign-existing-projects
description: Audit or improve an identified existing product interface in this project, preserving annotation workflows, data, and the target surface's design system.
---

# Existing interface improvements

Inspect the requested screen and its implementation. Connect each proposed change to an observed readability, usability, consistency, or accessibility problem. For review-only requests, report findings; for requested changes, implement within that scope.

The app is a compact React/Vite annotation tool. Follow [the design system](../../../docs-site/dev/reference/design-system.md), local shadcn primitives, compatibility adapters, and Lucide icons. Preserve useful data density, semantic status/AI colors, and existing navigation. The Vue/VitePress site has separate tokens and typography; public landing work belongs to [design-taste-frontend](../design-taste-frontend/SKILL.md).

Prioritize the affected hierarchy, control alignment, overflow, and missing interaction states. Keep real data and copy accurate. Font swaps, extra texture, asymmetric layouts, scroll effects, and new icon libraries are choices for an explicit design goal, not automatic upgrades.

Workbench changes must retain editing, selection, undo, focus, keyboard isolation, locks, and saved layout/preferences. For changes to their ownership or lifecycle, use [aap-workbench-state](../aap-workbench-state/SKILL.md). A screenshot alone cannot verify these behaviors.

For Data Manager charts, theme switching must refresh computed chart colors without a remount. Drill-down filters must use stored attribute values while displaying human-readable labels; check `apps/web/src/pages/Projects/data-manager/DataManagerCharts.tsx` and its tests.

Check relevant loading/error/empty states, keyboard focus, target viewport, and supported themes. For app styling, run `pnpm --filter @anno/web lint:css-tokens`. Exercise changed interactions and inspect recent network/console errors. Update visual baselines only after confirming the intended result.
