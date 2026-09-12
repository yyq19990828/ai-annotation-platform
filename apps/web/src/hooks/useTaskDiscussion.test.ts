import { describe, expect, it } from "vitest";
import { discussionKeys } from "@/pages/Workbench/state/discussionTypes";
import { taskDiscussionQueryKey } from "./useTaskDiscussion";

describe("task discussion query keys", () => {
  it("retains the frozen task-discussion prefix and isolates project/user action projections", () => {
    const key = taskDiscussionQueryKey("task-a", "all", null, "project-a", "user-a");

    expect(key.slice(0, 5)).toEqual(discussionKeys.feed("task-a", "all", null, 50));
    expect(key.slice(5)).toEqual(["project-a", "user-a"]);
  });

  it("does not let an irrelevant annotation id split task-scope caches", () => {
    expect(taskDiscussionQueryKey("task-a", "task", "annotation-a", "project-a", "user-a")).toEqual(
      taskDiscussionQueryKey("task-a", "task", null, "project-a", "user-a"),
    );
  });
});
