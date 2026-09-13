import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn((..._args: unknown[]) => Promise.resolve({}));

vi.mock("./client", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
  },
}));

import { auditApi } from "./audit";

beforeEach(() => get.mockClear());

describe("auditApi", () => {
  it("preserves an empty detail value when a detail key is present", () => {
    auditApi.list({ detail_key: "role", detail_value: "", page: 1 });

    expect(get).toHaveBeenCalledWith("/audit-logs?detail_key=role&detail_value=&page=1");
  });

  it("does not start a download when credentials change before the response completes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["audit"])),
    });
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:audit");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });

    const { useAuthStore } = await import("@/stores/authStore");
    useAuthStore.getState().setAuth("audit-token", {
      id: "audit-owner",
      name: "Audit owner",
      email: "audit@test.local",
      role: "super_admin",
      group_name: null,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    });
    const request = auditApi.export({ detail_key: "role", detail_value: "" });
    useAuthStore.getState().setAuth("replacement-token", {
      id: "replacement-owner",
      name: "Replacement",
      email: "replacement@test.local",
      role: "super_admin",
      group_name: null,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    });

    await expect(request).rejects.toThrow("当前登录状态已改变");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
