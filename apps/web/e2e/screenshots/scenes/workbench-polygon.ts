import type { ScreenshotScene } from "./_types";

export const POLYGON_SCENES: ScreenshotScene[] = [
  {
    name: "polygon/vertex-edit",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const polygonBtn = page.getByTestId("tool-btn-polygon");
      if (await polygonBtn.count()) await polygonBtn.click();
    },
    target: "docs-site/user-guide/images/polygon/vertex-edit.png",
  },
  {
    name: "polygon/close-hint",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      const polygonBtn = page.getByTestId("tool-btn-polygon");
      if (await polygonBtn.count()) await polygonBtn.click();
    },
    target: "docs-site/user-guide/images/polygon/close-hint.png",
  },
];
