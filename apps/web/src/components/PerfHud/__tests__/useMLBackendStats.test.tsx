/**
 * v0.9.13 · useMLBackendStats WS smoke 测试 (PerfHud).
 *
 * 验证 URL 路径 /ws/ml-backend-stats?token=... 拼接正确, visible+token 才建连,
 * 收 backends 帧后 ring buffer 行为, 卸载清理.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuthStore } from "@/stores/authStore";

import { useMLBackendStats } from "../useMLBackendStats";
import { usePerfHudStore } from "../usePerfHudStore";

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
  triggerOpen() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  triggerMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

let originalWS: typeof globalThis.WebSocket | undefined;

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.useFakeTimers();
  originalWS = globalThis.WebSocket;
  Object.defineProperty(globalThis, "WebSocket", {
    value: MockWebSocket,
    writable: true,
    configurable: true,
  });
  useAuthStore.setState({ token: "tok-stat", user: null });
  usePerfHudStore.setState({ visible: true });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(globalThis, "WebSocket", {
    value: originalWS,
    writable: true,
    configurable: true,
  });
  usePerfHudStore.setState({ visible: false });
});

describe("useMLBackendStats", () => {
  it("visible+token 时拼 /ws/ml-backend-stats URL", () => {
    renderHook(() => useMLBackendStats());
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toMatch(/\/ws\/ml-backend-stats/);
    expect(MockWebSocket.instances[0].url).toContain("token=tok-stat");
  });

  it("不可见时不建连", () => {
    usePerfHudStore.setState({ visible: false });
    renderHook(() => useMLBackendStats());
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("无 token 不建连", () => {
    useAuthStore.setState({ token: null, user: null });
    renderHook(() => useMLBackendStats());
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("收 backends 帧后 snapshots 反映", () => {
    const { result } = renderHook(() => useMLBackendStats());
    act(() => {
      MockWebSocket.instances[0].triggerOpen();
      MockWebSocket.instances[0].triggerMessage({
        backends: [
          {
            backend_id: "b1",
            backend_name: "sam2",
            state: "connected",
          },
        ],
      });
    });
    expect(result.current.snapshots["b1"]?.backend_name).toBe("sam2");
  });

  it("ping 帧不触发 state 变化", () => {
    const { result } = renderHook(() => useMLBackendStats());
    act(() => {
      MockWebSocket.instances[0].triggerMessage({ type: "ping" });
    });
    expect(Object.keys(result.current.snapshots).length).toBe(0);
  });

  it("卸载主动 close", () => {
    const { unmount } = renderHook(() => useMLBackendStats());
    unmount();
    expect(MockWebSocket.instances[0].closedManually).toBe(true);
  });
});
