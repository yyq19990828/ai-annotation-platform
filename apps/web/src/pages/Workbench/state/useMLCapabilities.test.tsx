import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
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
      supported_variants: [{ key: "sam_variant", variants: [{ value: "tiny" }] }],
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
    expect(result.current.capability?.supported_variants?.[0]?.key).toBe("sam_variant");
  });

  it("falls back to point/interactive_box/text when supported_prompts missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSetup.mockResolvedValue({ name: "legacy-backend" });
    const { result } = renderHook(
      () => useMLCapabilities("p1", "b1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prompts).toEqual(["point", "interactive_box", "text"]);
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

  it("v0.14.9 · prefers active model prompts/params and defaults to first interactive model", async () => {
    mockSetup.mockResolvedValue({
      name: "multi-backend",
      // 顶层 supported_prompts 故意与 model 不同, 验证 activeModel 优先级.
      supported_prompts: ["text"],
      params: { type: "object", properties: { top_threshold: { type: "number" } } },
      models: [
        {
          id: "det",
          task: "detection",
          display_name: "检测模型",
          supported_prompts: ["text"],
          supported_geometric_outputs: ["bbox"],
        },
        {
          id: "seg",
          task: "interactive_seg",
          display_name: "交互分割",
          is_interactive: true,
          supported_prompts: ["point", "bbox"],
          supported_geometric_outputs: ["polygon"],
          params: { type: "object", properties: { mask_threshold: { type: "number" } } },
        },
      ],
    });
    const { result } = renderHook(() => useMLCapabilities("p1", "b1"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // 默认选第一个 interactive 的 model (seg).
    expect(result.current.activeModelId).toBe("seg");
    expect(result.current.hasMultipleModels).toBe(true);
    expect(result.current.prompts).toEqual(["point", "bbox"]);
    expect(result.current.paramsSchema?.properties?.mask_threshold).toBeTruthy();
  });

  it("v0.14.9 · setActiveModelId switches prompts/params to the chosen model", async () => {
    mockSetup.mockResolvedValue({
      name: "multi-backend",
      models: [
        {
          id: "det",
          task: "detection",
          supported_prompts: ["text"],
          params: { type: "object", properties: { box_threshold: { type: "number" } } },
        },
        {
          id: "seg",
          task: "interactive_seg",
          is_interactive: true,
          supported_prompts: ["point"],
        },
      ],
    });
    const { result } = renderHook(() => useMLCapabilities("p1", "b1"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeModelId).toBe("seg");
    act(() => result.current.setActiveModelId("det"));
    await waitFor(() => expect(result.current.activeModelId).toBe("det"));
    expect(result.current.prompts).toEqual(["text"]);
    expect(result.current.paramsSchema?.properties?.box_threshold).toBeTruthy();
  });
});
