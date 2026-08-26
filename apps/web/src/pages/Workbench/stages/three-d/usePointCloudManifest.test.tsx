import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskPointCloudManifestResponse } from "@/api/generated";
import {
  getPointCloudNavigationTraceSnapshot,
  resetPointCloudNavigationTraceForTests,
} from "@/utils/pointCloudNavigationDiagnostics";

const getPointCloudManifestMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/tasks", () => ({
  tasksApi: { getPointCloudManifest: getPointCloudManifestMock },
}));

import { usePointCloudManifest } from "./usePointCloudManifest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function manifest(taskId: string, frameIndex: number): TaskPointCloudManifestResponse {
  return {
    task_id: taskId,
    frame_index: frameIndex,
    point_cloud_url: `https://storage.invalid/${taskId}.pcd?signature=secret`,
    point_cloud_format: "pcd",
    expires_in: 300,
    cameras: [
      {
        dataset_item_id: `${taskId}-camera`,
        name: "front",
        role: "CAM_FRONT",
        image_url: `https://storage.invalid/${taskId}.jpg?signature=secret`,
      },
    ],
  };
}

describe("usePointCloudManifest navigation diagnostics", () => {
  beforeEach(() => {
    getPointCloudManifestMock.mockReset();
    resetPointCloudNavigationTraceForTests();
  });

  it("passes the query abort signal to the manifest request and prevents a stale response", async () => {
    const first = deferred<TaskPointCloudManifestResponse>();
    const second = deferred<TaskPointCloudManifestResponse>();
    getPointCloudManifestMock.mockImplementation((taskId: string, init?: RequestInit) => {
      const request = taskId === "task-1" ? first : second;
      init?.signal?.addEventListener(
        "abort",
        () => request.reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
      return request.promise;
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender } = renderHook(({ taskId }) => usePointCloudManifest(taskId, true), {
      initialProps: { taskId: "task-1" },
      wrapper,
    });

    await waitFor(() =>
      expect(getPointCloudManifestMock).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    rerender({ taskId: "task-2" });
    await waitFor(() =>
      expect(getPointCloudManifestMock).toHaveBeenCalledWith(
        "task-2",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    second.resolve(manifest("task-2", 2));

    await waitFor(() => {
      const events = getPointCloudNavigationTraceSnapshot()?.events ?? [];
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "manifest",
            type: "signal-abort",
            taskId: "task-1",
          }),
          expect.objectContaining({
            source: "manifest",
            type: "request-aborted",
            taskId: "task-1",
          }),
          expect.objectContaining({
            source: "manifest",
            type: "request-success",
            taskId: "task-2",
            frameIndex: 2,
          }),
        ]),
      );
      expect(events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "manifest",
            type: "response-after-abort",
            taskId: "task-1",
          }),
        ]),
      );
    });
    expect(JSON.stringify(getPointCloudNavigationTraceSnapshot())).not.toContain(
      "signature=secret",
    );
  });
});
