#!/usr/bin/env node
// 校验 docs-site/**/*.md 中 <!-- snippet:PATH:START-END --> 标记包裹的代码块
// 与源文件 PATH 的 START..END 行（1-indexed，含两端）逐行一致。
//
// 标记格式：
//   <!-- snippet:apps/api/app/api/v1/auth.py:239-266 -->
//   ```python
//   ...源文件 239-266 行的逐字内容...
//   ```
//   <!-- /snippet -->
//
// 任一不一致退出 1 并打印 diff，让 prebuild / CI 拦下漂移。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(here, "../..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

const SNIPPET_RE =
  /<!--\s*snippet:([^\s:]+):(\d+)-(\d+)\s*-->\s*\n```[^\n]*\n([\s\S]*?)\n```\s*\n<!--\s*\/snippet\s*-->/g;

let failed = 0;
let checked = 0;

for (const mdPath of walk(DOCS_ROOT)) {
  const text = readFileSync(mdPath, "utf8");
  for (const m of text.matchAll(SNIPPET_RE)) {
    checked++;
    const [, srcRel, startStr, endStr, blockBody] = m;
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    const srcAbs = resolve(REPO_ROOT, srcRel);

    let srcLines;
    try {
      srcLines = readFileSync(srcAbs, "utf8").split("\n");
    } catch (e) {
      console.error(
        `[check-doc-snippets] ${relative(REPO_ROOT, mdPath)}: 源文件不存在 ${srcRel}`,
      );
      failed++;
      continue;
    }

    if (start < 1 || end > srcLines.length || start > end) {
      console.error(
        `[check-doc-snippets] ${relative(REPO_ROOT, mdPath)}: 行号越界 ${srcRel}:${start}-${end}（源文件共 ${srcLines.length} 行）`,
      );
      failed++;
      continue;
    }

    const expected = srcLines.slice(start - 1, end).join("\n");
    if (expected !== blockBody) {
      failed++;
      console.error(
        `\n[check-doc-snippets] FAIL: ${relative(REPO_ROOT, mdPath)} ↔ ${srcRel}:${start}-${end}`,
      );
      const exLines = expected.split("\n");
      const blLines = blockBody.split("\n");
      const max = Math.max(exLines.length, blLines.length);
      for (let i = 0; i < max; i++) {
        const a = blLines[i] ?? "<EOF>";
        const b = exLines[i] ?? "<EOF>";
        if (a !== b) {
          console.error(`  L${start + i}`);
          console.error(`    doc:    ${JSON.stringify(a)}`);
          console.error(`    source: ${JSON.stringify(b)}`);
        }
      }
    }
  }
}

if (failed > 0) {
  console.error(
    `\n[check-doc-snippets] ${failed} snippet 不一致 / ${checked} 检查；请同步文档代码块或更新行号。`,
  );
  process.exit(1);
}
console.log(`[check-doc-snippets] OK · ${checked} snippet 全部一致`);
