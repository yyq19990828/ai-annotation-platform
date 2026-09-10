import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isInitialQueryPaused, isRefreshQueryPaused } from "@/pages/shared/QueryState";

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

afterEach(() => {
  onlineManager.setOnline(true);
  cleanup();
});

describe("Query paused state adapter", () => {
  it("marks an offline first request as paused instead of loading or empty", () => {
    onlineManager.setOnline(false);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ["paused-first-request"],
          queryFn: async () => ({ items: ["queued"] }),
        }),
      { wrapper: makeWrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPaused).toBe(true);
    expect(isInitialQueryPaused(result.current, false)).toBe(true);
  });

  it("keeps cached content visible while an offline refresh is paused", () => {
    onlineManager.setOnline(false);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ["paused-refresh"],
          queryFn: async () => ({ items: ["fresh"] }),
          initialData: { items: ["cached"] },
        }),
      { wrapper: makeWrapper(client) },
    );

    expect(result.current.data).toEqual({ items: ["cached"] });
    expect(result.current.isPaused).toBe(true);
    expect(isRefreshQueryPaused(result.current, true)).toBe(true);
  });
});
