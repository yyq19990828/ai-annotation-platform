#!/usr/bin/env node
/**
 * check-orphan-images.mjs
 *
 * 与 check-image-manifest.mjs **反向**：那个查「文档引用的图是否产出」，这个查
 * 「产出的图是否被文档引用」。扫描 docs-site/user-guide/images/ 下所有图片文件，
 * 找出**没有任何 Markdown 页面 `![]()` / <img> 引用**的孤儿图（产出了却忘记回填）。
 *
 * 背景：截图/GIF 自动落到 images/ 并登记 IMAGE_CHECKLIST，但嵌入文档页是独立一步，
 * 容易漏。漏了就成孤儿资源——本检查在 CI 拦住它。
 *
 * 用法：
 *   node docs-site/scripts/check-orphan-images.mjs
 *   node docs-site/scripts/check-orphan-images.mjs --strict   # 有孤儿时退出码 1
 *
 * 在 CI visual-regression job 中以 --strict 模式运行（紧随 check-image-manifest）。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT   = path.resolve(__dirname, "../..");
const DOCS_ROOT   = path.join(REPO_ROOT, "docs-site");
const IMAGES_ROOT = path.join(REPO_ROOT, "docs-site/user-guide/images");

const strict = process.argv.includes("--strict");
const json   = process.argv.includes("--json");

// 有意保留、暂不嵌入文档的图片（相对 IMAGES_ROOT，正斜杠）。需要时在此登记豁免。
// 基线已归零：引入本检查时的 20 张存量孤儿已全部回填到对应 user-guide 页面。
// ai-tool-drawer 是已被顶部交互工具栏取代的历史截图，仅保留作视觉回归基线，不能再嵌入用户指南。
const IGNORE = new Set(["sam/ai-tool-drawer.png"]);

const IMG_EXT = /\.(png|gif|jpe?g|webp|svg)$/i;

// ── 收集 images/ 下所有图片文件（绝对路径）─────────────────────────
function* walk(dir, test) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, test);
    else if (test(entry.name)) yield full;
  }
}

const imageFiles = [...walk(IMAGES_ROOT, (n) => IMG_EXT.test(n))];
const imageFileSet = new Set(imageFiles);

// ── 收集所有 Markdown 引用并解析为绝对路径（记来源 md）──────────────
const referenced = new Map(); // 绝对路径 → 来源 md（相对仓库根）
for (const mdPath of walk(DOCS_ROOT, (n) => n.endsWith(".md"))) {
  const content = fs.readFileSync(mdPath, "utf8");
  const rel = path.relative(REPO_ROOT, mdPath).replace(/\\/g, "/");
  const imgRe = /!\[.*?\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/g;
  let m;
  while ((m = imgRe.exec(content)) !== null) {
    const src = (m[1] || m[2] || "").trim();
    if (src.startsWith("http") || !IMG_EXT.test(src)) continue;
    const mdDir = path.dirname(mdPath);
    const abs = src.startsWith("/")
      ? path.join(DOCS_ROOT, src) // 根绝对路径相对 docs-site 根（vitepress public 约定）
      : path.resolve(mdDir, src);
    if (!referenced.has(abs)) referenced.set(abs, rel);
  }
}

// ── 孤儿：磁盘有图但无任何文档引用 ────────────────────────────────
const orphans = imageFiles
  .map((abs) => path.relative(IMAGES_ROOT, abs).replace(/\\/g, "/"))
  .filter((rel) => !IGNORE.has(rel))
  .filter((rel) => !referenced.has(path.join(IMAGES_ROOT, rel)))
  .sort();

// ── 失链 GIF：文档引用了 images/ 下的 .gif 但磁盘上不存在 ──────────
// （PNG 等静态图的「引用但缺失」由 check-image-manifest 负责；GIF 不入 manifest，故在此兜底。）
const brokenGifRefs = [...referenced.entries()]
  .filter(([abs]) => abs.startsWith(IMAGES_ROOT + path.sep) && /\.gif$/i.test(abs))
  .filter(([abs]) => !imageFileSet.has(abs))
  .map(([abs, md]) => ({ rel: path.relative(IMAGES_ROOT, abs).replace(/\\/g, "/"), md }))
  .sort((a, b) => a.rel.localeCompare(b.rel));

const failed = orphans.length + brokenGifRefs.length;

if (json) {
  console.log(JSON.stringify({ total: imageFiles.length, orphans, brokenGifRefs }, null, 2));
  process.exit(strict && failed > 0 ? 1 : 0);
}

// ── 人类可读输出 ─────────────────────────────────────────────────
console.log(`\n孤儿图检查 — images/ 下 ${imageFiles.length} 张图\n${"─".repeat(64)}`);
if (orphans.length === 0) {
  console.log("✓  全部图片都已被文档页面引用，无孤儿。");
} else {
  for (const rel of orphans) console.log(`✗  孤儿(产出未引用): images/${rel}`);
  console.log(`   发现 ${orphans.length} 张孤儿图（产出但无任何 .md 引用）。`);
  console.log("   → 在对应 user-guide 页面加 ![](../images/…) 引用；或删文件；或加进 IGNORE 白名单。");
}
if (brokenGifRefs.length > 0) {
  for (const { rel, md } of brokenGifRefs) {
    console.log(`✗  失链 GIF(引用但文件不存在): images/${rel}`);
    console.log(`   引用自：${md} → 跑 pnpm screenshots:flows 录制，或修正引用路径。`);
  }
}
console.log("");

if (strict && failed > 0) process.exit(1);
