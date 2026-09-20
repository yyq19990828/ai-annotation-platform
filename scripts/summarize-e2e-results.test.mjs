import assert from "node:assert/strict";
import test from "node:test";

import { buildSummary, main } from "./summarize-e2e-results.mjs";

const report = {
  stats: { expected: 9, unexpected: 1, flaky: 1, skipped: 2, duration: 42_000 },
  errors: [{ message: "page error" }],
  suites: [
    {
      specs: [],
      suites: [
        {
          specs: [
            {
              tests: [
                { ok: true, expectedStatus: "passed", results: [{ status: "passed" }] },
                {
                  ok: true,
                  expectedStatus: "passed",
                  results: [{ status: "failed" }, { status: "passed" }],
                },
                { ok: false, expectedStatus: "passed", results: [{ status: "timedOut" }] },
                { ok: false, expectedStatus: "passed", results: [{ status: "interrupted" }] },
                { ok: false, expectedStatus: "passed", results: [] },
              ],
            },
          ],
          suites: [
            {
              specs: [
                {
                  tests: [
                    { ok: true, expectedStatus: "skipped", results: [{ status: "skipped" }] },
                    { ok: true, expectedStatus: "passed", results: [{ status: "passed" }] },
                  ],
                },
              ],
              suites: [],
            },
          ],
        },
      ],
    },
  ],
};

test("summary classifies first-attempt, retry, timeout, interruption and not-run", () => {
  const { text, requiredMissing } = buildSummary({
    suite: "default-one",
    outcome: "failure",
    report,
    prepSeconds: 210,
    runSeconds: 95,
  });
  assert.equal(requiredMissing, false);
  assert.match(text, /\| 9 \| 1 \| 1 \| 2 \| 1 \| 42\.0s |/);
  assert.match(
    text,
    /First-attempt passed \| Retry-then-passed \| Timed out \| Interrupted \| Not run /,
  );
  assert.match(text, /\| 2 \| 1 \| 1 \| 1 \| 1 |$/m);
  assert.match(text, /Prep: 210s · Execution: 95s/);
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
  assert.ok(stderr.join("").length === 0);
});

test("usage error exits 2", () => {
  const code = main([], {}, { stdout: [], stderr: { write: () => {} } });
  assert.equal(code, 2);
});
