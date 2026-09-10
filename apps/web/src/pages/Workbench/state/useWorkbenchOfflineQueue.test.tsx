import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ online: true, drain: vi.fn(), update: vi.fn() }));
vi.mock("@/api/tasks", () => ({ tasksApi: { updateAnnotation: state.update } }));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => ({
    online: state.online,
    queueCount: 1,
    queueReady: true,
    queueReadError: null,
  }),
}));
vi.mock("@/stores/authStore", () => ({ isCurrentAuthOwner: () => true }));
vi.mock("./offlineQueue", () => ({
  drain: state.drain,
  isOfflineCandidate: () => true,
  replaceAnnotationId: vi.fn(),
}));
import { useWorkbenchOfflineQueue } from "./useWorkbenchOfflineQueue";

it("keeps a failed operation without a render-driven retry loop and retries on reconnection", async () => {
  const client = new QueryClient();
  state.drain.mockResolvedValue({ ok: 0, failed: 0 }).mockResolvedValueOnce({ ok: 0, failed: 1 });
  const { result, rerender, unmount } = renderHook(() =>
    useWorkbenchOfflineQueue({
      userId: "alice",
      taskId: "task",
      queryClient: client,
      pushToast: vi.fn(),
      history: { replaceAnnotationId: vi.fn() },
    }),
  );
  await waitFor(() => expect(result.current.syncError).toBe("部分离线操作同步失败"));
  rerender();
  await act(async () => {
    await Promise.resolve();
  });
  expect(state.drain).toHaveBeenCalledTimes(1);
  state.online = false;
  rerender();
  state.online = true;
  rerender();
  await waitFor(() => expect(state.drain).toHaveBeenCalledTimes(2));
  unmount();
  client.clear();
});

it("replays a versioned offline update with its original precondition", async () => {
  const client = new QueryClient();
  const op = {
    kind: "update" as const,
    id: "operation",
    taskId: "task",
    userId: "alice",
    annotationId: "mask",
    payload: { attributes: { reviewed: true } },
    etag: 'W/"7"',
    ts: 1,
  };
  state.online = true;
  state.update.mockReset().mockResolvedValue(undefined);
  state.drain.mockReset().mockImplementationOnce(async (handler) => {
    await handler(op);
    return { ok: 1, failed: 0 };
  });
  const { unmount } = renderHook(() =>
    useWorkbenchOfflineQueue({
      userId: "alice",
      taskId: "task",
      queryClient: client,
      pushToast: vi.fn(),
      history: { replaceAnnotationId: vi.fn() },
    }),
  );
  try {
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.update).toHaveBeenCalledWith("task", "mask", op.payload, op.etag);
  } finally {
    unmount();
    client.clear();
  }
});
