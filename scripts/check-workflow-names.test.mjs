import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWorkflows } from "./check-workflow-names.mjs";

const workflow = (body, file = "docs-check.yml") => ({
  file,
  text: `name: Docs check\njobs:\n${body}\n`,
});

test("accepts quoted names, comments, acronyms and nested step names", () => {
  assert.deepEqual(
    checkWorkflows([
      workflow(`  check:
    name: "Python SDK tests" # public check name
    steps:
      - name: arbitrary step title + tools
        run: echo ok
  other:
    name: 'ML examples tests'`),
    ]),
    [],
  );
});

test("requires explicit names even when steps have names", () => {
  const findings = checkWorkflows([
    workflow(`  check:
    steps:
      - name: Docs validation`),
  ]);
  assert.ok(findings.some((f) => f.msg.includes("must set an explicit name") && f.line === 3));
});

test("rejects ambiguous, dynamic, and incorrectly cased display names", () => {
  for (const name of [
    "validate",
    "Docs/Validation",
    "Docs / validation",
    "Docs Validation",
    "Validation",
    "docs validation",
    "docs / Validation",
    "Docs build / Tests",
    "Docs / ${{ matrix.task }}",
    "Docs / Tests + build",
    ">-",
  ]) {
    assert.ok(checkWorkflows([workflow(`  check:\n    name: ${name}`)]).length, name);
  }
});

test("rejects duplicate display names across workflows", () => {
  const findings = checkWorkflows([
    workflow("  check:\n    name: Docs build"),
    workflow("  build:\n    name: 'Docs build'", "docs-deploy.yml"),
  ]);
  assert.ok(findings.some((f) => f.msg.includes('duplicate job name "Docs build"')));
});

test("checks filename and top-level casing", () => {
  const input = workflow("  check:\n    name: Docs validation", "claude.yml");
  input.text = input.text.replace("Docs check", "Docs Check");
  assert.equal(checkWorkflows([input]).length, 2);
});

test("rejects unsupported job layout instead of silently skipping it", () => {
  for (const body of [
    "  check: { name: 'Docs validation' }",
    "    check:\n      name: Docs validation",
    "  check:\n   name: Docs validation",
  ]) {
    assert.ok(checkWorkflows([workflow(body)]).length);
  }
});

test("ends the jobs mapping before other top-level mappings", () => {
  const input = workflow("  check:\n    name: Docs validation\nconcurrency:\n  group: docs");
  assert.deepEqual(checkWorkflows([input]), []);
});

test("CLI fails in strict mode and only warns in advisory mode", async () => {
  const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "workflow-names-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    const script = join(root, "scripts/check-workflow-names.mjs");
    copyFileSync(new URL("./check-workflow-names.mjs", import.meta.url), script);
    const file = join(root, ".github/workflows/docs-check.yml");
    writeFileSync(file, workflow("  check:\n    runs-on: ubuntu-latest").text);
    const strict = spawnSync(process.execPath, [script, "--strict"], { encoding: "utf8" });
    assert.equal(strict.status, 1, strict.stderr);
    assert.match(strict.stdout, /::error file=/);
    const advisory = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(advisory.status, 0, advisory.stderr);
    assert.match(advisory.stdout, /::warning file=/);
    writeFileSync(file, workflow("  check:\n    name: Docs validation").text);
    const valid = spawnSync(process.execPath, [script, "--strict"], { encoding: "utf8" });
    assert.equal(valid.status, 0, valid.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
