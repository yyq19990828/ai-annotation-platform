/**
 * M3 · 流程录制 spec。
 *
 * 执行：`pnpm screenshots:flows`（单独 project，video:on 全程录制）
 *
 * 前置条件同 screenshots.spec.ts。
 * flows project 只转码声明的文档 target；marketing-master project 归档所有成功流程。
 * outputs/flows 仅作为转码临时目录。
 */
import { test } from "../../fixtures/seed";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { expect, type Page } from "@playwright/test";
import { runE2eQuickstart } from "./e2e-quickstart";
import { runAiPredictionImport } from "./ai-prediction-import";
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
import { runVideoTimelineZoom } from "./video-timeline-zoom";
import { runVideoTrackerRange } from "./video-tracker-range";
import {
  runVideoTrackBatchPropagate,
  type VideoTrackBatchPropagateCleanupRecord,
} from "./video-track-batch-propagate";
import { runVideoPropagateTrackVsCopy } from "./video-propagate-track-vs-copy";
import { runVideoMaskTrackEdit } from "./video-mask-track-edit";
import { runAiTrackerPanel } from "./ai-tracker-panel";
import { runPointcloudControls } from "./pointcloud-controls";
import { runPointcloudView } from "./pointcloud-view";
import { runPointcloudCameraSeed3dBox } from "./pointcloud-camera-seed-3d-box";
import { runPointcloudCrossframeTrack } from "./pointcloud-crossframe-track";
import { runVideoDraw } from "./video-draw";
import { runVideoChapter } from "./video-chapter";
import { runVideoMultiSeedTracking } from "./video-multi-seed-tracking";
import { runVideoTimelinePredictionNavigation } from "./video-timeline-prediction-navigation";
import { runVideoTrackerTextDiscovery } from "./video-tracker-text-discovery";
import { runVideoTrackerComboDiscovery } from "./video-tracker-combo-discovery";
import { runVideoMaskCorrectionPropagate } from "./video-mask-correction-propagate";
import { runPipelineTemplateCreate } from "./pipeline-template-create";
import { runPipelineApplyProject, type PipelineApplyCleanupRecord } from "./pipeline-apply-project";
import { runJobsRetryRecovery } from "./jobs-retry-recovery";
import {
  runModelMarketGpuResourceOverview,
  runModelMarketRuntimePartialFailure,
  runModelMarketRuntimePool,
  runModelMarketVideoPool,
} from "./model-market-runtime-pool";
import { runProjectMlRouting } from "./project-ml-routing";
import { runBackgroundExportDownload } from "./background-export-download";
import {
  PROJECT_CREATE_RECORDING_NAME,
  runProjectCreateExistingResources,
} from "./project-create-existing-resources";
import { runVideoTrackCarryover } from "./video-track-carryover";
import { runLargeImageProgressive } from "./large-image-progressive";
import { runLargeImagePyramidRecovery } from "./large-image-pyramid-recovery";
import { runLargeImageMaskLimit } from "./large-image-mask-limit";
import { runPlatformOverview } from "./platform-overview";
import { runProjectActionsMenu } from "./project-actions-menu";
import { runJobsBellActive } from "./jobs-bell-active";
import { runVideoTrackerJobStates } from "./video-tracker-job-states";
import { runSmartScribble } from "./smart-scribble";
import { runHotkeyCheatSheet } from "./hotkey-cheatsheet";
import { runSamInteractive, runSamToolRecording, type SamRecordingTool } from "./sam-interactive";
import { runOcrInference, type OcrCleanupRecord } from "./ocr-inference";
import { runCurrentTaskImageInference } from "./current-task-image-inference";
import {
  runCurrentFrameVideoInference,
  type VideoFrameInferenceCleanupRecord,
} from "./current-frame-video-inference";
import {
  runSecondaryInferenceAttribute,
  type SecondaryInferenceCleanupRecord,
} from "./secondary-inference-attribute";
import { runCandidateKeyboardReview } from "./candidate-keyboard-review";
import {
  runCandidateReviewLifecycle,
  type CandidateReviewCleanupRecord,
} from "./candidate-review-lifecycle";
import { recordingAnchor } from "./_canvas";
import { installRecordingWorkbenchLayout } from "./_workbench-layout";
import { convertToGif } from "../_helpers/recorder";
import { recordFlowArtifact } from "../_helpers/flow-manifest";
import {
  archiveMarketingMaster,
  clipFromEpochWindow,
  getMarketingRunContext,
  MARKETING_PROJECT_NAME,
} from "../_helpers/marketing-recorder";
import { marketingAssetSpec } from "../_helpers/marketing-assets";
import {
  discardExternalMarketingRecording,
  startExternalMarketingRecording,
  stopExternalMarketingRecording,
} from "../_helpers/marketing-external-recorder";
import { applyScreenshotTheme, installScreenshotEnvironment } from "../environment";
import { loadScreenshotCatalog } from "../catalog-runtime";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const REPO_ROOT = HERE.replace(/\/apps\/web\/e2e\/screenshots\/flows\/?$/, "");
const FLOWS_OUT = path.join(REPO_ROOT, "apps/web/e2e/screenshots/outputs/flows");
const DOCS_IMAGES = path.join(REPO_ROOT, "docs-site/user-guide/images");
const MARKETING_ARCHIVE_ROOT = path.join(REPO_ROOT, ".artifacts/marketing");
const VALIDATE_ONLY = process.env.SCREENSHOT_VALIDATE_ONLY === "1";
const FLOW_CAPTURE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();
const FLOW_SOURCE_WORKTREE_DIRTY =
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim().length > 0;

let cached: ScreenshotSeedCatalog | null = null;
const ocrCleanupRecords: OcrCleanupRecord[] = [];
const videoFrameInferenceCleanupRecords: VideoFrameInferenceCleanupRecord[] = [];
const secondaryInferenceCleanupRecords: SecondaryInferenceCleanupRecord[] = [];
const candidateReviewCleanupRecords: CandidateReviewCleanupRecord[] = [];
const pipelineApplyCleanupRecords: PipelineApplyCleanupRecord[] = [];
const jobsRetryCleanupRecords: Array<{ projectId: string; taskId: string }> = [];
const backgroundExportCleanupRecords: Array<{
  projectId: string;
  taskId: string;
  jobId?: string;
}> = [];

const FLOW_SOURCE_BY_ASSET: Record<string, string> = {
  "ai-assisted-annotation": "sam-interactive.ts",
  "sam-tools/smart-point": "sam-interactive.ts",
  "sam-tools/smart-box": "sam-interactive.ts",
  "sam-tools/exemplar": "sam-interactive.ts",
  "video-tracker-cross-frame-points": "video-multi-seed-tracking.ts",
  "video-tracker-positive-negative": "video-multi-seed-tracking.ts",
  "video-tracker-box-seed": "video-multi-seed-tracking.ts",
  "video-timeline-prediction-navigation": "video-timeline-prediction-navigation.ts",
  "video-propagate-track-vs-copy": "video-propagate-track-vs-copy.ts",
  "video-tracker-text-discovery": "video-tracker-text-discovery.ts",
  "video-tracker-combo-discovery": "video-tracker-combo-discovery.ts",
  "video-mask-correction-propagate": "video-mask-correction-propagate.ts",
  "pipeline-template-create": "pipeline-template-create.ts",
  "pipeline-apply-project": "pipeline-apply-project.ts",
  "jobs-retry-recovery": "jobs-retry-recovery.ts",
  "model-market-runtime-pool": "model-market-runtime-pool.ts",
  "model-market-video-pool": "model-market-runtime-pool.ts",
  "model-market-runtime-partial-failure": "model-market-runtime-pool.ts",
  "model-market-gpu-resource-overview": "model-market-runtime-pool.ts",
  "project-ml-routing": "project-ml-routing.ts",
  "background-export-download": "background-export-download.ts",
  "project-create-existing-resources": "project-create-existing-resources.ts",
  "large-image-mask-limit": "large-image-mask-limit.ts",
  "platform-overview": "platform-overview.ts",
  "project-actions-menu": "project-actions-menu.ts",
  "jobs-bell-active": "jobs-bell-active.ts",
  "video-tracker-job-states": "video-tracker-job-states.ts",
};

function flowWatchPaths(assetId: string): string[] {
  const inferred = `${assetId.replace(/^sam-tools\//, "sam-")}.ts`;
  const sourceFile = FLOW_SOURCE_BY_ASSET[assetId] ?? inferred;
  const paths = [
    `apps/web/e2e/screenshots/flows/${sourceFile}`,
    "apps/web/e2e/screenshots/flows/_canvas.ts",
    "apps/web/e2e/screenshots/flows/_workbench-layout.ts",
    "apps/web/e2e/screenshots/_helpers/recorder.ts",
    "apps/web/e2e/fixtures/seed.ts",
    "apps/api/app/services/screenshot_seed_spec.py",
    "apps/api/app/services/screenshot_seed_backends.py",
  ];
  if (assetId === "jobs-retry-recovery") {
    paths.push("apps/api/scripts/screenshot_job_recovery_fixture.py");
  }
  if (assetId === "review-reject") {
    paths.push("apps/api/scripts/screenshot_review_reject_fixture.py");
  }
  if (assetId === "background-export-download") {
    paths.push("apps/api/scripts/screenshot_background_export_fixture.py");
  }
  return paths.filter((candidate, index, all) => all.indexOf(candidate) === index);
}

function recordGeneratedArtifact(targetPath: string, assetId: string, role: "docs-gif"): void {
  const info = test.info();
  recordFlowArtifact({
    repoRoot: REPO_ROOT,
    targetPath,
    assetId,
    role,
    source: path.relative(REPO_ROOT, info.file).replaceAll("\\", "/"),
    testTitle: info.titlePath.join(" › "),
    seedRevision: cached?.seed_revision ?? null,
    capturedCommit: FLOW_CAPTURE_COMMIT,
    sourceWorktreeDirty: FLOW_SOURCE_WORKTREE_DIRTY,
    watchPaths: flowWatchPaths(assetId),
  });
}

test.beforeAll(() => {
  screenshotDatabaseEnv();
  cached = loadScreenshotCatalog();
});

function screenshotDatabaseEnv(): NodeJS.ProcessEnv {
  const databaseUrl = process.env.SCREENSHOT_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("[flows] 缺少 SCREENSHOT_DATABASE_URL，拒绝在未确认的数据库上录制或清理");
  }
  const databaseName = databaseUrl.replace(/\?.*$/, "").split("/").at(-1) ?? "";
  if (!databaseName.endsWith("_test") && !databaseName.endsWith("_e2e")) {
    throw new Error("[flows] SCREENSHOT_DATABASE_URL 必须指向名称以 _test 或 _e2e 结尾的隔离库");
  }
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: databaseUrl,
    PYTHONPATH: ".",
  };
}

function screenshotBackendMode(catalog: ScreenshotSeedCatalog): "stub" | "live" {
  const backends = Object.values(catalog.projects)
    .map((project) => project.ml_backend?.name)
    .filter((name): name is string => Boolean(name));
  return backends.length > 0 && backends.every((name) => name === "mock-v2-backend")
    ? "stub"
    : "live";
}

function repairScreenshotProfile(mode: "stub" | "live", silent = false): void {
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/seed.py",
      "--profile",
      "screenshots",
      "--offline",
      "--repair",
      "--ml-backend-mode",
      mode,
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      stdio: silent ? "pipe" : "inherit",
    },
  );
}

// flow 会修改任务状态、标注和预标注作业。结束后由 screenshots profile
// 重建自己管理的固定项目，不再按几何类型猜测并删除数据。
// Playwright 要求 hook 的 fixture 参数使用对象解构；此处确实不消费任何 fixture。
// eslint-disable-next-line no-empty-pattern
test.afterAll(({}, testInfo) => {
  if (!cached) return;
  // 推理完成时已清一次；整组结束再幂等清理一次可变业务痕迹，
  // 然后才重建 seed。审计表是平台不可变安全记录，录制器不绕过该约束。
  for (const record of ocrCleanupRecords) cleanupOcrRecording(record);
  for (const record of videoFrameInferenceCleanupRecords) cleanupVideoFrameInference(record);
  for (const record of secondaryInferenceCleanupRecords) cleanupSecondaryInference(record);
  for (const record of candidateReviewCleanupRecords) cleanupCandidateReview(record);
  for (const record of pipelineApplyCleanupRecords) cleanupPipelineApply(record);
  for (const record of jobsRetryCleanupRecords) manageJobsRetryFixture("cleanup", record);
  for (const record of backgroundExportCleanupRecords) {
    manageBackgroundExportFixture("cleanup", record);
  }
  // Playwright 会在单项失败后重启 worker，并在旧 worker 上执行 afterAll。
  // marketing-master 的 catalog 由 globalSetup 只读取一次；此时重建固定项目会让
  // 后续 worker 继续使用已经失效的项目 / 任务 ID，造成整批录制级联跳回 Dashboard。
  // 营销录制使用隔离库，由外层录制流程在整批开始前准备、结束后统一恢复。
  if (testInfo.project.name === MARKETING_PROJECT_NAME) return;
  repairScreenshotProfile(screenshotBackendMode(cached));
});

function cleanupOcrRecording(record: OcrCleanupRecord): void {
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/cleanup_screenshot_ocr_flow.py",
      "--project-id",
      record.projectId,
      "--task-id",
      record.taskId,
      "--celery-task-id",
      record.celeryTaskId,
      ...record.annotationIds.flatMap((annotationId) => ["--annotation-id", annotationId]),
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      stdio: "inherit",
    },
  );
}

function cleanupVideoFrameInference(record: VideoFrameInferenceCleanupRecord): void {
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/cleanup_screenshot_ocr_flow.py",
      "--project-key",
      "video_demo",
      "--project-id",
      record.projectId,
      "--task-id",
      record.taskId,
      ...record.annotationIds.flatMap((annotationId) => ["--annotation-id", annotationId]),
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      stdio: "inherit",
    },
  );
}

function cleanupVideoTrackBatchPropagate(record: VideoTrackBatchPropagateCleanupRecord): void {
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/cleanup_screenshot_ocr_flow.py",
      "--project-key",
      "video_demo",
      "--project-id",
      record.projectId,
      "--task-id",
      record.taskId,
      ...record.videoTrackerJobIds.flatMap((jobId) => ["--video-tracker-job-id", jobId]),
      ...record.sourceAnnotationIds.flatMap((annotationId) => ["--annotation-id", annotationId]),
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      stdio: "inherit",
    },
  );
}

function cleanupSecondaryInference(record: SecondaryInferenceCleanupRecord): void {
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/cleanup_screenshot_ocr_flow.py",
      "--project-id",
      record.projectId,
      "--task-id",
      record.taskId,
      ...record.annotationIds.flatMap((annotationId) => ["--annotation-id", annotationId]),
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      stdio: "inherit",
    },
  );
}

function cleanupCandidateReview(record: CandidateReviewCleanupRecord): void {
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/cleanup_screenshot_ocr_flow.py",
      "--project-key",
      "image_demo",
      "--project-id",
      record.projectId,
      "--task-id",
      record.taskId,
      ...record.predictionIds.flatMap((predictionId) => ["--prediction-id", predictionId]),
      ...record.annotationIds.flatMap((annotationId) => ["--annotation-id", annotationId]),
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      stdio: "inherit",
    },
  );
}

function cleanupPipelineApply(record: PipelineApplyCleanupRecord): void {
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/cleanup_screenshot_ocr_flow.py",
      "--project-key",
      "image_demo",
      "--project-id",
      record.projectId,
      "--task-id",
      record.taskId,
      ...(record.celeryTaskId ? ["--celery-task-id", record.celeryTaskId] : []),
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      stdio: "inherit",
    },
  );
}

function manageJobsRetryFixture(
  action: "seed" | "cleanup",
  record: { projectId: string; taskId: string },
  userEmail?: string,
): { backend_id?: string } {
  const output = execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/screenshot_job_recovery_fixture.py",
      action,
      "--project-id",
      record.projectId,
      "--task-id",
      record.taskId,
      ...(userEmail ? ["--user-email", userEmail] : []),
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const lastLine = output.trim().split("\n").at(-1);
  if (!lastLine) throw new Error(`[jobs-retry-recovery] ${action} 未返回夹具结果`);
  return JSON.parse(lastLine) as { backend_id?: string };
}

function manageReviewRejectFixture(
  action: "prepare" | "cleanup",
  record: { projectId: string; taskId: string },
  reviewerEmail: string,
): void {
  execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/screenshot_review_reject_fixture.py",
      action,
      "--project-id",
      record.projectId,
      "--task-id",
      record.taskId,
      "--reviewer-email",
      reviewerEmail,
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      stdio: "inherit",
    },
  );
}

function manageBackgroundExportFixture(
  action: "run" | "cleanup",
  record: { projectId: string; taskId: string; jobId?: string },
): Record<string, unknown> {
  const output = execFileSync(
    path.join(REPO_ROOT, "apps/api/.venv/bin/python"),
    [
      "scripts/screenshot_background_export_fixture.py",
      action,
      "--project-id",
      record.projectId,
      "--task-id",
      record.taskId,
      ...(record.jobId ? ["--job-id", record.jobId] : []),
    ],
    {
      cwd: path.join(REPO_ROOT, "apps/api"),
      env: screenshotDatabaseEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const lastLine = output.trim().split("\n").at(-1);
  if (!lastLine) throw new Error(`[background-export-download] ${action} 未返回夹具结果`);
  return JSON.parse(lastLine) as Record<string, unknown>;
}

type GifOptions = {
  fps?: number;
  maxWidth?: number;
  maxColors?: number;
  startSec?: number;
  durationSec?: number;
  captureWindow?: { startEpochMs: number; endEpochMs: number };
};

type MarketingClip =
  | { startSeconds: number; durationSeconds: number }
  | { tailSeconds: number }
  | { startEpochMs: number; endEpochMs: number };

function marketingClipFromVariants(
  assetId: string,
  variants: Array<{ options?: GifOptions }>,
): MarketingClip | undefined {
  marketingAssetSpec(assetId);
  const captureWindows = variants.flatMap(({ options }) =>
    options?.captureWindow ? [options.captureWindow] : [],
  );
  if (captureWindows.length > 0) {
    return {
      startEpochMs: Math.min(...captureWindows.map((window) => window.startEpochMs)),
      endEpochMs: Math.max(...captureWindows.map((window) => window.endEpochMs)),
    };
  }
  const windows = variants.flatMap(({ options }) =>
    options?.startSec !== undefined && options.durationSec !== undefined
      ? [{ start: options.startSec, end: options.startSec + options.durationSec }]
      : [],
  );
  if (windows.length === 0) return undefined;

  const contentStart = Math.min(...windows.map((window) => window.start));
  const contentEnd = Math.max(...windows.map((window) => window.end));
  return {
    startSeconds: contentStart,
    durationSeconds: contentEnd - contentStart,
  };
}

async function archiveMarketingRecording(
  page: Page,
  assetId: string,
  universalClip?: MarketingClip,
): Promise<boolean> {
  const info = test.info();
  if (info.project.name !== MARKETING_PROJECT_NAME) return false;
  const capture = await stopExternalMarketingRecording(page);
  const resolvedClip =
    universalClip && "startEpochMs" in universalClip
      ? clipFromEpochWindow(capture.startedAtEpochMs, universalClip)
      : universalClip;
  const browser = {
    name: page.context().browser()?.browserType().name() ?? "chromium",
    version: page.context().browser()?.version() ?? "unknown",
  };
  await page.close();
  try {
    const archived = await archiveMarketingMaster({
      archiveRoot: MARKETING_ARCHIVE_ROOT,
      run: getMarketingRunContext(REPO_ROOT),
      video: capture,
      captureExtension: capture.extension,
      captureDriver: capture.driver,
      deviceScaleFactor: capture.deviceScaleFactor,
      sourcePhysicalSize: capture.sourcePhysicalSize,
      captureCadence: capture.cadence,
      assetId,
      assetSpec: marketingAssetSpec(assetId),
      source: path.relative(REPO_ROOT, info.file),
      testTitle: info.titlePath.join(" › "),
      projectName: info.project.name,
      seedRevision: cached?.seed_revision ?? null,
      viewport: capture.logicalViewport,
      browser,
      universalClip: resolvedClip,
    });
    console.log(`[marketing] ✓ 4K60 采集源：${archived.capturePath}`);
    console.log(`[marketing] ✓ 4K60 MP4 母版：${archived.masterPath}`);
    console.log(`[marketing] ✓ manifest：${archived.manifestPath}`);
    return true;
  } finally {
    capture.cleanup();
  }
}

async function finalizeVariants(
  page: Page,
  gifName: string,
  variants: Array<{ target: string; options?: GifOptions }>,
  marketingClip?: MarketingClip,
) {
  if (VALIDATE_ONLY) {
    await page.close();
    return;
  }
  const resolvedMarketingClip = marketingClip ?? marketingClipFromVariants(gifName, variants);
  if (await archiveMarketingRecording(page, gifName, resolvedMarketingClip)) return;
  if (variants.length === 0) {
    await page.close();
    return;
  }
  const video = page.video();
  if (!video) {
    throw new Error("[flows] video 未开启，检查 playwright config 的 flows project");
  }

  const outWebm = path.join(FLOWS_OUT, `${gifName}.webm`);
  const outGif = path.join(FLOWS_OUT, `${gifName}.gif`);

  // video 只在 page 关闭后才写完整；先 close 再 saveAs（saveAs 会等视频落盘），
  // 避免直接读 video.path() 拿到半截 webm 导致 ffmpeg palettegen 失败（短流程必踩）。
  await page.close();
  fs.mkdirSync(FLOWS_OUT, { recursive: true });
  try {
    await video.saveAs(outWebm);
    for (const variant of variants) {
      await convertToGif(outWebm, outGif, {
        fps: variant.options?.fps ?? 10,
        maxWidth: variant.options?.maxWidth ?? 1280,
        maxColors: variant.options?.maxColors,
        startSec: variant.options?.startSec,
        durationSec: variant.options?.durationSec,
      });
      if (!fs.existsSync(outGif)) {
        throw new Error(`[flows] ${gifName}: GIF 未生成，请安装 ffmpeg 或检查 FFMPEG_PATH`);
      }
      fs.mkdirSync(path.dirname(variant.target), { recursive: true });
      fs.copyFileSync(outGif, variant.target);
      recordGeneratedArtifact(variant.target, gifName, "docs-gif");
      console.log(`[flows] ✓ 同步 gif 到文档站：${variant.target}`);
    }
  } finally {
    fs.rmSync(outWebm, { force: true });
    fs.rmSync(outGif, { force: true });
    fs.rmSync(outGif.replace(/\.gif$/, ".palette.png"), { force: true });
  }
}

async function finalize(
  page: Page,
  gifName: string,
  // 文档站目标 gif 绝对路径（不填则只执行流程验证）
  docsTarget?: string,
  // GIF 转码参数（不填默认 fps:10 / maxWidth:1280）；工作台画面细节多时调小避免超 5MB；
  // startSec/durationSec 裁掉录屏开头(准备)与结尾(清理)，只留核心片段。
  gifOpts?: GifOptions,
  marketingClip?: MarketingClip,
) {
  const resolvedMarketingClip =
    marketingClip ??
    (gifOpts ? marketingClipFromVariants(gifName, [{ options: gifOpts }]) : undefined);
  await finalizeVariants(
    page,
    gifName,
    docsTarget ? [{ target: docsTarget, options: gifOpts }] : [],
    resolvedMarketingClip,
  );
}

async function finalizeMarketingBackedHomepageAsset(
  page: Page,
  name: string,
  trim: { startSec?: number; durationSec?: number },
  docsGifTarget?: string,
  docsGifOptions?: { fps?: number; maxWidth?: number },
) {
  if (VALIDATE_ONLY) {
    await page.close();
    return;
  }
  if (
    await archiveMarketingRecording(
      page,
      name,
      marketingClipFromVariants(name, [{ options: trim }]),
    )
  )
    return;
  if (!docsGifTarget) {
    await page.close();
    return;
  }
  const video = page.video();
  if (!video) throw new Error("[flows] video 未开启，无法生成文档 GIF");

  const tempName = name.replaceAll("/", "-");
  const source = path.join(FLOWS_OUT, `${tempName}.source.webm`);
  const gif = path.join(FLOWS_OUT, `${tempName}.gif`);
  await page.close();
  fs.mkdirSync(FLOWS_OUT, { recursive: true });
  try {
    await video.saveAs(source);
    await convertToGif(source, gif, {
      ...trim,
      fps: docsGifOptions?.fps ?? 8,
      maxWidth: docsGifOptions?.maxWidth ?? 860,
    });
    fs.mkdirSync(path.dirname(docsGifTarget), { recursive: true });
    fs.copyFileSync(gif, docsGifTarget);
    recordGeneratedArtifact(docsGifTarget, name, "docs-gif");
    console.log(`[flows] ✓ 同步 gif 到文档站：${docsGifTarget}`);
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
  test.beforeEach(async ({ page, seed }, testInfo) => {
    if (
      testInfo.project.name !== MARKETING_PROJECT_NAME ||
      testInfo.title.includes("e2e-quickstart")
    ) {
      return;
    }
    if (!cached) throw new Error("screenshot seed catalog 未完成");

    // 每条营销母版拥有独立的固定数据状态。绘图、审核和视频轨迹流程都会写库；
    // 若沿用同一任务，前一条素材会改变后一条素材的画布、状态与命中目标。
    for (const record of ocrCleanupRecords.splice(0)) cleanupOcrRecording(record);
    for (const record of videoFrameInferenceCleanupRecords.splice(0)) {
      cleanupVideoFrameInference(record);
    }
    repairScreenshotProfile(screenshotBackendMode(cached), true);
    cached = await seed.screenshotCatalog();

    // image_demo 主后端保留 SAM3 供交互工具使用；批量预标单项另启用 batchable YOLO。
    if (
      testInfo.title.startsWith("ai-preannotate —") ||
      testInfo.title.startsWith("ai-pre-variant-selector —")
    ) {
      await seed.enableMLBackendByName(
        cached.projects.image_demo.id,
        cached.users.admin.email,
        "yolo-backend",
      );
    }

    if (!VALIDATE_ONLY) await startExternalMarketingRecording(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.project.name === MARKETING_PROJECT_NAME) {
      await discardExternalMarketingRecording(page);
    }
  });

  test("e2e-quickstart — 登录→标注→提交", async ({ page, seed }) => {
    test.skip(
      test.info().project.name === MARKETING_PROJECT_NAME,
      "组合教程包含多个目标，不归档为单项营销母版",
    );
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    await installScreenshotEnvironment(page);
    let recordingPage = page;
    if (test.info().project.name === MARKETING_PROJECT_NAME) {
      const context = page.context();
      const project = cached.projects.image_demo;
      await seed.injectToken(page, cached.users.admin.email);
      await installRecordingWorkbenchLayout(page, "none");
      await page.goto(`/projects/${project.id}/annotate?task=${project.tasks.clean.id}`);
      await expect(page.getByTestId("workbench-stage")).toHaveAttribute(
        "data-image-ready",
        "true",
        { timeout: 10_000 },
      );
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.close();
      recordingPage = await context.newPage();
      await installScreenshotEnvironment(recordingPage);
    }
    await runE2eQuickstart(recordingPage, cached, {
      marketing: test.info().project.name === MARKETING_PROJECT_NAME,
    });
    await finalize(
      recordingPage,
      "e2e-quickstart",
      path.join(DOCS_IMAGES, "getting-started/e2e.gif"),
      {
        fps: 4,
        maxWidth: 640,
        maxColors: 128,
      },
    );
  });

  test("ai-preannotate — AI 预标注发起流程", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    const win = await runAiPreannotate(page, cached);
    await finalize(page, "ai-preannotate", undefined, drawTrim(win, t0));
  });

  test("ai-prediction-import — 导入预标注结果", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await installRecordingWorkbenchLayout(page, "both");
    const win = await runAiPredictionImport(page, cached, {
      marketing: test.info().project.name === MARKETING_PROJECT_NAME,
    });
    await finalize(page, "ai-prediction-import", undefined, drawTrim(win, t0));
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
      await applyScreenshotTheme(page, "dark");
      await installRecordingWorkbenchLayout(page, "none");
      const win = await runSamToolRecording(page, cached, demo.tool, { accept: true });
      await finalizeMarketingBackedHomepageAsset(
        page,
        `sam-tools/${demo.tool}`,
        drawTrim(win, t0),
        path.join(DOCS_IMAGES, "sam", demo.target),
        {
          fps: demo.fps ?? 8,
          maxWidth: demo.maxWidth ?? 860,
        },
      );
    });
  }

  test("smart-scribble — 已存 Mask 正负笔迹精修", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 正负笔迹 + 4K H.264 归档转码需覆盖完整营销母版链路
    const t0 = Date.now();
    const project = cached.projects.image_demo;
    const task = project.tasks.annotating;
    await seed.configureRasterMask(project.id, true);
    const source = await seed.injectRasterMask({
      taskId: task.id,
      userEmail: cached.users.admin.email,
      variant: "smart_scribble_source",
      label: "car",
      canvas: "media",
    });
    const fixture = await seed.nativeMaskCandidate(task.id, {
      variant: "smart_scribble_refined",
      promptFamily: "scribble",
      negativeScribbles: 1,
      promptSource: {
        annotationId: source.annotation_id,
        sourceVersion: 1,
        sourceDigest: source.mask.sha256,
      },
    });

    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runSmartScribble(page, cached, source.annotation_id, fixture);
    await finalize(
      page,
      "smart-scribble",
      path.join(DOCS_IMAGES, "sam/smart-scribble-interaction.gif"),
      { fps: 4, maxWidth: 860, maxColors: 96, ...drawTrim(win, t0) },
    );
  });

  test("sam-interactive — Magic Box 候选→人工确认", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.skip(!hasLiveSam3(cached), "首页 AI 视频只由 live SAM3 场景更新，stub 模式保留现有资产");
    test.setTimeout(150_000);
    const t0 = Date.now();
    // 首页视频保留候选虚线与 toast 的自然动效，因此不安装面向静态 PNG 的
    // fixed-time / reduced-motion 截图环境。
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runSamInteractive(page, cached);
    await finalizeMarketingBackedHomepageAsset(page, "ai-assisted-annotation", drawTrim(win, t0));
  });

  test("review-reject — 审核拒回流程", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(150_000);
    const project = cached.projects.image_demo;
    const task = project.tasks.review;
    const reviewerEmail = cached.users.reviewer.email;
    const t0 = Date.now();
    const cleanupRecord = { projectId: project.id, taskId: task.id };
    manageReviewRejectFixture("prepare", cleanupRecord, reviewerEmail);
    try {
      await installScreenshotEnvironment(page);
      await seed.injectToken(page, reviewerEmail);
      await applyScreenshotTheme(page, "dark");
      await installRecordingWorkbenchLayout(page, "both", {
        common: { petEnabled: false },
        layout: {
          floatingSelection: {
            collapsed: true,
            x: 1050,
            y: 110,
            w: 300,
            h: 260,
          },
        },
      });
      const win = await runReviewReject(page, cached);
      await finalize(page, "review-reject", path.join(DOCS_IMAGES, "review/reject-flow.gif"), {
        fps: 6,
        maxWidth: 860,
        ...drawTrim(win, t0),
      });
    } finally {
      manageReviewRejectFixture("cleanup", cleanupRecord, reviewerEmail);
    }
  });

  test("batch-bulk-actions — 批次多选批量操作", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    const win = await runBatchBulkActions(page, cached);
    await finalize(
      page,
      "batch-bulk-actions",
      path.join(DOCS_IMAGES, "projects/batch-bulk-actions.gif"),
      { ...drawTrim(win, t0) },
    );
  });

  test("ai-pre-variant-selector — 变体两轴联动", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    const win = await runAiPreVariantSelector(page, cached);
    await finalize(
      page,
      "ai-pre-variant-selector",
      path.join(DOCS_IMAGES, "projects/ai-pre-variant-selector.gif"),
      { ...drawTrim(win, t0) },
    );
  });

  test("ocr-inference — 真实 RapidOCR 当前题推理", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000);
    const t0 = Date.now();
    // 保留推理中 badge / loader 的自然动效，不安装静态 PNG 专用的禁动环境。
    await seed.injectToken(page, cached.users.project_admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both");
    let cleanupRecord: OcrCleanupRecord | null = null;
    const win = await runOcrInference(page, cached, (record) => {
      cleanupRecord = record;
      ocrCleanupRecords.push(record);
    });
    if (!cleanupRecord) throw new Error("[ocr-inference] 未记录无痕清理标识");
    cleanupOcrRecording(cleanupRecord);
    await finalizeMarketingBackedHomepageAsset(page, "ocr-real-scene", drawTrim(win, t0));
  });

  test("current-task-image-inference — 项目编排推理到人工采纳", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000);
    const t0 = Date.now();
    await seed.injectToken(page, cached.users.project_admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both");
    let cleanupRecord: OcrCleanupRecord | null = null;
    const win = await runCurrentTaskImageInference(page, cached, (record) => {
      cleanupRecord = record;
      ocrCleanupRecords.push(record);
    });
    if (!cleanupRecord) {
      throw new Error("[current-task-image-inference] 未记录无痕清理标识");
    }
    cleanupOcrRecording(cleanupRecord);
    await finalize(page, "current-task-image-inference", undefined, drawTrim(win, t0));
  });

  test("current-frame-video-inference — 当前帧车辆推理与作用域核对", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000);
    const t0 = Date.now();
    await seed.enableMLBackendByName(
      cached.projects.video_demo.id,
      cached.users.project_admin.email,
      "yolo-backend",
    );
    await seed.injectToken(page, cached.users.project_admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both");
    let cleanupRecord: VideoFrameInferenceCleanupRecord | null = null;
    const win = await runCurrentFrameVideoInference(page, cached, (record) => {
      cleanupRecord = record;
      videoFrameInferenceCleanupRecords.push(record);
    });
    if (!cleanupRecord) {
      throw new Error("[current-frame-video-inference] 未记录无痕清理标识");
    }
    cleanupVideoFrameInference(cleanupRecord);
    await finalize(page, "current-frame-video-inference", undefined, drawTrim(win, t0));
  });

  test("secondary-inference-attribute — 裁剪 OCR 属性写回与人工校正", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000);
    const t0 = Date.now();
    await seed.injectToken(page, cached.users.project_admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both", {
      common: { petEnabled: false },
      layout: {
        attrPanelCollapsed: false,
        aiSectionCollapsed: true,
        manualSectionCollapsed: false,
        discussionCollapsed: true,
        floatingSelection: { collapsed: true, x: 310, y: 510, w: 320, h: 300 },
      },
      ui: { secondary_bar_hidden: false },
    });
    let cleanupRecord: SecondaryInferenceCleanupRecord | null = null;
    const win = await runSecondaryInferenceAttribute(page, cached, (record) => {
      cleanupRecord = record;
      secondaryInferenceCleanupRecords.push(record);
    });
    if (!cleanupRecord) {
      throw new Error("[secondary-inference-attribute] 未记录无痕清理标识");
    }
    cleanupSecondaryInference(cleanupRecord);
    await finalize(page, "secondary-inference-attribute", undefined, drawTrim(win, t0));
  });

  test("rotated-bbox — 旋转框绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now(); // 录屏起点参照（page 在测试体前创建，t0≈video t=0）
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runRotatedBbox(page, cached);
    await finalize(page, "rotated-bbox", path.join(DOCS_IMAGES, "workbench/rotated-bbox.gif"), {
      fps: 4,
      maxWidth: 640,
      maxColors: 96,
      ...drawTrim(win, t0),
    });
  });

  test("bbox-draw — 矩形绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none", {
      image: { afterBoxCreate: "pick_class" },
      ui: { secondary_bar_hidden: true },
    });
    const win = await runBboxDraw(page, cached, {
      marketing: test.info().project.name === MARKETING_PROJECT_NAME,
    });
    await finalize(page, "bbox-draw", path.join(DOCS_IMAGES, "bbox/draw-in-progress.gif"), {
      fps: 4,
      maxWidth: 640,
      maxColors: 96,
      ...drawTrim(win, t0),
    });
  });

  test("polyline-draw — 折线逐点绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runPolylineDraw(page, cached);
    await finalize(page, "polyline-draw", path.join(DOCS_IMAGES, "polyline/draw-in-progress.gif"), {
      fps: 4,
      maxWidth: 640,
      maxColors: 96,
      ...drawTrim(win, t0),
    });
  });

  test("polygon-draw — 多边形逐点绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runPolygonDraw(page, cached);
    await finalize(page, "polygon-draw", path.join(DOCS_IMAGES, "polygon/draw-in-progress.gif"), {
      fps: 4,
      maxWidth: 640,
      maxColors: 96,
      ...drawTrim(win, t0),
    });
  });

  test("mask-draw — Mask 笔刷涂抹", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 多笔 Mask + 4K H.264 归档转码
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runMaskDraw(page, cached);
    await finalize(page, "mask-draw", path.join(DOCS_IMAGES, "mask-brush/draw-in-progress.gif"), {
      fps: 4,
      maxWidth: 640,
      maxColors: 96,
      ...drawTrim(win, t0),
    });
  });

  test("candidate-keyboard-review — 候选键盘审阅与自动前进", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const project = cached.projects.image_demo;
    const task = project.tasks.annotating;
    const candidateAnchors = [
      recordingAnchor(cached, "image_demo", "annotating", "review_vehicle_left"),
      recordingAnchor(cached, "image_demo", "annotating", "primary_vehicle"),
      recordingAnchor(cached, "image_demo", "annotating", "review_vehicle_right"),
    ];
    if (candidateAnchors.some((anchor) => anchor.polygon.length < 3)) {
      throw new Error("[candidate-keyboard-review] 候选车辆缺少可显示的轮廓锚点");
    }
    const predictions = await Promise.all(
      candidateAnchors.map((anchor, index) =>
        seed.injectPrediction({
          taskId: task.id,
          projectId: project.id,
          label: anchor.label,
          polygon: anchor.polygon,
          score: [0.96, 0.91, 0.87][index],
        }),
      ),
    );
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both");
    const win = await runCandidateKeyboardReview(
      page,
      cached,
      predictions.map((prediction) => prediction.prediction_id),
    );
    await finalizeVariants(page, "candidate-keyboard-review", [
      {
        target: path.join(DOCS_IMAGES, "workbench/review-auto-advance.gif"),
        options: {
          fps: 8,
          maxWidth: 860,
          ...drawTrim({ drawStartMs: win.autoAdvanceStartMs, drawEndMs: win.drawEndMs }, t0),
        },
      },
    ]);
  });

  test("candidate-review-lifecycle — 跳过、采纳、驳回与最终计数", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000);
    const project = cached.projects.image_demo;
    const task = project.tasks.annotating;
    const candidateAnchors = [
      recordingAnchor(cached, "image_demo", "annotating", "review_vehicle_left"),
      recordingAnchor(cached, "image_demo", "annotating", "primary_vehicle"),
      recordingAnchor(cached, "image_demo", "annotating", "review_vehicle_right"),
    ];
    if (candidateAnchors.some((anchor) => anchor.polygon.length < 3)) {
      throw new Error("[candidate-review-lifecycle] 候选车辆缺少可显示的轮廓锚点");
    }
    const predictionIds: string[] = [];
    for (const [index, anchor] of candidateAnchors.entries()) {
      const prediction = await seed.injectPrediction({
        taskId: task.id,
        projectId: project.id,
        label: anchor.label,
        polygon: anchor.polygon,
        score: [0.96, 0.91, 0.87][index],
      });
      predictionIds.push(prediction.prediction_id);
    }
    const cleanupRecord: CandidateReviewCleanupRecord = {
      projectId: project.id,
      taskId: task.id,
      predictionIds,
      annotationIds: [],
    };
    candidateReviewCleanupRecords.push(cleanupRecord);

    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both", {
      common: { petEnabled: false, autoAdvanceOnDecide: true },
      layout: {
        aiSectionCollapsed: false,
        manualSectionCollapsed: false,
        discussionCollapsed: true,
        attrPanelCollapsed: true,
        floatingSelection: { collapsed: true, x: 310, y: 690, w: 320, h: 300 },
      },
    });
    const win = await runCandidateReviewLifecycle(page, cached, cleanupRecord);
    await finalize(page, "candidate-review-lifecycle", undefined, drawTrim(win, t0));
    cleanupCandidateReview(cleanupRecord);
  });

  test("video-track — 视频时序工作台", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoTrack(page, cached);
    await finalize(page, "video-track", undefined, drawTrim(win, t0));
  });

  test("video-timeline-zoom — 时间轴锚点缩放与复位", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoTimelineZoom(page, cached);
    await finalize(
      page,
      "video-timeline-zoom",
      path.join(DOCS_IMAGES, "video-timeline/horizontal-zoom.gif"),
      { fps: 6, maxWidth: 640, maxColors: 128, ...drawTrim(win, t0) },
    );
  });

  test("video-timeline-prediction-navigation — AI 预测密度与帧导航", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 真实双目标视频推理 + 4K H.264 归档转码
    const t0 = Date.now();
    await seed.enableMLBackendByName(
      cached.projects.video_demo.id,
      cached.users.project_admin.email,
      "yolo-backend",
    );
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.project_admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    let cleanupRecord: VideoFrameInferenceCleanupRecord | null = null;
    const win = await runVideoTimelinePredictionNavigation(page, cached, (record) => {
      cleanupRecord = record;
      videoFrameInferenceCleanupRecords.push(record);
    });
    if (!cleanupRecord) {
      throw new Error("[video-timeline-prediction-navigation] 未记录无痕清理标识");
    }
    cleanupVideoFrameInference(cleanupRecord);
    await finalize(page, "video-timeline-prediction-navigation", undefined, drawTrim(win, t0));
  });

  test("video-chapter — 时间轴圈选与拖柄调整章节", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both");
    const windows = await runVideoChapter(page, cached);
    await finalizeVariants(page, "video-chapter", [
      {
        target: path.join(DOCS_IMAGES, "video-timeline/brush-create-chapter.gif"),
        options: { fps: 4, maxWidth: 600, maxColors: 96, ...drawTrim(windows.create, t0) },
      },
      {
        target: path.join(DOCS_IMAGES, "video-timeline/chapter-resize-hover.gif"),
        options: { fps: 4, maxWidth: 600, maxColors: 96, ...drawTrim(windows.resize, t0) },
      },
    ]);
  });

  test("video-tracker-range — 时间轴刷选追踪范围", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoTrackerRange(page, cached);
    await finalize(
      page,
      "video-tracker-range",
      path.join(DOCS_IMAGES, "video-propagate/shift-brush-range.gif"),
      { fps: 6, maxWidth: 680, maxColors: 128, ...drawTrim(win, t0) },
    );
  });

  test("video-track-batch-propagate — 双轨迹批量延展并复核", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 双轨迹真实视频推理 + 候选审阅 + 4K H.264 归档
    const project = cached.projects.video_demo;
    const task = project.tasks.tracking;
    const userEmail = cached.users.project_admin.email;
    const anchors = [
      recordingAnchor(cached, "video_demo", "tracking", "left_bus_f0", 0),
      recordingAnchor(cached, "video_demo", "tracking", "right_bus_f0", 0),
    ];
    const cleanupRecord: VideoTrackBatchPropagateCleanupRecord = {
      projectId: project.id,
      taskId: task.id,
      sourceAnnotationIds: [],
      videoTrackerJobIds: [],
    };
    const t0 = Date.now();

    try {
      await seed.enableMLBackendByName(project.id, userEmail, "sam3-backend");
      for (const [index, anchor] of anchors.entries()) {
        const [x1, y1, x2, y2] = anchor.bbox;
        const trackId = `trk_marketing_batch_${index === 0 ? "left" : "right"}`;
        const source = await seed.createTaskAnnotation(task.id, userEmail, {
          annotation_type: "video_track_bbox",
          tool_unit_id: "bbox",
          class_name: anchor.label,
          geometry: {
            type: "video_track_bbox",
            track_id: trackId,
            keyframes: [
              {
                frame_index: 0,
                bbox: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
                source: "manual",
                occluded: false,
              },
            ],
            outside: [],
          },
        });
        cleanupRecord.sourceAnnotationIds.push(source.id);
      }

      await installScreenshotEnvironment(page);
      await seed.injectToken(page, userEmail);
      await applyScreenshotTheme(page, "dark");
      await installRecordingWorkbenchLayout(page, "both", {
        common: { petEnabled: false },
        layout: {
          floatingSelection: {
            collapsed: false,
            x: 600,
            y: 150,
            w: 300,
            h: 300,
          },
        },
      });
      const win = await runVideoTrackBatchPropagate(
        page,
        cached,
        cleanupRecord.sourceAnnotationIds,
        (jobId) => cleanupRecord.videoTrackerJobIds.push(jobId),
      );
      if (cleanupRecord.videoTrackerJobIds.length !== 1) {
        throw new Error("[video-track-batch-propagate] 批量延展必须只产生一个追踪作业");
      }
      await finalize(page, "video-track-batch-propagate", undefined, drawTrim(win, t0));
    } finally {
      if (
        cleanupRecord.sourceAnnotationIds.length > 0 ||
        cleanupRecord.videoTrackerJobIds.length > 0
      ) {
        cleanupVideoTrackBatchPropagate(cleanupRecord);
      }
    }
  });

  test("video-propagate-track-vs-copy — 几何复制与 AI 延展对比", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 真实 30 帧 SAM3 追踪 + 候选审阅 + 4K H.264 归档
    const project = cached.projects.video_demo;
    const task = project.tasks.tracking;
    const userEmail = cached.users.project_admin.email;
    const anchor = recordingAnchor(cached, "video_demo", "tracking", "left_bus_f0", 0);
    const cleanupRecord: VideoTrackBatchPropagateCleanupRecord = {
      projectId: project.id,
      taskId: task.id,
      sourceAnnotationIds: [],
      videoTrackerJobIds: [],
    };
    const t0 = Date.now();

    try {
      await seed.enableMLBackendByName(project.id, userEmail, "sam3-backend");
      const [x1, y1, x2, y2] = anchor.bbox;
      const source = await seed.createTaskAnnotation(task.id, userEmail, {
        annotation_type: "video_track_bbox",
        tool_unit_id: "bbox",
        class_name: anchor.label,
        geometry: {
          type: "video_track_bbox",
          track_id: "trk_marketing_propagate_compare",
          keyframes: [
            {
              frame_index: 0,
              bbox: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
              source: "manual",
              occluded: false,
            },
          ],
          outside: [],
        },
      });
      cleanupRecord.sourceAnnotationIds.push(source.id);

      await installScreenshotEnvironment(page);
      await seed.injectToken(page, userEmail);
      await applyScreenshotTheme(page, "dark");
      await installRecordingWorkbenchLayout(page, "both", {
        common: { petEnabled: false },
        layout: {
          floatingSelection: {
            collapsed: false,
            x: 770,
            y: 115,
            w: 310,
            h: 350,
          },
        },
      });
      const win = await runVideoPropagateTrackVsCopy(page, cached, source.id, (jobId) =>
        cleanupRecord.videoTrackerJobIds.push(jobId),
      );
      if (cleanupRecord.videoTrackerJobIds.length !== 1) {
        throw new Error("[video-propagate-track-vs-copy] AI 对比必须只产生一个追踪作业");
      }
      await finalize(page, "video-propagate-track-vs-copy", undefined, drawTrim(win, t0));
    } finally {
      if (
        cleanupRecord.sourceAnnotationIds.length > 0 ||
        cleanupRecord.videoTrackerJobIds.length > 0
      ) {
        cleanupVideoTrackBatchPropagate(cleanupRecord);
      }
    }
  });

  test("video-tracker-cross-frame-points — 双目标跨帧多正点", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 真实视频推理 + 4K H.264 归档转码
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoMultiSeedTracking(page, cached, "cross-frame-points");
    await finalize(page, "video-tracker-cross-frame-points", undefined, drawTrim(win, t0));
  });

  test("video-tracker-positive-negative — 双目标正负点修正", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 真实视频推理 + 4K H.264 归档转码
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoMultiSeedTracking(page, cached, "positive-negative");
    await finalize(page, "video-tracker-positive-negative", undefined, drawTrim(win, t0));
  });

  test("video-tracker-box-seed — 双目标整车框种子", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 真实视频推理 + 4K H.264 归档转码
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoMultiSeedTracking(page, cached, "box-seed");
    await finalize(page, "video-tracker-box-seed", undefined, drawTrim(win, t0));
  });

  test("video-tracker-text-discovery — 文本发现双目标并采纳轨迹", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 真实视频推理 + 4K H.264 归档转码
    const t0 = Date.now();
    await seed.enableMLBackendByName(
      cached.projects.video_demo.id,
      cached.users.project_admin.email,
      "sam3-backend",
    );
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.project_admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoTrackerTextDiscovery(page, cached);
    await finalize(page, "video-tracker-text-discovery", undefined, drawTrim(win, t0));
  });

  test("video-tracker-combo-discovery — 文本发现后逐对象记忆追踪", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(240_000); // 真实两趟视频推理 + 4K H.264 归档转码
    const t0 = Date.now();
    await seed.enableMLBackendByName(
      cached.projects.video_demo.id,
      cached.users.project_admin.email,
      "sam3-backend",
    );
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.project_admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoTrackerComboDiscovery(page, cached);
    await finalize(page, "video-tracker-combo-discovery", undefined, drawTrim(win, t0));
  });

  test("video-mask-correction-propagate — 错帧加减笔迹后重传播", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(240_000); // 两次 Mask 提交 + 真实视频重传播 + 4K H.264 归档
    const t0 = Date.now();
    await seed.enableMLBackendByName(
      cached.projects.video_demo.id,
      cached.users.project_admin.email,
      "sam3-backend",
    );
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.project_admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both");
    const win = await runVideoMaskCorrectionPropagate(page, cached);
    await finalize(page, "video-mask-correction-propagate", undefined, drawTrim(win, t0));
  });

  test("pipeline-template-create — 创建车辆检测到属性分类公共模板", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(150_000);
    const t0 = Date.now();
    let pipelineId: string | null = null;
    try {
      await installScreenshotEnvironment(page);
      await seed.injectToken(page, cached.users.admin.email);
      await applyScreenshotTheme(page, "dark");
      const win = await runPipelineTemplateCreate(page, (createdId) => {
        pipelineId = createdId;
      });
      await finalize(page, "pipeline-template-create", undefined, drawTrim(win, t0));
    } finally {
      if (pipelineId) {
        await seed.deleteProjectPipeline(pipelineId, cached.users.admin.email);
      }
    }
  });

  test("pipeline-apply-project — 套用公共模板并运行项目默认编排", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(240_000);
    const project = cached.projects.image_demo;
    const task = project.tasks.clean;
    const userEmail = cached.users.admin.email;
    const t0 = Date.now();
    let sourcePipelineId: string | null = null;
    let appliedPipelineId: string | null = null;
    let cleanupRecord: PipelineApplyCleanupRecord | null = null;

    try {
      cleanupPipelineApply({ projectId: project.id, taskId: task.id });
      const yoloBackendId = await seed.enableMLBackendByName(project.id, userEmail, "yolo-backend");
      const attributeBackendId = await seed.enableMLBackendByName(
        project.id,
        userEmail,
        "onnxtools-backend",
      );
      const sourcePipeline = await seed.createProjectPipeline(userEmail, {
        name: "车辆检测 → 车型与颜色",
        scope: "public",
        project_id: null,
        organization_id: null,
        stages: [
          {
            stage: 0,
            ml_backend_id: yoloBackendId,
            source: { kind: "dataset", data_type: "image" },
            model_id: "detect",
            model_variants: { series: "yolo11", size: "s" },
            class_filter: [2, 5, 7],
          },
          {
            stage: 1,
            ml_backend_id: attributeBackendId,
            model_id: "vehicle-attr-classify",
            task_type: "classification",
            parent_stage: 0,
            parent_class_filter: ["car", "bus", "truck"],
            roi: { mode: "crop", pad: 0.05 },
            input: { mode: "crop" },
            write: { target: "attributes", keys: ["vehicle_type", "color"] },
            on_failure: "keep_parent",
          },
        ],
        is_default: false,
      });
      sourcePipelineId = sourcePipeline.id;

      await installScreenshotEnvironment(page);
      await seed.injectToken(page, userEmail);
      await applyScreenshotTheme(page, "dark");
      await installRecordingWorkbenchLayout(page, "both");
      const win = await runPipelineApplyProject(
        page,
        cached,
        sourcePipeline.id,
        (createdId) => {
          appliedPipelineId = createdId;
        },
        (record) => {
          cleanupRecord = record;
          pipelineApplyCleanupRecords.push(record);
        },
      );
      if (!appliedPipelineId) {
        throw new Error("[pipeline-apply-project] 未记录套用后的私有编排 ID");
      }
      if (!cleanupRecord) {
        throw new Error("[pipeline-apply-project] 未记录真实推理清理标识");
      }
      cleanupPipelineApply(cleanupRecord);
      await finalize(page, "pipeline-apply-project", undefined, drawTrim(win, t0));
    } finally {
      if (cleanupRecord) cleanupPipelineApply(cleanupRecord);
      if (appliedPipelineId) await seed.deleteProjectPipeline(appliedPipelineId, userEmail);
      if (sourcePipelineId) await seed.deleteProjectPipeline(sourcePipelineId, userEmail);
    }
  });

  test("jobs-retry-recovery — 失败预测重试后进入结果", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(150_000);
    const project = cached.projects.ocr_demo;
    const task = project.tasks.ocr;
    const userEmail = cached.users.admin.email;
    const record = { projectId: project.id, taskId: task.id };
    const t0 = Date.now();
    jobsRetryCleanupRecords.push(record);

    try {
      manageJobsRetryFixture("cleanup", record);
      const fixture = manageJobsRetryFixture("seed", record, userEmail);
      if (!fixture.backend_id) {
        throw new Error("[jobs-retry-recovery] 夹具未返回 RapidOCR backend id");
      }
      await seed.predictTestMLBackend(project.id, fixture.backend_id, task.id, userEmail);
      await installScreenshotEnvironment(page);
      await seed.injectToken(page, userEmail);
      await applyScreenshotTheme(page, "dark");
      await installRecordingWorkbenchLayout(page, "both");
      const win = await runJobsRetryRecovery(page, cached);
      await finalize(page, "jobs-retry-recovery", undefined, drawTrim(win, t0));
    } finally {
      manageJobsRetryFixture("cleanup", record);
    }
  });

  test("model-market-runtime-pool — 服务池运行时观测与实例下钻", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    const win = await runModelMarketRuntimePool(page, cached);
    await finalize(page, "model-market-runtime-pool", undefined, drawTrim(win, t0));
  });

  test("model-market-video-pool — 视频追踪独立显存池与预热入口", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    const win = await runModelMarketVideoPool(page, cached);
    await finalize(page, "model-market-video-pool", undefined, drawTrim(win, t0));
  });

  test("model-market-runtime-partial-failure — 单数据源失败与可信状态保留", async ({
    page,
    seed,
  }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    const win = await runModelMarketRuntimePartialFailure(page, cached);
    await finalize(page, "model-market-runtime-partial-failure", undefined, drawTrim(win, t0));
  });

  test("model-market-gpu-resource-overview — GPU 资源就绪性、预算与阻断实例", async ({
    page,
    seed,
  }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    const win = await runModelMarketGpuResourceOverview(page, cached);
    await finalize(page, "model-market-gpu-resource-overview", undefined, drawTrim(win, t0));
  });

  test("platform-overview — 全局统计、模型成本与近期活动", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    const win = await runPlatformOverview(page);
    await finalize(page, "platform-overview", undefined, drawTrim(win, t0));
  });

  test("project-actions-menu — 导入、导出与复制入口", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    const win = await runProjectActionsMenu(page, cached);
    await finalize(page, "project-actions-menu", undefined, drawTrim(win, t0));
  });

  test("jobs-bell-active — 进度、取消与完成产物下载", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    const win = await runJobsBellActive(page);
    await finalize(page, "jobs-bell-active", undefined, drawTrim(win, t0));
  });

  test("video-tracker-job-states — 四状态、筛选与返回视频工作台", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    const win = await runVideoTrackerJobStates(page, cached);
    await finalize(page, "video-tracker-job-states", undefined, drawTrim(win, t0));
  });

  test("project-ml-routing — 批量主后端与交互能力自动分流", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    try {
      await installScreenshotEnvironment(page);
      await seed.injectToken(page, cached.users.admin.email);
      await applyScreenshotTheme(page, "dark");
      await installRecordingWorkbenchLayout(page, "none");
      const win = await runProjectMlRouting(page, cached);
      await finalize(page, "project-ml-routing", undefined, drawTrim(win, t0));
    } finally {
      repairScreenshotProfile(screenshotBackendMode(cached), true);
      cached = await seed.screenshotCatalog();
    }
  });

  test("background-export-download — 后台多格式导出与 ZIP 下载", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(150_000);
    const project = cached.projects.image_demo;
    const task = project.tasks.clean;
    const record: { projectId: string; taskId: string; jobId?: string } = {
      projectId: project.id,
      taskId: task.id,
    };
    const t0 = Date.now();
    backgroundExportCleanupRecords.push(record);

    try {
      manageBackgroundExportFixture("cleanup", record);
      await installScreenshotEnvironment(page);
      await seed.injectToken(page, cached.users.admin.email);
      await applyScreenshotTheme(page, "dark");
      const win = await runBackgroundExportDownload(
        page,
        cached,
        (jobId) => manageBackgroundExportFixture("run", { ...record, jobId }),
        (jobId) => {
          record.jobId = jobId;
        },
      );
      await finalize(page, "background-export-download", undefined, drawTrim(win, t0));
    } finally {
      manageBackgroundExportFixture("cleanup", record);
    }
  });

  test("project-create-existing-resources — 创建项目并复用已有资源", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const userEmail = cached.users.admin.email;
    let createdProjectId: string | undefined;
    const t0 = Date.now();

    try {
      await seed.deleteProjectsByExactName(PROJECT_CREATE_RECORDING_NAME, userEmail);
      await installScreenshotEnvironment(page);
      await seed.injectToken(page, userEmail);
      await applyScreenshotTheme(page, "dark");
      const win = await runProjectCreateExistingResources(page, cached, (projectId) => {
        createdProjectId = projectId;
      });
      await finalize(page, "project-create-existing-resources", undefined, drawTrim(win, t0));
    } finally {
      if (createdProjectId) await seed.deleteProject(createdProjectId, userEmail);
    }
  });

  test("video-track-carryover — 跨帧虚影 Tab 续写", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both", {
      video: { trackContinueAutoAdvance: true },
    });
    const win = await runVideoTrackCarryover(page, cached);
    await finalize(
      page,
      "video-track-carryover",
      path.join(DOCS_IMAGES, "workbench/video-track-carryover-ghost.gif"),
      { fps: 4, maxWidth: 600, maxColors: 96, ...drawTrim(win, t0) },
    );
  });

  test("video-mask-track-edit — Mask 轨迹创建与后续帧编辑", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 视频解码 + 两次 Mask 提交 + 4K H.264 归档
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "both");
    const win = await runVideoMaskTrackEdit(page, cached);
    await finalize(page, "video-mask-track-edit", undefined, drawTrim(win, t0));
  });

  test("ai-tracker-panel — AI 追踪面板拖动缩放与互斥", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runAiTrackerPanel(page, cached);
    await finalize(page, "ai-tracker-panel", undefined, drawTrim(win, t0));
  });

  test("pointcloud-controls — 点云控件(上色/点大小/深度)", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 点云加载与 4K H.264 归档都较重
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runPointcloudControls(page, cached);
    await finalize(page, "pointcloud-controls", undefined, drawTrim(win, t0));
  });

  test("pointcloud-view — 点云视图导航(拖动旋转)", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(180_000); // 点云加载与 4K H.264 归档都较重
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runPointcloudView(page, cached);
    await finalize(page, "pointcloud-view", undefined, drawTrim(win, t0));
  });

  test("video-draw — 视频画框轨迹(track 关键帧插值)", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000); // 视频解码 + 两次画框 + 来回逐帧, 冷启动时给 worker 留足余量
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runVideoDraw(page, cached);
    await finalize(
      page,
      "video-draw",
      // 画框和逐帧插值的帧间变化大，使用低帧率与受限调色板保持可提交体积。
      path.join(DOCS_IMAGES, "workbench/video-track-trajectory.gif"),
      { fps: 3, maxWidth: 520, maxColors: 80, ...drawTrim(win, t0) },
    );
  });

  test("large-image-progressive — 大图渐进式高清切片", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(90_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runLargeImageProgressive(page, cached);
    await finalize(page, "large-image-progressive", undefined, drawTrim(win, t0));
  });

  test("large-image-pyramid-recovery — 单切片失败后自动恢复", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(90_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runLargeImagePyramidRecovery(page, cached);
    await finalize(page, "large-image-pyramid-recovery", undefined, drawTrim(win, t0));
  });

  test("large-image-mask-limit — 超大图矢量标注与 Mask 尺寸门禁", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(90_000);
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.admin.email);
    await applyScreenshotTheme(page, "dark");
    await installRecordingWorkbenchLayout(page, "none");
    const win = await runLargeImageMaskLimit(page, cached);
    await finalize(page, "large-image-mask-limit", undefined, drawTrim(win, t0));
  });

  test("pointcloud-camera-seed-3d-box — 相机图辅助生成并核对 3D 框", async ({ page, seed }) => {
    test.skip(
      test.info().project.name !== MARKETING_PROJECT_NAME,
      "真实点云种框需要 marketing-master 的硬件 WebGL 与 60Hz 运行面",
    );
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const t0 = Date.now();
    const userEmail = cached.users.admin.email;
    let created: { taskId: string; annotationId: string } | null = null;
    try {
      await installScreenshotEnvironment(page);
      await seed.injectToken(page, userEmail);
      await applyScreenshotTheme(page, "dark");
      await installRecordingWorkbenchLayout(page, "both", {
        layout: { triViewFloat: { x: 24, y: 24, w: 320, h: 540, collapsed: true } },
      });
      const win = await runPointcloudCameraSeed3dBox(page, cached);
      created = win.created;
      await finalize(page, "pointcloud-camera-seed-3d-box", undefined, drawTrim(win, t0));
    } finally {
      if (created) {
        await seed.deleteTaskAnnotation(created.taskId, created.annotationId, userEmail);
      }
    }
  });

  test("pointcloud-crossframe-track — 3D 目标跨帧延续、修正与邻帧核对", async ({ page, seed }) => {
    test.skip(
      test.info().project.name !== MARKETING_PROJECT_NAME,
      "真实点云跨帧链需要 marketing-master 的硬件 WebGL 与 60Hz 运行面",
    );
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    test.setTimeout(120_000);
    const userEmail = cached.users.admin.email;
    const frame0 = cached.projects.pointcloud_demo.tasks.frame_000;
    const cleanup: Array<{ taskId: string; annotationId: string }> = [];
    try {
      const source = await seed.createTaskAnnotation(frame0.id, userEmail, {
        annotation_type: "box_3d",
        tool_unit_id: "lidar_box_3d",
        class_name: "object",
        geometry: {
          type: "box_3d",
          center: [2.0934999585151672, -0.2625943124294281, -0.3888123378157616],
          size: [0.940999960899353, 0.7639772057533264, 0.7222056895494461],
          rotation: [0, 0, 1.7316441821747883],
          convention_at_create: "opencv_camera",
        },
      });
      cleanup.push({ taskId: frame0.id, annotationId: source.id });

      const t0 = Date.now();
      await installScreenshotEnvironment(page);
      await seed.injectToken(page, userEmail);
      await applyScreenshotTheme(page, "dark");
      await installRecordingWorkbenchLayout(page, "both", {
        common: {
          crossFrameOverlayEnabled: true,
          crossFrameOverlayK: 1,
          crossFrameOverlayScope: "selected",
        },
      });
      const win = await runPointcloudCrossframeTrack(page, cached, source, (created) => {
        cleanup.push(created);
      });
      await finalize(page, "pointcloud-crossframe-track", undefined, drawTrim(win, t0));
    } finally {
      for (const annotation of cleanup.reverse()) {
        await seed.deleteTaskAnnotation(annotation.taskId, annotation.annotationId, userEmail);
      }
    }
  });

  test("hotkey-cheatsheet — 键盘快捷键面板(? 打开)", async ({ page, seed }) => {
    if (!cached) throw new Error("screenshot seed catalog 未完成");
    const t0 = Date.now();
    await installScreenshotEnvironment(page);
    await seed.injectToken(page, cached.users.annotator.email);
    await applyScreenshotTheme(page, "dark");
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
  return {
    startSec,
    durationSec,
    captureWindow: {
      startEpochMs: win.drawStartMs - 400,
      endEpochMs: win.drawEndMs + 400,
    },
  };
}
