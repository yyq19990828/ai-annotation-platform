import { describe, expect, it, vi } from "vitest";
import {
  createDiscussionDraftStore,
  type DiscussionDraftStore,
  UnsupportedDiscussionFieldError,
} from "./useDiscussionDraftStore";
import type { DiscussionTarget } from "./discussionTypes";

const owner = { sessionId: "session-a", userId: "user-a" };
const task: DiscussionTarget = { projectId: "project-a", taskId: "task-a", kind: "task" };
const taskB: DiscussionTarget = { projectId: "project-a", taskId: "task-b", kind: "task" };
const annotation: DiscussionTarget = {
  projectId: "project-a",
  taskId: "task-a",
  kind: "annotation",
  annotationId: "annotation-a",
};

const line = (x = 0) => ({
  shapes: [{ type: "line" as const, points: [x, x, x + 1, x + 1] }],
});

function makeStore(): DiscussionDraftStore {
  return createDiscussionDraftStore({ owner });
}

describe("createDiscussionDraftStore", () => {
  it("follows new annotation selections without moving drafts or overriding an unchanged selection's manual target", () => {
    const store = makeStore();
    const second = { ...annotation, annotationId: "annotation-b" } as DiscussionTarget;
    store.patchDraft(annotation, { body: "A draft", canvas_drawing: line() });
    store.patchDraft(second, { body: "B draft" });
    store.followAnnotationSelection("project-a", "task-a", "annotation-a");
    expect(store.getSendTarget("project-a", "task-a")).toEqual(annotation);
    store.setSendTarget("project-a", "task-a", task);
    store.followAnnotationSelection("project-a", "task-a", "annotation-a");
    expect(store.getSendTarget("project-a", "task-a")).toEqual(task);
    store.followAnnotationSelection("project-a", "task-a", "annotation-b");
    expect(store.getSendTarget("project-a", "task-a")).toEqual(second);
    expect(store.getDraft(annotation)).toMatchObject({ body: "A draft", canvas_drawing: line() });
    expect(store.getDraft(second)).toMatchObject({ body: "B draft" });
    store.followAnnotationSelection("project-a", "task-a", null);
    expect(store.getSendTarget("project-a", "task-a")).toEqual(task);
    expect(store.getDraft(second)?.body).toBe("B draft");
    expect(store.getDraft(task)?.body).toBe("");
    store.followAnnotationSelection("project-a", "task-b", "other-task-annotation");
    expect(store.getSendTarget("project-a", "task-a")).toEqual(task);
    store.followAnnotationSelection("project-a", "task-a", "annotation-a");
    expect(store.getSendTarget("project-a", "task-a")).toEqual(annotation);
    store.dispose();
    store.followAnnotationSelection("project-a", "task-a", "annotation-b");
    expect(store.getSendTarget("project-a", "task-a")).toBeUndefined();
  });

  it("keeps task A/B/A drafts independently and creates them lazily", () => {
    const store = makeStore();

    expect(store.getDraft(task)).toBeUndefined();
    store.patchDraft(task, { body: "A" });
    store.patchDraft(taskB, { body: "B" });

    expect(store.getSnapshot().drafts).toHaveProperty(
      JSON.stringify(["project-a", "task-a", "task", null]),
    );
    expect(store.getDraft(task)?.body).toBe("A");
    expect(store.getDraft(taskB)?.text).toBe("B");
    expect(store.getDraft(task)?.target).toEqual(task);
  });

  it("does not silently discard unsupported rich fields on text-only targets", () => {
    const store = makeStore();

    expect(() =>
      store.patchDraft(task, {
        mentions: [{ userId: "u", displayName: "U", offset: 0, length: 2 }],
      }),
    ).toThrow(UnsupportedDiscussionFieldError);
    expect(() =>
      store.beginSubmission(task, {
        body: "task",
        mentions: [{ userId: "u", displayName: "U", offset: 0, length: 2 }],
        attachments: [],
        canvas_drawing: null,
      }),
    ).toThrow(UnsupportedDiscussionFieldError);
    expect(store.getDraft(task)).toBeDefined();
    expect(store.getDraft(task)?.body).toBe("");
  });

  it("allows one request per target and protects newer edits from a late success", () => {
    const store = makeStore();
    store.patchDraft(task, { body: "first" });
    const first = store.beginSubmission(task);
    expect(first).not.toBeNull();
    expect(store.beginSubmission(task)).toBeNull();

    store.patchDraft(task, { body: "second" });
    expect(store.resolveSubmission(first!)).toBe(false);
    expect(store.getDraft(task)).toMatchObject({ body: "second", status: "dirty", error: null });

    const second = store.beginSubmission(task);
    expect(second?.payload.body).toBe("second");
    expect(store.resolveSubmission(second!)).toBe(true);
    expect(store.getDraft(task)).toMatchObject({ body: "", text: "", status: "idle" });
  });

  it("retains content and exposes a target-local error on failure", () => {
    const store = makeStore();
    store.patchDraft(annotation, { body: "keep me" });
    const request = store.beginSubmission(annotation);
    expect(request).not.toBeNull();

    expect(store.rejectSubmission(request!, new Error("offline"))).toBe(true);
    expect(store.getDraft(annotation)).toMatchObject({
      body: "keep me",
      status: "error",
      error: "offline",
    });
    expect(store.beginSubmission(annotation)?.payload.body).toBe("keep me");
  });

  it("captures the first anchor and blocks submission while a live canvas is active", () => {
    const store = makeStore();
    const anchor = { kind: "video_frame" as const, frameIndex: 8, source: "manual" as const };
    store.patchDraft(annotation, { body: "located" });
    expect(store.captureAnchor(annotation, anchor)).toBe(true);
    expect(store.captureAnchor(annotation, { ...anchor, frameIndex: 9 })).toBe(false);
    expect(store.getDraft(annotation)?.anchor).toEqual(anchor);

    const origin = store.makeOrigin(annotation)!;
    expect(store.startCanvasSession(origin, line())).toBe(true);
    expect(store.getDraft(annotation)?.canvasActive).toBe(true);
    expect(store.beginSubmission(annotation)).toBeNull();
    expect(store.saveDrawing(origin, line(), { active: true })).toBe(true);
    expect(store.saveDrawing(origin, line(), { active: true })).toBe(true);
  });

  it("rejects stale live drawing results and discards disposed origins", () => {
    const store = makeStore();
    const first = store.makeOrigin(annotation)!;
    expect(store.startCanvasSession(first, line(1))).toBe(true);
    const second = store.makeOrigin(annotation)!;
    expect(store.startCanvasSession(second, line(2))).toBe(true);

    expect(store.acceptDrawing(first, line(3))).toBe(false);
    expect(store.getDraft(annotation)?.canvas_drawing).toEqual(line(2));
    expect(store.disposeOrigin(second)).toBe(true);
    expect(store.acceptDrawing(second, line(4))).toBe(false);
    expect(store.getDraft(annotation)?.canvas_drawing).toBeNull();
  });

  it("accepts a late upload into its original target, not the currently visible target", () => {
    const store = makeStore();
    const origin = {
      owner: store.getOwner(),
      target: annotation,
      requestId: "upload-1",
    };
    const attachment = { storageKey: "k", fileName: "x.png", mimeType: "image/png", size: 3 };
    expect(store.acceptUpload(origin, attachment)).toBe(true);
    expect(store.getDraft(task)).toBeUndefined();
    expect(store.getDraft(annotation)?.attachments).toEqual([attachment]);
  });

  it("isolates accounts and clears late results on disposal", () => {
    const disposed = vi.fn();
    const store = createDiscussionDraftStore({ owner, onDispose: disposed });
    store.patchDraft(task, { body: "private" });
    const origin = store.makeOrigin(annotation)!;
    store.dispose();

    expect(disposed).toHaveBeenCalledWith(owner);
    expect(store.isOwned(origin)).toBe(false);
    expect(store.getDraft(task)).toBeUndefined();
    expect(store.acceptDrawing(origin, line())).toBe(false);

    const other = createDiscussionDraftStore({
      owner: { sessionId: "session-b", userId: "user-b" },
    });
    expect(other.getDraft(task)).toBeUndefined();
  });

  it("fails closed immediately when the host auth lease is replaced", () => {
    let current = true;
    const store = createDiscussionDraftStore({
      owner,
      isOwnerCurrent: () => current,
    });
    store.patchDraft(task, { body: "old lease" });
    const origin = store.makeOrigin(annotation)!;
    current = false;
    expect(store.getDraft(task)).toBeUndefined();
    expect(store.isOwned(origin)).toBe(false);
    expect(() => store.patchDraft(task, { body: "must reject" })).toThrow();
    expect(store.acceptDrawing(origin, line())).toBe(false);
  });

  it("remembers an explicit send target per task", () => {
    const store = makeStore();
    expect(store.setSendTarget("project-a", "task-a", annotation)).toBe(true);
    expect(store.getSendTarget("project-a", "task-a")).toEqual(annotation);
    expect(store.getSendTarget("project-a", "task-b")).toBeUndefined();
  });
});
