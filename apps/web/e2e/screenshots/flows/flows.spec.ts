/**
 * M3 · 流程录制 spec。
 *
 * 执行：`pnpm screenshots:flows`（单独 project，video:on 全程录制）
 *
 * 前置条件同 screenshots.spec.ts。
 * 每条 test 跑完后把 .webm → GIF 落到
 * apps/web/e2e/screenshots/outputs/flows/。
 */
import { test } from "../../fixtures/seed";
import type { SeedData } from "../../fixtures/seed";
import type { Page } from "@playwright/test";
import { runE2eQuickstart } from "./e2e-quickstart";
import { runAiPreannotate } from "./ai-preannotate";
import { runReviewReject } from "./review-reject";
import { runBatchBulkActions } from "./batch-bulk-actions";
import { runAiPreVariantSelector } from "./ai-pre-variant-selector";
import { runRotatedBbox } from "./rotated-bbox";
import { runPolylineDraw } from "./polyline-draw";
import { convertToGif } from "../_helpers/recorder";
import path from "path";
import fs from "fs";

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const REPO_ROOT = HERE.replace(/\/apps\/web\/e2e\/screenshots\/flows\/?$/, "");
const FLOWS_OUT = path.join(REPO_ROOT, "apps/web/e2e/screenshots/outputs/flows");
const DOCS_GIF  = path.join(REPO_ROOT, "docs-site/user-guide/images/getting-started");
const DOCS_IMAGES = path.join(REPO_ROOT, "docs-site/user-guide/images");

let cached: SeedData | null = null;

test.beforeAll(async ({ request }) => {
  const res = await request.get(
    `${process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000"}/api/v1/__test/seed/peek`,
  );
  if (!res.ok()) throw new Error(`seed/peek failed: ${res.status()}`);
  const peek = (await res.json()) as {
    admin_email: string | null;
    project_id: string | null;
    task_id: string | null;
  };
  if (!peek.admin_email) throw new Error("seed/peek: 找不到 admin 用户");
  cached = {
    admin_email:     peek.admin_email,
    annotator_email: peek.admin_email,
    reviewer_email:  peek.admin_email,
    project_id:      peek.project_id ?? "",
    task_ids:        peek.task_id ? [peek.task_id] : [],
    ml_backend_id:   "",
  };
});

async function finalize(
  page: Page,
  gifName: string,
  // 文档站目标 gif 绝对路径（不填则只产出到 outputs/flows/）
  docsTarget?: string,
) {
  const video = page.video();
  if (!video) {
    console.warn("[flows] video 未开启，检查 playwright config 的 flows project");
    return;
  }

  const outWebm = path.join(FLOWS_OUT, `${gifName}.webm`);
  const outGif  = path.join(FLOWS_OUT, `${gifName}.gif`);

  // video 只在 page 关闭后才写完整；先 close 再 saveAs（saveAs 会等视频落盘），
  // 避免直接读 video.path() 拿到半截 webm 导致 ffmpeg palettegen 失败（短流程必踩）。
  await page.close();
  fs.mkdirSync(FLOWS_OUT, { recursive: true });
  await video.saveAs(outWebm);
  await convertToGif(outWebm, outGif, { fps: 10, maxWidth: 1280 });

  // 同步 gif 到文档站
  const docsGif = docsTarget ?? (gifName === "e2e-quickstart" ? path.join(DOCS_GIF, "e2e.gif") : null);
  if (docsGif && fs.existsSync(outGif)) {
    fs.mkdirSync(path.dirname(docsGif), { recursive: true });
    fs.copyFileSync(outGif, docsGif);
    console.log(`[flows] ✓ 同步 gif 到文档站：${docsGif}`);
  }
}

test.describe("flow recordings", () => {
  test("e2e-quickstart — 登录→标注→提交", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runE2eQuickstart(page, cached);
    await finalize(page, "e2e-quickstart");
  });

  test("ai-preannotate — AI 预标注发起流程", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runAiPreannotate(page, cached);
    await finalize(page, "ai-preannotate");
  });

  test("review-reject — 审核拒回流程", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.reviewer_email);
    await runReviewReject(page, cached);
    await finalize(page, "review-reject");
  });

  test("batch-bulk-actions — 批次多选批量操作", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runBatchBulkActions(page);
    await finalize(page, "batch-bulk-actions", path.join(DOCS_IMAGES, "projects/batch-bulk-actions.gif"));
  });

  test("ai-pre-variant-selector — 变体两轴联动", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runAiPreVariantSelector(page);
    await finalize(page, "ai-pre-variant-selector", path.join(DOCS_IMAGES, "projects/ai-pre-variant-selector.gif"));
  });

  test("rotated-bbox — 旋转框绘制+旋转", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runRotatedBbox(page, cached);
    await finalize(page, "rotated-bbox", path.join(DOCS_IMAGES, "workbench/rotated-bbox.gif"));
  });

  test("polyline-draw — 折线逐点绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runPolylineDraw(page, cached);
    await finalize(page, "polyline-draw", path.join(DOCS_IMAGES, "polyline/draw-in-progress.gif"));
  });
});
