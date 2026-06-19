#!/usr/bin/env node
/**
 * Tailwind className 颜色规范检查 (warning 模式) — Tailwind 时代的暗色护栏.
 *
 * 配套 check-css-tokens.mjs (护 CSS Modules 时代). 随 v0.17.x 全量迁移到 shadcn/Tailwind,
 * 颜色逐步从 *.module.css 移到 *.tsx 的 className. 本脚本扫 className, 对齐设计规范 §2.4 禁则:
 *   1. 裸色: className 里出现 #hex / rgb() / rgba() / hsl() / oklch() / oklab() / color()
 *   2. 任意色值: bg-[#...] / text-[rgb(...)] / border-[hsl(...)] 等 Tailwind arbitrary color value
 *   3. (建议级) 暗色配对: 语义色 text/bg/border-<hue>-600 应伴随 dark:...-<hue>-400 (设计规范 §2.2)
 *
 * 中性色/表面/边框走 shadcn 的 --sc-* token (bg-background / text-foreground / border-border ...),
 * 语义彩色走固定调色板 (sky/emerald/violet/amber/rose) + 柔底 /10 + 暗色提亮. 不在 className 里写裸色.
 *
 * v0.17.7 全量迁移完成,转入 **blocking 模式**: 有发现时 exit 1,阻断 CI。
 *
 * 唯一可信来源: docs/plans/2026-06-19-v0.17.0-ui-design-system.md (晋升后 design-system.md).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCAN_DIR = join(ROOT, "src");
const CI = !!process.env.GITHUB_ACTIONS;

// 设计规范 §2.2 的固定语义色相 + 常见基础色相 (限定范围, 降噪).
const SEMANTIC_HUES = [
  "sky", "emerald", "violet", "amber", "rose",
  "red", "green", "blue", "yellow", "orange", "purple", "indigo", "teal", "cyan",
];

function walkTsxFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "coverage")
        continue;
      walkTsxFiles(p, out);
    } else if (s.isFile() && name.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

// 去掉行注释 // ... 与块注释 /* ... */ (避免注释里举例的色值误报), 用空格替换保留行号.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

// 抽取所有 className=... 的值块. 支持:
//   className="..."  className='...'  className={ ...任意表达式(cn(), 模板串)... }
// 返回 [{ value, index }] (index 为值块在原文中的起始偏移, 用于定位行号).
function extractClassNameChunks(text) {
  const chunks = [];
  const re = /className\s*=\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let i = m.index + m[0].length;
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      // 引号字符串 (className="..." 或模板串字面)
      const quote = ch;
      let j = i + 1;
      while (j < text.length && text[j] !== quote) {
        if (text[j] === "\\") j++;
        j++;
      }
      chunks.push({ value: text.slice(i + 1, j), index: i + 1 });
      re.lastIndex = j + 1;
    } else if (ch === "{") {
      // 表达式块 className={ ... } — 平衡括号扫描
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      chunks.push({ value: text.slice(i + 1, j), index: i + 1 });
      re.lastIndex = j + 1;
    }
  }
  return chunks;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

// 裸色字面: #hex (3/4/6/8 位) / rgb( / rgba( / hsl( / hsla( / oklch( / oklab( / color(
const BARE_COLOR_RE =
  /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|color)\s*\(/;
// Tailwind 任意色值: <util>-[<color>]  (color = #hex / rgb()/hsl()/oklch() / var(--...))
const ARBITRARY_COLOR_RE =
  /\b(?:bg|text|border|ring|ring-offset|fill|stroke|from|via|to|outline|shadow|decoration|caret|accent|divide)-\[\s*(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|color)\s*\(|var\(--)/;

function checkChunk(value) {
  const issues = [];

  if (BARE_COLOR_RE.test(value)) {
    const hit = value.match(BARE_COLOR_RE);
    issues.push({ kind: "bare-color", detail: hit[0].trim() });
  }
  if (ARBITRARY_COLOR_RE.test(value)) {
    const hit = value.match(ARBITRARY_COLOR_RE);
    issues.push({ kind: "arbitrary-color", detail: hit[0].trim() });
  }

  // 暗色配对: 对每个 (text|bg|border)-<hue>-600 检查同 className 是否有 dark:(...)-<hue>-400.
  // v0.17.7: 修正匹配 — 容许 `!` 修饰符 + 中间变体前缀(hover:/focus: 等).
  const hueRe = new RegExp(
    `\\b(!)?(text|bg|border)-(${SEMANTIC_HUES.join("|")})-600\\b`,
    "g",
  );
  let hm;
  while ((hm = hueRe.exec(value)) !== null) {
    const [, , prefix, hue] = hm;
    const darkRe = new RegExp(`dark:[a-z!:-]*${prefix}-${hue}-400\\b`);
    if (!darkRe.test(value)) {
      issues.push({
        kind: "dark-pair",
        detail: `${prefix}-${hue}-600 缺 dark:${prefix}-${hue}-400`,
      });
    }
  }

  return issues;
}

function main() {
  const files = walkTsxFiles(SCAN_DIR);
  const findings = [];

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const text = stripComments(raw);
    for (const { value, index } of extractClassNameChunks(text)) {
      const issues = checkChunk(value);
      for (const issue of issues) {
        findings.push({
          file: relative(ROOT, file),
          line: lineOf(text, index),
          ...issue,
        });
      }
    }
  }

  if (findings.length === 0) {
    console.log(
      "✓ check-tw-tokens: className 无裸色 / 任意色值, 语义色暗色配对完整.",
    );
    process.exit(0);
  }

  const byKind = {};
  for (const f of findings) (byKind[f.kind] ??= []).push(f);

  const KIND_LABEL = {
    "bare-color": "裸色字面 (#hex / rgb / oklch) 写进 className",
    "arbitrary-color": "Tailwind 任意色值 util-[...] (绕过 token / 调色板)",
    "dark-pair": "语义色缺暗色配对 (设计规范 §2.2)",
  };

  console.warn(
    `✗ check-tw-tokens (blocking): ${findings.length} 处违反颜色规范\n`,
  );
  for (const kind of ["bare-color", "arbitrary-color", "dark-pair"]) {
    const list = byKind[kind];
    if (!list?.length) continue;
    console.warn(`▶ ${kind} (${list.length}): ${KIND_LABEL[kind]}`);
    for (const f of list) {
      console.warn(`  ${f.file}:${f.line}  ${f.detail}`);
      if (CI) {
        const msg = `[check-tw-tokens] ${KIND_LABEL[kind]}: ${f.detail}`;
        console.log(`::warning file=apps/web/${f.file},line=${f.line}::${msg}`);
      }
    }
    console.warn("");
  }

  console.warn(
    "修复指引: 中性色走 --sc-* (bg-background/text-foreground/border-border), " +
      "语义彩色走固定调色板 + 柔底 /10 + dark:提亮. 见设计规范 §2.2/§2.4. ",
  );
  process.exit(1);
}

main();
