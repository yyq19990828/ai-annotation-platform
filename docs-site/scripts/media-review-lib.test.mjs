import assert from "node:assert/strict";
import test from "node:test";
import { classifyMedia, collectPublishedMedia, mediaAuditFailed } from "./media-review-lib.mjs";

test("missing media is broken", () => {
  assert.equal(
    classifyMedia({
      exists: false,
      currentHash: null,
      review: null,
      changedPaths: [],
      ageDays: 0,
      maxAgeDays: 30,
    }).status,
    "broken",
  );
});

test("unreviewed media is review due", () => {
  assert.equal(
    classifyMedia({
      exists: true,
      currentHash: "abc",
      review: null,
      changedPaths: [],
      ageDays: 0,
      maxAgeDays: 30,
    }).status,
    "review_due",
  );
});

test("hash or watched source change makes a review stale", () => {
  assert.equal(
    classifyMedia({
      exists: true,
      currentHash: "new",
      review: { sha256: "old" },
      changedPaths: ["apps/web/src/example.tsx"],
      ageDays: 1,
      maxAgeDays: 30,
    }).status,
    "stale",
  );
});

test("unchanged recent review is current", () => {
  assert.equal(
    classifyMedia({
      exists: true,
      currentHash: "same",
      review: { sha256: "same" },
      changedPaths: [],
      ageDays: 3,
      maxAgeDays: 30,
    }).status,
    "current",
  );
});

test("homepage static image imports remain in the published media inventory", () => {
  const records = collectPublishedMedia();
  for (const name of ["video-track", "pointcloud", "review", "data-manager"]) {
    const entry = records.get(`docs-site/.vitepress/theme/assets/home/hero/${name}.webp`);
    assert.ok(entry, `${name} Hero import is missing`);
    assert.ok(entry.kinds.has("image"));
    assert.ok(entry.sources.has("docs-site/.vitepress/theme/components/home/DataAtlasHero.vue"));
  }
});

test("PR integrity allows stale and overdue reviews but blocks missing files and source hash mismatch", () => {
  const report = {
    counts: { broken: 0, stale: 1, review_due: 1, current: 0 },
    assets: [{ provenance_issues: [] }],
  };
  assert.equal(mediaAuditFailed(report, { integrity: true }), false);
  assert.equal(mediaAuditFailed(report, { strict: true }), true);
  assert.equal(mediaAuditFailed(report, { release: true }), true);
  report.counts.broken = 1;
  assert.equal(mediaAuditFailed(report, { integrity: true }), true);
  assert.equal(mediaAuditFailed(report), false);
  report.counts.broken = 0;
  report.assets[0].provenance_issues = ["文件哈希与生成来源清单不一致"];
  assert.equal(mediaAuditFailed(report, { integrity: true }), true);
  assert.equal(mediaAuditFailed(report), false);
});

test("release retains overdue-review and provenance requirements even when integrity is selected", () => {
  const report = {
    counts: { broken: 0, stale: 0, review_due: 1, current: 0 },
    assets: [{ provenance_issues: [] }],
  };
  assert.equal(mediaAuditFailed(report, { strict: true }), false);
  assert.equal(mediaAuditFailed(report, { integrity: true, release: true }), true);
  report.counts.review_due = 0;
  report.assets[0].provenance_issues = ["没有生成来源清单"];
  assert.equal(mediaAuditFailed(report, { integrity: true }), false);
  assert.equal(mediaAuditFailed(report, { strict: true }), false);
  assert.equal(mediaAuditFailed(report, { release: true }), true);
  report.assets[0].provenance_issues = [];
  assert.equal(mediaAuditFailed(report, { release: true }), false);
});
