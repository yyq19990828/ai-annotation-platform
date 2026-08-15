#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  changedWatchPaths,
  classifyMedia,
  collectPublishedMedia,
  currentCommit,
  currentSeedRevision,
  defaultWatchPaths,
  readProvenance,
  readReviewRegistry,
  sha256File,
  tierAOpenItems,
} from "./media-review-lib.mjs";

const strict = process.argv.includes("--strict");
const release = process.argv.includes("--release");
const jsonOnly = process.argv.includes("--json");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;

const published = collectPublishedMedia();
const reviews = readReviewRegistry();
const provenance = readProvenance();
const expectedSeed = currentSeedRevision();
const now = Date.now();
const results = [];

for (const [key, record] of [...published].sort(([left], [right]) => left.localeCompare(right))) {
  const exists = fs.existsSync(record.absolute);
  const currentHash = exists ? sha256File(record.absolute) : null;
  const review = reviews.entries[key] ?? null;
  const source = provenance.entries.get(key) ?? null;
  const watchPaths = review?.watch_paths ?? defaultWatchPaths(key, record, source);
  const changedPaths = review ? changedWatchPaths(review.last_verified_commit, watchPaths) : [];
  const verifiedAt = review?.verified_at ? Date.parse(review.verified_at) : Number.NaN;
  const ageDays = Number.isFinite(verifiedAt)
    ? (now - verifiedAt) / 86_400_000
    : Number.POSITIVE_INFINITY;
  const classified = classifyMedia({
    exists,
    currentHash,
    review,
    changedPaths,
    ageDays,
    maxAgeDays: reviews.default_max_age_days,
  });
  const provenanceIssues = [];
  if (!source) {
    provenanceIssues.push("没有生成来源清单");
  } else {
    if (source.sha256 && currentHash && source.sha256 !== currentHash) {
      provenanceIssues.push("文件哈希与生成来源清单不一致");
    }
    if (source.source_worktree_dirty) provenanceIssues.push("生成时工作树非干净状态");
    if (expectedSeed && source.seed_revision && source.seed_revision !== expectedSeed) {
      provenanceIssues.push(`seed ${source.seed_revision} 不是当前 ${expectedSeed}`);
    }
  }
  results.push({
    path: key,
    kinds: [...record.kinds].sort(),
    referenced_by: [...record.sources].sort(),
    status: classified.status,
    reasons: classified.reasons,
    sha256: currentHash,
    watch_paths: watchPaths,
    changed_paths: changedPaths,
    last_verified_commit: review?.last_verified_commit ?? null,
    verified_at: review?.verified_at ?? null,
    provenance: source,
    provenance_issues: provenanceIssues,
  });
}

const counts = Object.fromEntries(
  ["broken", "stale", "review_due", "current"].map((status) => [
    status,
    results.filter((item) => item.status === status).length,
  ]),
);
const tierA = tierAOpenItems();
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  repository_commit: currentCommit(),
  expected_seed_revision: expectedSeed,
  default_max_age_days: reviews.default_max_age_days,
  counts,
  provenance_issue_count: results.filter((item) => item.provenance_issues.length > 0).length,
  open_tier_a_count: tierA.length,
  open_tier_a: tierA,
  assets: results,
};

if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

function humanSummary() {
  const lines = [
    "",
    `文档媒体审计 — ${results.length} 个已引用文件`,
    "─".repeat(72),
    `broken ${counts.broken} · stale ${counts.stale} · review-due ${counts.review_due} · current ${counts.current}`,
    `生成来源告警 ${report.provenance_issue_count} · 未完成 Tier A ${tierA.length}`,
  ];
  for (const status of ["broken", "stale", "review_due"]) {
    const items = results.filter((item) => item.status === status);
    if (items.length === 0) continue;
    lines.push("", `${status}:`);
    for (const item of items.slice(0, 20)) {
      lines.push(`  - ${item.path}: ${item.reasons.join("；")}`);
      if (item.provenance_issues.length > 0) {
        lines.push(`    来源：${item.provenance_issues.join("；")}`);
      }
    }
    if (items.length > 20) lines.push(`  … 其余 ${items.length - 20} 项见 JSON 报告`);
  }
  lines.push("");
  return lines.join("\n");
}

if (jsonOnly) console.log(JSON.stringify(report, null, 2));
else console.log(humanSummary());

if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    "## 文档媒体审计",
    "",
    "| Broken | Stale | Review due | Current | 来源告警 | Tier A 缺口 |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${counts.broken} | ${counts.stale} | ${counts.review_due} | ${counts.current} | ${report.provenance_issue_count} | ${tierA.length} |`,
    "",
    `仓库提交：\`${report.repository_commit.slice(0, 12)}\`；当前 seed：\`${expectedSeed ?? "unknown"}\`。`,
    "",
  ].join("\n");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

const provenanceHashMismatch = results.some((item) =>
  item.provenance_issues.includes("文件哈希与生成来源清单不一致"),
);
const strictFailure = counts.broken > 0 || counts.stale > 0 || provenanceHashMismatch;
const releaseFailure =
  strictFailure ||
  counts.review_due > 0 ||
  results.some((item) => item.provenance_issues.length > 0);
if ((release && releaseFailure) || (strict && strictFailure)) process.exit(1);
