import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../api/auth";
import type { OfflineOp } from "../pages/Workbench/state/offlineQueue";
import { useAuthStore } from "../stores/authStore";

const mockAuthApi = vi.hoisted(() => ({
  login: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
}));

const mockOfflineQueue = vi.hoisted(() => ({
  count: vi.fn(),
  drain: vi.fn(),
  replaceAnnotationId: vi.fn(),
}));

const mockTasksApi = vi.hoisted(() => ({
  createAnnotation: vi.fn(),
  updateAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
}));

vi.mock("../api/auth", () => ({
  authApi: mockAuthApi,
}));

vi.mock("../api/tasks", () => ({
  tasksApi: mockTasksApi,
}));

vi.mock("../pages/Workbench/state/offlineQueue", () => ({
  countDurably: mockOfflineQueue.count,
  drain: mockOfflineQueue.drain,
  replaceAnnotationId: mockOfflineQueue.replaceAnnotationId,
}));

import { useLogin, useLogout } from "./useAuth";

const fakeUser: MeResponse = {
  id: "1",
  email: "admin@example.com",
  name: "Admin",
  role: "super_admin",
  group_name: null,
  status: "active",
  created_at: "2026-05-10T00:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useLogin", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null });
    vi.clearAllMocks();
    mockOfflineQueue.count.mockResolvedValue(0);
    mockOfflineQueue.drain.mockResolvedValue({ ok: 0, failed: 0 });
    mockOfflineQueue.replaceAnnotationId.mockResolvedValue(undefined);
  });

  it("does not expose a token-only auth state while /auth/me is loading", async () => {
    const me = deferred<MeResponse>();
    mockAuthApi.login.mockResolvedValue({ access_token: "jwt", token_type: "bearer" });
    mockAuthApi.me.mockReturnValue(me.promise);

    const { result } = renderHook(() => useLogin(), { wrapper });

    act(() => {
      result.current.mutate({ email: "admin", password: "123456" });
    });

    await waitFor(() => expect(mockAuthApi.me).toHaveBeenCalled());
    expect(localStorage.getItem("token")).toBe("jwt");
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null });

    act(() => {
      me.resolve(fakeUser);
    });

    await waitFor(() =>
      expect(useAuthStore.getState()).toMatchObject({ token: "jwt", user: fakeUser }),
    );
  });

  it("clears the temporary token if /auth/me fails", async () => {
    mockAuthApi.login.mockResolvedValue({ access_token: "jwt", token_type: "bearer" });
    mockAuthApi.me.mockRejectedValue(new Error("me failed"));

    const { result } = renderHook(() => useLogin(), { wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ email: "admin", password: "123456" });
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("me failed");
    expect(localStorage.getItem("token")).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null });
  });
});

describe("useLogout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.getState().setAuth("jwt", fakeUser);
    mockOfflineQueue.count.mockResolvedValue(0);
    mockOfflineQueue.drain.mockResolvedValue({ ok: 0, failed: 0 });
    mockAuthApi.logout.mockResolvedValue(undefined);
  });

  it("没有待同步操作时直接退出", async () => {
    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current.requestLogout();
    });

    expect(mockOfflineQueue.count).toHaveBeenCalledWith({
      userId: fakeUser.id,
      isCurrent: expect.any(Function),
    });
    expect(mockAuthApi.logout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("读取队列期间账号切换时不清理新账号", async () => {
    const pendingCount = deferred<number>();
    mockOfflineQueue.count.mockReturnValue(pendingCount.promise);
    const { result } = renderHook(() => useLogout(), { wrapper });
    let request: Promise<void> | undefined;

    act(() => {
      request = result.current.requestLogout();
    });
    await waitFor(() => expect(mockOfflineQueue.count).toHaveBeenCalled());
    const nextUser = { ...fakeUser, id: "new-user" };
    useAuthStore.setState({ token: "new-jwt", user: nextUser });
    pendingCount.resolve(1);
    await act(async () => {
      await request;
    });

    expect(mockAuthApi.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toEqual(nextUser);
  });

  it("登出请求等待期间账号切换时不清理新账号", async () => {
    const logoutRequest = deferred<void>();
    mockOfflineQueue.count.mockResolvedValue(0);
    mockAuthApi.logout.mockReturnValue(logoutRequest.promise);
    const { result } = renderHook(() => useLogout(), { wrapper });
    let request: Promise<void> | undefined;

    act(() => {
      request = result.current.requestLogout();
    });
    await waitFor(() => expect(mockAuthApi.logout).toHaveBeenCalled());
    const nextUser = { ...fakeUser, id: "new-user" };
    useAuthStore.setState({ token: "new-jwt", user: nextUser });
    logoutRequest.resolve();
    await act(async () => {
      await request;
    });

    expect(useAuthStore.getState().user).toEqual(nextUser);
  });

  it("有待同步操作时提供保留本机记录并退出", async () => {
    mockOfflineQueue.count.mockResolvedValue(2);
    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current.requestLogout();
    });
    expect(result.current.prompt).toEqual({ userId: fakeUser.id, pendingCount: 2 });
    expect(mockAuthApi.logout).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirmLogout("keep");
    });

    expect(mockOfflineQueue.drain).not.toHaveBeenCalled();
    expect(mockAuthApi.logout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("同步成功后退出", async () => {
    mockOfflineQueue.count.mockResolvedValue(1);
    const queued: Extract<OfflineOp, { kind: "update" }> = {
      kind: "update",
      id: "op-1",
      taskId: "task-1",
      userId: fakeUser.id,
      annotationId: "ann-1",
      payload: { class_name: "car" },
      ts: 1,
    };
    mockOfflineQueue.drain.mockImplementation(async (handler) => {
      await handler(queued);
      mockOfflineQueue.count.mockResolvedValue(0);
      return { ok: 1, failed: 0 };
    });
    mockTasksApi.updateAnnotation.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current.requestLogout();
    });
    await act(async () => {
      await result.current.confirmLogout("sync");
    });

    expect(mockTasksApi.updateAnnotation).toHaveBeenCalledWith("task-1", "ann-1", {
      class_name: "car",
    });
    expect(mockOfflineQueue.drain).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ userId: fakeUser.id }),
    );
    expect(mockAuthApi.logout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("同步失败时保留当前账号和队列，并允许明确选择保留记录退出", async () => {
    mockOfflineQueue.count.mockResolvedValue(1);
    mockOfflineQueue.drain.mockRejectedValue(new Error("network unavailable"));
    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current.requestLogout();
    });
    await act(async () => {
      await result.current.confirmLogout("sync");
    });

    expect(result.current.prompt).toEqual({ userId: fakeUser.id, pendingCount: 1 });
    expect(result.current.syncError).toContain("network unavailable");
    expect(mockAuthApi.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toEqual(fakeUser);

    await act(async () => {
      await result.current.confirmLogout("keep");
    });
    expect(mockAuthApi.logout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("退出请求失败也清理本地认证，但不清空离线队列", async () => {
    mockOfflineQueue.count.mockResolvedValue(1);
    mockAuthApi.logout.mockRejectedValue(new Error("token expired"));
    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current.requestLogout();
    });
    await act(async () => {
      await result.current.confirmLogout("keep");
    });

    expect(useAuthStore.getState().user).toBeNull();
    expect(mockOfflineQueue.drain).not.toHaveBeenCalled();
  });

  it("读取本机记录失败时先说明未知状态，不直接退出", async () => {
    mockOfflineQueue.count.mockRejectedValue(new Error("IndexedDB unavailable"));
    const { result } = renderHook(() => useLogout(), { wrapper });
    await act(async () => {
      await result.current.requestLogout();
    });
    expect(result.current.prompt).toEqual({ userId: fakeUser.id, pendingCount: null });
    expect(result.current.syncError).toContain("无法读取");
    expect(mockAuthApi.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toEqual(fakeUser);
    await act(async () => {
      await result.current.confirmLogout("keep");
    });
    expect(mockAuthApi.logout).toHaveBeenCalledOnce();
  });

  it("其他标签页换了凭证后不会同步旧账号或登出新账号", async () => {
    mockOfflineQueue.count.mockResolvedValue(1);
    const { result } = renderHook(() => useLogout(), { wrapper });
    await act(async () => {
      await result.current.requestLogout();
    });
    localStorage.setItem("token", "other-tab-token");
    await act(async () => {
      await result.current.confirmLogout("sync");
    });
    expect(mockOfflineQueue.drain).not.toHaveBeenCalled();
    expect(mockAuthApi.logout).not.toHaveBeenCalled();
    expect(localStorage.getItem("token")).toBe("other-tab-token");
  });
});
