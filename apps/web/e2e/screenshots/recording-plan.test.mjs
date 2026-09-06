import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { RECORDING_FLOWS, recordingPlan, screenshotCatalogPath } from "./recording-plan.mjs";

test("selection scopes AI without changing capture quality or legacy catalog defaults", () => {
  assert.equal(recordingPlan(["bbox-draw"]).backendRequirements, "none");
  const output = execFileSync(
    process.execPath,
    [
      new URL("../../scripts/run-recording-capture.mjs", import.meta.url).pathname,
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
