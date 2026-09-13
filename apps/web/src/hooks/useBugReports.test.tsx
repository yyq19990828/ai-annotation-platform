import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import { bugReportsApi } from "@/api/bug-reports";
import { useBugReports } from "./useBugReports";

vi.mock("@/api/bug-reports", () => ({
  bugReportsApi: {
    list: vi.fn(),
  },
}));

const mockList = vi.mocked(bugReportsApi.list);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

describe("useBugReports", () => {
  beforeEach(() => {
    mockList.mockReset();
    useAuthStore.setState({
      token: "test-token",
      user: { id: "owner-1" } as never,
    });
  });

  it("passes React Query's AbortSignal and scopes the cache key to the auth owner", async () => {
    mockList.mockResolvedValue({ items: [], total: 0 });
    const { client, Wrapper } = makeWrapper();
    const params = { status: "new", limit: 50 };

    const { result } = renderHook(() => useBugReports(params), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockList).toHaveBeenCalledWith(params, expect.any(AbortSignal));
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toContainEqual(["bug-reports", "list", "owner-1", params]);
  });

  it("keeps the latest filter result when an earlier request resolves late", async () => {
    const pending = new Map<
      string,
      { resolve: (value: { items: never[]; total: number }) => void }
    >();
    mockList.mockImplementation((params) => {
      return new Promise((resolve) => {
        pending.set(params?.status ?? "all", { resolve });
      });
    });
    const { Wrapper } = makeWrapper();
    const { result, rerender } = renderHook(
      ({ status }: { status: string }) =>
        useBugReports({
          status,
          limit: 50,
        }),
      {
        initialProps: { status: "new" },
        wrapper: Wrapper,
      },
    );

    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith({ status: "new", limit: 50 }, expect.any(AbortSignal)),
    );
    const firstSignal = mockList.mock.calls[0][1];
    rerender({ status: "fixed" });
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        { status: "fixed", limit: 50 },
        expect.any(AbortSignal),
      ),
    );
    const secondSignal = mockList.mock.calls[1][1];
    expect(secondSignal).not.toBe(firstSignal);
    await waitFor(() => expect(firstSignal?.aborted).toBe(true));

    pending.get("fixed")!.resolve({ items: [], total: 2 });
    await waitFor(() => expect(result.current.data?.total).toBe(2));
    pending.get("new")!.resolve({ items: [], total: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.data?.total).toBe(2);
  });
});
