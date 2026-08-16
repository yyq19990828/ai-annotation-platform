#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordFlowArtifact } from "../e2e/screenshots/_helpers/flow-manifest.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const ARCHIVE_ROOT = path.join(REPO_ROOT, ".artifacts/marketing");
const OUTPUT_ROOT = path.join(REPO_ROOT, "docs-site/public/media");

const POSTER_AT_SECONDS = new Map([
  ["review-reject", 2],
  ["jobs-retry-recovery", 11],
  ["model-market-runtime-pool", 10],
  ["model-market-video-pool", 10],
  ["video-timeline-prediction-navigation", 8],
  ["model-market-runtime-partial-failure", 7],
  ["model-market-gpu-resource-overview", 10],
  ["platform-overview", 17],
  ["project-actions-menu", 9],
  ["jobs-bell-active", 10],
  ["video-tracker-job-states", 5],
  ["project-ml-routing", 14],
  ["background-export-download", 16],
  ["project-create-existing-resources", 14],
  ["large-image-pyramid-recovery", 9],
  ["large-image-mask-limit", 11],
  ["pointcloud-camera-seed-3d-box", 10],
  ["pointcloud-crossframe-track", 15],
  ["pointcloud-billboard-label", 10],
  ["storage-connector-create-test", 15],
  ["video-track-batch-propagate", 2.5],
  ["video-propagate-track-vs-copy", 14],
]);

const TARGETS = new Map(
  [
    ["ai-prediction-import", "ai/prediction-import"],
    ["ai-preannotate", "ai/preannotate"],
    ["ai-assisted-annotation", "ai/assisted-annotation"],
    ["candidate-keyboard-review", "ai/candidate-keyboard-review"],
    ["candidate-review-lifecycle", "ai/candidate-review-lifecycle"],
    ["review-reject", "review/reject-flow"],
    ["ocr-real-scene", "ai/ocr-current-task"],
    ["current-task-image-inference", "ai/current-task-image-inference"],
    ["current-frame-video-inference", "ai/current-frame-video-inference"],
    ["secondary-inference-attribute", "ai/secondary-inference-attribute"],
    ["pipeline-template-create", "pipeline/template-create"],
    ["pipeline-apply-project", "pipeline/apply-project"],
    ["jobs-retry-recovery", "workflows/jobs-retry-recovery"],
    ["model-market-runtime-pool", "superadmin/model-market/runtime-pools"],
    ["model-market-video-pool", "superadmin/model-market/video-pool"],
    ["model-market-runtime-partial-failure", "superadmin/model-market/runtime-data-sources"],
    ["model-market-gpu-resource-overview", "superadmin/model-market/gpu-resources"],
    ["platform-overview", "superadmin/platform-overview"],
    ["project-actions-menu", "projects/project-actions-menu"],
    ["jobs-bell-active", "jobs/jobs-bell-active"],
    ["video-tracker-job-states", "jobs/video-tracker-job-states"],
    ["project-ml-routing", "projects/ml-routing"],
    ["background-export-download", "datasets/background-export-download"],
    ["project-create-existing-resources", "projects/create-existing-resources"],
    ["ai-pre-variant-selector", "projects/ai-pre-variant-selector"],
    ["batch-bulk-actions", "projects/batch-bulk-actions"],
    ["hotkey-cheatsheet", "workbench/hotkey-cheatsheet"],
    ["mask-draw", "mask-brush/mask-draw"],
    ["polygon-draw", "polygon/draw"],
    ["polyline-draw", "polyline/draw"],
    ["rotated-bbox", "workbench/rotated-bbox"],
    ["smart-scribble", "sam/smart-scribble"],
    ["video-chapter", "video/video-chapter"],
    ["video-draw", "video/video-draw"],
    ["video-timeline-zoom", "video/video-timeline-zoom"],
    ["video-track-carryover", "video/video-track-carryover"],
    ["ai-tracker-panel", "video/ai-tracker-panel"],
    ["video-track", "video/workbench-overview"],
    ["video-track-batch-propagate", "video/track-batch-propagate"],
    ["video-propagate-track-vs-copy", "video/propagate-track-vs-copy"],
    ["video-timeline-prediction-navigation", "video/prediction-density-navigation"],
    ["video-mask-track-edit", "video/mask-track-edit"],
    ["video-tracker-range", "video/tracker-range"],
    ["video-tracker-cross-frame-points", "video/tracker-cross-frame-points"],
    ["video-tracker-positive-negative", "video/tracker-positive-negative"],
    ["video-tracker-box-seed", "video/tracker-box-seed"],
    ["video-tracker-text-discovery", "video/tracker-text-discovery"],
    ["video-tracker-combo-discovery", "video/tracker-combo-discovery"],
    ["video-mask-correction-propagate", "video/mask-correction-propagate"],
    ["pointcloud-controls", "pointcloud/controls"],
    ["pointcloud-view", "pointcloud/orbit"],
    ["pointcloud-camera-seed-3d-box", "pointcloud/camera-seed-3d-box"],
    ["pointcloud-crossframe-track", "pointcloud/crossframe-track"],
    ["pointcloud-billboard-label", "pointcloud/billboard-label"],
    ["storage-connector-create-test", "datasets/storage-connector-create-test"],
    ["large-image-progressive", "large-image/progressive"],
    ["large-image-pyramid-recovery", "large-image/pyramid-recovery"],
    ["large-image-mask-limit", "large-image/mask-limit"],
  ].map(([assetId, target]) => [assetId, target]),
);

const HOME_TARGETS = new Map(
  [
    ["ai-assisted-annotation", "ai-assisted-annotation"],
    ["ocr-real-scene", "ocr-real-scene"],
    ["sam-tools/smart-point", "sam-tools/smart-point"],
    ["sam-tools/smart-box", "sam-tools/smart-box"],
    ["sam-tools/exemplar", "sam-tools/exemplar"],
  ].map(([assetId, target]) => [assetId, target]),
);

function optionValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1])
      values.push(process.argv[index + 1]);
  }
  return values;
}

function latestRunDirectory() {
  const candidates = fs
    .readdirSync(ARCHIVE_ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(ARCHIVE_ROOT, entry.name, "manifest.json")),
    )
    .map((entry) => entry.name)
    .sort();
  const latest = candidates.at(-1);
  if (!latest) throw new Error("[docs-media] 没有可用的高清营销运行目录");
  return path.join(ARCHIVE_ROOT, latest);
}

function checked(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `[docs-media] ${command} 失败：${result.error?.message ?? result.stderr.trim() ?? result.status}`,
    );
  }
  return result.stdout;
}

function verifyVideo(filePath, expected) {
  const parsed = JSON.parse(
    checked("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,avg_frame_rate,pix_fmt",
      "-of",
      "json",
      filePath,
    ]),
  );
  const stream = parsed.streams?.[0];
  if (
    stream?.codec_name !== expected.codec ||
    stream?.width !== expected.width ||
    stream?.height !== expected.height ||
    stream?.avg_frame_rate !== expected.fps ||
    stream?.pix_fmt !== expected.pixelFormat
  ) {
    throw new Error(`[docs-media] 派生视频规格不正确：${filePath} ${JSON.stringify(stream)}`);
  }
}

const runArg = optionValues("--run").at(-1);
const runDirectory = runArg ? path.resolve(ARCHIVE_ROOT, runArg) : latestRunDirectory();
const manifestPath = path.join(runDirectory, "manifest.json");
if (!fs.existsSync(manifestPath)) throw new Error(`[docs-media] manifest 不存在：${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schema_version !== 4 || !manifest.run || !manifest.entries) {
  throw new Error(`[docs-media] 不支持的营销 manifest：${manifestPath}`);
}

const requestedAssets = optionValues("--asset");
const selected =
  requestedAssets.length > 0
    ? requestedAssets
    : [...new Set([...TARGETS.keys(), ...HOME_TARGETS.keys()])];
const unknown = selected.filter((assetId) => !TARGETS.has(assetId) && !HOME_TARGETS.has(assetId));
if (unknown.length > 0) throw new Error(`[docs-media] 未登记的文档派生资产：${unknown.join(", ")}`);

for (const assetId of selected) {
  const entry = manifest.entries[assetId];
  if (!entry) throw new Error(`[docs-media] 运行 ${manifest.run.id} 缺少资产：${assetId}`);
  const sourceInfo = entry.files?.universal_mp4;
  if (!sourceInfo?.file || !sourceInfo.sha256) {
    throw new Error(`[docs-media] ${assetId} 缺少通用 MP4 来源`);
  }
  const source = path.join(runDirectory, sourceInfo.file);
  const provenance = {
    repoRoot: REPO_ROOT,
    assetId,
    source: "apps/web/scripts/derive-doc-media.mjs",
    seedRevision: entry.seed_revision ?? null,
    capturedCommit: manifest.run.source_commit,
    sourceWorktreeDirty: Boolean(manifest.run.source_worktree_dirty),
    sourceAsset: {
      runId: manifest.run.id,
      assetId,
      sha256: sourceInfo.sha256,
    },
  };
  const durationSeconds = Number(sourceInfo.media?.duration_ms ?? 0) / 1000;
  const posterAt =
    POSTER_AT_SECONDS.get(assetId) ??
    Math.max(1, Math.min(durationSeconds * 0.72, durationSeconds - 0.4));

  const docsTarget = TARGETS.get(assetId);
  if (docsTarget) {
    const targetStem = path.join(OUTPUT_ROOT, docsTarget);
    const videoTarget = `${targetStem}.mp4`;
    const posterTarget = `${targetStem}-poster.webp`;
    const videoTemp = `${videoTarget}.${process.pid}.tmp.mp4`;
    const posterTemp = `${posterTarget}.${process.pid}.tmp.webp`;
    fs.mkdirSync(path.dirname(videoTarget), { recursive: true });

    try {
      checked("ffmpeg", [
        "-y",
        "-i",
        source,
        "-an",
        "-vf",
        "fps=30,scale=1280:720:flags=lanczos,setsar=1",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "24",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        videoTemp,
      ]);
      verifyVideo(videoTemp, {
        codec: "h264",
        width: 1280,
        height: 720,
        fps: "30/1",
        pixelFormat: "yuv420p",
      });
      checked("ffmpeg", [
        "-y",
        "-ss",
        posterAt.toFixed(3),
        "-i",
        videoTemp,
        "-frames:v",
        "1",
        "-c:v",
        "libwebp",
        "-quality",
        "84",
        posterTemp,
      ]);
      fs.renameSync(videoTemp, videoTarget);
      fs.renameSync(posterTemp, posterTarget);

      const docsProvenance = {
        ...provenance,
        testTitle: `derive docs media › ${assetId}`,
        watchPaths: [
          entry.source,
          "apps/web/e2e/screenshots/_helpers/marketing-assets.ts",
          "docs-site/.vitepress/theme/components/DocsVideo.vue",
        ].filter(Boolean),
      };
      recordFlowArtifact({ ...docsProvenance, targetPath: videoTarget, role: "docs-video" });
      recordFlowArtifact({ ...docsProvenance, targetPath: posterTarget, role: "poster" });
      console.log(`[docs-media] ✓ ${assetId} → ${path.relative(REPO_ROOT, videoTarget)}`);
    } finally {
      fs.rmSync(videoTemp, { force: true });
      fs.rmSync(posterTemp, { force: true });
    }
  }

  const homeTarget = HOME_TARGETS.get(assetId);
  if (homeTarget) {
    const targetStem = path.join(REPO_ROOT, "docs-site/public/home", homeTarget);
    const webmTarget = `${targetStem}.webm`;
    const mp4Target = `${targetStem}.mp4`;
    const posterTarget = `${targetStem}-poster.webp`;
    const webmTemp = `${webmTarget}.${process.pid}.tmp.webm`;
    const mp4Temp = `${mp4Target}.${process.pid}.tmp.mp4`;
    const posterTemp = `${posterTarget}.${process.pid}.tmp.webp`;
    fs.mkdirSync(path.dirname(webmTarget), { recursive: true });

    try {
      checked("ffmpeg", [
        "-y",
        "-i",
        source,
        "-an",
        "-vf",
        "fps=30,scale=1280:720:flags=lanczos,setsar=1",
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "32",
        "-b:v",
        "0",
        "-deadline",
        "good",
        "-cpu-used",
        "3",
        "-row-mt",
        "1",
        "-pix_fmt",
        "yuv420p",
        webmTemp,
      ]);
      verifyVideo(webmTemp, {
        codec: "vp9",
        width: 1280,
        height: 720,
        fps: "30/1",
        pixelFormat: "yuv420p",
      });
      checked("ffmpeg", [
        "-y",
        "-i",
        source,
        "-an",
        "-vf",
        "fps=30,scale=1280:720:flags=lanczos,setsar=1",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "24",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4Temp,
      ]);
      verifyVideo(mp4Temp, {
        codec: "h264",
        width: 1280,
        height: 720,
        fps: "30/1",
        pixelFormat: "yuv420p",
      });
      checked("ffmpeg", [
        "-y",
        "-ss",
        posterAt.toFixed(3),
        "-i",
        mp4Temp,
        "-frames:v",
        "1",
        "-c:v",
        "libwebp",
        "-quality",
        "84",
        posterTemp,
      ]);
      fs.renameSync(webmTemp, webmTarget);
      fs.renameSync(mp4Temp, mp4Target);
      fs.renameSync(posterTemp, posterTarget);

      const homeProvenance = {
        ...provenance,
        testTitle: `derive home media › ${assetId}`,
        watchPaths: [
          entry.source,
          "apps/web/e2e/screenshots/_helpers/marketing-assets.ts",
          "docs-site/.vitepress/theme/components/home/ProductProof.vue",
        ].filter(Boolean),
      };
      recordFlowArtifact({ ...homeProvenance, targetPath: webmTarget, role: "home-video" });
      recordFlowArtifact({ ...homeProvenance, targetPath: mp4Target, role: "home-video" });
      recordFlowArtifact({ ...homeProvenance, targetPath: posterTarget, role: "home-poster" });
      console.log(`[home-media] ✓ ${assetId} → ${path.relative(REPO_ROOT, webmTarget)}`);
    } finally {
      fs.rmSync(webmTemp, { force: true });
      fs.rmSync(mp4Temp, { force: true });
      fs.rmSync(posterTemp, { force: true });
    }
  }
}
