import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { dashboardApi } from "./dashboard";
import { useAuthStore } from "@/stores/authStore";

const authUser = (id: string) => ({
  id,
  name: id,
  email: `${id}@test.local`,
  role: "super_admin",
  group_name: null,
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  useAuthStore.getState().setAuth("people-token", authUser("people-owner"));
  vi.restoreAllMocks();
});

describe("dashboardApi.exportPeople", () => {
  it("does not start a download when credentials change before the response completes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["people"])),
      headers: { get: () => "" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:people");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });

    const request = dashboardApi.exportPeople({ q: "Alice" });
    useAuthStore.getState().setAuth("replacement-token", authUser("replacement-owner"));

    await expect(request).rejects.toThrow("当前登录状态已改变");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
