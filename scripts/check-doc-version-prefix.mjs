#!/usr/bin/env node

// Advisory check: flag any user-readable version number (e.g. `v0.14.14`) in narrative docs.
//
// Project convention: docs should read as the *current* state of the system, with NO visible
// version numbers. When a doc is updated after a code change, weave the change into the prose;
// do not leave version annotations a reader can see — neither line-leading changelog prefixes
// (`v1.2.3: ...`, `## v1.2.3`) nor inline provenance (`... 端点（v0.14.11）`).
// Version provenance, if it must be recorded, belongs in an HTML comment (`<!-- since v1.2.3 -->`),
// which renders invisibly and is therefore NOT flagged.
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

// Any user-readable version token like `v0.14.14` / `v1.2`. The leading `v` plus a dot is what
// marks a version annotation; this deliberately does NOT match `/v1/` routes, a bare `v2`, a
// section number (`4.1`), or "Node v18+" (no dot). Matched anywhere a reader can see it.
const RE_VERSION = /(?<![A-Za-z0-9])v\d+\.\d+(?:\.\d+)*/i;

// Remove HTML-comment spans from a line, carrying multi-line comment state across lines, so a
// version that lives only inside `<!-- ... -->` (the sanctioned place) is not flagged.
function stripComments(line, inComment) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (inComment) {
      const end = line.indexOf("-->", i);
      if (end === -1) break;
      i = end + 3;
      inComment = false;
    } else {
      const start = line.indexOf("<!--", i);
      if (start === -1) {
        out += line.slice(i);
        break;
      }
      out += line.slice(i, start);
      i = start + 4;
      inComment = true;
    }
  }
  return { visible: out, inComment };
}

function parseArgs(argv) {
  const out = {
    base: "",
    head: "",
    staged: false,
    files: [],
    format: "text",
    writeMarkdown: "",
    strict: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--base=")) out.base = arg.slice("--base=".length);
    else if (arg.startsWith("--head=")) out.head = arg.slice("--head=".length);
    else if (arg === "--staged") out.staged = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg.startsWith("--files=")) {
      out.files = arg
        .slice("--files=".length)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--format=")) out.format = arg.slice("--format=".length);
    else if (arg.startsWith("--write-markdown="))
      out.writeMarkdown = arg.slice("--write-markdown=".length);
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
  return runGit(range)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter(isDoc);
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

// YAML frontmatter (the leading `---` ... `---` block) is metadata VitePress consumes; it is
// NOT rendered to readers, so a `since: v0.1.0` field there is invisible and must not be flagged.
// Returns the 1-based line number of the closing `---`, or 0 if there is no frontmatter.
function frontmatterEnd(file) {
  let text;
  try {
    text = readFileSync(resolve(repoRoot, file), "utf8");
  } catch {
    return 0;
  }
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return 0;
}

function scanFile(file, opts) {
  const findings = [];
  const fmEnd = frontmatterEnd(file);
  let inComment = false;
  for (const { line, content } of addedLines(file, opts)) {
    const stripped = stripComments(content, inComment);
    inComment = stripped.inComment;
    if (line <= fmEnd) continue; // skip invisible frontmatter
    if (RE_VERSION.test(stripped.visible)) {
      findings.push({ path: file, line, snippet: content.trim().slice(0, 120) });
    }
  }
  return findings;
}

const args = parseArgs(process.argv.slice(2));
const findings = changedDocFiles(args).flatMap((f) => scanFile(f, args));

const HINT =
  "文档不应出现用户可见的版本号(如 v0.14.14);删除它, 或把版本信息移入 HTML 注释 (<!-- since vX.Y.Z -->)";

function toMarkdown() {
  const lines = ["<!-- doc-version-prefix-check -->", "## Doc Version-Prefix Style Check", ""];
  if (findings.length === 0) {
    lines.push("- No user-readable version numbers found in changed docs.");
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
    process.stdout.write(`::warning file=${f.path},line=${f.line}::doc version: ${HINT}\n`);
  }
}

if (findings.length === 0) {
  process.stdout.write("文档版本号检查: 未发现用户可见的版本号。\n");
} else {
  process.stdout.write(`文档版本号检查: 发现 ${findings.length} 处建议改写 (${HINT}):\n`);
  for (const f of findings) process.stdout.write(`  ${f.path}:${f.line}  ${f.snippet}\n`);
}

process.exit(args.strict && findings.length > 0 ? 1 : 0);
