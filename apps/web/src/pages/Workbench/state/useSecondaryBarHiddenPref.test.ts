import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockUpdatePreferences = vi.hoisted(() => vi.fn());
const mockPushToast = vi.hoisted(() => vi.fn());
const mockUser = vi.hoisted(() => ({
  current: { id: "u1", preferences: { ui: { secondary_bar_hidden: false } } },
}));

vi.mock("@/api/auth", () => ({
  authApi: { updatePreferences: mockUpdatePreferences },
}));
vi.mock("@/components/ui/Toast", () => ({
  useToastStore: { getState: () => ({ push: mockPushToast }) },
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: typeof mockUser.current }) => unknown) =>
      selector({ user: mockUser.current }),
    {
      getState: () => ({
        user: mockUser.current,
        setUser: (user: typeof mockUser.current) => {
          mockUser.current = user;
        },
      }),
    },
  ),
}));

import { useSecondaryBarHiddenPref } from "./useSecondaryBarHiddenPref";

describe("useSecondaryBarHiddenPref", () => {
  it("保存失败保留本地显隐并提示，再次切换重新保存", async () => {
    mockUpdatePreferences.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const { result, rerender } = renderHook(() => useSecondaryBarHiddenPref());
    act(() => result.current.setHidden(true));
    rerender();
    expect(result.current.hidden).toBe(true);
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith({
        kind: "error",
        msg: "二次推理面板设置未同步",
        sub: expect.stringContaining("当前显示状态已保留"),
      }),
    );
    act(() => result.current.setHidden(false));
    expect(mockUpdatePreferences).toHaveBeenLastCalledWith({ ui: { secondary_bar_hidden: false } });
  });
});
