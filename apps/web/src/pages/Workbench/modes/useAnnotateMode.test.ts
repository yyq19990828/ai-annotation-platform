import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskResponse } from "@/types";
import { useAnnotateMode } from "./useAnnotateMode";

const mocks = vi.hoisted(() => ({
  withdrawMutate: vi.fn(),
  reopenMutate: vi.fn(),
  acceptRejectionMutate: vi.fn(),
  skipMutate: vi.fn(),
}));

vi.mock("@/hooks/useTasks", () => ({
  useWithdrawTask: () => ({ mutate: mocks.withdrawMutate, isPending: false }),
  useReopenTask: () => ({ mutate: mocks.reopenMutate, isPending: false }),
  useAcceptRejection: () => ({ mutate: mocks.acceptRejectionMutate, isPending: false }),
  useSkipTask: () => ({ mutate: mocks.skipMutate, isPending: false }),
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
    status: "in_progress",
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

function renderAnnotate(overrides: Partial<TaskResponse> = {}) {
  const navigateTask = vi.fn();
  const smartNext = vi.fn();
  const onSubmit = vi.fn();
  const pushToast = vi.fn();
  const rendered = renderHook(() =>
    useAnnotateMode({
      mode: "annotate",
      taskId: "t1",
      task: task(overrides),
      navigateTask,
      smartNext,
      onSubmit,
      isSubmitting: false,
      pushToast,
    }),
  );
  return { ...rendered, navigateTask, smartNext, onSubmit, pushToast };
}

describe("useAnnotateMode", () => {
  beforeEach(() => {
    mocks.withdrawMutate.mockReset();
    mocks.reopenMutate.mockReset();
    mocks.acceptRejectionMutate.mockReset();
    mocks.skipMutate.mockReset();
    mocks.skipMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
  });

  it("exposes submit, smart next and skip actions for annotate topbar", () => {
    const { result, navigateTask, smartNext, onSubmit } = renderAnnotate();

    act(() => result.current.topbarActions.onSubmit?.());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    act(() => result.current.topbarActions.onSmartNextOpen?.());
    act(() => result.current.topbarActions.onSmartNextUncertain?.());
    expect(smartNext).toHaveBeenNthCalledWith(1, "open");
    expect(smartNext).toHaveBeenNthCalledWith(2, "uncertain");

    act(() => result.current.topbarActions.onSkip?.("no_target"));
    expect(mocks.skipMutate).toHaveBeenCalledWith(
      { taskId: "t1", reason: "no_target", note: undefined },
      expect.any(Object),
    );
    expect(navigateTask).toHaveBeenCalledWith("next");
  });

  it("keeps review and completed tasks locked and routes withdraw/reopen actions", () => {
    const review = renderAnnotate({ status: "review", reviewer_claimed_at: null });
    expect(review.result.current.isLocked).toBe(true);
    expect(review.result.current.bannerActions.canWithdraw).toBe(true);

    act(() => review.result.current.bannerActions.onWithdraw());
    expect(mocks.withdrawMutate).toHaveBeenCalledWith("t1", expect.any(Object));

    const completed = renderAnnotate({ status: "completed" });
    expect(completed.result.current.isLocked).toBe(true);
    expect(completed.result.current.topbarActions.canReopen).toBe(true);

    act(() => completed.result.current.topbarActions.onReopen?.());
    expect(mocks.reopenMutate).toHaveBeenCalledWith("t1", expect.any(Object));
  });

  it("routes rejected-task accept action through the banner actions", () => {
    const { result } = renderAnnotate({ status: "rejected", reject_reason: "框偏移" });

    act(() => result.current.bannerActions.onAcceptRejection());
    expect(mocks.acceptRejectionMutate).toHaveBeenCalledWith("t1", expect.any(Object));
  });
});
