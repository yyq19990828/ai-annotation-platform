#!/usr/bin/env node
/**
 * M2 · screenshots:lint
 *
 * 检查 docs-site/user-guide/ 下所有 Markdown 引用的图片是否都在
 * e2e/screenshots/outputs/manifest.json 中有记录。
 *
 * 输出：
 *   ✓ 已在 manifest 的自动图
 *   ○ manifest 中 auto:false 的手动图（维护者主动标记）
 *   ✗ 被引用但不在 manifest 的图（需要：① 跑 screenshots 产出，或 ② 手动补 manifest）
 *
 * 用法：
 *   pnpm screenshots:lint
 *   pnpm screenshots:lint --strict   # 有 ✗ 时退出码 1
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { globSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, "../../../..");
const DOCS_ROOT  = path.join(REPO_ROOT, "docs-site/user-guide");
const MANIFEST_PATH = path.join(__dirname, "../e2e/screenshots/outputs/manifest.json");

const strict = process.argv.includes("--strict");

// ── 读取 manifest ────────────────────────────────────────────────
let manifest = {};
if (fs.existsSync(MANIFEST_PATH)) {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
} else {
  console.warn("⚠  manifest.json 不存在，请先跑 pnpm screenshots 生成。");
}

// ── 扫描 Markdown 中的图片引用 ──────────────────────────────────
const mdFiles = globSync("**/*.md", { cwd: DOCS_ROOT });
const imageRefs = new Set();

for (const mdFile of mdFiles) {
  const content = fs.readFileSync(path.join(DOCS_ROOT, mdFile), "utf8");
  // 匹配 ![...](...) 和 <img src="..." />
  const imgRegex = /!\[.*?\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/g;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    const imgSrc = match[1] || match[2];
    if (!imgSrc) continue;
    // 只关心相对路径 images/... 的引用
    if (imgSrc.startsWith("images/") || imgSrc.includes("/images/")) {
      // 标准化为 docs-site/user-guide/images/... 的相对路径
      const normalized = imgSrc.replace(/^.*images\//, "docs-site/user-guide/images/");
      imageRefs.add(normalized);
    }
  }
}

// ── 比对 ─────────────────────────────────────────────────────────
let missingCount = 0;

console.log(`\n截图自动化 manifest 校验 (${imageRefs.size} 张引用图)\n`);
console.log("─".repeat(60));

for (const ref of [...imageRefs].sort()) {
  const entry = manifest[ref];
  if (!entry) {
    console.log(`✗  ${ref}`);
    console.log(`   → 未在 manifest 中：跑 pnpm screenshots 自动产出，或手动补 manifest`);
    missingCount++;
  } else if (!entry.auto) {
    console.log(`○  ${ref}  (手动维护)`);
    if (entry.note) console.log(`   → ${entry.note}`);
  } else {
    const date = entry.lastRun ? entry.lastRun.slice(0, 10) : "未知";
    console.log(`✓  ${ref}  [${entry.scene} · ${date}]`);
  }
}

console.log("─".repeat(60));
console.log(`\n共 ${imageRefs.size} 张，缺 ${missingCount} 张\n`);

if (strict && missingCount > 0) {
  process.exit(1);
}
