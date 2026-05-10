import { describe, expect, it } from "vitest";
import {
  buildWorkbenchUrl,
  getRememberedWorkbenchTask,
  rememberWorkbenchTask,
  resolveWorkbenchReturnTo,
} from "./workbenchNavigation";

function memoryStorage(initial?: Record<string, string>) {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  } as Pick<Storage, "getItem" | "setItem">;
}

describe("workbenchNavigation", () => {
  it("remembers the last task per batch", () => {
    const storage = memoryStorage();
    rememberWorkbenchTask("batch-1", "task-2", storage);

    expect(getRememberedWorkbenchTask("batch-1", storage)).toBe("task-2");
    expect(getRememberedWorkbenchTask("batch-2", storage)).toBeNull();
  });

  it("builds workbench URLs with batch, task, and return target", () => {
    expect(
      buildWorkbenchUrl("project-1", {
        batchId: "batch-1",
        taskId: "task-2",
        returnTo: "/ai-pre/jobs?status=failed",
      }),
    ).toBe(
      "/projects/project-1/annotate?batch=batch-1&task=task-2&returnTo=%2Fai-pre%2Fjobs%3Fstatus%3Dfailed",
    );
  });

  it("rejects unsafe return targets", () => {
    expect(resolveWorkbenchReturnTo("https://example.com", "/projects/p/annotate")).toBe("/dashboard");
    expect(resolveWorkbenchReturnTo("//example.com/path", "/projects/p/annotate")).toBe("/dashboard");
    expect(resolveWorkbenchReturnTo("/ai-pre", "/projects/p/annotate")).toBe("/ai-pre");
    expect(resolveWorkbenchReturnTo("/projects/p/annotate", "/projects/p/annotate")).toBe("/dashboard");
  });
});
