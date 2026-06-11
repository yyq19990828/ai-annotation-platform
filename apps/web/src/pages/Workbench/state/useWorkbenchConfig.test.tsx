// v0.10.10 · I17.3 · useWorkbenchConfig 单测：项目级覆盖合并优先级 + lockedFields。
// v0.15.3 · 偏好四分树:用户偏好走 image.* / common.* 子树;项目级 rendering_config 保持平铺。

import type { ReactNode } from "react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPreferences = vi.hoisted(() => vi.fn());
const mockUpdatePreferences = vi.hoisted(() => vi.fn());
const mockAuthUser = vi.hoisted(() => ({
  current: { id: "u1" } as { id: string; preferences?: unknown },
}));

vi.mock("@/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/api/auth")>("@/api/auth");
  return {
    ...actual,
    authApi: {
      getPreferences: mockGetPreferences,
      updatePreferences: mockUpdatePreferences,
    },
  };
});

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: { user: unknown }) => unknown) =>
    selector({ user: mockAuthUser.current }),
}));

import { useWorkbenchConfig } from "./useWorkbenchConfig";

function wrapper({ children }: { children: ReactNode }) {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

describe("useWorkbenchConfig · v0.10.10 项目级覆盖", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockAuthUser.current = { id: "u1" };
    window.localStorage.clear();
  });

  it("首帧优先使用本地 layout 缓存，避免右栏按旧偏好闪开再收起", () => {
    window.localStorage.setItem("workbench.u1.rightOpen", "0");
    mockAuthUser.current = {
      id: "u1",
      preferences: {
        workbench: {
          layout: { rightOpen: true, rightWidth: 360 },
        },
      },
    };
    mockGetPreferences.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useWorkbenchConfig(), { wrapper });

    expect(result.current.loaded).toBe(false);
    expect(result.current.layout.rightOpen).toBe(false);
    expect(result.current.layout.rightWidth).toBe(360);
  });

  it("无项目覆盖时，config = DEFAULTS ∪ 用户偏好；lockedFields = []", async () => {
    mockGetPreferences.mockResolvedValue({
      workbench: { image: { smoothImage: false, cssImageFilter: "invert(1)" } },
    });
    const { result } = renderHook(() => useWorkbenchConfig(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.config.image.smoothImage).toBe(false);
    expect(result.current.config.image.cssImageFilter).toBe("invert(1)");
    // 未提供的字段走默认
    expect(result.current.config.image.controlPointsSize).toBe(6);
    expect(result.current.config.common.longTaskSampleRate).toBe(0.05);
    expect(result.current.lockedFields).toEqual([]);
  });

  it("项目级 rendering_config(平铺)覆盖用户级 image.* 子树；lockedFields 列出被覆盖字段", async () => {
    mockGetPreferences.mockResolvedValue({
      workbench: { image: { smoothImage: true, controlPointsSize: 10 } },
    });
    const { result } = renderHook(
      () =>
        useWorkbenchConfig({
          smoothImage: false,
          cssImageFilter: "grayscale(1)",
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // smoothImage 用户=true，项目=false → 项目胜
    expect(result.current.config.image.smoothImage).toBe(false);
    // cssImageFilter 用户未设，项目=grayscale → 项目胜
    expect(result.current.config.image.cssImageFilter).toBe("grayscale(1)");
    // controlPointsSize 项目未覆盖 → 沿用用户值 10
    expect(result.current.config.image.controlPointsSize).toBe(10);
    expect(result.current.lockedFields).toEqual(
      expect.arrayContaining(["smoothImage", "cssImageFilter"]),
    );
    expect(result.current.lockedFields).not.toContain("controlPointsSize");
  });

  it("项目级字段 = null/undefined 视作「不覆盖」，不进 lockedFields", async () => {
    mockGetPreferences.mockResolvedValue({
      workbench: { image: { smoothImage: true } },
    });
    const { result } = renderHook(
      () =>
        useWorkbenchConfig({
          smoothImage: null,
          cssImageFilter: undefined,
          controlPointsSize: 12,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.config.image.smoothImage).toBe(true); // 沿用用户
    expect(result.current.config.image.controlPointsSize).toBe(12); // 项目覆盖
    expect(result.current.lockedFields).toEqual(["controlPointsSize"]);
  });

  it("setLayout 立即更新本地状态与 localStorage，并 debounce 全量 workbench PATCH", async () => {
    mockGetPreferences.mockResolvedValue({
      workbench: { image: { smoothImage: false }, layout: { rightWidth: 300 } },
    });
    mockUpdatePreferences.mockImplementation(async (payload) => payload);
    const { result } = renderHook(() => useWorkbenchConfig(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    vi.useFakeTimers();
    act(() => {
      result.current.setLayout({
        rightWidth: 420,
        floatingDiscussion: {
          detached: true,
          x: 760,
          y: 180,
          w: 420,
          h: 560,
        },
        floatingInspector: {
          detached: true,
          x: 640,
          y: 80,
          w: 360,
          h: 600,
        },
      });
    });

    expect(result.current.layout.rightWidth).toBe(420);
    expect(result.current.layout.floatingInspector.detached).toBe(true);
    expect(result.current.layout.floatingDiscussion.detached).toBe(true);
    expect(window.localStorage.getItem("workbench.u1.rightWidth")).toBe("420");
    expect(window.localStorage.getItem("workbench.u1.floatingDiscussion")).toContain("\"detached\":true");
    expect(mockUpdatePreferences).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      workbench: expect.objectContaining({
        image: expect.objectContaining({ smoothImage: false }),
        layout: expect.objectContaining({
          rightWidth: 420,
          floatingDiscussion: expect.objectContaining({
            detached: true,
            h: 560,
          }),
          floatingInspector: expect.objectContaining({
            detached: true,
            w: 360,
          }),
        }),
      }),
    });
    vi.useRealTimers();
  });
});

describe("useWorkbenchConfig · v0.15.3 setFields + 多实例广播", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockAuthUser.current = { id: "u1" };
    window.localStorage.clear();
  });

  it("setFields 子树级 patch 立即生效并 debounce PATCH", async () => {
    mockGetPreferences.mockResolvedValue({ workbench: {} });
    mockUpdatePreferences.mockImplementation(async (payload) => payload);
    const { result } = renderHook(() => useWorkbenchConfig(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    vi.useFakeTimers();
    act(() => {
      result.current.setFields({ image: { controlPointsSize: 12 } });
    });
    // 本地立即生效（画布实时预览），未到 300ms 不发请求
    expect(result.current.config.image.controlPointsSize).toBe(12);
    // 其余字段不被 patch 踩掉
    expect(result.current.config.image.smoothImage).toBe(true);
    expect(mockUpdatePreferences).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      workbench: expect.objectContaining({
        image: expect.objectContaining({ controlPointsSize: 12 }),
      }),
    });
    vi.useRealTimers();
  });

  it("一个实例 setFields 后，另一实例(画布)同步收到新值 —— 抽屉实时预览链路", async () => {
    mockGetPreferences.mockResolvedValue({ workbench: {} });
    mockUpdatePreferences.mockImplementation(async (payload) => payload);
    const drawer = renderHook(() => useWorkbenchConfig(), { wrapper });
    const canvas = renderHook(() => useWorkbenchConfig(), { wrapper });
    await waitFor(() => expect(drawer.result.current.loaded).toBe(true));
    await waitFor(() => expect(canvas.result.current.loaded).toBe(true));

    act(() => {
      drawer.result.current.setFields({ image: { smoothImage: false } });
    });
    expect(canvas.result.current.config.image.smoothImage).toBe(false);
  });
});
