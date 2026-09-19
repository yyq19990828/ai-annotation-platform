import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getAccess = vi.hoisted(() => vi.fn());
vi.mock("@/api/projects", () => ({
  projectsApi: { getAccess },
}));

import { useProjectAccess, projectAccessQueryKey } from "./useProjectAccess";
import { useAuthStore } from "@/stores/authStore";

const ACCESS = {
  project_id: "p1",
  user_id: "u1",
  platform_role: "employee" as const,
  project_role: "annotator" as const,
  membership_id: "m1",
  membership_version: 3,
  access_kind: "member" as const,
  is_manager: false,
  capabilities: ["project.read", "task.read", "annotation.write"],
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useProjectAccess", () => {
  beforeEach(() => {
    getAccess.mockReset();
    useAuthStore.setState({ token: "tok", user: { id: "u1" } as never });
  });

  it("解析能力集合并暴露 projectRole / membershipVersion", async () => {
    getAccess.mockResolvedValue(ACCESS);
    const { result } = renderHook(() => useProjectAccess("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.access).toBeDefined());
    expect(result.current.hasCapability("annotation.write")).toBe(true);
    expect(result.current.hasCapability("annotation.write", "review.write")).toBe(false);
    expect(result.current.projectRole).toBe("annotator");
    expect(result.current.membershipVersion).toBe(3);
    expect(getAccess).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("账号或项目缺失时不发起请求", async () => {
    getAccess.mockResolvedValue(ACCESS);
    const { result } = renderHook(() => useProjectAccess(undefined), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(getAccess).not.toHaveBeenCalled();
    expect(result.current.hasCapability("annotation.write")).toBe(false);
  });

  it("请求失败时 isError 且不误报能力", async () => {
    getAccess.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useProjectAccess("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.hasCapability("task.read")).toBe(false);
  });

  it("cache key 绑定账号与项目", () => {
    expect(projectAccessQueryKey("p1", "u1", "t1")).toEqual(["project-access", "p1", "u1", "t1"]);
    expect(projectAccessQueryKey(undefined, "u1", "t1")[1]).toBeNull();
  });
});
