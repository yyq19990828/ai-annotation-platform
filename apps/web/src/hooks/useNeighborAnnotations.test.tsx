/**
 * v0.14.1 · useNeighborAnnotations 单测: group_id 短路 + 跨 task 拉取 + group 过滤。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/api/tasks", () => ({
  tasksApi: {
    getAnnotations: vi.fn(),
  },
}));

import { tasksApi } from "@/api/tasks";
import { useNeighborAnnotations } from "./useNeighborAnnotations";

const mockGetAnnotations = tasksApi.getAnnotations as unknown as ReturnType<
  typeof vi.fn
>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function ann(id: string, group_id: number | null) {
  return { id, task_id: "x", group_id, geometry: { type: "box_3d" } } as any;
}

describe("useNeighborAnnotations", () => {
  beforeEach(() => mockGetAnnotations.mockReset());

  it("selectedGroupId 为 null → 短路不发请求", () => {
    renderHook(() => useNeighborAnnotations(["t1", "t2"], null), {
      wrapper: makeWrapper(),
    });
    expect(mockGetAnnotations).not.toHaveBeenCalled();
  });

  it("按 group_id 过滤跨 task 的 annotations", async () => {
    mockGetAnnotations.mockImplementation(async (tid: string) =>
      tid === "t1"
        ? [ann("a1", 5), ann("a2", 9)]
        : [ann("b1", 5), ann("b2", 5)],
    );
    const { result } = renderHook(
      () => useNeighborAnnotations(["t1", "t2"], 5),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byTask["t1"].map((a) => a.id)).toEqual(["a1"]);
    expect(result.current.byTask["t2"].map((a) => a.id)).toEqual(["b1", "b2"]);
  });

  it("去重重复 task_id", async () => {
    mockGetAnnotations.mockResolvedValue([ann("a1", 7)]);
    renderHook(() => useNeighborAnnotations(["t1", "t1", "t1"], 7), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(mockGetAnnotations).toHaveBeenCalled());
    expect(mockGetAnnotations).toHaveBeenCalledTimes(1);
  });
});
