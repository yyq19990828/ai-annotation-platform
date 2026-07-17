/**
 * M3 · 流程录制 spec。
 *
 * 执行：`pnpm screenshots:flows`（单独 project，video:on 全程录制）
 *
 * 前置条件同 screenshots.spec.ts。
 * 只有声明文档 target 的 flow 会转码；outputs/flows 仅作为转码临时目录。
 */
import { test } from "../../fixtures/seed";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import type { Page } from "@playwright/test";
import { runE2eQuickstart } from "./e2e-quickstart";
import { runAiPreannotate } from "./ai-preannotate";
import { runReviewReject } from "./review-reject";
import { runBatchBulkActions } from "./batch-bulk-actions";
import { runAiPreVariantSelector } from "./ai-pre-variant-selector";
import { runRotatedBbox } from "./rotated-bbox";
import { runBboxDraw } from "./bbox-draw";
import { runPolylineDraw } from "./polyline-draw";
import { runPolygonDraw } from "./polygon-draw";
import { runMaskDraw } from "./mask-draw";
import { runVideoTrack } from "./video-track";
import { runAiTrackerPanel } from "./ai-tracker-panel";
import { runPointcloudControls } from "./pointcloud-controls";
import { runPointcloudView } from "./pointcloud-view";
import { runVideoDraw } from "./video-draw";
import { runHotkeyCheatSheet } from "./hotkey-cheatsheet";
import {
  runSamInteractive,
  runSamToolRecording,
  type SamRecordingTool,
} from "./sam-interactive";
import { runOcrInference, type OcrCleanupRecord } from "./ocr-inference";
import { installRecordingWorkbenchLayout } from "./_workbench-layout";
import { convertToGif, convertToWebm } from "../_helpers/recorder";
import { installScreenshotEnvironment } from "../environment";
import { loadScreenshotCatalog } from "../catalog-runtime";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const REPO_ROOT = HERE.replace(/\/apps\/web\/e2e\/screenshots\/flows\/?$/, "");
const FLOWS_OUT = path.join(REPO_ROOT, "apps/web/e2e/screenshots/outputs/flows");
const DOCS_IMAGES = path.join(REPO_ROOT, "docs-site/user-guide/images");
const HOME_MEDIA = path.join(REPO_ROOT, "docs-site/public/home");
const VALIDATE_ONLY = process.env.SCREENSHOT_VALIDATE_ONLY === "1";

let cached: ScreenshotSeedCatalog | null = null;
const ocrCleanupRecords: OcrCleanupRecord[] = [];

test.beforeAll(() => {
  cached = loadScreenshotCatalog();
});

// flow 会修改任务状态、标注和预标注作业。结束后由 screenshots profile
// 重建自己管理的固定项目，不再按几何类型猜测并删除数据。
test.afterAll(() => {
  if (!cached) return;
  // 推理完成时已清一次；整组结束再幂等清理一次可变业务痕迹，
  // 然后才重建 seed。审计表是平台不可变安全记录，录制器不绕过该约束。
  for (const record of ocrCleanupRecords) cleanupOcrRecording(record);
  const backends = Object.values(cached.projects)
    .map((project) => project.ml_backend?.name)
    .filter((name): name is string => Boolean(name));
  const mode = backends.length > 0 && backends.every((name) => name === "mock-v2-backend")
    ? "stub"
    : "live";
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/seed.py",
      "--profile", "screenshots",
      "--offline",
      "--repair",
      "--ml-backend-mode", mode,
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: { ...process.env, PYTHONPATH: "." },
      stdio: "inherit",
    },
  );
});

function cleanupOcrRecording(record: OcrCleanupRecord): void {
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/cleanup_screenshot_ocr_flow.py",
      "--project-id", record.projectId,
      "--task-id", record.taskId,
      "--celery-task-id", record.celeryTaskId,
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: { ...process.env, PYTHONPATH: "." },
      stdio: "inherit",
    },
  );
}

async function finalize(
  page: Page,
  gifName: string,
  // 文档站目标 gif 绝对路径（不填则只产出到 outputs/flows/）
  docsTarget?: string,
  // GIF 转码参数（不填默认 fps:10 / maxWidth:1280）；工作台画面细节多时调小避免超 5MB；
  // startSec/durationSec 裁掉录屏开头(准备)与结尾(清理)，只留核心片段。
  gifOpts?: { fps?: number; maxWidth?: number; startSec?: number; durationSec?: number },
) {
  if (VALIDATE_ONLY) {
    await page.close();
    return;
  }
  if (!docsTarget) {
    await page.close();
    return;
  }
  const video = page.video();
  if (!video) {
    throw new Error("[flows] video 未开启，检查 playwright config 的 flows project");
  }

  const outWebm = path.join(FLOWS_OUT, `${gifName}.webm`);
  const outGif  = path.join(FLOWS_OUT, `${gifName}.gif`);

  // video 只在 page 关闭后才写完整；先 close 再 saveAs（saveAs 会等视频落盘），
  // 避免直接读 video.path() 拿到半截 webm 导致 ffmpeg palettegen 失败（短流程必踩）。
  await page.close();
  fs.mkdirSync(FLOWS_OUT, { recursive: true });
  try {
    await video.saveAs(outWebm);
    await convertToGif(outWebm, outGif, {
      fps: gifOpts?.fps ?? 10,
      maxWidth: gifOpts?.maxWidth ?? 1280,
      startSec: gifOpts?.startSec,
      durationSec: gifOpts?.durationSec,
    });
    if (!fs.existsSync(outGif)) {
      throw new Error(`[flows] ${gifName}: GIF 未生成，请安装 ffmpeg 或检查 FFMPEG_PATH`);
    }
    fs.mkdirSync(path.dirname(docsTarget), { recursive: true });
    fs.copyFileSync(outGif, docsTarget);
    console.log(`[flows] ✓ 同步 gif 到文档站：${docsTarget}`);
  } finally {
    fs.rmSync(outWebm, { force: true });
    fs.rmSync(outGif, { force: true });
    fs.rmSync(outGif.replace(/\.gif$/, ".palette.png"), { force: true });
  }
}

async function finalizeHomepageWebm(
  page: Page,
  name: string,
  trim: { startSec?: number; durationSec?: number },
  docsGifTarget?: string,
) {
  if (VALIDATE_ONLY) {
    await page.close();
    return;
  }
  const video = page.video();
  if (!video) throw new Error("[flows] video 未开启，无法生成首页 AI 媒体");

  const source = path.join(FLOWS_OUT, `${name}.source.webm`);
  const gif = path.join(FLOWS_OUT, `${name}.gif`);
  await page.close();
  fs.mkdirSync(FLOWS_OUT, { recursive: true });
  try {
    await video.saveAs(source);
    const posterAtSec = Math.max(1, (trim.durationSec ?? 4) - 2.8);
    await convertToWebm(source, path.join(HOME_MEDIA, `${name}.webm`), {
      ...trim,
      fps: 12,
      maxWidth: 960,
      posterAtSec,
      posterPath: path.join(HOME_MEDIA, `${name}-poster.webp`),
    });
    if (docsGifTarget) {
      await convertToGif(source, gif, {
        ...trim,
        fps: 8,
        maxWidth: 860,
      });
      fs.mkdirSync(path.dirname(docsGifTarget), { recursive: true });
      fs.copyFileSync(gif, docsGifTarget);
      console.log(`[flows] ✓ 同步 gif 到文档站：${docsGifTarget}`);
    }
  } finally {
    fs.rmSync(source, { force: true });
    fs.rmSync(gif, { force: true });
    fs.rmSync(gif.replace(/\.gif$/, ".palette.png"), { force: true });
  }
}

function hasLiveSam3(catalog: ScreenshotSeedCatalog): boolean {
  const backend = catalog.projects.image_demo.ml_backend;
  return Boolean(
    backend?.name.toLowerCase().includes("sam3") ||
    (backend?.capabilities.models ?? []).some((model) =>
      [model.id, model.model_family].some(
        (value) => typeof value === "string" && value.toLowerCase().includes("sam3"),
      ),
    ),
  );
}

test.describe("flow recordings", () => {
  test("e2e-quickstart — 登录→标注→提交", async ({ page }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    await installScreenshotEnvironment(page);
    await runE2eQuickstart(page, cached);
    await finalize(page, "e2e-quickstart");
  });

  test("ai-preannotate — AI 预标注发起流程", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await runAiPreannotate(page, cached);
    await finalize(page, "ai-preannotate");
  });

  const samToolDemos: Array<{
    tool: SamRecordingTool;
    label: string;
    target: string;
    fps?: number;
    maxWidth?: number;
  }> = [
    { tool: "smart-point", label: "智能点", target: "smart-point-interaction.gif" },
    { tool: "smart-box", label: "智能框", target: "smart-box-interaction.gif" },
    {
      tool: "exemplar",
      label: "Exemplar 示例",
      target: "exemplar-interaction.gif",
      fps: 6,
      maxWidth: 760,
    },
  ];

  for (const demo of samToolDemos) {
    test(`sam-tool-${demo.tool} — ${demo.label}真实推理`, async ({ page, seed }) => {
      if (!cached) throw new Error("screenshot seed catalog 未完成");
      test.skip(!hasLiveSam3(cached), "真实 SAM 工具 GIF 只由 live SAM3 场景更新");
      test.setTimeout(150_000);
      const t0 = Date.now();
      await seed.injectToken(page, cached.users.admin.email);
      await installRecordingWorkbenchLayout(page, "none");
      const win = await runSamToolRecording(page, cached, demo.tool);
      await finalize(
        page,
        `sam-${demo.tool}`,
        path.join(DOCS_IMAGES, "sam", demo.target),
        {
          fps: demo.fps ?? 8,
          maxWidth: demo.maxWidth ?? 860,
          ...drawTrim(win, t0),
        },
      );
    });
  }

  test("sam-interactive — Magic Box 候选→人工确认", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.skip(!hasLiveSam3(cached), "首页 AI 视频只由 live SAM3 场景更新，stub 模式保留现有资产");
    test.setTimeout(150_000);
    const t0 = Date.now();
    // 首页视频保留候选虚线与 toast 的自然动效，因此不安装面向静态 PNG 的
    // fixed-time / reduced-motion 截图环境。
    await seed.injectToken(page, cached.users.admin.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runSamInteractive(page, cached);
    await finalizeHomepageWebm(
      page,
      "ai-assisted-annotation",
      drawTrim(win, t0),
      path.join(DOCS_IMAGES, "sam/magic-box-interaction.gif"),
    );
  });

  test("review-reject — 审核拒回流程", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.reviewer.email);
    await installRecordingWorkbenchLayout(page, "both");
    await runReviewReject(page, cached);
    await finalize(page, "review-reject");
  });

  test("batch-bulk-actions — 批次多选批量操作", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await runBatchBulkActions(page, cached);
    await finalize(page, "batch-bulk-actions", path.join(DOCS_IMAGES, "projects/batch-bulk-actions.gif"));
  });

  test("ai-pre-variant-selector — 变体两轴联动", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await runAiPreVariantSelector(page, cached);
    await finalize(page, "ai-pre-variant-selector", path.join(DOCS_IMAGES, "projects/ai-pre-variant-selector.gif"));
  });

  test("ocr-inference — 真实 RapidOCR 当前题推理", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000);
    const t0 = Date.now();
    // 保留推理中 badge / loader 的自然动效，不安装静态 PNG 专用的禁动环境。
    await seed.injectToken(page, cached.users.project_admin.email);
    await installRecordingWorkbenchLayout(page, "both");
    let cleanupRecord: OcrCleanupRecord | null = null;
    const win = await runOcrInference(page, cached, (record) => {
      cleanupRecord = record;
      ocrCleanupRecords.push(record);
    });
    if (!cleanupRecord) throw new Error("[ocr-inference] 未记录无痕清理标识");
    cleanupOcrRecording(cleanupRecord);
    await finalize(
      page,
      "ocr-real-scene",
      path.join(DOCS_IMAGES, "workbench/ocr-real-scene.gif"),
      { fps: 6, maxWidth: 860, ...drawTrim(win, t0) },
    );
  });

  test("rotated-bbox — 旋转框绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now(); // 录屏起点参照（page 在测试体前创建，t0≈video t=0）
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runRotatedBbox(page, cached);
    await finalize(
      page,
      "rotated-bbox",
      path.join(DOCS_IMAGES, "workbench/rotated-bbox.gif"),
      { fps: 8, maxWidth: 900, ...drawTrim(win, t0) },
    );
  });

  test("bbox-draw — 矩形绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runBboxDraw(page, cached);
    await finalize(
      page,
      "bbox-draw",
      path.join(DOCS_IMAGES, "bbox/draw-in-progress.gif"),
      { fps: 8, maxWidth: 900, ...drawTrim(win, t0) },
    );
  });

  test("polyline-draw — 折线逐点绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runPolylineDraw(page, cached);
    await finalize(
      page,
      "polyline-draw",
      path.join(DOCS_IMAGES, "polyline/draw-in-progress.gif"),
      { fps: 8, maxWidth: 900, ...drawTrim(win, t0) },
    );
  });

  test("polygon-draw — 多边形逐点绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runPolygonDraw(page, cached);
    await finalize(
      page,
      "polygon-draw",
      path.join(DOCS_IMAGES, "polygon/draw-in-progress.gif"),
      { fps: 8, maxWidth: 900, ...drawTrim(win, t0) },
    );
  });

  test("mask-draw — Mask 笔刷涂抹", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runMaskDraw(page, cached);
    await finalize(
      page,
      "mask-draw",
      path.join(DOCS_IMAGES, "mask-brush/draw-in-progress.gif"),
      { fps: 8, maxWidth: 900, ...drawTrim(win, t0) },
    );
  });

  test("video-track — 视频时序工作台", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoTrack(page, cached);
    await finalize(
      page,
      "video-track",
      // 视频运动多、调色板帧间变化大，fps/宽度比画布 flow 再降一档以压到 5MB 内。
      // 收起边栏后画布变宽、帧间变化更大，maxWidth 再降到 640 才稳压 5MB。
      path.join(DOCS_IMAGES, "workbench/video-track-overview.gif"),
      { fps: 6, maxWidth: 640, ...drawTrim(win, t0) },
    );
  });

  test("ai-tracker-panel — AI 追踪面板拖动缩放与互斥", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runAiTrackerPanel(page, cached);
    await finalize(
      page,
      "ai-tracker-panel",
      path.join(DOCS_IMAGES, "video-propagate/ai-tracking-panel-interaction.gif"),
      { fps: 8, maxWidth: 760, ...drawTrim(win, t0) },
    );
  });

  test("pointcloud-controls — 点云控件(上色/点大小/深度)", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(60000); // 点云 PCD 加载 + SwiftShader 渲染重, 默认 30s 不够
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runPointcloudControls(page, cached);
    await finalize(
      page,
      "pointcloud-controls",
      // 3D 点云画面细节密、调色板帧间变化大，沿用视频档 fps6/720 压到 5MB 内。
      path.join(DOCS_IMAGES, "workbench/pointcloud-controls-bar.gif"),
      { fps: 6, maxWidth: 720, ...drawTrim(win, t0) },
    );
  });

  test("pointcloud-view — 点云视图导航(拖动旋转)", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(60000); // 点云 PCD 加载 + SwiftShader 渲染重, 默认 30s 不够
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runPointcloudView(page, cached);
    await finalize(
      page,
      "pointcloud-view",
      // 整片点云随 orbit 旋转、帧间变化比逐项切控件大得多，调色板更新猛，
      // 比控件档再降一档到 fps5/620(同 video-draw)才稳压 5MB 内。
      path.join(DOCS_IMAGES, "workbench/pointcloud-view-orbit.gif"),
      { fps: 5, maxWidth: 620, ...drawTrim(win, t0) },
    );
  });

  test("video-draw — 视频画框轨迹(track 关键帧插值)", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(60000); // 视频解码 + 两次画框 + 来回逐帧, 默认 30s 不够
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoDraw(page, cached);
    await finalize(
      page,
      "video-draw",
      // 画框+逐帧插值帧间变化大, 比其它 flow 再降一档(fps5/620)压到 5MB 内。
      path.join(DOCS_IMAGES, "workbench/video-track-trajectory.gif"),
      { fps: 5, maxWidth: 620, ...drawTrim(win, t0) },
    );
  });

  test("hotkey-cheatsheet — 键盘快捷键面板(? 打开)", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runHotkeyCheatSheet(page, cached);
    await finalize(
      page,
      "hotkey-cheatsheet",
      // 面板以文字 + kbd 为主、帧间变化小，沿用画布档 fps8/900 即可压到 5MB 内。
      path.join(DOCS_IMAGES, "workbench/hotkey-cheatsheet.gif"),
      { fps: 8, maxWidth: 900, ...drawTrim(win, t0) },
    );
  });
});

// 由绘制起止时间戳算 GIF 裁剪窗口：startSec 跳过开头(加载/隐藏预测/选工具)，
// durationSec 只留绘制段(裁掉结尾的删除清理)。win 为 null(工具缺失)时不裁。
function drawTrim(
  win: { drawStartMs: number; drawEndMs: number } | null,
  t0: number,
): { startSec?: number; durationSec?: number } {
  if (!win) return {};
  const startSec = Math.max(0, (win.drawStartMs - t0) / 1000 - 0.4);
  const durationSec = (win.drawEndMs - win.drawStartMs) / 1000 + 0.8;
  return { startSec, durationSec };
}
