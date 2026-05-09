/**
 * v0.8.8 · useNotificationSocket 单测：reauth + 重连关键路径。
 *
 * 不打 真实 WS server，用 MockWebSocket 替换 globalThis.WebSocket，
 * 然后通过 instance 的 dispatchEvent / onclose 模拟服务端关闭码。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";

const refreshMock = vi.fn();
vi.mock("@/api/auth", () => ({
  authApi: {
    refresh: () => refreshMock(),
  },
}));

import { useNotificationSocket } from "../useNotificationSocket";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0;
  closedManually = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close() {
    this.closedManually = true;
  }
  // 测试钩子
  triggerClose(code: number) {
    this.onclose?.({ code, wasClean: false } as CloseEvent);
  }
  triggerOpen() {
    this.onopen?.(new Event("open"));
  }
}

let originalWS: typeof globalThis.WebSocket | undefined;

beforeEach(() => {
  MockWebSocket.instances = [];
  refreshMock.mockReset();
  vi.useFakeTimers();
  originalWS = globalThis.WebSocket;
  Object.defineProperty(globalThis, "WebSocket", {
    value: MockWebSocket,
    writable: true,
    configurable: true,
  });
  useAuthStore.setState({ token: "old-token", user: null });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(globalThis, "WebSocket", {
    value: originalWS,
    writable: true,
    configurable: true,
  });
});

function wrap() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useNotificationSocket", () => {
  it("挂载时用 token 拼接 ws URL 并建立连接", () => {
    renderHook(() => useNotificationSocket(), { wrapper: wrap() });
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toContain("token=old-token");
    // v0.9.11 修复: WS URL 从错误的 /api/v1/ws/notifications 改为 /ws/notifications
    // (ws_router 在 main.py 是 app.include_router(ws_router) 无 prefix).
    expect(MockWebSocket.instances[0].url).toMatch(/\/ws\/notifications/);
    expect(MockWebSocket.instances[0].url).not.toMatch(/\/api\/v1\/ws\/notifications/);
  });

  it("token 为空时不建立连接", () => {
    useAuthStore.setState({ token: null, user: null });
    renderHook(() => useNotificationSocket(), { wrapper: wrap() });
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("close code 1008 时调 /auth/refresh 并用新 token 重连", async () => {
    refreshMock.mockResolvedValue({
      access_token: "new-token",
      token_type: "bearer",
    });

    renderHook(() => useNotificationSocket(), { wrapper: wrap() });
    expect(MockWebSocket.instances.length).toBe(1);

    // 模拟 1008（鉴权过期）关闭
    await act(async () => {
      MockWebSocket.instances[0].triggerClose(1008);
      // 让 .then 回调跑（refresh 是异步）
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().token).toBe("new-token");

    // scheduleRetry 1s 后用新 token 重连
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(MockWebSocket.instances.length).toBe(2);
    expect(MockWebSocket.instances[1].url).toContain("token=new-token");
  });

  it("close code 1008 + refresh 失败 → 不再重连", async () => {
    refreshMock.mockRejectedValue(new Error("token revoked"));

    renderHook(() => useNotificationSocket(), { wrapper: wrap() });
    await act(async () => {
      MockWebSocket.instances[0].triggerClose(1008);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(refreshMock).toHaveBeenCalled();

    // catch 后 closedManually = true → schedule 不会触发新连接
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("普通 close（非鉴权码）走 backoff 重连，不调 refresh", async () => {
    renderHook(() => useNotificationSocket(), { wrapper: wrap() });
    act(() => {
      MockWebSocket.instances[0].triggerClose(1006);
    });
    expect(refreshMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("卸载时手动 close、不再 retry", () => {
    const { unmount } = renderHook(() => useNotificationSocket(), { wrapper: wrap() });
    unmount();
    expect(MockWebSocket.instances[0].closedManually).toBe(true);
  });
});
