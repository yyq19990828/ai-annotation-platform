import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationResponse, TaskResponse } from "@/types";
import { resolveActiveDiscussionAnnotation } from "./discussionTargets";

const mocks = vi.hoisted(() => ({ annotations: vi.fn(), segments: vi.fn() }));
vi.mock("./tasks", () => ({
  tasksApi: { getAnnotations: (...args: unknown[]) => mocks.annotations(...args) },
}));
vi.mock("./videoTracker", () => ({
  videoTrackerApi: { segments: (...args: unknown[]) => mocks.segments(...args) },
}));
const task = { id: "task", project_id: "project", file_type: "image" } as TaskResponse;
const annotation = {
  id: "annotation",
  task_id: "task",
  project_id: "project",
  is_active: true,
} as AnnotationResponse;

beforeEach(() => vi.resetAllMocks());

describe("active discussion annotation resolution", () => {
  it("uses the active original task reader for an image annotation", async () => {
    mocks.annotations.mockResolvedValue([annotation]);
    expect(await resolveActiveDiscussionAnnotation(task, annotation.id)).toBe(annotation);
    expect(mocks.segments).not.toHaveBeenCalled();
    expect(mocks.annotations).toHaveBeenCalledWith(task.id, null, { signal: undefined });
  });

  it("searches later collaboration segments without claiming a lease", async () => {
    mocks.segments.mockResolvedValue({
      task_id: task.id,
      collaboration_enabled: true,
      segments: [{ id: "first" }, { id: "second" }],
    });
    const older = { ...annotation, video_segment_id: "second" };
    mocks.annotations.mockResolvedValueOnce([]).mockResolvedValueOnce([older]);
    const signal = new AbortController().signal;
    expect(
      await resolveActiveDiscussionAnnotation(
        { ...task, file_type: "video" },
        annotation.id,
        signal,
      ),
    ).toEqual(older);
    expect(mocks.annotations.mock.calls).toEqual([
      [task.id, "first", { signal }],
      [task.id, "second", { signal }],
    ]);
  });

  it("uses the unsegmented reader when video collaboration is disabled", async () => {
    mocks.segments.mockResolvedValue({
      task_id: task.id,
      collaboration_enabled: false,
      segments: [{ id: "first" }],
    });
    mocks.annotations.mockResolvedValue([annotation]);
    expect(
      await resolveActiveDiscussionAnnotation({ ...task, file_type: "video" }, annotation.id),
    ).toEqual(annotation);
    expect(mocks.annotations).toHaveBeenCalledWith(task.id, null, { signal: undefined });
  });

  it("rejects mismatched annotation ownership and returns missing only after successful reads", async () => {
    mocks.annotations.mockResolvedValue([{ ...annotation, is_active: false }]);
    expect(await resolveActiveDiscussionAnnotation(task, annotation.id)).toBeNull();
    mocks.annotations.mockResolvedValue([{ ...annotation, task_id: "other" }]);
    expect(await resolveActiveDiscussionAnnotation(task, annotation.id)).toBeNull();
    mocks.annotations.mockRejectedValue(new Error("temporary failure"));
    await expect(resolveActiveDiscussionAnnotation(task, annotation.id)).rejects.toThrow(
      "temporary failure",
    );
  });

  it("stops before the next segment when a request is cancelled", async () => {
    const controller = new AbortController();
    mocks.segments.mockResolvedValue({
      task_id: task.id,
      collaboration_enabled: true,
      segments: [{ id: "first" }, { id: "second" }],
    });
    mocks.annotations.mockImplementation(async () => {
      controller.abort();
      return [];
    });
    await expect(
      resolveActiveDiscussionAnnotation(
        { ...task, file_type: "video" },
        annotation.id,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.annotations).toHaveBeenCalledTimes(1);
  });
});
