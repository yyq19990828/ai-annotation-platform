import { beforeEach, describe, expect, it } from "vitest";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { useAuthStore } from "@/stores/authStore";
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

  it("keeps detail activation separate from canvas focus and records scoped snapshots", () => {
    const target = {
      id: "issue-detail",
      kind: "issue",
      project_id: "project-a",
      task_id: "task-a",
      thread_parent_id: null,
      is_active: true,
    } as AnnotationFeedback;
    const beforeFocus = useActiveIssueStore.getState().focusTick;
    useActiveIssueStore.getState().openIssueDetail(target);
    target.task_id = "task-b";
    const state = useActiveIssueStore.getState();
    expect(state.detailRequestTick).toBe(1);
    expect(state.detailTargetId).toBe("issue-detail");
    expect(state.detailScope).toEqual({ projectId: "project-a", taskId: "task-a" });
    expect(state.detailTarget?.task_id).toBe("task-a");
    expect(state.focusTick).toBe(beforeFocus);
    useActiveIssueStore.getState().openIssueDetail("issue-detail", {
      projectId: "project-a",
      taskId: "task-a",
    });
    expect(useActiveIssueStore.getState().detailRequestTick).toBe(2);
    useActiveIssueStore.getState().requestIssuesTab();
    expect(useActiveIssueStore.getState().detailTargetId).toBeNull();
  });

  it("retires pin/detail snapshots across logout-login while preserving same-user token renewal", () => {
    localStorage.clear();
    useAuthStore.getState().setAuth("token-a", { id: "user-a" } as never);
    useActiveIssueStore.getState().openIssueDetail("issue-a", {
      projectId: "project-a",
      taskId: "task-a",
    });
    useAuthStore.getState().setAuth("token-renewed", { id: "user-a" } as never);
    expect(useActiveIssueStore.getState().detailTargetId).toBe("issue-a");
    useAuthStore.getState().logout();
    expect(useActiveIssueStore.getState().detailTargetId).toBeNull();
    expect(useActiveIssueStore.getState().pinTarget).toBeNull();
    useAuthStore.getState().setAuth("token-b", { id: "user-a" } as never);
    expect(useActiveIssueStore.getState().detailTargetId).toBeNull();
    useAuthStore.getState().logout();
    localStorage.clear();
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
