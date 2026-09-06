import { describe, expect, it } from "vitest";

import { relativeTaskTargetId } from "./useWorkbenchTaskFlow";

describe("relativeTaskTargetId", () => {
  it("高速连按时基于尚未提交的意图游标继续前进", () => {
    const taskIds = ["task-a", "task-b", "task-c", "task-d"];
    const first = relativeTaskTargetId(taskIds, "task-a", null, "next");
    const second = relativeTaskTargetId(taskIds, "task-a", first, "next");
    const third = relativeTaskTargetId(taskIds, "task-a", second, "next");

    expect([first, second, third]).toEqual(["task-b", "task-c", "task-d"]);
  });

  it("到达队列边界后不重复导航当前目标", () => {
    expect(relativeTaskTargetId(["task-a", "task-b"], "task-b", null, "next")).toBeNull();
    expect(relativeTaskTargetId(["task-a", "task-b"], "task-a", null, "prev")).toBeNull();
  });
});
