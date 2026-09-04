import { beforeEach, describe, expect, it } from "vitest";

import {
  beginPointCloudNavigationTrace,
  fingerprintPointCloudResource,
  getPointCloudNavigationTraceSnapshot,
  pointCloudNavigationGenerationForTask,
  publishPointCloudNavigationTrace,
  recordPointCloudCameraResourceResult,
  registerPointCloudNavigationResource,
  resetPointCloudNavigationTraceForTests,
} from "./pointCloudNavigationDiagnostics";

describe("pointCloudNavigationDiagnostics", () => {
  beforeEach(() => {
    resetPointCloudNavigationTraceForTests();
  });

  it("keeps one generation across timeline, shell and resource boundaries", () => {
    const generation = beginPointCloudNavigationTrace({
      source: "timeline",
      targetTaskId: "task-24",
      frameIndex: 24,
    });
    publishPointCloudNavigationTrace({
      source: "shell",
      type: "identity",
      taskId: "task-24",
      requestedTaskId: "task-24",
      resolvedTaskId: "task-24",
    });
    const resourceKey = registerPointCloudNavigationResource({
      taskId: "task-24",
      frameIndex: 24,
      url: "https://storage.invalid/private/frame-24.pcd?signature=secret",
      kind: "point-cloud",
    });

    const snapshot = getPointCloudNavigationTraceSnapshot();
    expect(pointCloudNavigationGenerationForTask("task-24")).toBe(generation);
    expect(snapshot?.events).toHaveLength(2);
    expect(snapshot?.events.every((event) => event.generation === generation)).toBe(true);
    expect(resourceKey).toMatch(/^resource-[0-9a-f]{8}$/);
    expect(JSON.stringify(snapshot)).not.toContain("signature=secret");
    expect(JSON.stringify(snapshot)).not.toContain("frame-24.pcd");
  });

  it("starts a new generation for every user intent and retains task ownership", () => {
    const first = beginPointCloudNavigationTrace({
      source: "timeline",
      targetTaskId: "task-20",
      frameIndex: 20,
    });
    const second = beginPointCloudNavigationTrace({
      source: "timeline",
      targetTaskId: "task-24",
      frameIndex: 24,
    });

    expect(second).toBe(first + 1);
    expect(pointCloudNavigationGenerationForTask("task-20")).toBe(first);
    expect(pointCloudNavigationGenerationForTask("task-24")).toBe(second);
    expect(getPointCloudNavigationTraceSnapshot()?.activeGeneration).toBe(second);
  });

  it("records load events only for registered camera resources", () => {
    const cameraUrl = "https://storage.invalid/private/camera.jpg?signature=secret";
    beginPointCloudNavigationTrace({
      source: "timeline",
      targetTaskId: "task-1",
      frameIndex: 1,
    });
    registerPointCloudNavigationResource({
      taskId: "task-1",
      frameIndex: 1,
      url: cameraUrl,
      kind: "camera",
      cameraRole: "CAM_FRONT",
    });
    recordPointCloudCameraResourceResult(cameraUrl, "load");

    const events = getPointCloudNavigationTraceSnapshot()?.events ?? [];
    const event = events[events.length - 1];
    expect(event).toMatchObject({
      source: "camera",
      type: "image-load",
      taskId: "task-1",
      frameIndex: 1,
      cameraRole: "CAM_FRONT",
    });
    expect(JSON.stringify(event)).not.toContain(cameraUrl);
  });

  it("keeps a fixed-size event ring", () => {
    beginPointCloudNavigationTrace({ source: "shell", targetTaskId: "task-1" });
    for (let index = 0; index < 400; index += 1) {
      publishPointCloudNavigationTrace({
        source: "shell",
        type: "identity",
        taskId: "task-1",
        status: String(index),
      });
    }
    const events = getPointCloudNavigationTraceSnapshot()?.events ?? [];
    expect(events).toHaveLength(320);
    expect(events[0]?.sequence).toBeGreaterThan(1);
    expect(events[events.length - 1]?.status).toBe("399");
  });

  it("returns stable but different resource fingerprints", () => {
    expect(fingerprintPointCloudResource("a")).toBe(fingerprintPointCloudResource("a"));
    expect(fingerprintPointCloudResource("a")).not.toBe(fingerprintPointCloudResource("b"));
  });
});
