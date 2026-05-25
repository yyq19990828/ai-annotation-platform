import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDelete = vi.fn();

vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: {
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import { useDeleteMLBackend } from "./useMLBackends";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useMLBackends mutations", () => {
  beforeEach(() => {
    mockDelete.mockReset().mockResolvedValue(undefined);
  });

  it("删除 backend 后刷新项目总览相关查询", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useDeleteMLBackend("p1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync("b1");
    });

    expect(mockDelete).toHaveBeenCalledWith("p1", "b1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["ml-backends", "p1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["projects"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["project", "p1"] });
  });
});
