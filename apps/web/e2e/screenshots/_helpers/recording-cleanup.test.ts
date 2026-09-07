import assert from "node:assert/strict";
import test from "node:test";
import { drainRecordingCleanup } from "./recording-cleanup.ts";

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
