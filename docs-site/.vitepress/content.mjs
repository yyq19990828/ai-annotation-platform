// Source paths are independent from public routes. Keep this map as the shared
// source of truth for VitePress and the docs navigation checker.
export const rewrites = {
  "dev/tutorials/ml-backend-starter.md": "dev/ml-backend/starter.md",
  "redirects/projects-annotation-guide.md": "user-guide/projects/annotation-guide.md",
};

// Maintenance material and runnable examples live beside the docs sources but
// are not standalone documentation pages.
export const srcExclude = ["maintainers/**", "dev/examples/**"];
