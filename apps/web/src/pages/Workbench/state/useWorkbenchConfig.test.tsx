// v0.10.10 · I17.3 · useWorkbenchConfig 单测：项目级覆盖合并优先级 + lockedFields。

import type { ReactNode } from "react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPreferences = vi.hoisted(() => vi.fn());

vi.mock("@/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/api/auth")>("@/api/auth");
  return {
    ...actual,
    authApi: {
      getPreferences: mockGetPreferences,
      updatePreferences: vi.fn(),
    },
  };
});

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "u1" } }),
}));

import { useWorkbenchConfig } from "./useWorkbenchConfig";

function wrapper({ children }: { children: ReactNode }) {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

describe("useWorkbenchConfig · v0.10.10 项目级覆盖", () => {
  beforeEach(() => vi.clearAllMocks());

  it("无项目覆盖时，config = DEFAULTS ∪ 用户偏好；lockedFields = []", async () => {
    mockGetPreferences.mockResolvedValue({
      workbench: { smoothImage: false, cssImageFilter: "invert(1)" },
    });
    const { result } = renderHook(() => useWorkbenchConfig(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.config.smoothImage).toBe(false);
    expect(result.current.config.cssImageFilter).toBe("invert(1)");
    // 未提供的字段走默认
    expect(result.current.config.controlPointsSize).toBe(6);
    expect(result.current.lockedFields).toEqual([]);
  });

  it("项目级 rendering_config 覆盖用户级；lockedFields 列出被覆盖字段", async () => {
    mockGetPreferences.mockResolvedValue({
      workbench: { smoothImage: true, controlPointsSize: 10 },
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
    expect(result.current.config.smoothImage).toBe(false);
    // cssImageFilter 用户未设，项目=grayscale → 项目胜
    expect(result.current.config.cssImageFilter).toBe("grayscale(1)");
    // controlPointsSize 项目未覆盖 → 沿用用户值 10
    expect(result.current.config.controlPointsSize).toBe(10);
    expect(result.current.lockedFields).toEqual(
      expect.arrayContaining(["smoothImage", "cssImageFilter"]),
    );
    expect(result.current.lockedFields).not.toContain("controlPointsSize");
  });

  it("项目级字段 = null/undefined 视作「不覆盖」，不进 lockedFields", async () => {
    mockGetPreferences.mockResolvedValue({
      workbench: { smoothImage: true },
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
    expect(result.current.config.smoothImage).toBe(true); // 沿用用户
    expect(result.current.config.controlPointsSize).toBe(12); // 项目覆盖
    expect(result.current.lockedFields).toEqual(["controlPointsSize"]);
  });
});
