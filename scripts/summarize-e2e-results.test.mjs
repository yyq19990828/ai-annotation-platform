import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildSummary, main } from "./summarize-e2e-results.mjs";

// Fixtures are REAL Playwright JSON reports (locked 1.59.1 contract), generated
// from tiny controlled runs: scripts/fixtures/e2e-summary/*.json. See the
// generation commands in docs/research/36 §3.
const fixtureDir = new URL("./fixtures/e2e-summary/", import.meta.url);
const loadFixture = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, fixtureDir), "utf8"));

test("passed fixture: one first-attempt pass, no retries or failures", () => {
  const { text } = buildSummary({
    suite: "smoke",
    outcome: "success",
    report: loadFixture("passed"),
  });
  assert.match(text, /\| 1 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(text, /First-attempt passed \| Retry-then-passed/);
  assert.doesNotMatch(text, /First failure:/);
});

test("failed fixture: unexpected status, timeout-free failure and a recorded first failure with id and reason", () => {
  const { text } = buildSummary({
    suite: "default-one",
    outcome: "failure",
    report: loadFixture("failed"),
  });
  assert.match(text, /\| 0 \| 1 \| 0 \| 0 \|/);
  assert.match(
    text,
    /First failure: failed\.spec\.ts › fails with a stable reason \(project chromium, attempt 0\)/,
  );
  assert.match(text, /retryOutcome.*none|retryOutcome.*failed/s);
});

test("flaky fixture: retry-then-passed is counted separately from first-attempt", () => {
  const { text } = buildSummary({
    suite: "smoke",
    outcome: "success",
    report: loadFixture("flaky"),
  });
  assert.match(text, /First-attempt passed \| Retry-then-passed/);
  assert.match(text, /\| 0 \| 1 \|/);
});

test("expected-failure fixture counts as expected, not as a failure", () => {
  const { text } = buildSummary({
    suite: "smoke",
    outcome: "success",
    report: loadFixture("expected-failure"),
  });
  assert.match(text, /\| 1 \| 0 \| 0 \| 0 \|/);
});

test("skipped fixture is intentional (executed skip result), not not-run", () => {
  const { text } = buildSummary({
    suite: "smoke",
    outcome: "success",
    report: loadFixture("skipped"),
  });
  assert.match(text, /\| 0 \| 0 \| 0 \| 1 \|/);
  assert.match(text, /\| 0 \| 0 \| 0 \| 0 \| 1 \| 0 \|/);
});

test("max-failures fixture keeps per-test accounting without fabricating not-run entries", () => {
  // Real 1.59 runs with --max-failures still execute and report the queued
  // test (worker already started), so notRun stays 0 and the interruption is
  // attributed by status; missing suites are covered by the audit instead.
  const { text } = buildSummary({
    suite: "default-one",
    outcome: "failure",
    report: loadFixture("maxfailures"),
  });
  assert.match(text, /\| 1 \| 1 \|/);
  assert.match(text, /Not run \|/);
});

test("timing rows render prep/execution/build seconds when supplied", () => {
  const { text } = buildSummary({
    suite: "smoke",
    outcome: "success",
    report: loadFixture("passed"),
    prepSeconds: "210",
    runSeconds: "95",
    buildSeconds: "77",
  });
  assert.match(text, /Prep: 210s · Execution: 95s · Build: 77s/);
});

test("a missing report with a success outcome fails closed", () => {
  const writes = [];
  const stderr = [];
  const code = main(
    ["mask-native", "success", "missing-e2e-results.json"],
    {},
    {
      stdout: [],
      stderr: { write: (chunk) => stderr.push(chunk) },
      appendFileSync: (path, chunk) => writes.push([path, chunk]),
      readFileSync: () => {
        throw new Error("should not read");
      },
      existsSync: () => false,
      summaryPath: "summary.md",
    },
  );
  assert.equal(code, 1);
  assert.ok(writes[0][1].includes("No completed Playwright report"));
  assert.ok(stderr.join("").includes("without a Playwright report"));
});

test("a missing report with a failed outcome is reported without failing the step again", () => {
  const stderr = [];
  const writes = [];
  const code = main(
    ["mask-native", "failure", "missing-e2e-results.json"],
    {},
    {
      stdout: { write: (chunk) => writes.push(chunk) },
      stderr: { write: (chunk) => stderr.push(chunk) },
      appendFileSync: () => {},
      readFileSync: () => "",
      existsSync: () => false,
      summaryPath: undefined,
    },
  );
  assert.equal(code, 0);
});

test("usage error exits 2", () => {
  const code = main([], {}, { stdout: [], stderr: { write: () => {} } });
  assert.equal(code, 2);
});
