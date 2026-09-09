import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { planE2ESuites } from "./plan-e2e-suites.mjs";

const names = (event, paths) => planE2ESuites(event, paths).include.map(({ suite }) => suite);
const functional = [
  "default-one",
  "default-two",
  "default-three",
  "default-four",
  "mask-readonly",
  "mask-native",
  "mask-ai-native",
];

test("every PR retains all four functional shards and three Mask suites", () => {
  assert.deepEqual(names("pull_request", []), functional);
  assert.deepEqual(
    names("pull_request", ["docs-site/user-guide/workbench/index.md", "README.md"]),
    functional,
  );
});

test("runtime, dependencies and the routing mechanism select both extended checks", () => {
  for (const path of [
    "apps/web/src/pages/Workbench/layout/workbenchLayoutExecutor.ts",
    "apps/web/src/styles/shadcn.css",
    "apps/web/e2e/tests/deleted.spec.ts",
    "apps/web/playwright.extended.config.ts",
    "apps/api/app/api/v1/_test_seed.py",
    "apps/api/app/api/v1/annotations.py",
    "packages/shared/example.ts",
    "pnpm-lock.yaml",
    "package.json",
    ".env.example",
    "docker-compose.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/e2e-run.yml",
    "scripts/plan-e2e-suites.mjs",
    "scripts/plan-e2e-suites.test.mjs",
  ]) {
    assert.deepEqual(
      names("pull_request", [path]),
      [...functional, "visual", "layout-stress"],
      path,
    );
  }
});

test("main always runs everything; scheduled and manual runs select the extended suites", () => {
  assert.deepEqual(names("push"), [...functional, "visual", "layout-stress"]);
  for (const event of ["schedule", "workflow_dispatch"])
    assert.deepEqual(names(event), ["visual", "layout-stress"]);
});

test("missing change information or an unsupported event cannot silently omit checks", () => {
  assert.throws(() => planE2ESuites("pull_request"), /changed paths/);
  assert.throws(() => planE2ESuites("unknown", []), /Unsupported/);
});

test("CLI handles deleted and renamed paths, and fails on an unavailable base", () => {
  const cwd = mkdtempSync(join(tmpdir(), "e2e-routing-"));
  const script = fileURLToPath(new URL("./plan-e2e-suites.mjs", import.meta.url));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const run = (base) =>
    spawnSync(process.execPath, [script, base], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_EVENT_NAME: "pull_request" },
    });
  try {
    git("init");
    git("config", "user.name", "E2E routing test");
    git("config", "user.email", "test@example.invalid");
    mkdirSync(join(cwd, "apps/web"), { recursive: true });
    writeFileSync(join(cwd, "apps/web/old file\n.spec.ts"), "fixture\n");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "base");
    const base = git("rev-parse", "HEAD");
    git("mv", "apps/web/old file\n.spec.ts", "README.md");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "move out of frontend",
    );
    const result = run(base);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout.trim().slice("matrix=".length)).include.map(({ suite }) => suite),
      [...functional, "visual", "layout-stress"],
    );
    assert.notEqual(run("0".repeat(40)).status, 0);
    assert.notEqual(run("").status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
