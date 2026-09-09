import { describe, expect, it } from "vitest";

import { relativeTaskTargetId, resolveSubmitBlockedReason } from "./useWorkbenchTaskFlow";

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

describe("resolveSubmitBlockedReason", () => {
  it("waits for existing writes before considering a durable local queue", () => {
    expect(
      resolveSubmitBlockedReason({
        pendingWrites: 1,
        maskSaving: false,
        maskDraft: false,
        localDraft: false,
        queueCount: 2,
      }),
    ).toBe("工作台写入尚未完成");
    expect(
      resolveSubmitBlockedReason({
        pendingWrites: 0,
        maskSaving: false,
        maskDraft: false,
        localDraft: false,
        queueCount: 2,
      }),
    ).toBe("离线队列仍有操作待同步");
  });

  it("keeps a failed sync visible as a submit blocker until the owner resolves it", () => {
    expect(
      resolveSubmitBlockedReason({
        pendingWrites: 0,
        maskSaving: false,
        maskDraft: false,
        localDraft: false,
        queueCount: 0,
        syncError: "部分离线操作同步失败",
      }),
    ).toBe("部分离线操作同步失败");
  });
});
