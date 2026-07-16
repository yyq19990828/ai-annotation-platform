#!/usr/bin/env node
/**
 * 快速检查用户指南中的 Markdown / img / AutoImage 引用是否已登记到
 * screenshot manifest。完整哈希、场景和孤儿检查由 docs-site/scripts 下的两个门禁负责。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectMarkdownImageReferences } from "../../../scripts/image-reference-utils.mjs";
import { readScreenshotManifest } from "../../../scripts/screenshot-manifest-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs-site");
const USER_GUIDE_ROOT = path.join(DOCS_ROOT, "user-guide");
const IMAGES_PREFIX = "docs-site/user-guide/images/";
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "apps/web/e2e/screenshots/outputs/manifest.json",
);
const strict = process.argv.includes("--strict");

const { schemaVersion, entries } = readScreenshotManifest(MANIFEST_PATH);
if (!fs.existsSync(MANIFEST_PATH)) {
  console.warn("⚠  manifest.json 不存在，请先运行完整截图矩阵。");
}

const references = collectMarkdownImageReferences({
  scanRoot: USER_GUIDE_ROOT,
  repoRoot: REPO_ROOT,
  docsRoot: DOCS_ROOT,
});
const imageRefs = [...references.entries()]
  .filter(([key]) => key.startsWith(IMAGES_PREFIX) && !/\.gif$/i.test(key))
  .sort(([left], [right]) => left.localeCompare(right));

let missingCount = 0;
console.log(`\n截图 manifest 快速校验（schema v${schemaVersion}，${imageRefs.length} 张静态引用图）\n`);
console.log("─".repeat(64));

for (const [key, reference] of imageRefs) {
  const entry = entries[key];
  if (!entry) {
    console.log(`✗  ${key}`);
    console.log(`   引用自：${[...reference.sources].join(", ")}`);
    missingCount += 1;
  } else if (!entry.auto) {
    console.log(`○  ${key}  (手动维护)`);
  } else {
    const date = (entry.generated_at ?? entry.lastRun)?.slice(0, 10) ?? "未知";
    console.log(`✓  ${key}  [${entry.scene} · ${date}]`);
  }
}

console.log("─".repeat(64));
console.log(`\n共 ${imageRefs.length} 张，缺 ${missingCount} 张\n`);
if (strict && missingCount > 0) process.exit(1);
