#!/usr/bin/env node
// scripts/check-dead-links.mjs
//
// 扫描仓库所有 markdown 文件中的相对路径引用，找出指向不存在文件的「死链」，
// 并为每条死链推荐最相似的现有文件（用 Damerau-Levenshtein 距离 + 路径相似度）。
//
// 用法：
//   node scripts/check-dead-links.mjs                   # 全仓扫描（默认跳过历史快照）
//   node scripts/check-dead-links.mjs --json            # JSON 输出（CI 用）
//   node scripts/check-dead-links.mjs --include-historical
//                                                       # 也检查 docs/plans/ 与 docs/changelogs/
//   node scripts/check-dead-links.mjs path/to/dir       # 仅扫描子目录
//
// 退出码：发现死链返回 1，否则 0。
//
// 默认跳过的源（不视为死链来源，因为是固化历史快照）：
//   docs/plans/、docs/changelogs/
// 默认跳过的目录（不扫描）：
//   node_modules / .git / .claude/worktrees / dist / build /
//   docs-site/changelog/ / docs-site/roadmap/ / docs-site/dev/adr/（VitePress 自动镜像）
//
// 目标侧识别：VitePress 风格 `./foo` 自动尝试 `./foo.md` 与 `./foo/index.md`；
// 源码引用 `path/file.ts:123` 自动剥离行号后缀；docs-site/dev/adr 等镜像目录
// 会回查 docs/adr 源文件，避免镜像未重建造成的假死链。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve, relative, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { rewrites } from "../docs-site/.vitepress/content.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "..");
const REWRITE_SOURCE_BY_ROUTE = new Map(
  Object.entries(rewrites).map(([source, target]) => [target.replace(/\.md$/, ""), source]),
);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".turbo",
  ".pnpm-store",
  ".cache",
]);

// 这些目录虽然在仓内，但属于自动生成 / 临时副本 / 第三方 vendor，不作为死链来源
const SKIP_PATH_PREFIXES = [
  ".claude/worktrees/",
  "docs-site/changelog/",
  "docs-site/roadmap/",
  "docs-site/dev/adr/",
  "docs-site/.vitepress/cache/",
  "docs-site/.vitepress/dist/",
];

// 路径片段匹配（更通用）：vendor/、third_party/ 等子目录
const SKIP_PATH_SEGMENTS = ["/vendor/", "/third_party/", "/third-party/"];

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

function shouldSkipFile(relPath) {
  const p = relPath.split(sep).join("/");
  if (SKIP_PATH_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  const padded = "/" + p;
  if (SKIP_PATH_SEGMENTS.some((seg) => padded.includes(seg))) return true;
  return false;
}

function walk(root, out = []) {
  for (const entry of readdirSync(root)) {
    const full = resolve(root, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (shouldSkipDir(entry)) continue;
      walk(full, out);
    } else if (st.isFile() && entry.endsWith(".md")) {
      const rel = relative(REPO, full);
      if (shouldSkipFile(rel)) continue;
      out.push(full);
    }
  }
  return out;
}

// 提取 markdown 中的相对链接目标。匹配两类：
//   [text](path)            标准链接
//   [text]: path            引用式定义
// 忽略：http(s)://, mailto:, #anchor, javascript:, data:
function extractLinks(text) {
  // 屏蔽代码 fence (```...```) 与行内 code (`...`)：把它们替换为等长空格，
  // 这样下游 regex 不会匹配代码里的示例链接，行号也保持原样。
  function maskCode(src) {
    const lines = src.split("\n");
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) {
        inFence = !inFence;
        lines[i] = " ".repeat(lines[i].length);
        continue;
      }
      if (inFence) {
        lines[i] = " ".repeat(lines[i].length);
        continue;
      }
      // 行内 code：成对反引号之间清空
      lines[i] = lines[i].replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
    }
    return lines.join("\n");
  }
  const masked = maskCode(text);

  const links = [];

  const lineStarts = [0];
  for (let i = 0; i < masked.length; i++) {
    if (masked.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  const lineOf = (off) => {
    let lo = 0,
      hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const inlineRe = /\[(?:[^\]\\]|\\.)*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = inlineRe.exec(masked))) {
    links.push({ target: m[1], offset: m.index, line: lineOf(m.index) });
  }

  const refRe = /^[ \t]*\[(?:[^\]\\]|\\.)+\]:\s*(\S+)/gm;
  while ((m = refRe.exec(masked))) {
    links.push({ target: m[1], offset: m.index, line: lineOf(m.index) });
  }

  return links;
}

function isExternal(target) {
  return /^(https?:|mailto:|ftp:|javascript:|data:|tel:)/i.test(target);
}

function stripFragment(target) {
  const i = target.indexOf("#");
  return i >= 0 ? target.slice(0, i) : target;
}

function stripQuery(target) {
  const i = target.indexOf("?");
  return i >= 0 ? target.slice(0, i) : target;
}

// 源码引用约定：`path/to/file.ts:123` 或 `path/to/file.ts:12-34` 用尾部冒号 + 数字定位行号
function stripLineSuffix(target) {
  return target.replace(/:\d+(?:-\d+)?$/, "");
}

// 解析链接目标为绝对仓库路径；返回 null 表示「非文件链接」(纯锚点)
// 当源文件在 docs-site/ 内部时，绝对路径（/foo）按 VitePress 站点根 (= docs-site/) 解析
function resolveTarget(sourceFile, target) {
  if (!target || target.startsWith("#")) return null;
  if (isExternal(target)) return null;

  let t = stripLineSuffix(stripQuery(stripFragment(target)));
  if (!t) return null;

  try {
    t = decodeURIComponent(t);
  } catch {
    // 保留原样
  }

  let abs;
  if (t.startsWith("/")) {
    const relSource = relative(REPO, sourceFile).split(sep).join("/");
    if (relSource.startsWith("docs-site/")) {
      abs = resolve(REPO, "docs-site", "." + t);
    } else {
      abs = resolve(REPO, "." + t);
    }
  } else {
    abs = resolve(dirname(sourceFile), t);
  }
  return abs;
}

// Damerau-Levenshtein 距离，带上限剪枝
function dlDistance(a, b, cap = 64) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length,
    n = b.length;
  const prev2 = new Array(n + 1);
  const prev = new Array(n + 1);
  const cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= n; j++) {
      prev2[j] = prev[j];
      prev[j] = cur[j];
    }
  }
  return prev[n];
}

// 综合相似度评分：basename 距离权重高 + 完整路径距离次之，越小越像
function similarityScore(missingRel, candidateRel) {
  const a = basename(missingRel);
  const b = basename(candidateRel);
  const nameDist = dlDistance(a.toLowerCase(), b.toLowerCase());
  const pathDist = dlDistance(missingRel.toLowerCase(), candidateRel.toLowerCase());
  // basename 严重失配时直接惩罚
  return nameDist * 4 + pathDist;
}

function pickClosest(missingAbs, repoFiles, limit = 3) {
  const missingRel = relative(REPO, missingAbs);
  const scored = [];
  for (const f of repoFiles) {
    const rel = relative(REPO, f);
    const score = similarityScore(missingRel, rel);
    scored.push({ rel, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit);
}

// 收集仓库内所有候选文件（用于相似度匹配）。这里不排除自动镜像目录，
// 因为有时死链可以通过指向镜像目录修复。
function collectAllFiles(root, out = []) {
  for (const entry of readdirSync(root)) {
    const full = resolve(root, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (shouldSkipDir(entry)) continue;
      // 即使是 SKIP_PATH_PREFIXES 也保留，候选用
      collectAllFiles(full, out);
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// 历史快照目录：默认不视为死链来源（内容已固化，引用的源码常已搬迁）
// docs/adr/archive/ = Accepted ADR 归档，内部相对引用维持原样，不作为死链源。
const HISTORICAL_SOURCE_PREFIXES = ["docs/plans/", "docs/changelogs/", "docs/adr/archive/"];

function isHistoricalSource(relPath) {
  const p = relPath.split(sep).join("/");
  return HISTORICAL_SOURCE_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const includeHistorical = args.includes("--include-historical");
  const positional = args.filter((a) => !a.startsWith("--"));
  const scanRoot = positional[0] ? resolve(REPO, positional[0]) : REPO;

  const mdFiles = walk(scanRoot).filter((f) => {
    if (includeHistorical) return true;
    return !isHistoricalSource(relative(REPO, f));
  });
  const allFiles = collectAllFiles(REPO);

  // VitePress / MkDocs 风格：`./foo` 实际指向 `./foo.md` 或 `./foo/index.md`
  // 同时识别 docs-site/ 下的自动镜像约定：
  //   docs-site/dev/adr/<X>     ↔ docs/adr/<X>
  //   docs-site/changelog/<X>   ↔ docs/changelogs/<X> 或根 CHANGELOG.md
  //   docs-site/roadmap/<X>     ↔ ROADMAP/<X>（前缀 `archived-` 对应 archive/）
  //   rewrites 的公开路由       ↔ docs-site/ 下的实际源文件
  //   /api-reference.html 等    ↔ docs-site/public/...（VitePress public/ 挂载到站根）
  function existsAny(...paths) {
    return paths.some((p) => existsSync(p));
  }

  function tryResolveWithExtensions(abs) {
    if (existsAny(abs, abs + ".md", resolve(abs, "index.md"))) return true;

    const rel = relative(REPO, abs).split(sep).join("/");

    if (rel.startsWith("docs-site/")) {
      const route = rel.slice("docs-site/".length).replace(/\/$/, "");
      const source = REWRITE_SOURCE_BY_ROUTE.get(route);
      if (source && existsSync(resolve(REPO, "docs-site", source))) return true;
    }

    // ADR 镜像
    if (rel.startsWith("docs-site/dev/adr/")) {
      const sub = rel.slice("docs-site/dev/adr/".length);
      const srcBase = resolve(REPO, "docs/adr", sub);
      if (existsAny(srcBase, srcBase + ".md")) return true;
    }
    // CHANGELOG 镜像
    if (rel.startsWith("docs-site/changelog/")) {
      const sub = rel.slice("docs-site/changelog/".length);
      const srcBase = resolve(REPO, "docs/changelogs", sub);
      if (existsAny(srcBase, srcBase + ".md")) return true;
      if (sub === "" || sub === "index") {
        if (existsSync(resolve(REPO, "CHANGELOG.md"))) return true;
      }
    }
    // ROADMAP 镜像（`archived-` → `archive/`）
    if (rel.startsWith("docs-site/roadmap/")) {
      const rawSub = rel.slice("docs-site/roadmap/".length);
      const sub = rawSub.startsWith("archived-")
        ? `archive/${rawSub.slice("archived-".length)}`
        : rawSub;
      const srcBase = resolve(REPO, "ROADMAP", sub);
      if (existsAny(srcBase, srcBase + ".md")) return true;
      if (sub === "" || sub === "index") {
        if (existsSync(resolve(REPO, "ROADMAP.md"))) return true;
      }
    }
    // VitePress public/ 静态资源
    if (rel.startsWith("docs-site/") && !rel.startsWith("docs-site/public/")) {
      const sub = rel.slice("docs-site/".length);
      if (existsSync(resolve(REPO, "docs-site/public", sub))) return true;
    }
    return false;
  }

  const dead = [];
  for (const file of mdFiles) {
    const text = readFileSync(file, "utf8");
    const links = extractLinks(text);
    for (const { target, line } of links) {
      const abs = resolveTarget(file, target);
      if (abs == null) continue;
      if (tryResolveWithExtensions(abs)) continue;
      dead.push({
        file: relative(REPO, file),
        line,
        target,
        resolved: relative(REPO, abs),
        suggestions: pickClosest(abs, allFiles),
      });
    }
  }

  if (jsonMode) {
    process.stdout.write(JSON.stringify(dead, null, 2) + "\n");
  } else {
    if (dead.length === 0) {
      console.log(`✓ 未发现死链（扫描 ${mdFiles.length} 个 markdown 文件）`);
    } else {
      console.log(`✗ 发现 ${dead.length} 条死链（扫描 ${mdFiles.length} 个 markdown 文件）\n`);
      for (const d of dead) {
        console.log(`${d.file}:${d.line}`);
        console.log(`  链接：${d.target}`);
        console.log(`  解析为：${d.resolved}（不存在）`);
        if (d.suggestions.length > 0) {
          console.log(`  最相似：`);
          for (const s of d.suggestions) {
            console.log(`    - ${s.rel}  (score=${s.score})`);
          }
        }
        console.log("");
      }
    }
  }

  process.exit(dead.length === 0 ? 0 : 1);
}

main();
