import { beforeEach, describe, expect, it } from "vitest";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { useActiveIssueStore } from "./useActiveIssueStore";

beforeEach(() => {
  useActiveIssueStore.setState(useActiveIssueStore.getInitialState(), true);
});

describe("explicit Issue pin requests", () => {
  it("records repeated clicks on the same pin independently of generic tab requests", () => {
    const actions = useActiveIssueStore.getState();
    actions.highlightFromPin("issue-a");
    actions.highlightFromPin("issue-a");
    expect(useActiveIssueStore.getState()).toMatchObject({
      highlightId: "issue-a",
      pinRequestTick: 2,
      tabRequestTick: 2,
      pinTarget: null,
    });
    actions.requestIssuesTab();
    actions.focusIssue("issue-b");
    expect(useActiveIssueStore.getState()).toMatchObject({
      pinRequestTick: 2,
      tabRequestTick: 3,
      focusTick: 1,
    });
  });

  it("captures original project/task ownership instead of retaining a mutable record", () => {
    const target = {
      id: "issue-a",
      project_id: "project-a",
      task_id: "task-a",
      anchor_position: { x: 0.2, y: 0.4 },
    } as AnnotationFeedback;
    useActiveIssueStore.getState().highlightFromPin(target);
    target.task_id = "task-b";
    target.anchor_position!.x = 0.8;
    expect(useActiveIssueStore.getState().pinTarget).toMatchObject({
      id: "issue-a",
      project_id: "project-a",
      task_id: "task-a",
      anchor_position: { x: 0.2, y: 0.4 },
    });
  });
});
