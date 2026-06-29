import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetEnablement = vi.fn();

vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: {
    setEnablement: (...args: unknown[]) => mockSetEnablement(...args),
  },
}));

import { useSetMLBackendEnablement } from "./useMLBackends";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useMLBackends mutations", () => {
  beforeEach(() => {
    mockSetEnablement.mockReset().mockResolvedValue(undefined);
  });

  it("切换启用后刷新项目总览相关查询", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useSetMLBackendEnablement("p1"), {
      wrapper: makeWrapper(qc),
    });

    const payload = { enabled: true };
    await act(async () => {
      await result.current.mutateAsync({ registryId: "r1", payload });
    });

    expect(mockSetEnablement).toHaveBeenCalledWith("p1", "r1", payload);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["ml-backends", "p1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["projects"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["project", "p1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["admin", "ml-integrations", "overview"],
    });
  });
});
