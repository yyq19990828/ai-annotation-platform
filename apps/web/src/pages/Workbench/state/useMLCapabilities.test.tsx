import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetup = vi.hoisted(() => vi.fn());

vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: { setup: mockSetup },
}));

import { useMLCapabilities } from "./useMLCapabilities";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useMLCapabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns prompts and params from /setup response", async () => {
    mockSetup.mockResolvedValue({
      name: "sam3-backend",
      version: "0.10.1",
      model_version: "sam3.1",
      supported_prompts: ["bbox", "text", "exemplar"],
      params: { type: "object", properties: { box_threshold: { type: "number" } } },
    });
    const { result } = renderHook(
      () => useMLCapabilities("p1", "b1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prompts).toEqual(["bbox", "text", "exemplar"]);
    expect(result.current.isPromptSupported("bbox")).toBe(true);
    expect(result.current.isPromptSupported("point")).toBe(false);
    expect(result.current.paramsSchema?.type).toBe("object");
  });

  it("falls back to point/bbox/text when supported_prompts missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSetup.mockResolvedValue({ name: "legacy-backend" });
    const { result } = renderHook(
      () => useMLCapabilities("p1", "b1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prompts).toEqual(["point", "bbox", "text"]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns empty prompts on error", async () => {
    mockSetup.mockRejectedValue(new Error("502 backend unreachable"));
    const { result } = renderHook(
      () => useMLCapabilities("p1", "b1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.prompts).toEqual([]);
    expect(result.current.isPromptSupported("bbox")).toBe(false);
  });

  it("is disabled when backendId is null", () => {
    const { result } = renderHook(
      () => useMLCapabilities("p1", null),
      { wrapper },
    );
    expect(mockSetup).not.toHaveBeenCalled();
    expect(result.current.prompts).toEqual([]);
  });
});
