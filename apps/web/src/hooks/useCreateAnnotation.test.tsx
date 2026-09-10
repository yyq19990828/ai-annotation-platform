import { createElement, type ReactNode } from "react";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationPayload } from "@/api/tasks";
import type { AnnotationResponse } from "@/types";
import type { MeResponse } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";

const createAnnotationMock = vi.hoisted(() => vi.fn());
vi.mock("../api/tasks", () => ({ tasksApi: { createAnnotation: createAnnotationMock } }));

import { useCreateAnnotation } from "./useTasks";

type Owner = { taskId: string | undefined; videoSegmentId?: string | null };
const A: Owner = { taskId: "task-a", videoSegmentId: "segment-a" };
const B: Owner = { taskId: "task-b", videoSegmentId: "segment-b" };
const otherSegment: Owner = { taskId: "task-a", videoSegmentId: "segment-other" };
const clients: QueryClient[] = [];
const completions: Promise<unknown>[] = [];
const releasePending: Array<() => void> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  releasePending.push(() => reject(new Error("Test finished")));
  return { promise, resolve, reject };
}

function queryKey(owner: Owner) {
  return owner.videoSegmentId
    ? ["annotations", owner.taskId, owner.videoSegmentId]
    : ["annotations", owner.taskId];
}

function payload(className = "car"): AnnotationPayload {
  return {
    class_name: className,
    annotation_type: "bbox",
    geometry: { type: "bbox", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    attributes: { checked: false },
  };
}

function annotation(id: string, owner: Owner, input = payload()): AnnotationResponse {
  return {
    id,
    task_id: owner.taskId!,
    video_segment_id: owner.videoSegmentId ?? null,
    project_id: null,
    user_id: null,
    source: "manual",
    annotation_type: input.annotation_type ?? "bbox",
    class_name: input.class_name,
    geometry: input.geometry,
    confidence: 1,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    attributes: input.attributes,
    created_at: "2026-09-07T00:00:00Z",
    updated_at: null,
  };
}

function setup(owner: Owner = A, mutationCache?: MutationCache) {
  const client = new QueryClient({
    mutationCache,
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return {
    client,
    ...renderHook(
      ({ taskId, videoSegmentId }: Owner) => useCreateAnnotation(taskId, videoSegmentId),
      {
        initialProps: owner,
        wrapper,
      },
    ),
  };
}

function submit(mutation: ReturnType<typeof useCreateAnnotation>, input = payload()) {
  let promise!: Promise<AnnotationResponse>;
  act(() => {
    promise = mutation.mutateAsync(input);
  });
  completions.push(promise);
  void promise.catch(() => undefined);
  return promise;
}

beforeEach(() => {
  createAnnotationMock.mockReset();
  useAuthStore.getState().setAuth("test-token", { id: "test-owner" } as MeResponse);
});
afterEach(async () => {
  onlineManager.setOnline(true);
  cleanup();
  releasePending.splice(0).forEach((release) => release());
  await Promise.allSettled(completions.splice(0));
  clients.splice(0).forEach((client) => client.clear());
  useAuthStore.getState().logout();
  vi.restoreAllMocks();
});

it("does not create or install an optimistic row after another account logs in during cancellation", async () => {
  const { result, client } = setup();
  const gate = deferred<void>();
  const cancel = vi.spyOn(client, "cancelQueries").mockReturnValueOnce(gate.promise);
  const request = submit(result.current);
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  useAuthStore.getState().setAuth("next-token", { id: "next-owner" } as MeResponse);
  const next = annotation("next-owner-row", A);
  client.setQueryData(queryKey(A), [next]);
  gate.resolve();
  await expect(request).rejects.toMatchObject({ name: "AnnotationMutationOwnerChangedError" });
  expect(createAnnotationMock).not.toHaveBeenCalled();
  expect(client.getQueryData(queryKey(A))).toEqual([next]);
});

it("offline creation rejects to the durable queue owner instead of pausing forever", async () => {
  onlineManager.setOnline(false);
  const error = new TypeError("offline");
  createAnnotationMock.mockRejectedValue(error);
  const { result, client } = setup();
  const pending = submit(result.current);
  await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(1));
  await expect(pending).rejects.toBe(error);
  expect(client.getQueryData(queryKey(A))).toEqual([]);
});

describe("useCreateAnnotation submission ownership", () => {
  it.each(["query cancellation", "global onMutate"] as const)(
    "keeps the original task, segment and optimistic cache while awaiting %s",
    async (pauseAt) => {
      const gate = deferred<void>();
      const response = deferred<AnnotationResponse>();
      createAnnotationMock.mockReturnValue(response.promise);
      const onMutate = vi.fn(() => gate.promise);
      const { client, result, rerender } = setup(
        A,
        pauseAt === "global onMutate" ? new MutationCache({ onMutate }) : undefined,
      );
      const cancel = vi.spyOn(client, "cancelQueries");
      if (pauseAt === "query cancellation") cancel.mockReturnValueOnce(gate.promise);
      const oldA = annotation("old-a", A);
      const oldB = annotation("old-b", B);
      client.setQueryData(queryKey(A), [oldA]);
      client.setQueryData(queryKey(B), [oldB]);
      const input = payload();
      const pending = submit(result.current, input);
      await waitFor(() =>
        expect(pauseAt === "global onMutate" ? onMutate : cancel).toHaveBeenCalledTimes(1),
      );
      expect(createAnnotationMock).not.toHaveBeenCalled();

      rerender(B);
      await act(async () => gate.resolve());
      await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(1));
      expect(createAnnotationMock).toHaveBeenCalledWith(A.taskId, {
        ...input,
        video_segment_id: A.videoSegmentId,
      });
      expect(client.getQueryData<AnnotationResponse[]>(queryKey(A))).toEqual([
        oldA,
        expect.objectContaining({ task_id: A.taskId, video_segment_id: A.videoSegmentId }),
      ]);
      expect(client.getQueryData(queryKey(B))).toEqual([oldB]);
      await act(async () => {
        response.resolve(annotation("created-a", A));
        await pending;
      });
    },
  );

  it.each([B, otherSegment])(
    "reconciles success into the submitted cache after switching to $taskId/$videoSegmentId",
    async (next) => {
      const response = deferred<AnnotationResponse>();
      createAnnotationMock.mockReturnValue(response.promise);
      const { client, result, rerender } = setup();
      const oldA = annotation("old-a", A);
      const oldNext = annotation("old-next", next);
      client.setQueryData(queryKey(A), [oldA]);
      client.setQueryData(queryKey(next), [oldNext]);
      const pending = submit(result.current);
      await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(1));
      const tmp = client.getQueryData<AnnotationResponse[]>(queryKey(A))![1];

      rerender(next);
      const created = annotation("created-a", A);
      await act(async () => {
        response.resolve(created);
        await pending;
      });
      expect(client.getQueryData(queryKey(A))).toEqual([
        oldA,
        { ...created, render_key: tmp.render_key },
      ]);
      expect(client.getQueryData(queryKey(next))).toEqual([oldNext]);
    },
  );

  it.each([B, otherSegment])(
    "rolls back only the submitted cache after switching to $taskId/$videoSegmentId",
    async (next) => {
      const response = deferred<AnnotationResponse>();
      createAnnotationMock.mockReturnValue(response.promise);
      const { client, result, rerender } = setup();
      const oldA = annotation("old-a", A);
      const oldNext = annotation("old-next", next);
      client.setQueryData(queryKey(A), [oldA]);
      client.setQueryData(queryKey(next), [oldNext]);
      const pending = submit(result.current);
      await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(1));

      rerender(next);
      const error = new Error("Request rejected");
      await act(async () => {
        response.reject(error);
        await expect(pending).rejects.toBe(error);
      });
      expect(client.getQueryData(queryKey(A))).toEqual([oldA]);
      expect(client.getQueryData(queryKey(next))).toEqual([oldNext]);
    },
  );

  it("keeps later successful and pending creates when an earlier A → B → A request fails", async () => {
    const first = deferred<AnnotationResponse>();
    const second = deferred<AnnotationResponse>();
    const third = deferred<AnnotationResponse>();
    createAnnotationMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const { client, result, rerender } = setup();
    const oldA = annotation("old-a", A);
    const oldB = annotation("old-b", B);
    client.setQueryData(queryKey(A), [oldA]);
    client.setQueryData(queryKey(B), [oldB]);
    const firstPending = submit(result.current, payload("first"));
    await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(1));

    rerender(B);
    rerender(A);
    const secondPending = submit(result.current, payload("second"));
    await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(2));
    const thirdPending = submit(result.current, payload("third"));
    await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(3));
    const pendingThird = client
      .getQueryData<AnnotationResponse[]>(queryKey(A))!
      .find((item) => item.class_name === "third")!;
    const createdSecond = annotation("created-second", A, payload("second"));
    await act(async () => {
      second.resolve(createdSecond);
      await secondPending;
      first.reject(new Error("First request rejected"));
      await expect(firstPending).rejects.toThrow("First request rejected");
    });

    expect(client.getQueryData(queryKey(A))).toEqual([
      oldA,
      expect.objectContaining(createdSecond),
      pendingThird,
    ]);
    expect(client.getQueryData(queryKey(B))).toEqual([oldB]);
    await act(async () => {
      third.resolve(annotation("created-third", A, payload("third")));
      await thirdPending;
    });
  });

  it("reconciles success after returning to A and refreshing away its optimistic row", async () => {
    const response = deferred<AnnotationResponse>();
    createAnnotationMock.mockReturnValue(response.promise);
    const { client, result, rerender } = setup();
    const pending = submit(result.current);
    await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(1));
    rerender(B);
    rerender(A);
    const refreshed = annotation("refreshed-a", A);
    client.setQueryData(queryKey(A), [refreshed]);
    const created = annotation("created-a", A);
    await act(async () => {
      response.resolve(created);
      await pending;
    });
    expect(client.getQueryData(queryKey(A))).toEqual([refreshed, expect.objectContaining(created)]);
  });

  it("removes its optimistic row even when no cache existed before the failed create", async () => {
    const response = deferred<AnnotationResponse>();
    createAnnotationMock.mockReturnValue(response.promise);
    const { client, result } = setup();
    const pending = submit(result.current);
    await waitFor(() =>
      expect(client.getQueryData<AnnotationResponse[]>(queryKey(A))).toHaveLength(1),
    );
    await act(async () => {
      response.reject(new Error("Request rejected"));
      await expect(pending).rejects.toThrow("Request rejected");
    });
    expect(client.getQueryData(queryKey(A))).toEqual([]);
  });

  it("keeps a refetched annotation instead of duplicating or replacing it with an older create response", async () => {
    const response = deferred<AnnotationResponse>();
    createAnnotationMock.mockReturnValue(response.promise);
    const { client, result } = setup();
    const pending = submit(result.current);
    await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(1));
    const optimistic = client.getQueryData<AnnotationResponse[]>(queryKey(A))![0];
    const created = annotation("created-a", A);
    const updated = { ...created, class_name: "updated", version: 2 };
    client.setQueryData(queryKey(A), [optimistic, updated]);
    await act(async () => {
      response.resolve(created);
      await pending;
    });
    expect(client.getQueryData(queryKey(A))).toEqual([updated]);
  });

  it("binds retained submit functions to their original task and preserves public callbacks and variables", async () => {
    const response = deferred<AnnotationResponse>();
    createAnnotationMock.mockReturnValue(response.promise);
    const { client, result, rerender } = setup(A);
    const createFromA = result.current.mutate;
    rerender(B);
    const input = payload();
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    act(() => expect(createFromA(input, { onSuccess, onSettled })).toBeUndefined());
    await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledTimes(1));
    expect(createAnnotationMock).toHaveBeenCalledWith(A.taskId, {
      ...input,
      video_segment_id: A.videoSegmentId,
    });
    await waitFor(() => expect(result.current.variables).toBe(input));
    const created = annotation("created-a", A);
    await act(async () => response.resolve(created));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith(
      created,
      input,
      expect.objectContaining({ tmpId: expect.any(String) }),
      expect.objectContaining({ client }),
    );
    expect(onSettled).toHaveBeenCalledWith(
      created,
      null,
      input,
      expect.any(Object),
      expect.objectContaining({ client }),
    );
    expect(client.getQueryData(queryKey(A))).toEqual([expect.objectContaining(created)]);
    expect(client.getQueryData(queryKey(B))).toBeUndefined();
  });

  it("keeps mutateAsync rejection and per-call error/settled callback arguments", async () => {
    const response = deferred<AnnotationResponse>();
    createAnnotationMock.mockReturnValue(response.promise);
    const owner = { taskId: "image-task" };
    const { client, result, rerender } = setup(owner);
    const input = payload();
    const onError = vi.fn();
    const onSettled = vi.fn();
    let pending!: Promise<AnnotationResponse>;
    act(() => {
      pending = result.current.mutateAsync(input, { onError, onSettled });
    });
    completions.push(pending);
    void pending.catch(() => undefined);
    await waitFor(() => expect(createAnnotationMock).toHaveBeenCalledWith(owner.taskId, input));
    rerender(B);
    const error = new Error("Request rejected");
    await act(async () => {
      response.reject(error);
      await expect(pending).rejects.toBe(error);
    });
    expect(onError).toHaveBeenCalledWith(
      error,
      input,
      expect.objectContaining({ tmpId: expect.any(String) }),
      expect.objectContaining({ client }),
    );
    expect(onSettled).toHaveBeenCalledWith(
      undefined,
      error,
      input,
      expect.any(Object),
      expect.objectContaining({ client }),
    );
    expect(client.getQueryData(queryKey(owner))).toEqual([]);
    expect(client.getQueryData(queryKey(B))).toBeUndefined();
  });
});
