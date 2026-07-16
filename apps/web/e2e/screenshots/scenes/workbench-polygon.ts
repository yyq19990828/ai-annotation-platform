import type { ScreenshotScene } from "./_types";

export const POLYGON_SCENES: ScreenshotScene[] = [
  {
    name: "polygon/vertex-edit",
    role: "annotator",
    fixture: { project: "image_demo", task: "annotating" },
    route: (catalog) => {
      const project = catalog.projects.image_demo;
      return `/projects/${project.id}/annotate?task=${project.tasks.annotating.id}`;
    },
    prepare: async (page) => {
      await page.getByTestId("workbench-stage").waitFor({ timeout: 10_000 });
      await page.getByTestId("tool-btn-polygon").click();
    },
    target: "docs-site/user-guide/images/polygon/vertex-edit.png",
  },
  {
    name: "polygon/close-hint",
    role: "annotator",
    fixture: { project: "image_demo", task: "annotating" },
    route: (catalog) => {
      const project = catalog.projects.image_demo;
      return `/projects/${project.id}/annotate?task=${project.tasks.annotating.id}`;
    },
    prepare: async (page) => {
      await page.getByTestId("workbench-stage").waitFor({ timeout: 10_000 });
      await page.getByTestId("tool-btn-polygon").click();
    },
    target: "docs-site/user-guide/images/polygon/close-hint.png",
  },
];
