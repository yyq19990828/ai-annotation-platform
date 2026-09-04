#!/usr/bin/env node
// 从高清营销母版库（manifest schema v4）派生宣传文章用的 GIF 与封面 PNG。
// 与 derive-doc-media.mjs 不同：本脚本服务 docs/articles/** 的对外发布稿，
// 输出不进 docs-site，源默认取本地 AAP资产 母版库。
//
// 用法：
//   node scripts/derive-article-media.mjs [--archive <dir>] [--article <id>] [--asset <id> ...]
//     --archive  母版库根目录，默认 ~/Desktop/AAP资产（需含 manifest.json）
//     --article  只处理指定文章配置，默认全部
//     --asset    只处理指定资产 id，可重复
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const DEFAULT_ARCHIVE = path.join(os.homedir(), "Desktop", "AAP资产");

// 每篇文章的素材配置。trim/coverAt 单位秒；fps/width 控制 GIF 体积。
// 知乎/公众号单图上限按 10MB 预算，目标 ≤8MB。
const ARTICLES = {
  "06-video-track": {
    output: "docs/articles/media/06-video-track",
    assets: {
      "video-track": { fps: 10, width: 800, coverAt: 8 },
      "video-draw": { fps: 15, width: 1280, coverAt: 8 },
      "current-frame-video-inference": { fps: 15, width: 1280, coverAt: 18 },
      "video-propagate-track-vs-copy": { fps: 15, width: 1280, coverAt: 17 },
      "video-tracker-text-discovery": { fps: 15, width: 1280, coverAt: 12 },
      "video-tracker-positive-negative": {
        fps: 10,
        width: 800,
        coverAt: 24,
        trim: [4.5, 30.5],
      },
      "video-track-batch-propagate": { fps: 15, width: 1280, coverAt: 8 },
    },
  },
};

const GIF_BUDGET_BYTES = 8 * 1024 * 1024;

function optionValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function checked(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `[article-media] ${command} 失败：${result.error?.message ?? result.stderr.trim() ?? result.status}`,
    );
  }
  return result.stdout;
}

function gifInfo(filePath) {
  const parsed = JSON.parse(
    checked("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,nb_frames",
      "-of",
      "json",
      filePath,
    ]),
  );
  const stream = parsed.streams?.[0];
  return { width: stream?.width, height: stream?.height, frames: Number(stream?.nb_frames ?? 0) };
}

const archiveArg = optionValues("--archive").at(-1);
const ARCHIVE = archiveArg ? path.resolve(archiveArg) : DEFAULT_ARCHIVE;
const manifestPath = path.join(ARCHIVE, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error(`[article-media] manifest 不存在：${manifestPath}`);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schema_version !== 4 || !manifest.entries) {
  throw new Error(`[article-media] 不支持的 manifest：${manifestPath}`);
}

const articleArg = optionValues("--article").at(-1);
const articleIds = articleArg ? [articleArg] : Object.keys(ARTICLES);
const unknownArticle = articleIds.filter((id) => !ARTICLES[id]);
if (unknownArticle.length > 0) {
  throw new Error(`[article-media] 未登记的文章配置：${unknownArticle.join(", ")}`);
}

const requestedAssets = optionValues("--asset");
let oversized = [];

for (const articleId of articleIds) {
  const article = ARTICLES[articleId];
  const outputRoot = path.join(REPO_ROOT, article.output);
  fs.mkdirSync(outputRoot, { recursive: true });

  const assetIds = requestedAssets.length
    ? requestedAssets.filter((id) => article.assets[id])
    : Object.keys(article.assets);
  if (requestedAssets.length && assetIds.length === 0) {
    throw new Error(`[article-media] 文章 ${articleId} 不含所请求的资产`);
  }

  for (const assetId of assetIds) {
    const entry = manifest.entries[assetId];
    if (!entry) throw new Error(`[article-media] manifest 缺少资产：${assetId}`);
    const sourceInfo = entry.files?.universal_mp4;
    if (!sourceInfo?.file) throw new Error(`[article-media] ${assetId} 缺少通用 MP4 来源`);
    const source = path.join(ARCHIVE, sourceInfo.file);
    const duration = Number(sourceInfo.media?.duration_ms ?? 0) / 1000;
    const config = article.assets[assetId];
    const { fps, width, coverAt, trim } = config;
    const [trimStart, trimEnd] = Array.isArray(trim) ? [trim[0], trim[1]] : [null, null];

    const gifTarget = path.join(outputRoot, `${assetId}.gif`);
    const coverTarget = path.join(outputRoot, `${assetId}-cover.png`);
    const paletteTemp = `${gifTarget}.${process.pid}.palette.png`;
    const gifTemp = `${gifTarget}.${process.pid}.tmp.gif`;
    const coverTemp = `${coverTarget}.${process.pid}.tmp.png`;

    try {
      const trimArgs = (start, end) => {
        const args = ["-ss", start.toFixed(3)];
        if (end != null) args.push("-to", end.toFixed(3));
        return args;
      };
      const scale = `scale=${width}:-1:flags=lanczos`;
      checked("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        ...trimArgs(trimStart ?? 0, trimEnd),
        "-i",
        source,
        "-vf",
        `fps=${fps},${scale},palettegen=stats_mode=diff`,
        paletteTemp,
      ]);
      checked("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        ...trimArgs(trimStart ?? 0, trimEnd),
        "-i",
        source,
        "-i",
        paletteTemp,
        "-lavfi",
        `fps=${fps},${scale} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
        gifTemp,
      ]);
      checked("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        Math.min(coverAt, Math.max(0, duration - 0.2)).toFixed(3),
        "-i",
        source,
        "-frames:v",
        "1",
        "-vf",
        "scale=1600:-1:flags=lanczos",
        coverTemp,
      ]);
      fs.renameSync(gifTemp, gifTarget);
      fs.renameSync(coverTemp, coverTarget);

      const bytes = fs.statSync(gifTarget).size;
      const info = gifInfo(gifTarget);
      const flag = bytes > GIF_BUDGET_BYTES ? " ⚠ 超预算" : "";
      if (bytes > GIF_BUDGET_BYTES) oversized.push(assetId);
      console.log(
        `[article-media] ✓ ${assetId} → ${path.relative(REPO_ROOT, gifTarget)} ` +
          `${(bytes / 1024 / 1024).toFixed(2)}MB ${info.width}x${info.height} ${info.frames}f${flag}`,
      );
    } finally {
      fs.rmSync(paletteTemp, { force: true });
      fs.rmSync(gifTemp, { force: true });
      fs.rmSync(coverTemp, { force: true });
    }
  }
}

if (oversized.length > 0) {
  console.error(
    `[article-media] 以下 GIF 超过 8MB 预算，需降低 fps/width：${oversized.join(", ")}`,
  );
  process.exitCode = 1;
}
