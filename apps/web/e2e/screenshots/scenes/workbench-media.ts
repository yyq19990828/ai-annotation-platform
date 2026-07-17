import type { ScreenshotScene } from "./_types";
import type { Page } from "@playwright/test";
import {
  installRecordingWorkbenchLayout,
  waitForRecordingWorkbenchLayout,
} from "../flows/_workbench-layout";

async function reloadWithSidebarLayout(page: Page, mode: "both" | "none"): Promise<void> {
  await installRecordingWorkbenchLayout(page, mode);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForRecordingWorkbenchLayout(page, mode);
}

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
      await reloadWithSidebarLayout(page, "both");
      await page.getByTestId("video-timeline-shell").waitFor({ state: "visible", timeout: 15_000 });
      await page.getByTestId("video-konva-stage").waitFor({ state: "visible", timeout: 10_000 });
      await page.getByText("实时同步", { exact: true }).waitFor({ timeout: 5000 });

      // 后台追踪若在 seed repair 前刚好完成，候选审阅条可能晚到；静态场景只展示干净工作台。
      const trackerReview = page.getByTestId("video-tracker-review-bar");
      if (await trackerReview.isVisible()) {
        await page.getByTestId("tracker-review-discard").click();
        await trackerReview.waitFor({ state: "hidden", timeout: 5000 });
        await page
          .getByText("已丢弃 AI 追踪候选", { exact: true })
          .waitFor({ state: "hidden", timeout: 10_000 });
      }

      await page.getByTitle("适应视口（双击空白）").click();
      await page.waitForTimeout(800);
    },
    target: "docs-site/user-guide/images/workbench/video-real-scene.png",
  },
  {
    name: "workbench/video-ai-tracking-panel",
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
      await reloadWithSidebarLayout(page, "both");
      await page.getByTestId("video-timeline-shell").waitFor({ state: "visible", timeout: 15_000 });
      await page.getByTestId("video-konva-stage").waitFor({ state: "visible", timeout: 10_000 });

      const trackerReview = page.getByTestId("video-tracker-review-bar");
      if (await trackerReview.isVisible()) {
        await page.getByTestId("tracker-review-discard").click();
        await trackerReview.waitFor({ state: "hidden", timeout: 5000 });
      }

      await page.getByTitle("适应视口（双击空白）").click();
      await page.getByTestId("workbench-ai-tracker").click();
      await page
        .getByTestId("video-tracker-propagate-dialog")
        .waitFor({ state: "visible", timeout: 5000 });
      await page.waitForTimeout(500);
    },
    target: "docs-site/user-guide/images/video-propagate/ai-tracking-panel.png",
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
      await reloadWithSidebarLayout(page, "both");
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
      const aiButton = page.getByTestId("workbench-ai-single");
      await aiButton.click();
      await page.getByTestId("ai-prediction-popover").waitFor({ state: "visible", timeout: 5000 });
      await page.waitForTimeout(300);
    },
    target: "docs-site/user-guide/images/workbench/ocr-real-scene.png",
  },
];
