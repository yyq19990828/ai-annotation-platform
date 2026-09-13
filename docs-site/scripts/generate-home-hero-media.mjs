#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs, { mkdirSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  readScreenshotManifest,
  readImageDimensions,
  sha256File,
} from "../../scripts/screenshot-manifest-utils.mjs";
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

const { values } = parseArgs({ options: { asset: { type: "string", multiple: true } } });
const selected = values.asset ?? media.map(([, name]) => name.replace(/\.webp$/, ""));
for (const name of selected) {
  if (!media.some(([, output]) => output === `${name}.webp`)) {
    throw new Error(`Unknown Hero asset: ${name}`);
  }
}
const screenshot = readScreenshotManifest(
  resolve(repoRoot, "apps/web/e2e/screenshots/outputs/manifest.json"),
);
const manifestPath = resolve(repoRoot, "apps/web/e2e/screenshots/outputs/flow-manifest.json");
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : { schema_version: 1, entries: {} };
const capturedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const sourceWorktreeDirty = Boolean(
  execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim(),
);

const probe = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
if (probe.status !== 0) {
  throw new Error(
    `ffmpeg 不可用，无法生成首页 Hero WebP。请安装 ffmpeg 或设置 FFMPEG_PATH。\n${probe.stderr || probe.error || ""}`,
  );
}

mkdirSync(outputRoot, { recursive: true });
for (const [inputRelative, outputName] of media) {
  if (!selected.includes(outputName.replace(/\.webp$/, ""))) continue;
  const input = resolve(repoRoot, inputRelative);
  const inputEntry = screenshot.entries[inputRelative];
  const sourceHash = sha256File(input);
  if (!inputEntry || inputEntry.sha256 !== sourceHash) {
    throw new Error(`Hero source must match its screenshot manifest: ${inputRelative}`);
  }
  const dimensions = readImageDimensions(input);
  const output = resolve(outputRoot, outputName);
  const temporary = `${output}.${process.pid}.tmp.webp`;
  let result = spawnSync(
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
      temporary,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 && result.stderr?.includes("Unknown encoder 'libwebp'")) {
    result = spawnSync("cwebp", ["-q", "85", "-m", "4", input, "-o", temporary], {
      encoding: "utf8",
    });
  }
  if (result.status !== 0) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`首页 Hero WebP 生成失败：${inputRelative}\n${result.stderr}`);
  }
  fs.renameSync(temporary, output);
  const key = relative(repoRoot, output).replaceAll("\\", "/");
  manifest.entries[key] = {
    asset_id: `home-hero/${outputName.replace(/\.webp$/, "")}`,
    role: "hero-image",
    generated_at: new Date().toISOString(),
    captured_commit: inputEntry.source_commit ?? screenshot.source_commit ?? null,
    source_worktree_dirty:
      inputEntry.source_worktree_dirty ?? screenshot.source_worktree_dirty ?? null,
    derived_commit: capturedCommit,
    derivation_worktree_dirty: sourceWorktreeDirty,
    seed_revision: inputEntry?.seed_revision ?? null,
    source: "docs-site/scripts/generate-home-hero-media.mjs",
    watch_paths: [
      inputRelative,
      inputEntry?.source,
      "docs-site/scripts/generate-home-hero-media.mjs",
      "docs-site/.vitepress/theme/components/home/DataAtlasHero.vue",
    ].filter(Boolean),
    sha256: sha256File(output),
    bytes: statSync(output).size,
    media: { codec: "webp", ...dimensions },
    capture: { profile: "static", inference: "none" },
    source_asset: {
      path: inputRelative,
      sha256: sourceHash,
      captured_commit: inputEntry?.source_commit ?? null,
    },
  };
  manifest.updated_at = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const sizeKiB = (statSync(output).size / 1024).toFixed(1);
  console.log(`[home-hero] ${relative(repoRoot, output)} (${sizeKiB} KiB)`);
}
