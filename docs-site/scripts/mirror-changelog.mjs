#!/usr/bin/env node
// 把仓库根 CHANGELOG.md / ROADMAP.md 与 docs/changelogs/* / ROADMAP/* 镜像到
// docs-site/changelog/、docs-site/roadmap/，让 VitePress 能渲染并部署到 Pages。
// 同时输出 sidebar.generated.json 给 .vitepress/config.ts 注入。
//
// 与 mirror-adr.mjs 同样模式：源文件不动；镜像产物 gitignore；改源后 build 时重建。

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");

const banner = (srcRel) =>
  `> ⚠️ **自动镜像** · 此页由 \`docs-site/scripts/mirror-changelog.mjs\` 从 \`${srcRel}\` 生成，请勿直接编辑此处；改源文件后 \`pnpm docs:build\` 会自动同步。\n\n`;

// 转义代码块外的尖括号：CHANGELOG/ROADMAP 里有大量 `<reason>` `<JWT>` `<AppShell>`
// 这种 placeholder 文本，写在代码里没事，但 VitePress 的 Vue compiler 会把代码块外的
// 裸 `<word>` 当成未闭合标签报错。这里把代码 fence (```...```) 与 inline code (`...`)
// 之外的所有 `<` `>` 转成实体。
function escapeAnglesOutsideCode(text) {
  const lines = text.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // 行内：按 `...` 切片，奇数下标是 code，偶数下标是文本，仅文本部分转义
    // 只转义 `<`：Vue 解析器只对未闭合 `<tag>` 报错；保留 `>` 以免破坏 markdown
    // blockquote。autolinks `<url>` 在源文件中未使用（已 grep 确认）。
    const parts = line.split("`");
    for (let j = 0; j < parts.length; j += 2) {
      parts[j] = parts[j].replace(/</g, "&lt;");
    }
    lines[i] = parts.join("`");
  }
  return lines.join("\n");
}

const GITHUB_BLOB = "https://github.com/yyq19990828/ai-annotation-platform/blob/main";

// 链接改写：把仓库内引用改成 VitePress 站点路径或 GitHub blob URL。
// 涵盖 root（CHANGELOG.md / ROADMAP.md）与子目录（docs/changelogs/, ROADMAP/）两种
// 视角，因此同时匹配 `./xxx`、`xxx`、`../xxx` 三种相对前缀。
function rewriteLinks(text) {
  // 通用的「相对前缀」段：(?:\.\.?\/)*  匹配任意数量的 ./ 或 ../
  const REL = "(?:\\.\\.?\\/)*";
  const HASH = "(#[^)\\s]*)?";

  return text
    // changelogs 子文件 → /changelog/<ver>
    .replace(new RegExp(`\\]\\(${REL}docs\\/changelogs\\/([^)#\\s]+?)\\.md${HASH}\\)`, "g"), "](/changelog/$1$2)")
    // changelogs 目录 → /changelog/
    .replace(new RegExp(`\\]\\(${REL}docs\\/changelogs\\/?\\)`, "g"), "](/changelog/)")
    // CHANGELOG.md → /changelog/
    .replace(new RegExp(`\\]\\(${REL}CHANGELOG\\.md${HASH}\\)`, "g"), "](/changelog/$1)")
    // ROADMAP/<ver>.md → /roadmap/<ver>
    .replace(new RegExp(`\\]\\(${REL}ROADMAP\\/([^)#\\s]+?)\\.md${HASH}\\)`, "g"), "](/roadmap/$1$2)")
    // ROADMAP.md → /roadmap/
    .replace(new RegExp(`\\]\\(${REL}ROADMAP\\.md${HASH}\\)`, "g"), "](/roadmap/$1)")
    // ADR → /dev/adr/<id>
    .replace(new RegExp(`\\]\\(${REL}docs\\/adr\\/([^)#\\s]+?)\\.md${HASH}\\)`, "g"), "](/dev/adr/$1$2)")
    // plans / research 不进站点：指向 GitHub blob URL（保留 hash）
    .replace(new RegExp(`\\]\\(${REL}docs\\/(plans|research)\\/([^)#\\s]+?\\.md)${HASH}\\)`, "g"),
      `](${GITHUB_BLOB}/docs/$1/$2$3)`)
    // 同目录 ./0.10.x.md（在 ROADMAP/ 内或 docs/changelogs/ 内的版本互引）→ 站点干净 URL
    .replace(/\]\(\.\/(\d+(?:\.\d+)*\.x)\.md(#[^)\s]*)?\)/g, "](./$1$2)");
}

// 版本号自然倒序：0.10.x 在 0.9.x 之前
function compareVersionDesc(a, b) {
  const pa = a.replace(/\.md$/, "").split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.replace(/\.md$/, "").split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return db - da;
  }
  return 0;
}

function mirrorOne({ srcFile, srcRel, dstFile }) {
  const text = readFileSync(srcFile, "utf8");
  const body = escapeAnglesOutsideCode(rewriteLinks(text));
  writeFileSync(dstFile, banner(srcRel) + body);
}

function buildGroup({ name, rootSrc, rootSrcRel, dirSrc, dirSrcRel, dstDir, urlPrefix }) {
  if (existsSync(dstDir)) rmSync(dstDir, { recursive: true, force: true });
  mkdirSync(dstDir, { recursive: true });

  // 1. 根入口 → index.md
  if (!existsSync(rootSrc)) {
    console.error(`[mirror-changelog] 源文件不存在：${rootSrc}`);
    process.exit(1);
  }
  mirrorOne({
    srcFile: rootSrc,
    srcRel: rootSrcRel,
    dstFile: resolve(dstDir, "index.md"),
  });

  // 2. 子目录 → <name>.md
  const versionFiles = existsSync(dirSrc) && statSync(dirSrc).isDirectory()
    ? readdirSync(dirSrc).filter((f) => f.endsWith(".md")).sort(compareVersionDesc)
    : [];
  for (const file of versionFiles) {
    mirrorOne({
      srcFile: resolve(dirSrc, file),
      srcRel: `${dirSrcRel}/${file}`,
      dstFile: resolve(dstDir, file),
    });
  }

  // 3. sidebar：index 在最前，其余按版本倒序
  const sidebar = [{ text: `${name} 总览`, link: `${urlPrefix}/` }];
  for (const file of versionFiles) {
    const stem = file.replace(/\.md$/, "");
    sidebar.push({ text: `v${stem}`, link: `${urlPrefix}/${stem}` });
  }
  writeFileSync(
    resolve(dstDir, "sidebar.generated.json"),
    JSON.stringify(sidebar, null, 2) + "\n",
  );

  console.log(
    `[mirror-changelog] ${name}: 1 root + ${versionFiles.length} versions → ${dstDir}`,
  );
}

buildGroup({
  name: "更新日志",
  rootSrc: resolve(REPO, "CHANGELOG.md"),
  rootSrcRel: "CHANGELOG.md",
  dirSrc: resolve(REPO, "docs/changelogs"),
  dirSrcRel: "docs/changelogs",
  dstDir: resolve(here, "../changelog"),
  urlPrefix: "/changelog",
});

buildGroup({
  name: "Roadmap",
  rootSrc: resolve(REPO, "ROADMAP.md"),
  rootSrcRel: "ROADMAP.md",
  dirSrc: resolve(REPO, "ROADMAP"),
  dirSrcRel: "ROADMAP",
  dstDir: resolve(here, "../roadmap"),
  urlPrefix: "/roadmap",
});
