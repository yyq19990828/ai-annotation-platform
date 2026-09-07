import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  RECORDING_FLOWS,
  recordingInference,
  recordingPlan,
  screenshotCatalogPath,
} from "./recording-plan.mjs";

test("selection scopes AI without changing capture quality or legacy catalog defaults", () => {
  assert.equal(recordingPlan(["bbox-draw"]).backendRequirements, "none");
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("../../scripts/run-recording-capture.mjs", import.meta.url)),
      "--",
      "--flow",
      "bbox-draw",
      "--plan",
    ],
    { encoding: "utf8" },
  );
  assert.equal(JSON.parse(output).backendRequirements, "none");
  assert.equal(recordingPlan(["ocr-inference", "bbox-draw"]).backendRequirements, "ocr");
  assert.equal(
    recordingPlan(["sam-interactive"], "marketing").backendRequirements,
    "image_interactive",
  );
  assert.equal(
    recordingPlan(["candidate-keyboard-review"]).backendRequirements,
    "image_interactive",
  );
  assert.throws(() => recordingPlan(["typo"]), /Unregistered/);
  assert.throws(
    () => recordingPlan(["pointcloud-billboard-label"]),
    /requires --profile marketing/,
  );
  assert.equal(
    recordingPlan(["pointcloud-billboard-label"], "marketing").backendRequirements,
    "none",
  );
  assert.throws(() => recordingPlan([]), /Select/);
  assert.throws(() => recordingPlan(["bbox-draw"], "4k-mac"), /Unknown profile/);
  const grep = new RegExp(recordingPlan(["bbox-draw"]).grep);
  assert.ok(grep.test("flows flow recordings bbox-draw — title"));
  assert.ok(!grep.test("flows flow recordings rotated-bbox-draw — title"));
  assert.equal(
    screenshotCatalogPath("none"),
    "/api/v1/__test/seed/catalog?profile=screenshots&backend_requirements=none",
  );
  assert.equal(screenshotCatalogPath(undefined), "/api/v1/__test/seed/catalog?profile=screenshots");
  const spec = fs.readFileSync(new URL("./flows/flows.spec.ts", import.meta.url), "utf8");
  for (const id of Object.keys(RECORDING_FLOWS)) {
    assert.ok(id.startsWith("sam-tool-") || spec.includes(`test("${id} —`), `No flow for ${id}`);
  }
});

test("capability-only panels and live inference retain separate recording evidence", () => {
  assert.deepEqual(RECORDING_FLOWS["ai-tracker-panel"], ["video_tracker"]);
  assert.equal(recordingPlan(["ai-tracker-panel"]).backendRequirements, "video_tracker");
  assert.equal(recordingInference("ai-tracker-panel"), "none");

  assert.deepEqual(RECORDING_FLOWS["current-task-image-inference"], ["ocr"]);
  assert.equal(recordingPlan(["current-task-image-inference"]).backendRequirements, "ocr");
  assert.equal(recordingInference("current-task-image-inference"), "live");

  for (const id of [
    "sam-tool-smart-point",
    "sam-tool-smart-box",
    "sam-tool-exemplar",
    "sam-interactive",
    "ocr-inference",
    "candidate-keyboard-review",
    "candidate-review-lifecycle",
    "smart-scribble",
  ]) {
    assert.equal(recordingInference(id), "live", id);
  }
  for (const [id, requirements] of Object.entries(RECORDING_FLOWS)) {
    if (requirements.length === 0) assert.equal(recordingInference(id), "none", id);
  }
  for (const id of ["typo", "toString", "__proto__"]) {
    assert.throws(() => recordingInference(id), /Unregistered/);
  }
});

test("mixed selection combines capability requirements without widening individual inference", () => {
  const plan = recordingPlan([
    "ai-tracker-panel",
    "current-task-image-inference",
    "bbox-draw",
    "ai-tracker-panel",
  ]);
  assert.deepEqual(plan.flows, ["ai-tracker-panel", "current-task-image-inference", "bbox-draw"]);
  assert.equal(plan.backendRequirements, "ocr,video_tracker");
  assert.deepEqual(plan.flows.map(recordingInference), ["none", "live", "none"]);
  const grep = new RegExp(plan.grep);
  for (const id of plan.flows) assert.ok(grep.test(`flows flow recordings ${id} — title`));
  assert.ok(!grep.test("flows flow recordings video-tracker-range — title"));
});
