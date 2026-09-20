import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditE2ERequirements, main } from "./audit-e2e-requirements.mjs";

test("passed, failed, cancelled, setup-failure and missing are accounted fail-closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-audit-"));
  try {
    writeFileSync(
      join(dir, "smoke.json"),
      JSON.stringify({ outcome: "success", stats: { expected: 9, unexpected: 0 } }),
    );
    writeFileSync(join(dir, "default-one.json"), JSON.stringify({ outcome: "failure" }));
    writeFileSync(join(dir, "mask-native.json"), JSON.stringify({ outcome: "cancelled" }));
    writeFileSync(join(dir, "visual.json"), JSON.stringify({ outcome: "setup-failure" }));
    const audit = auditE2ERequirements({
      requiredSuites: [
        { suite: "smoke", planned: true },
        { suite: "default-one", planned: true },
        { suite: "mask-native", planned: true },
        { suite: "visual", planned: true },
        { suite: "layout-stress", planned: true },
      ],
      statusDir: dir,
    });
    assert.equal(audit.ok, false);
    const bySuite = Object.fromEntries(audit.rows.map((row) => [row.suite, row.state]));
    assert.equal(bySuite.smoke, "passed");
    assert.equal(bySuite["default-one"], "failed");
    assert.equal(bySuite["mask-native"], "cancelled");
    assert.equal(bySuite.visual, "setup-failure");
    assert.equal(bySuite["layout-stress"], "missing");
    assert.deepEqual(audit.blockers.map((row) => row.suite).sort(), [
      "default-one",
      "layout-stress",
      "mask-native",
      "visual",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs-allowed skips never block while unplanned skips do", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-audit-"));
  try {
    writeFileSync(join(dir, "smoke.json"), JSON.stringify({ outcome: "success" }));
    writeFileSync(join(dir, "mask-native.json"), JSON.stringify({ outcome: "skipped" }));
    const withReason = auditE2ERequirements({
      requiredSuites: [
        { suite: "smoke", planned: true },
        { suite: "mask-native", planned: false, docsAllowedSkip: true },
      ],
      statusDir: dir,
    });
    assert.equal(withReason.ok, true);
    assert.deepEqual(withReason.rows.map((row) => row.state).sort(), [
      "docs-allowed-skip",
      "passed",
    ]);
    const withoutReason = auditE2ERequirements({
      requiredSuites: [
        { suite: "smoke", planned: true },
        { suite: "mask-native", planned: true },
      ],
      statusDir: dir,
    });
    assert.equal(withoutReason.ok, false);
    assert.deepEqual(withoutReason.blockers.map((row) => row.suite).sort(), ["mask-native"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("empty required lists need a docs-only classification; repeated audits stay idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-audit-"));
  try {
    const invalid = auditE2ERequirements({ requiredSuites: [], statusDir: dir });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.blockers[0].state, "invalid-manifest");

    const manifest = {
      classification: "docs-only",
      reason: "docs-only change (whitelisted markdown/docs-site paths); no app E2E required",
      suites: [],
    };
    const first = auditE2ERequirements({ requiredSuites: manifest, statusDir: dir });
    const again = auditE2ERequirements({ requiredSuites: manifest, statusDir: dir });
    assert.equal(first.ok, true);
    assert.equal(again.ok, true);
    assert.deepEqual(first.rows, again.rows);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs-allowed skip flags cannot bypass a planned:true required suite", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-audit-bypass-"));
  try {
    const bypass = auditE2ERequirements({
      requiredSuites: {
        classification: "app-code",
        reason: "legacy frozen gate membership",
        suites: [{ suite: "smoke", planned: true, docsAllowedSkip: true }],
      },
      statusDir: dir,
    });
    assert.equal(bypass.ok, false);
    assert.ok(bypass.blockers.some((row) => row.state === "invalid-manifest"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI fails closed on unreadable artifacts and missing inputs", () => {
  const stderr = [];
  assert.equal(main([], { stderr: { write: (c) => stderr.push(c) } }), 2);
  assert.equal(
    main(["req.json", "missing-dir"], { stderr: { write: () => {} }, existsSync: () => false }),
    2,
  );
});
