import type { ScreenshotScene } from "./_types";
import { openCoco8Annotate } from "../flows/_canvas";

async function openPolygonWorkbench(
  page: Parameters<NonNullable<ScreenshotScene["prepare"]>>[0],
  data: Parameters<NonNullable<ScreenshotScene["prepare"]>>[1],
) {
  if (!(await openCoco8Annotate(page, data.admin_email))) {
    throw new Error("polygon screenshots require seeded image project P-COCO8");
  }
}

export const POLYGON_SCENES: ScreenshotScene[] = [
  {
    name: "polygon/vertex-edit",
    role: "annotator",
    route: () => "/",
    prepare: async (page, data) => {
      await openPolygonWorkbench(page, data);
      await page.getByTestId("tool-btn-polygon").click();
    },
    target: "docs-site/user-guide/images/polygon/vertex-edit.png",
  },
  {
    name: "polygon/close-hint",
    role: "annotator",
    route: () => "/",
    prepare: async (page, data) => {
      await openPolygonWorkbench(page, data);
      await page.getByTestId("tool-btn-polygon").click();
    },
    target: "docs-site/user-guide/images/polygon/close-hint.png",
  },
];
