---
name: design-taste-frontend
description: Design or refine this project's public landing and marketing surfaces. Excludes annotation workbenches, admin screens, and routine component fixes.
---

# Public product surfaces

Match the user's audience, references, and requested degree of change. Preserve existing brand and information architecture unless their change is part of the task. A review request produces findings; implement when requested.

## Locate the surface

- The documentation homepage is Vue/VitePress: `docs-site/.vitepress/theme/components/DocsHome.vue`, `components/home/`, and `docs-home.css`.
- Reading pages use `docs-theme.css`. Keep `--home-*` brand treatment scoped to the homepage and `--docs-*` reading tokens separate. VitePress uses `html.dark`; the React app uses `data-theme`.
- Consult [the design system](../../../docs-site/dev/reference/design-system.md) for the relevant surface. Keep local fonts and existing assets; do not introduce React/RSC, another component system, an animation library, or new fonts just to match a generic aesthetic.

## Shape the result

Use content hierarchy, readable type, and purposeful spacing to communicate the real product. Choose layout and imagery for the content; there are no mandatory aesthetic dials, font bans, section quotas, or animation requirements.

Use verified product screenshots or recordings for claims about annotation capabilities. Do not invent adoption metrics, testimonials, dates, or model output. Illustrative material should be recognizable as illustration. For capture and published media provenance, use [aap-doc-media](../aap-doc-media/SKILL.md).

Retain working destinations, accessible labels and focus, meaningful alternative text, contrast, responsive behavior, and reduced-motion support. Any added motion should explain state or hierarchy and clean up its resources. Keep the primary action easy to find without removing necessary content to meet a word count.

Inspect the changed page at relevant viewport sizes and in both supported themes. Verify links and interactions. Run the relevant build or targeted checks; use performance tooling when loading or animation changes warrant it.
