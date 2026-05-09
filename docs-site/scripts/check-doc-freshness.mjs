#!/usr/bin/env node
/**
 * 检查 docs-site/ 下所有 .md 文件的 last_reviewed 字段，
 * 超过 THRESHOLD_DAYS 天未审阅则输出 warning（不退出，不阻断构建）。
 *
 * 用法：node docs-site/scripts/check-doc-freshness.mjs [--threshold=<days>]
 *   默认 threshold = 180 天
 *
 * CI 集成：在 docs:build 前运行，仅输出 warning，不阻断。
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __here = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(__here, "..");

const SKIP_DIRS = new Set(["adr", "changelog", "roadmap", ".vitepress", "public", "scripts", "node_modules"]);
const SKIP_GENERATED = /\.generated\.md$/;
const REDIRECT_MARKER = "router.go(";

const thresholdArg = process.argv.find((a) => a.startsWith("--threshold="));
const THRESHOLD_DAYS = thresholdArg ? parseInt(thresholdArg.split("=")[1], 10) : 180;
const THRESHOLD_MS = THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

const now = Date.now();
let stale = 0;
let missing = 0;
let checked = 0;

function parseFrontmatterField(content, field) {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = content.slice(0, end);
  const m = block.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name));
    } else if (e.isFile() && extname(e.name) === ".md") {
      checkFile(join(dir, e.name));
    }
  }
}

function checkFile(filePath) {
  const rel = relative(DOCS_ROOT, filePath);
  const content = readFileSync(filePath, "utf8");

  if (SKIP_GENERATED.test(filePath)) return;
  if (content.includes(REDIRECT_MARKER)) return;

  checked++;
  const rawDate = parseFrontmatterField(content, "last_reviewed");

  if (!rawDate) {
    console.warn(`[warn] Missing last_reviewed: ${rel}`);
    missing++;
    return;
  }

  const reviewedMs = Date.parse(rawDate);
  if (isNaN(reviewedMs)) {
    console.warn(`[warn] Invalid last_reviewed date "${rawDate}": ${rel}`);
    missing++;
    return;
  }

  const ageDays = Math.floor((now - reviewedMs) / (24 * 60 * 60 * 1000));
  if (now - reviewedMs > THRESHOLD_MS) {
    console.warn(`[warn] Stale (${ageDays}d since review): ${rel}`);
    stale++;
  }
}

walk(DOCS_ROOT);

console.log(`\nChecked ${checked} files (threshold: ${THRESHOLD_DAYS} days).`);
if (stale > 0 || missing > 0) {
  console.warn(`${stale} stale file(s), ${missing} without last_reviewed. Consider reviewing.`);
} else {
  console.log("All files are fresh.");
}
// Always exit 0 — freshness check is advisory, not blocking.
