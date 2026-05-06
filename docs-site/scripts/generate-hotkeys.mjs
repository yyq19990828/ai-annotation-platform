#!/usr/bin/env node
// 从 apps/web/src/pages/Workbench/state/hotkeys.ts 中的 HOTKEYS 数组 + GROUP_LABEL
// 生成 docs-site/user-guide/workbench/hotkeys.generated.md。
// 在 docs:dev / docs:build 之前自动执行。
//
// 使用 regex 解析 TS 源文件——无需 ts-node / tsc：HOTKEYS 是纯字面量数组。
// 解析失败会报错退出，让漂移问题暴露在 CI 而不是文档站静默错乱。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../apps/web/src/pages/Workbench/state/hotkeys.ts");
const dst = resolve(here, "../user-guide/workbench/hotkeys.generated.md");

const text = readFileSync(src, "utf8");

// 1. 找 HOTKEYS = [...] 字面量
const arrayMatch = text.match(/export const HOTKEYS:[^=]*=\s*(\[[\s\S]*?\n\];)/);
if (!arrayMatch) {
  console.error("[generate-hotkeys] 未找到 HOTKEYS 数组字面量，hotkeys.ts 结构是否变了？");
  process.exit(1);
}
const arrLiteral = arrayMatch[1];

// 2. 抽出每个对象 { keys: [...], desc: "...", group: "...", actionType?: "..." }
// keys 数组中的字符串可能含 `]` / `[` 字符（如 `["]"]`），不能用 `[^\]]` 截断。
// 改成：匹配 keys: [ <strings...> ]，其中 strings 是字符串字面量序列。
const STR = `"(?:[^"\\\\]|\\\\.)*"`;
const itemRe = new RegExp(
  `\\{\\s*keys:\\s*\\[((?:\\s*${STR}\\s*,?)+)\\]\\s*,` +
    `\\s*desc:\\s*(${STR})\\s*,` +
    `\\s*group:\\s*"(\\w+)"`,
  "g",
);
const items = [];
for (const m of arrLiteral.matchAll(itemRe)) {
  const keysLiteral = m[1];
  const keysArr = [];
  for (const km of keysLiteral.matchAll(new RegExp(STR, "g"))) {
    // 去掉首尾引号 + 反引号转义
    keysArr.push(km[0].slice(1, -1).replace(/\\"/g, '"'));
  }
  const desc = m[2].slice(1, -1).replace(/\\"/g, '"');
  items.push({ keys: keysArr, desc, group: m[3] });
}
if (items.length === 0) {
  console.error("[generate-hotkeys] 解析到 0 条 hotkey；regex 与 hotkeys.ts 不匹配。");
  process.exit(1);
}

// 3. 找 GROUP_LABEL
const groupRe = /export const GROUP_LABEL:[^=]*=\s*\{([^}]+)\}/;
const groupMatch = text.match(groupRe);
const groupLabel = {};
if (groupMatch) {
  for (const g of groupMatch[1].matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)) {
    groupLabel[g[1]] = g[2].replace(/\\"/g, '"');
  }
}

// 4. 按 group 排序输出
const groupOrder = ["draw", "view", "ai", "nav", "system"];
const byGroup = new Map();
for (const it of items) {
  if (!byGroup.has(it.group)) byGroup.set(it.group, []);
  byGroup.get(it.group).push(it);
}

const lines = [];
lines.push("<!-- AUTO-GENERATED — 由 docs-site/scripts/generate-hotkeys.mjs 从 -->");
lines.push("<!-- apps/web/src/pages/Workbench/state/hotkeys.ts 生成。请勿手改。 -->");
lines.push("");

const formatKey = (k) =>
  k.includes("+") || k.includes(" ") ? `\`${k}\`` : `\`${k}\``;
const formatKeys = (keys) => keys.map(formatKey).join(" + ");

for (const g of groupOrder) {
  const list = byGroup.get(g);
  if (!list) continue;
  const label = groupLabel[g] ?? g;
  lines.push(`### ${label}`);
  lines.push("");
  lines.push("| 快捷键 | 动作 |");
  lines.push("|---|---|");
  for (const it of list) {
    lines.push(`| ${formatKeys(it.keys)} | ${it.desc} |`);
  }
  lines.push("");
}

mkdirSync(dirname(dst), { recursive: true });
writeFileSync(dst, lines.join("\n"));
console.log(`[generate-hotkeys] wrote ${items.length} hotkeys → ${dst}`);
