#!/usr/bin/env node
/**
 * 颜色 token 一致性检查 — 防"暗色模式失效"类 BUG (B-32 / B-36 / B-38 / B-39).
 *
 * 根因: AI 写新 CSS 时凭"经验"造同义但不存在的变量名
 *   var(--color-text, #1f2937)  ← --color-text 在 tokens.css 里没定义
 * 浏览器找不到变量 → 退回 fallback "#1f2937" (浅色硬编码) → 暗色模式下不可读.
 *
 * 本脚本两类检查:
 *   1. (hard fail) `var(--color-XXX...)` 引用了 tokens.css 中未定义的变量名
 *   2. (hard fail) `var(--color-XXX, <fallback>)` 给 token 配 fallback —
 *      允许 fallback 的口子等于允许"造名"绕过检查 #1, 因此禁止.
 *      例外: fallback 本身是另一个已定义的 token (eg `var(--color-foo, var(--color-bar))`).
 *
 * 唯一可信来源: apps/web/src/styles/tokens.css.
 * 需要新颜色就在 tokens.css 同时加 light + dark 两套定义, 不要在组件里就地造名.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TOKENS_PATH = join(ROOT, "src/styles/tokens.css");
const SCAN_DIR = join(ROOT, "src");

function loadDefinedTokens() {
  const text = readFileSync(TOKENS_PATH, "utf8");
  const set = new Set();
  // 仅匹配定义处: `  --color-foo: <value>;` (左侧, 紧跟冒号).
  const re = /(--color-[a-z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(text)) !== null) set.add(m[1]);
  return set;
}

function walkCssFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "coverage")
        continue;
      walkCssFiles(p, out);
    } else if (s.isFile() && name.endsWith(".css")) {
      out.push(p);
    }
  }
  return out;
}

// CSS 注释里若出现 var(--color-*) 字面 (例如 BatchesSection.module.css L8 "既有
// var(--color-*) 全部保留"), 不算引用. 用空格替换 (而非删除) 以保留行号定位.
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

// 匹配 `var(--color-XXX[, fallback])`, fallback 可能含嵌套括号 (e.g. var(--color-a, var(--color-b))).
// 用一个简单的"消括号"扫描器, 不靠正则一把梭.
function* scanVarColorRefs(text) {
  const needle = "var(--color-";
  let i = 0;
  while (true) {
    const at = text.indexOf(needle, i);
    if (at < 0) return;
    // 解析变量名 (停在 ',' 或 ')' 或空白).
    let p = at + 4; // 跳过 "var("
    let nameEnd = p;
    while (nameEnd < text.length) {
      const c = text[nameEnd];
      if (c === "," || c === ")" || /\s/.test(c)) break;
      nameEnd++;
    }
    const name = text.slice(p, nameEnd);
    // 找匹配的右括号.
    let depth = 1;
    let q = nameEnd;
    let commaAt = -1;
    while (q < text.length && depth > 0) {
      const c = text[q];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      } else if (c === "," && depth === 1 && commaAt < 0) {
        commaAt = q;
      }
      q++;
    }
    const fallback = commaAt >= 0 ? text.slice(commaAt + 1, q).trim() : null;
    // 行号定位 (基于 at).
    const line = text.slice(0, at).split("\n").length;
    yield { name, fallback, line, raw: text.slice(at, q + 1) };
    i = q + 1;
  }
}

function isFallbackAnotherToken(fallback, defined) {
  if (!fallback) return false;
  const trim = fallback.trim();
  const m = trim.match(/^var\((--color-[a-z0-9-]+)\b/);
  if (!m) return false;
  return defined.has(m[1]);
}

function main() {
  const defined = loadDefinedTokens();
  const files = walkCssFiles(SCAN_DIR);
  const errors = [];

  for (const f of files) {
    // tokens.css 自身定义颜色, 跳过.
    if (f === TOKENS_PATH) continue;
    const text = stripCssComments(readFileSync(f, "utf8"));
    for (const ref of scanVarColorRefs(text)) {
      const rel = relative(ROOT, f);
      // 检查 #1: 未定义的 token 名.
      if (!defined.has(ref.name)) {
        errors.push({
          file: rel,
          line: ref.line,
          kind: "undefined-token",
          msg: `${ref.name} 未在 tokens.css 中定义 — 不要在组件里就地造名, 缺啥就去 tokens.css 同时加 light + dark 两套定义.`,
          snippet: ref.raw,
        });
        continue;
      }
      // 检查 #2: 给已定义 token 配 fallback (例外: fallback 是另一个已定义 token).
      if (ref.fallback && !isFallbackAnotherToken(ref.fallback, defined)) {
        errors.push({
          file: rel,
          line: ref.line,
          kind: "fallback-on-defined-token",
          msg: `${ref.name} 已定义却带 fallback "${ref.fallback}" — fallback 会让 token 改名 / 删除时静默退回浅色硬编码, 触发暗色模式 BUG. 直接 var(${ref.name}) 即可.`,
          snippet: ref.raw,
        });
      }
    }
  }

  if (errors.length === 0) {
    console.log("✓ check-css-tokens: 所有 --color-* 引用都对得上 tokens.css 定义, 且未滥用 fallback.");
    process.exit(0);
  }

  // 分组打印.
  const byKind = {};
  for (const e of errors) (byKind[e.kind] ??= []).push(e);

  console.error(`✗ check-css-tokens: ${errors.length} 个违规\n`);
  if (byKind["undefined-token"]) {
    console.error(`▶ undefined-token (${byKind["undefined-token"].length}): 引用 tokens.css 未定义的变量, 浏览器会退回 fallback (通常浅色硬编码) → 暗色模式失效.`);
    for (const e of byKind["undefined-token"]) {
      console.error(`  ${e.file}:${e.line}  ${e.msg}`);
      console.error(`    ${e.snippet}`);
    }
    console.error();
  }
  if (byKind["fallback-on-defined-token"]) {
    console.error(`▶ fallback-on-defined-token (${byKind["fallback-on-defined-token"].length}): 给已定义 token 配 fallback.`);
    for (const e of byKind["fallback-on-defined-token"]) {
      console.error(`  ${e.file}:${e.line}  ${e.msg}`);
      console.error(`    ${e.snippet}`);
    }
    console.error();
  }

  console.error(
    `修复指引: 颜色唯一可信来源是 apps/web/src/styles/tokens.css. ` +
      `参考 CLAUDE.md "颜色 token 规则".`,
  );
  process.exit(1);
}

main();
