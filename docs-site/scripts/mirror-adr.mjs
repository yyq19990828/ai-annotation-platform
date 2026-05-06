#!/usr/bin/env node
// 把 docs/adr/*.md 镜像到 docs-site/dev/adr/，让 VitePress 能渲染（VitePress 只
// 渲染 docs-site/ 内的 .md），同时输出 sidebar.generated.json 给 .vitepress/config.ts
// 注入到「开发文档 → ADR」侧边栏组。
//
// 镜像后文件头部插入一行 ⚠ 警告，提示读者去 docs/adr/ 改源文件。
// 文件内 frontmatter / 标题 / 链接保持不变（ADR 互引继续用相对路径即可）。

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../../docs/adr");
const DST = resolve(here, "../dev/adr");
const SIDEBAR = resolve(here, "../dev/adr/sidebar.generated.json");

if (!existsSync(SRC)) {
  console.error(`[mirror-adr] 源目录不存在：${SRC}`);
  process.exit(1);
}

// 清空 dst，避免源端删除 ADR 后镜像残留
if (existsSync(DST)) rmSync(DST, { recursive: true, force: true });
mkdirSync(DST, { recursive: true });

const banner = (srcRel) =>
  `> ⚠️ **自动镜像** · 此页由 \`docs-site/scripts/mirror-adr.mjs\` 从 \`${srcRel}\` 生成，请勿直接编辑此处；改源文件后 \`pnpm docs:build\` 会自动同步。\n\n`;

const files = readdirSync(SRC).filter((f) => f.endsWith(".md")).sort();
const sidebar = [];

for (const name of files) {
  const srcRel = `docs/adr/${name}`;
  const text = readFileSync(resolve(SRC, name), "utf8");

  // README → index：链接也要从 ./0001-... 改为绝对 /dev/adr/0001-...，避免 VitePress dead link
  const isReadme = name === "README.md";
  const dstName = isReadme ? "index.md" : name;

  // 抽取首个 # 标题作为 sidebar text
  const titleMatch = text.match(/^#\s+(.+?)\s*$/m);
  const title = titleMatch ? titleMatch[1].trim() : name.replace(/\.md$/, "");

  let body = text;
  if (isReadme) {
    // README 内的 `0001-...md` / `./0001-...md` 链接需改为站点路径
    body = body.replace(
      /\]\(\.?\/?(\d{4}-[\w-]+)\.md\)/g,
      "](/dev/adr/$1)",
    );
  }

  writeFileSync(resolve(DST, dstName), banner(srcRel) + body);

  if (!isReadme) {
    sidebar.push({
      text: title,
      link: `/dev/adr/${name.replace(/\.md$/, "")}`,
    });
  }
}

// 写 sidebar；放 README/index 在最前
sidebar.unshift({ text: "ADR 索引", link: "/dev/adr/" });
writeFileSync(SIDEBAR, JSON.stringify(sidebar, null, 2) + "\n");

console.log(
  `[mirror-adr] mirrored ${files.length} files → ${DST}; sidebar with ${sidebar.length} entries`,
);
