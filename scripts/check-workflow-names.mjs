#!/usr/bin/env node

// Advisory check: keep GitHub Actions workflow naming consistent.
//
// Project convention (see CLAUDE.md "CI workflow naming"):
// - File names: `<domain>-<action>.yml` in kebab-case; the cross-domain aggregate
//   stays `ci.yml`.
// - Top-level `name:`: sentence case (`<Domain> <action>`). The first word is
//   capitalized; every other word is lowercase unless it is a short all-caps
//   acronym or a proper noun in the allow-list below.
//
// This is ADVISORY: it prints findings and exits 0 (never blocks), unless
// --strict is passed. It mirrors scripts/check-doc-version-prefix.mjs for
// arg/output conventions.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const workflowsDir = join(repoRoot, ".github", "workflows");

// Proper nouns / product names whose casing must be preserved. Extend freely;
// adding a word here makes it legal anywhere in a workflow name.
const PROPER_NOUNS = new Set(["Claude", "Code", "Playwright", "VitePress", "MinIO"]);

// Short all-caps token (2-5 chars, digits allowed) counts as an acronym: CI, PR,
// SDK, E2E, API, ML, TSC, ... recognized without listing each one.
const isAcronym = (word) => /^[A-Z][A-Z0-9]{1,4}$/.test(word);

const RE_FILE = /^[a-z0-9]+(-[a-z0-9]+)*\.yml$/;
// Top-level `name:` is the first unindented `name:` key; indented ones are
// job/step names and are out of scope here.
const RE_TOP_NAME = /^name:[ \t]+(\S.*)$/m;

function checkWord(word, index) {
  if (isAcronym(word) || PROPER_NOUNS.has(word)) return null;
  const lower = word.toLowerCase();
  const capitalized = word[0] === word[0].toUpperCase() && word.slice(1) === lower.slice(1);
  if (capitalized) {
    return index === 0
      ? null
      : `"${word}" should be lowercase in sentence case (only add it to ` +
          `PROPER_NOUNS if it is a proper noun)`;
  }
  if (word === lower) {
    return index === 0 ? `first word "${word}" must start uppercase` : null;
  }
  return `"${word}" has mixed casing`;
}

function scanFile(file, findings) {
  const path = `.github/workflows/${file}`;
  const text = readFileSync(join(workflowsDir, file), "utf8");
  if (!RE_FILE.test(file)) {
    findings.push({
      path,
      line: 1,
      msg: "file name should be kebab-case `<domain>-<action>.yml`",
    });
  }
  const match = text.match(RE_TOP_NAME);
  if (!match) {
    findings.push({ path, line: 1, msg: "missing top-level `name:`" });
    return;
  }
  const line = text.slice(0, match.index).split("\n").length;
  // Only plain word tokens are checked; tokens carrying punctuation are skipped.
  const words = match[1].split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z0-9-]*$/.test(w));
  words.forEach((word, i) => {
    const msg = checkWord(word, i);
    if (msg) findings.push({ path, line, msg });
  });
}

const strict = process.argv.includes("--strict");
const findings = [];
for (const file of readdirSync(workflowsDir)
  .filter((f) => f.endsWith(".yml"))
  .sort()) {
  scanFile(file, findings);
}

const HINT = "workflow 顶层 name 用 sentence case, 文件名用 kebab-case `<域>-<动作>.yml`";

for (const f of findings) {
  process.stdout.write(`::warning file=${f.path},line=${f.line}::workflow naming: ${f.msg}\n`);
}

if (findings.length === 0) {
  process.stdout.write("Workflow 命名检查: 全部合规。\n");
} else {
  process.stdout.write(`Workflow 命名检查: 发现 ${findings.length} 处建议修正 (${HINT}):\n`);
  for (const f of findings) process.stdout.write(`  ${f.path}:${f.line}  ${f.msg}\n`);
}

process.exit(strict && findings.length > 0 ? 1 : 0);
