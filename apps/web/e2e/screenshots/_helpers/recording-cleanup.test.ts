import assert from "node:assert/strict";
import test from "node:test";
import { drainRecordingCleanup, recoverRecordingAnnotationIds } from "./recording-cleanup.ts";

test("completed recording cleanup does not replay stale project IDs after reseeding", async () => {
  const records = [{ project: "first" }, { project: "second" }];
  const cleaned: string[] = [];
  await drainRecordingCleanup(records, async (record) => {
    cleaned.push(record.project);
  });
  await drainRecordingCleanup(records, () => {
    throw new Error("The old projects no longer exist");
  });
  assert.deepEqual(records, []);
  assert.deepEqual(cleaned, ["first", "second"]);
});

test("a cleanup failure retains that record and following records for the final retry", async () => {
  const records = ["done", "retry", "pending"];
  await assert.rejects(
    drainRecordingCleanup(records, async (record) => {
      if (record === "retry") throw new Error("temporary cleanup failure");
    }),
    /temporary cleanup failure/,
  );
  assert.deepEqual(records, ["retry", "pending"]);
  const retried: string[] = [];
  await drainRecordingCleanup(records, (record) => {
    retried.push(record);
  });
  assert.deepEqual(retried, ["retry", "pending"]);
  assert.deepEqual(records, []);
});

test("recovery finds committed outputs after a lost browser response without deleting the baseline", () => {
  const scope = {
    taskId: "task",
    baselineAnnotationIds: ["existing"],
    annotationIds: ["registered"],
  };
  const observed = ["existing", "registered", "lost-response"].map((id) => ({
    id,
    task_id: "task",
  }));
  recoverRecordingAnnotationIds(scope, observed);
  recoverRecordingAnnotationIds(scope, observed);
  assert.deepEqual(scope.annotationIds, ["registered", "lost-response"]);
});

test("recovery rejects mixed task responses before registering deletions", () => {
  const scope = { taskId: "task", baselineAnnotationIds: [], annotationIds: [] as string[] };
  assert.throws(
    () =>
      recoverRecordingAnnotationIds(scope, [
        { id: "new", task_id: "task" },
        { id: "unrelated", task_id: "other" },
      ]),
    /outside its task scope/,
  );
  assert.deepEqual(scope.annotationIds, []);
});

test("failed recovery remains queued until a valid response can be reconciled", async () => {
  const scope = { taskId: "task", baselineAnnotationIds: [], annotationIds: [] as string[] };
  const records = [scope];
  await assert.rejects(
    drainRecordingCleanup(records, (record) =>
      recoverRecordingAnnotationIds(record, { error: "unavailable" }),
    ),
    /requires an array/,
  );
  assert.equal(records.length, 1);
  await drainRecordingCleanup(records, (record) =>
    recoverRecordingAnnotationIds(record, [{ id: "saved", task_id: "task" }]),
  );
  assert.deepEqual(scope.annotationIds, ["saved"]);
  assert.deepEqual(records, []);
});
