#!/usr/bin/env node

// Advisory check: flag changelog-style version-prefixed entries added to narrative docs.
//
// Project convention: docs should read as the *current* state of the system. When a doc is
// updated after a code change, the change should be woven into the prose — NOT appended as a
// version-prefixed changelog entry (e.g. `v1.2.3: ...`, `## v1.2.3`, `- v1.2.3 — ...`).
// Version provenance, if needed, belongs in an HTML comment (`<!-- since v1.2.3 -->`), which
// this check does not flag (it only inspects line-leading version tokens).
//
// This is ADVISORY: it prints findings and exits 0 (never blocks), unless --strict is passed.
// It mirrors scripts/check-doc-impact.mjs for arg/git conventions.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// Docs where a version prefix is an anti-pattern.
const SCAN = [/^docs-site\/.*\.md$/, /^README\.md$/, /^DEV\.md$/];
// Places where version-prefixed content is legitimate (changelog / ADRs / generated / build output).
const EXEMPT = [
  /^CHANGELOG\.md$/,
  /^docs\/adr\//,
  /^docs-site\/dev\/adr\//,
  /\.generated\.md$/,
  /^docs-site\/\.vitepress\/dist\//,
];

// A SemVer-ish version used as a changelog-style prefix.
const RE_HEADING = /^#{1,6}\s+v?\d+\.\d+(?:\.\d+)?\b/i; // "## v1.2.3", "### 0.8 ..."
const RE_PREFIX = /^\s*(?:[-*+]\s+)?v?\d+\.\d+\.\d+\s*[:：\-–—]/i; // "v1.2.3: ...", "- v1.2.3 — ..."
const RE_FENCE = /^\s*(?:```|~~~)/;

function parseArgs(argv) {
  const out = { base: "", head: "", staged: false, files: [], format: "text", writeMarkdown: "", strict: false };
  for (const arg of argv) {
    if (arg.startsWith("--base=")) out.base = arg.slice("--base=".length);
    else if (arg.startsWith("--head=")) out.head = arg.slice("--head=".length);
    else if (arg === "--staged") out.staged = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg.startsWith("--files=")) {
      out.files = arg.slice("--files=".length).split(",").map((x) => x.trim()).filter(Boolean);
    } else if (arg.startsWith("--format=")) out.format = arg.slice("--format=".length);
    else if (arg.startsWith("--write-markdown=")) out.writeMarkdown = arg.slice("--write-markdown=".length);
  }
  return out;
}

function runGit(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function isDoc(file) {
  return SCAN.some((r) => r.test(file)) && !EXEMPT.some((r) => r.test(file));
}

function changedDocFiles(opts) {
  if (opts.files.length > 0) return opts.files.filter(isDoc);
  let range;
  if (opts.base && opts.head) range = ["diff", "--name-only", `${opts.base}...${opts.head}`];
  else if (opts.staged) range = ["diff", "--name-only", "--cached"];
  else range = ["diff", "--name-only", "HEAD"];
  return runGit(range).split("\n").map((x) => x.trim()).filter(Boolean).filter(isDoc);
}

// Return added lines with their new-file line numbers for one file.
function addedLines(file, opts) {
  if (opts.files.length > 0) {
    // Ad-hoc mode: scan the whole working-tree file.
    let text;
    try {
      text = readFileSync(resolve(repoRoot, file), "utf8");
    } catch {
      return [];
    }
    return text.split("\n").map((content, i) => ({ line: i + 1, content }));
  }
  let diffArgs;
  if (opts.base && opts.head) diffArgs = ["diff", "-U0", `${opts.base}...${opts.head}`, "--", file];
  else if (opts.staged) diffArgs = ["diff", "-U0", "--cached", "--", file];
  else diffArgs = ["diff", "-U0", "HEAD", "--", file];

  const out = runGit(diffArgs).split("\n");
  const added = [];
  let newLine = 0;
  for (const raw of out) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+++")) continue;
    if (raw.startsWith("+")) {
      added.push({ line: newLine, content: raw.slice(1) });
      newLine++;
    }
    // deletions / metadata lines do not advance the new-file counter
  }
  return added;
}

function scanFile(file, opts) {
  const findings = [];
  let inFence = false;
  for (const { line, content } of addedLines(file, opts)) {
    if (RE_FENCE.test(content)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (RE_HEADING.test(content) || RE_PREFIX.test(content)) {
      findings.push({ path: file, line, snippet: content.trim().slice(0, 120) });
    }
  }
  return findings;
}

const args = parseArgs(process.argv.slice(2));
const findings = changedDocFiles(args).flatMap((f) => scanFile(f, args));

const HINT =
  "把改动融入正文,或将版本信息放进 HTML 注释 (<!-- since vX.Y.Z -->),不要用 changelog 式版本前缀";

function toMarkdown() {
  const lines = ["<!-- doc-version-prefix-check -->", "## Doc Version-Prefix Style Check", ""];
  if (findings.length === 0) {
    lines.push("- No version-prefixed changelog entries found in changed docs.");
    return lines.join("\n");
  }
  lines.push(`- Findings: ${findings.length} — ${HINT}`, "", "### Findings");
  for (const f of findings) lines.push(`- \`${f.path}:${f.line}\` — \`${f.snippet}\``);
  return lines.join("\n");
}

if (args.writeMarkdown) {
  const abs = resolve(repoRoot, args.writeMarkdown);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, toMarkdown() + "\n");
}

if (args.format === "github") {
  for (const f of findings) {
    process.stdout.write(`::warning file=${f.path},line=${f.line}::doc version-prefix: ${HINT}\n`);
  }
}

if (findings.length === 0) {
  process.stdout.write("文档版本前缀检查: 未发现 changelog 式版本前缀。\n");
} else {
  process.stdout.write(`文档版本前缀检查: 发现 ${findings.length} 处建议改写 (${HINT}):\n`);
  for (const f of findings) process.stdout.write(`  ${f.path}:${f.line}  ${f.snippet}\n`);
}

process.exit(args.strict && findings.length > 0 ? 1 : 0);
