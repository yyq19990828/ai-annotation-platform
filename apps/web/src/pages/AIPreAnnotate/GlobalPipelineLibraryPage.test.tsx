import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockUseCapabilityInstances = vi.fn();
const mockCreateProjectPipelineMutateAsync = vi.fn();

vi.mock("@/api/mlCapabilities", () => ({
  useCapabilityInstances: () => mockUseCapabilityInstances(),
}));

vi.mock("@/hooks/useProjectPipelines", () => ({
  useCreateProjectPipeline: () => ({
    mutateAsync: mockCreateProjectPipelineMutateAsync,
    isPending: false,
  }),
}));

vi.mock("./components/PipelineGraphCanvas", () => ({
  default: () => <div data-testid="pipeline-canvas" />,
}));

import GlobalPipelineLibraryPage from "./GlobalPipelineLibraryPage";

function renderUI() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <GlobalPipelineLibraryPage />
    </QueryClientProvider>,
  );
}

describe("GlobalPipelineLibraryPage", () => {
  beforeEach(() => {
    mockCreateProjectPipelineMutateAsync.mockReset();
    mockCreateProjectPipelineMutateAsync.mockResolvedValue({ id: "pipe-public" });
    mockUseCapabilityInstances.mockReset();
    mockUseCapabilityInstances.mockReturnValue({
      data: { instances: [] },
      isLoading: false,
    });
  });

  it("全局池保留探测失败 backend 但禁用选择", async () => {
    mockUseCapabilityInstances.mockReturnValue({
      data: {
        instances: [
          {
            backend_id: "bk-global-ok",
            state: "connected",
            name: "global-det",
            models: [
              {
                id: "det",
                display_name: "Global Det",
                task: "detection",
                supported_inputs: ["full_image"],
                supported_geometric_outputs: ["bbox"],
                output_attribute_types: [],
                output_attribute_schema: [],
              },
            ],
          },
          {
            backend_id: "bk-global-error",
            state: "error",
            name: "bad-det",
            models: [
              {
                id: "bad",
                display_name: "Bad Det",
                task: "detection",
                supported_inputs: ["full_image"],
                supported_geometric_outputs: ["bbox"],
                output_attribute_types: [],
                output_attribute_schema: [],
              },
            ],
          },
        ],
      },
      isLoading: false,
    });

    renderUI();
    await screen.findByTestId("pipeline-canvas");

    const source = screen.getByLabelText("全局源阶段模型") as HTMLSelectElement;
    const errorOption = Array.from(source.options).find((o) =>
      o.textContent?.includes("探测失败"),
    );
    expect(errorOption).toBeTruthy();
    expect(errorOption?.disabled).toBe(true);
  });

  it("保存公共编排时使用 instances.backend_id 作为 stage backend", async () => {
    mockUseCapabilityInstances.mockReturnValue({
      data: {
        instances: [
          {
            backend_id: "bk-global-det",
            state: "connected",
            name: "global-det",
            models: [
              {
                id: "det",
                display_name: "Global Det",
                task: "detection",
                supported_inputs: ["full_image"],
                supported_geometric_outputs: ["bbox"],
                output_attribute_types: [],
                output_attribute_schema: [],
              },
              {
                id: "attr",
                display_name: "Vehicle Attr",
                task: "classification",
                supported_inputs: ["crop"],
                supported_geometric_outputs: [],
                output_attribute_types: ["class"],
                output_attribute_schema: [{ key: "color", label: "Color", type: "select" }],
              },
            ],
          },
        ],
      },
      isLoading: false,
    });
    renderUI();
    await screen.findByTestId("pipeline-canvas");

    fireEvent.change(screen.getByPlaceholderText(/例如 detect/), {
      target: { value: "global detect attr" },
    });
    fireEvent.click(screen.getByRole("button", { name: /加入下游/ }));
    fireEvent.click(screen.getByRole("button", { name: /保存公共编排/ }));

    await waitFor(() => {
      expect(mockCreateProjectPipelineMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "global detect attr",
          scope: "public",
          project_id: null,
          organization_id: null,
          is_default: false,
          stages: [
            expect.objectContaining({
              stage: 0,
              ml_backend_id: "bk-global-det",
              model_id: "det",
            }),
            expect.objectContaining({
              stage: 1,
              parent_stage: 0,
              ml_backend_id: "bk-global-det",
              model_id: "attr",
              write: { target: "attributes" },
            }),
          ],
        }),
      );
    });
  });
});
