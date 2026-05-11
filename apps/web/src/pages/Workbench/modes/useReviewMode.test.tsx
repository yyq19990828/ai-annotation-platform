import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskResponse } from "@/types";
import { useReviewMode } from "./useReviewMode";

const mocks = vi.hoisted(() => ({
  approveMutate: vi.fn(),
  rejectMutate: vi.fn(),
  claimMutate: vi.fn(),
}));

vi.mock("@/hooks/useTasks", () => ({
  useApproveTask: () => ({ mutate: mocks.approveMutate, isPending: false }),
  useRejectTask: () => ({ mutate: mocks.rejectMutate, isPending: false }),
  useReviewClaim: () => ({ mutate: mocks.claimMutate, isPending: false }),
}));

vi.mock("@/pages/Review/ReviewerMiniPanel", () => ({
  ReviewerMiniPanel: () => <span data-testid="reviewer-mini-panel" />,
}));

function task(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: "t1",
    project_id: "p1",
    display_id: "T-1",
    file_name: "image.jpg",
    file_url: null,
    file_type: "image",
    tags: [],
    status: "review",
    assignee_id: "u1",
    assignee: null,
    reviewer: null,
    is_labeled: false,
    overlap: 0,
    total_annotations: 0,
    total_predictions: 0,
    batch_id: "b1",
    sequence_order: null,
    image_width: 100,
    image_height: 100,
    thumbnail_url: null,
    blurhash: null,
    video_metadata: null,
    submitted_at: null,
    reviewer_id: null,
    reviewer_claimed_at: null,
    reviewed_at: null,
    reject_reason: null,
    skip_reason: null,
    skipped_at: null,
    reopened_count: 0,
    last_reopened_at: null,
    created_at: "2026-05-11T00:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

function renderReview(mode: "annotate" | "review" = "review", overrides: Partial<TaskResponse> = {}) {
  const navigateTask = vi.fn();
  const pushToast = vi.fn();
  const rendered = renderHook(() =>
    useReviewMode({
      mode,
      taskId: "t1",
      task: task(overrides),
      navigateTask,
      pushToast,
    }),
  );
  return { ...rendered, navigateTask, pushToast };
}

describe("useReviewMode", () => {
  beforeEach(() => {
    mocks.approveMutate.mockReset();
    mocks.rejectMutate.mockReset();
    mocks.claimMutate.mockReset();
  });

  it("claims review tasks only in review mode", () => {
    renderReview("annotate");
    expect(mocks.claimMutate).not.toHaveBeenCalled();

    renderReview("review");
    expect(mocks.claimMutate).toHaveBeenCalledWith("t1", expect.any(Object));

    mocks.claimMutate.mockClear();
    renderReview("review", { status: "completed" });
    expect(mocks.claimMutate).not.toHaveBeenCalled();
  });

  it("exposes diff mode state for review mode", () => {
    const { result } = renderReview();

    expect(result.current.diffMode).toBe("diff");
    act(() => result.current.onSetDiffMode?.("raw"));
    expect(result.current.diffMode).toBe("raw");
  });

  it("handles A/R review hotkeys", () => {
    const { result } = renderReview();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(mocks.approveMutate).toHaveBeenCalledWith("t1", expect.any(Object));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    });
    expect(result.current.rejectModal?.open).toBe(true);
  });

  it("routes reject confirm to reject mutation", () => {
    const { result } = renderReview("review", { skip_reason: "no_target" });

    expect(result.current.rejectModal?.skipReasonHint).toBe("no_target");
    act(() => result.current.rejectModal?.onConfirm("框不完整"));
    expect(mocks.rejectMutate).toHaveBeenCalledWith(
      { taskId: "t1", reason: "框不完整" },
      expect.any(Object),
    );
  });
});
