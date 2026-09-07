import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "@playwright/test";
import { commitPendingAnnotationClass } from "../flows/_canvas.ts";

test("recording registers a saved annotation even when its picker fails to close", async () => {
  const created: string[] = [];
  const page = {
    getByTestId: () => ({
      waitFor: async ({ state }: { state: string }) => {
        if (state === "hidden") throw new Error("picker stayed open");
      },
      getByText: () => ({ last: () => ({ click: async () => {} }) }),
    }),
    waitForResponse: async () => ({
      json: async () => ({ id: "saved-track", task_id: 42, class_name: "truck" }),
    }),
  } as unknown as Page;
  await assert.rejects(
    commitPendingAnnotationClass(page, {
      label: "truck",
      taskId: 42,
      onCreated: (id) => created.push(id),
    }),
    /picker stayed open/,
  );
  assert.deepEqual(created, ["saved-track"]);
});

test("native Mask acceptance registers prediction lineage before class verification fails", async () => {
  const registered: Array<{ id: string; predictionId: unknown }> = [];
  const page = {
    getByTestId: () => ({
      waitFor: async () => {},
      getByText: () => ({ last: () => ({ click: async () => {} }) }),
    }),
    waitForResponse: async () => ({
      json: async () => ({
        annotation: {
          id: "saved-mask",
          task_id: 42,
          class_name: "car",
          parent_prediction_id: "interactive-prediction",
        },
      }),
    }),
  } as unknown as Page;
  await assert.rejects(
    commitPendingAnnotationClass(page, {
      label: "truck",
      taskId: 42,
      onCreated: (id, annotation) =>
        registered.push({ id, predictionId: annotation.parent_prediction_id }),
    }),
    /标注落库结果与语义锚点不一致/,
  );
  assert.deepEqual(registered, [{ id: "saved-mask", predictionId: "interactive-prediction" }]);
});
