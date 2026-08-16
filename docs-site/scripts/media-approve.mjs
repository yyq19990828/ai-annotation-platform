#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  REVIEW_PATH,
  REPO_ROOT,
  collectPublishedMedia,
  currentCommit,
  defaultWatchPaths,
  readProvenance,
  readReviewRegistry,
  sha256File,
} from "./media-review-lib.mjs";

function optionValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1])
      values.push(process.argv[index + 1]);
  }
  return values;
}

const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();
if (dirty) {
  throw new Error("[media-approve] 工作树必须干净，避免把复核结果绑定到不完整的仓库提交");
}

const published = collectPublishedMedia();
const provenance = readProvenance();
const registry = readReviewRegistry();
const requested = optionValues("--asset");
const approveAll = process.argv.includes("--all");
if (!approveAll && requested.length === 0) {
  throw new Error("[media-approve] 请提供 --asset <仓库相对路径>，或在全部人工复核后使用 --all");
}
const selected = approveAll ? [...published.keys()] : requested;
const unknown = selected.filter((key) => !published.has(key));
if (unknown.length > 0) throw new Error(`[media-approve] 资产未被文档引用：${unknown.join(", ")}`);

const commit = currentCommit();
const verifiedAt = new Date().toISOString();
let reviewer = process.env.GITHUB_ACTOR;
if (!reviewer) {
  try {
    reviewer = execFileSync("git", ["config", "user.name"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    reviewer = "unknown";
  }
}

for (const key of selected.sort()) {
  const record = published.get(key);
  if (!fs.existsSync(record.absolute)) throw new Error(`[media-approve] 文件不存在：${key}`);
  const source = provenance.entries.get(key) ?? null;
  registry.entries[key] = {
    last_verified_commit: commit,
    verified_at: verifiedAt,
    reviewer: reviewer || "unknown",
    review_profile: registry.review_profile,
    sha256: sha256File(record.absolute),
    watch_paths: defaultWatchPaths(key, record, source),
  };
  console.log(`[media-approve] ✓ ${key} → ${commit.slice(0, 12)}`);
}

registry.entries = Object.fromEntries(
  Object.entries(registry.entries).sort(([left], [right]) => left.localeCompare(right)),
);
const tempPath = `${REVIEW_PATH}.${process.pid}.tmp`;
fs.writeFileSync(tempPath, `${JSON.stringify(registry, null, 2)}\n`);
fs.renameSync(tempPath, REVIEW_PATH);
console.log(`[media-approve] 已更新 ${path.relative(REPO_ROOT, REVIEW_PATH)}`);
