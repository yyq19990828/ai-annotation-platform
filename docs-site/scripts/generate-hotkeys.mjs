#!/usr/bin/env node
// 从 apps/web/src/pages/Workbench/state/hotkeys.ts 中的 HOTKEYS 数组 + GROUP_LABEL
// 生成 docs-site/user-guide/workbench/hotkeys.generated.md。
// 在 docs:dev / docs:build 之前自动执行。
//
// 使用项目已有 TypeScript parser 读取字面量，校验上下文与目标元数据；不执行源码。
// 解析失败会报错退出，让漂移问题暴露在 CI 而不是文档站静默错乱。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { emitGenerated } from "./_emit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../apps/web/src/pages/Workbench/state/hotkeys.ts");
const dst = resolve(here, "../user-guide/workbench/hotkeys.generated.md");

const text = readFileSync(src, "utf8");

// 2. Read complete records, including context/target fields, so formatting cannot drop entries.
const ts = createRequire(src)("typescript");
const sourceFile = ts.createSourceFile(src, text, ts.ScriptTarget.Latest, true);
const declaration = sourceFile.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((node) => node.name.getText(sourceFile) === "HOTKEYS");
if (!declaration?.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) {
  throw new Error("HOTKEYS must be an array literal");
}
const contexts = new Set([
  "image",
  "video",
  "image-prediction",
  "video-prediction",
  "video-no-prediction",
]);
const items = declaration.initializer.elements.map((node) => {
  if (!ts.isObjectLiteralExpression(node)) throw new Error("Hotkey must be an object literal");
  const item = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) throw new Error("Hotkey properties must be literals");
    const key = property.name.getText(sourceFile);
    const value = property.initializer;
    if (ts.isStringLiteral(value)) item[key] = value.text;
    else if (
      key === "keys" &&
      ts.isArrayLiteralExpression(value) &&
      value.elements.every(ts.isStringLiteral)
    ) {
      item.keys = value.elements.map((element) => element.text);
    } else throw new Error(`Unsupported hotkey property: ${key}`);
  }
  if (!item.keys?.length || !item.desc || !item.group)
    throw new Error("Incomplete hotkey definition");
  if (item.context && !contexts.has(item.context))
    throw new Error(`Unknown hotkey context: ${item.context}`);
  if (item.targetTool && !["setTool", "setVideoTool"].includes(item.actionType))
    throw new Error("Tool target requires a tool action");
  return item;
});
if (items.length === 0) throw new Error("HOTKEYS is empty");

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
const groupOrder = ["draw", "view", "video", "ai", "nav", "threed", "system"];
const byGroup = new Map();
for (const it of items) {
  if (!byGroup.has(it.group)) byGroup.set(it.group, []);
  byGroup.get(it.group).push(it);
}

const lines = [];
lines.push("<!-- AUTO-GENERATED — 由 docs-site/scripts/generate-hotkeys.mjs 从 -->");
lines.push("<!-- apps/web/src/pages/Workbench/state/hotkeys.ts 生成。请勿手改。 -->");
lines.push("");
lines.push(
  "同一按键按当前工作台与选择上下文路由。输入框、菜单、停靠标签、类别弹层及活跃工具自有按键优先；A / D 仅处理普通待决候选，成功后才自动前进，视频限定当前帧。交互式 SAM 使用 Enter / Esc / Tab，追踪作业使用其审阅操作。",
);
lines.push("");

const formatKey = (k) => (k.includes("+") || k.includes(" ") ? `\`${k}\`` : `\`${k}\``);
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

emitGenerated({
  dst,
  content: lines.join("\n"),
  label: "generate-hotkeys",
  detail: `${items.length} hotkeys`,
});
