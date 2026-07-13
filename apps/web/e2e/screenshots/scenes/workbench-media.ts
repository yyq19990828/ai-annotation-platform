import type { ScreenshotScene } from "./_types";

export const WORKBENCH_MEDIA_SCENES: ScreenshotScene[] = [
  {
    name: "workbench/video-real-scene",
    role: "admin",
    fixture: {
      project: "video_demo",
      task: "tracking",
      backend: "video_tracker",
      capabilities: ["task:tracker"],
    },
    route: (catalog) => {
      const project = catalog.projects.video_demo;
      return `/projects/${project.id}/annotate?task=${project.tasks.tracking.id}`;
    },
    prepare: async (page) => {
      await page.getByTestId("video-timeline-shell").waitFor({ state: "visible", timeout: 15_000 });
      await page.getByTestId("video-konva-stage").waitFor({ state: "visible", timeout: 10_000 });
      await page.getByText("实时同步", { exact: true }).waitFor({ timeout: 5000 });
      await page.waitForTimeout(800);
    },
    target: "docs-site/user-guide/images/workbench/video-real-scene.png",
  },
  {
    name: "workbench/pointcloud-real-scene",
    role: "admin",
    fixture: { project: "pointcloud_demo", task: "frame_000" },
    route: (catalog) => {
      const project = catalog.projects.pointcloud_demo;
      return `/projects/${project.id}/annotate?task=${project.tasks.frame_000.id}`;
    },
    prepare: async (page) => {
      await page.getByTestId("pc-viewport").waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(1800);
    },
    target: "docs-site/user-guide/images/workbench/pointcloud-real-scene.png",
  },
  {
    name: "workbench/ocr-real-scene",
    role: "admin",
    fixture: {
      project: "ocr_demo",
      task: "ocr",
      backend: "ocr",
      capabilities: ["task:ocr", "output:polygon", "attribute:text"],
    },
    route: (catalog) => {
      const project = catalog.projects.ocr_demo;
      return `/projects/${project.id}/annotate?task=${project.tasks.ocr.id}`;
    },
    prepare: async (page) => {
      await page.getByTestId("workbench-stage").waitFor({ state: "visible", timeout: 10_000 });
      const aiButton = page.getByTitle("打开 AI 面板");
      await aiButton.click();
      await page.getByTestId("ai-prediction-popover").waitFor({ state: "visible", timeout: 5000 });
      await page.waitForTimeout(300);
    },
    target: "docs-site/user-guide/images/workbench/ocr-real-scene.png",
  },
];
