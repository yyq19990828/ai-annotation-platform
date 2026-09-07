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
