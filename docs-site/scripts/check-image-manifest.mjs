#!/usr/bin/env node
/**
 * M4 · check-image-manifest.mjs
 *
 * 校验 docs-site/user-guide/ 所有 Markdown 引用的图片是否都在
 * apps/web/e2e/screenshots/outputs/manifest.json 中有记录。
 *
 * 用法：
 *   node docs-site/scripts/check-image-manifest.mjs
 *   node docs-site/scripts/check-image-manifest.mjs --strict   # 有缺失时退出码 1
 *
 * 在 CI release-gate job 中以 --strict 模式运行。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT     = path.resolve(__dirname, "../..");
const DOCS_ROOT     = path.join(REPO_ROOT, "docs-site/user-guide");
const MANIFEST_PATH = path.join(REPO_ROOT, "apps/web/e2e/screenshots/outputs/manifest.json");

const strict = process.argv.includes("--strict");
const json   = process.argv.includes("--json");

// ── 读 manifest ──────────────────────────────────────────────────
let manifest = {};
if (fs.existsSync(MANIFEST_PATH)) {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
} else {
  console.warn("⚠  manifest.json 不存在。请先跑 pnpm screenshots。");
}

// ── 扫描 Markdown 图片引用 ───────────────────────────────────────
function* walkMd(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMd(full);
    else if (entry.name.endsWith(".md")) yield full;
  }
}

const imageRefs = new Map(); // normalized-key → source md file

for (const mdPath of walkMd(DOCS_ROOT)) {
  const content = fs.readFileSync(mdPath, "utf8");
  const rel = path.relative(REPO_ROOT, mdPath);
  const imgRe = /!\[.*?\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/g;
  let m;
  while ((m = imgRe.exec(content)) !== null) {
    const src = (m[1] || m[2] || "").trim();
    if (!src.startsWith("http") && src.match(/\.(png|gif|jpg|jpeg|webp|svg)/i)) {
      // 标准化到仓库根相对路径
      const mdDir = path.dirname(mdPath);
      const abs   = src.startsWith("/")
        ? path.join(REPO_ROOT, "docs-site", src)
        : path.resolve(mdDir, src);
      const key = path.relative(REPO_ROOT, abs).replace(/\\/g, "/");
      imageRefs.set(key, rel);
    }
  }
}

// ── 比对 ─────────────────────────────────────────────────────────
const results = { auto: [], manual: [], missing: [] };

for (const [key, mdSource] of [...imageRefs].sort()) {
  const entry = manifest[key];
  if (!entry) {
    results.missing.push({ key, mdSource });
  } else if (!entry.auto) {
    results.manual.push({ key, mdSource, note: entry.note });
  } else {
    results.auto.push({ key, mdSource, scene: entry.scene, lastRun: entry.lastRun });
  }
}

if (json) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(strict && results.missing.length > 0 ? 1 : 0);
}

// ── 人类可读输出 ─────────────────────────────────────────────────
const total   = imageRefs.size;
const missing = results.missing.length;

console.log(`\n图片 manifest 校验 — ${total} 张引用图\n${"─".repeat(64)}`);

for (const r of results.auto) {
  const date = r.lastRun?.slice(0, 10) ?? "?";
  console.log(`✓  ${r.key}  [${r.scene} · ${date}]`);
}
for (const r of results.manual) {
  console.log(`○  ${r.key}  (手动维护${r.note ? "：" + r.note : ""})`);
}
for (const r of results.missing) {
  console.log(`✗  ${r.key}`);
  console.log(`   引用自：${r.mdSource}`);
  console.log(`   → 跑 pnpm screenshots 自动产出，或在 manifest.json 里手动标记 auto:false`);
}

console.log(`${"─".repeat(64)}`);
console.log(`共 ${total} 张 | ✓ ${results.auto.length} 自动 | ○ ${results.manual.length} 手动 | ✗ ${missing} 缺失\n`);

if (strict && missing > 0) process.exit(1);
