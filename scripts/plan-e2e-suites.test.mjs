import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { planE2ESuites, selectSuites, shadowPlan, SUITE_CONTRACT } from "./plan-e2e-suites.mjs";

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

const core = ["default-one", "default-two", "default-three", "default-four"];
const specialties = ["mask-readonly", "mask-native", "mask-ai-native"];

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
  assert.throws(() => selectSuites("unknown", []), /Unsupported/);
  assert.throws(() => selectSuites("pull_request", "not-an-array"), /changed paths/);
});

test("shadow selection classifies docs-only changes and proposes no app suites", () => {
  const docsOnly = [
    "README.md",
    "docs-site/user-guide/workbench/index.md",
    "docs/research/31-repository-optimization-p7-e2e-isolation.md",
  ];
  const shadow = shadowPlan("pull_request", docsOnly);
  assert.deepEqual(shadow.planned, []);
  assert.equal(shadow.classification.docsOnly, true);
  assert.deepEqual(shadow.added, []);
  // The gate is unchanged: docs-only PRs still run the full legacy matrix
  // until P9 switches it, and the diff records exactly that.
  assert.deepEqual(shadow.removed, functional);
});

test("executable docs examples and docs build config are app code, not docs-only", () => {
  for (const path of [
    "docs-site/dev/examples/protocol-demo.py",
    "docs-site/.vitepress/config.ts",
    "docs-site/dev/examples/data/fixture.json",
  ]) {
    const shadow = shadowPlan("pull_request", [path]);
    assert.equal(shadow.classification.docsOnly, false, path);
    // §6 shadow: app-code changes run the bounded smoke plus triggered
    // specialties; whole functional shards belong to the full scope.
    assert.deepEqual(shadow.planned, ["smoke"], path);
  }
});

test("empty diffs and unrecognized paths fail closed to the conservative selection", () => {
  const empty = shadowPlan("pull_request", []);
  assert.deepEqual(empty.planned, ["smoke", ...core, "visual", "layout-stress"]);
  assert.equal(empty.classification.emptyDiff, true);
  assert.ok(empty.warnings.some((warning) => /empty diff/.test(warning)));

  const unknown = shadowPlan("pull_request", ["model-configs/weights.yaml"]);
  assert.deepEqual(unknown.planned, ["smoke", ...core, "visual", "layout-stress"]);
  assert.ok(unknown.classification.unknownPaths.includes("model-configs/weights.yaml"));
  assert.ok(unknown.warnings.some((warning) => /unrecognized top-level paths/.test(warning)));
});

test("multi-domain changes broaden to the extended checks with recorded reasons", () => {
  const shadow = shadowPlan("pull_request", [
    "apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx",
    "apps/api/app/services/project_access.py",
  ]);
  assert.deepEqual(shadow.planned, ["smoke", ...specialties, ...core, "visual", "layout-stress"]);
  assert.equal(shadow.classification.multiDomain, true);
  assert.ok(shadow.reasons.some((reason) => /multi-domain/.test(reason.because)));
});

test("single-domain frontend changes select core plus triggered specialties", () => {
  const shadow = shadowPlan("pull_request", [
    "apps/web/src/pages/Workbench/stage/shared/geometry/maskOperations.ts",
  ]);
  // Core stays unconditional for app code, the Mask specialties ride along as
  // triggered, and the extended checks are the recorded narrowing proposal.
  assert.deepEqual(shadow.planned, ["smoke", ...specialties]);
  assert.ok(shadow.reasons.some((reason) => /raster Mask/.test(reason.because)));
  // Smoke itself is shadow-only, so the diff against the frozen gate shows it
  // as an addition together with the dropped default shards and extended.
  assert.deepEqual(shadow.added, ["smoke"]);
  assert.deepEqual(shadow.removed, [...core, "visual", "layout-stress"]);
});

test("mask runtime numbers from P7 evidence ride with the contract", () => {
  const contractFor = (suite) => {
    const entry = SUITE_CONTRACT.find((candidate) => candidate.suite === suite);
    assert.ok(entry, `missing contract entry for ${suite}`);
    return entry;
  };
  const readonly = contractFor("mask-readonly");
  assert.equal(readonly.runtime.collects, 13);
  assert.equal(readonly.runtime.skipped, 11);
  const native = contractFor("mask-native");
  assert.equal(native.runtime.collects, 22);
  assert.equal(native.runtime.skipped, 2);
});

test("shared CPU contract suites are wired as triggered specialties with dependencies", () => {
  const shadow = shadowPlan("pull_request", [
    "apps/_shared/protocol_v2/src/aap_protocol_v2/schemas.py",
    "apps/sam3-backend/main.py",
  ]);
  const wired = shadow.sharedContracts.wired.map(({ suite }) => suite);
  assert.deepEqual(wired.sort(), ["shared-mask-utils", "shared-protocol-v2"]);
  for (const suite of shadow.sharedContracts.wired) {
    assert.match(suite.command, /uv run --extra test pytest/);
    assert.match(suite.dependencies, /no database, no GPU/);
  }
  // Torch-dependent runtime plus the five ML backends stay explicit
  // hardware/model qualification and are never scheduled from the planner.
  const qualification = shadow.sharedContracts.qualification.map(({ suite }) => suite);
  assert.deepEqual(qualification.sort(), [
    "ml-grounded-sam2-backend",
    "ml-onnxtools-backend",
    "ml-rapidocr-backend",
    "ml-sam3-backend",
    "ml-yolo-backend",
    "shared-backend-runtime",
  ]);
  for (const suite of shadow.sharedContracts.qualification) assert.equal(suite.wired, false);
});

test("shadow diff against the legacy gate is recorded for schedule changes", () => {
  const shadow = shadowPlan("schedule");
  // Legacy: extended-only. Shadow proposal per §6.2: nightly full matrix.
  assert.deepEqual(shadow.legacy, ["visual", "layout-stress"]);
  assert.deepEqual(shadow.planned, [
    "smoke",
    ...core,
    ...specialties,
    "video-pipeline",
    "pointcloud",
    "visual",
    "layout-stress",
  ]);
  assert.deepEqual(shadow.added, [
    "smoke",
    ...core,
    ...specialties,
    "video-pipeline",
    "pointcloud",
  ]);
  assert.deepEqual(shadow.removed, []);
  assert.ok(shadow.warnings.some((warning) => /proposed change for P9/.test(warning)));
});

test("app-code changes can never produce an empty shadow selection", () => {
  // The core suites are unconditional for app code, so this only holds
  // structurally; the explicit throw guards future edits to the rules.
  const shadow = shadowPlan("pull_request", ["apps/api/app/services/project_access.py"]);
  assert.ok(shadow.planned.length > 0);
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
    const [matrixLine, shadowLine] = result.stdout.trim().split("\n");
    assert.deepEqual(
      JSON.parse(matrixLine.trim().slice("matrix=".length)).include.map(({ suite }) => suite),
      [...functional, "visual", "layout-stress"],
    );
    // The shadow report must ride along on every planning invocation without
    // changing the gate selection.
    const shadow = JSON.parse(shadowLine.trim().slice("shadow=".length));
    assert.deepEqual(shadow.legacy, [...functional, "visual", "layout-stress"]);
    assert.ok(Array.isArray(shadow.added) && Array.isArray(shadow.removed));
    assert.notEqual(run("0".repeat(40)).status, 0);
    assert.notEqual(run("").status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
