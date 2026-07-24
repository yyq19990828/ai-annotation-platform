#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const outputRoot = resolve(here, "../.vitepress/theme/assets/home/hero");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

const media = [
  ["docs-site/user-guide/images/workbench/video-real-scene.png", "video-track.webp"],
  ["docs-site/user-guide/images/workbench/pointcloud-real-scene.png", "pointcloud.webp"],
  ["docs-site/user-guide/images/projects/data-manager-overview.png", "data-manager.webp"],
  ["docs-site/user-guide/images/review/workbench.png", "review.webp"],
];

const probe = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
if (probe.status !== 0) {
  throw new Error(
    `ffmpeg 不可用，无法生成首页 Hero WebP。请安装 ffmpeg 或设置 FFMPEG_PATH。\n${probe.stderr || probe.error || ""}`,
  );
}

mkdirSync(outputRoot, { recursive: true });
for (const [inputRelative, outputName] of media) {
  const input = resolve(repoRoot, inputRelative);
  const output = resolve(outputRoot, outputName);
  const result = spawnSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-y",
      "-i",
      input,
      "-frames:v",
      "1",
      "-c:v",
      "libwebp",
      "-quality",
      "85",
      "-compression_level",
      "4",
      output,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`首页 Hero WebP 生成失败：${inputRelative}\n${result.stderr}`);
  }
  const sizeKiB = (statSync(output).size / 1024).toFixed(1);
  console.log(`[home-hero] ${relative(repoRoot, output)} (${sizeKiB} KiB)`);
}
