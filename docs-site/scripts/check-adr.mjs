#!/usr/bin/env node
// 校验 docs/adr/ 下 ADR 文件：
//   1. 编号唯一（00NN-*.md）
//   2. 编号连续（无空号）
//   3. 文件首部包含 Status 字段
// 失败退出 1。

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ADR_DIR = resolve(here, "../../docs/adr");

const SKIP = new Set(["README.md", "TEMPLATE.md"]);
const NUM_RE = /^(\d{4})-[a-z0-9-]+\.md$/i;

const files = readdirSync(ADR_DIR).filter((f) => f.endsWith(".md") && !SKIP.has(f));
const errors = [];
const numbers = new Map();

for (const f of files) {
  const m = f.match(NUM_RE);
  if (!m) {
    errors.push(`Bad ADR filename: ${f}（应为 NNNN-kebab-case.md）`);
    continue;
  }
  const n = parseInt(m[1], 10);
  if (numbers.has(n)) {
    errors.push(`Duplicate ADR number ${m[1]}: ${numbers.get(n)} vs ${f}`);
  }
  numbers.set(n, f);

  const content = readFileSync(join(ADR_DIR, f), "utf8");
  // 接受 `- **Status:** ...` / `Status: ...` / `## Status` 等多种写法
  const statusOk =
    /^\s*[-*]?\s*\**\s*Status\s*\**\s*[:：]/im.test(content) ||
    /^##?\s*Status\b/im.test(content);
  if (!statusOk) {
    errors.push(`Missing Status field: ${f}`);
  }
}

const sorted = [...numbers.keys()].sort((a, b) => a - b);
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i] !== sorted[i - 1] + 1) {
    errors.push(`ADR numbering gap: ${sorted[i - 1]} → ${sorted[i]}`);
  }
}

if (errors.length) {
  console.error("ADR check failed:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

console.log(`ADR check OK (${numbers.size} files, ${sorted[0]} → ${sorted.at(-1)})`);
