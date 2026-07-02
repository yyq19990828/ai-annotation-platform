/**
 * v0.9.12 · ProjectDetailPanel 单测 (BUG B-17 多选 batch + 串/并行预标).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockTriggerMutate = vi.fn();
const mockUseProject = vi.fn();
const mockUseBatches = vi.fn();
const mockUseMLBackends = vi.fn();
const mockUseTrigger = vi.fn();
const mockUseProjectPipelines = vi.fn();
const mockUseCapabilityInstances = vi.fn();
const mockSummaryAPI = vi.fn();
const mockQueueAPI = vi.fn();
const mockAliasFreqAPI = vi.fn();
const mockSetupAPI = vi.fn();
const mockCapabilitiesAPI = vi.fn();
const mockUpdateProjectMutate = vi.fn();
const mockUpdateProjectMutateAsync = vi.fn();
const mockCreateProjectPipelineMutateAsync = vi.fn();
const mockApplyProjectPipelineMutate = vi.fn();
const mockApplyProjectPipelineMutateAsync = vi.fn();
const mockDeleteProjectPipelineMutate = vi.fn();
const mockUpdatePreferences = vi.fn();

vi.mock("@/hooks/useProjects", () => ({
  useProject: (id: string) => mockUseProject(id),
  useProjects: () => ({ data: [], isLoading: false }),
  // v0.9.13 起 ProjectDetailPanel 调用 useUpdateProject 持久化 chips/threshold; mock 默认 noop
  useUpdateProject: () => ({
    mutate: mockUpdateProjectMutate,
    mutateAsync: mockUpdateProjectMutateAsync,
    isPending: false,
  }),
}));
// v0.9.13 起 useBatchEventsSocket 在 mount 时发起 ws upgrade, MSW 没装 ws handler 时
// libuv stream assert → worker crash. 单测里直接 noop 即可 (WS 行为另有 useBatchEventsSocket 自己的 smoke 测试).
vi.mock("@/hooks/useBatchEventsSocket", () => ({
  useBatchEventsSocket: () => undefined,
}));
vi.mock("@/hooks/useProjectPipelines", () => ({
  useProjectPipelines: (...args: unknown[]) => mockUseProjectPipelines(...args),
  useCreateProjectPipeline: () => ({
    mutateAsync: mockCreateProjectPipelineMutateAsync,
    isPending: false,
  }),
  useApplyProjectPipeline: () => ({
    mutate: mockApplyProjectPipelineMutate,
    mutateAsync: mockApplyProjectPipelineMutateAsync,
    isPending: false,
  }),
  useDeleteProjectPipeline: () => ({
    mutate: mockDeleteProjectPipelineMutate,
    isPending: false,
  }),
}));
vi.mock("@/api/mlCapabilities", () => ({
  useCapabilityInstances: () => mockUseCapabilityInstances(),
}));
vi.mock("@/hooks/useBatches", () => ({
  useBatches: (pid: string, status: string) => mockUseBatches(pid, status),
}));
vi.mock("@/hooks/useMLBackends", () => ({
  useMLBackends: (pid: string) => mockUseMLBackends(pid),
}));
vi.mock("@/hooks/usePreannotation", async () => {
  const actual = await vi.importActual<any>("@/hooks/usePreannotation");
  return {
    ...actual,
    useTriggerPreannotation: () => mockUseTrigger(),
    // v0.18.6 起 ProjectDetailPanel 订阅预标进度 WS; 单测 noop 避免 ws upgrade 崩 worker
    // (同 useBatchEventsSocket)。逐阶段实时徽标的快照消费另由更聚焦的测试覆盖。
    usePreannotationProgress: () => ({
      progress: null,
      connection: "idle",
      retries: 0,
    }),
  };
});
vi.mock("@/api/adminPreannotate", async () => {
  const actual = await vi.importActual<any>("@/api/adminPreannotate");
  return {
    ...actual,
    adminPreannotateApi: {
      ...actual.adminPreannotateApi,
      summary: () => mockSummaryAPI(),
      queue: (limit: number) => mockQueueAPI(limit),
    },
  };
});
vi.mock("@/api/aliasFrequency", () => ({
  aliasFrequencyApi: {
    byProject: (pid: string) => mockAliasFreqAPI(pid),
  },
}));
vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: {
    setup: (projectId: string, backendId: string) => mockSetupAPI(projectId, backendId),
    capabilities: (projectId: string, backendId: string) =>
      mockCapabilitiesAPI(projectId, backendId),
  },
  mlBackendSetupQueryKey: (p: unknown, b: unknown) => ["ml-backends", p, b, "setup"],
}));
vi.mock("@/api/auth", () => ({
  authApi: {
    getPreferences: vi.fn().mockResolvedValue({ ai: { params_by_backend: {} } }),
    updatePreferences: (payload: unknown) => mockUpdatePreferences(payload),
  },
}));

import { ProjectDetailPanel } from "./ProjectDetailPanel";

function renderUI(extras: Partial<{ summary: any }> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProjectDetailPanel
          projectId="p1"
          onBack={() => {}}
          summary={extras.summary}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectDetailPanel v0.9.12", () => {
  beforeEach(() => {
    mockTriggerMutate.mockReset();
    mockSetupAPI.mockReset();
    mockCapabilitiesAPI.mockReset();
    mockUpdateProjectMutate.mockReset();
    mockUpdateProjectMutateAsync.mockReset();
    mockUpdateProjectMutateAsync.mockResolvedValue(undefined);
    // 默认能力目录无 ocr / doc_layout 条目 → 不出现任务类型选择 (保持原文本预标行为).
    mockCapabilitiesAPI.mockResolvedValue({ name: "grounded-sam2", models: [] });
    mockUpdatePreferences.mockReset();
    mockUseProject.mockReturnValue({
      data: { type_key: "image-det", ml_backend_id: "bk1" },
      isLoading: false,
    });
    mockUseProjectPipelines.mockReset();
    mockUseProjectPipelines.mockReturnValue({ data: [], isLoading: false });
    mockUseCapabilityInstances.mockReset();
    mockUseCapabilityInstances.mockReturnValue({
      data: { instances: [] },
      isLoading: false,
    });
    mockCreateProjectPipelineMutateAsync.mockReset();
    mockCreateProjectPipelineMutateAsync.mockResolvedValue({
      id: "pipe-created",
      name: "项目默认编排",
      scope: "private",
      project_id: "p1",
      organization_id: null,
      stages: [{ stage: 0, ml_backend_id: "bk1" }],
      is_default: true,
    });
    mockApplyProjectPipelineMutate.mockReset();
    mockApplyProjectPipelineMutateAsync.mockReset();
    mockApplyProjectPipelineMutateAsync.mockResolvedValue({
      id: "pipe-applied",
      name: "项目默认编排",
      scope: "private",
      project_id: "p1",
      organization_id: null,
      stages: [{ stage: 0, ml_backend_id: "bk1" }],
      is_default: true,
    });
    mockDeleteProjectPipelineMutate.mockReset();
    mockUseBatches.mockReturnValue({
      data: [
        { id: "b1", display_id: "B-1", name: "批次甲", total_tasks: 10 },
        { id: "b2", display_id: "B-2", name: "批次乙", total_tasks: 20 },
      ],
      isLoading: false,
    });
    mockUseMLBackends.mockReturnValue({
      data: [{ id: "bk1", name: "grounded-sam2" }],
      isLoading: false,
    });
    mockUseTrigger.mockReturnValue({
      mutateAsync: mockTriggerMutate.mockResolvedValue({
        job_id: "j1",
        total_tasks: 10,
      }),
      isPending: false,
    });
    mockSummaryAPI.mockResolvedValue({ items: [] });
    mockQueueAPI.mockResolvedValue({ items: [] });
    mockAliasFreqAPI.mockResolvedValue({
      project_id: "p1",
      total_predictions: 0,
      frequency: {},
      last_computed_at: new Date().toISOString(),
    });
    mockSetupAPI.mockResolvedValue({
      name: "grounded-sam2",
      supported_prompts: ["text"],
      supported_variants: [
        {
          key: "sam_variant",
          title: "SAM 2",
          variants: [
            { value: "tiny", label: "Tiny", vram_gb: 1.5, tier: "fast" },
            { value: "large", label: "Large", vram_gb: 6, tier: "accurate" },
          ],
        },
        {
          key: "dino_variant",
          title: "DINO",
          variants: [
            { value: "T", label: "Tiny", vram_gb: 1.5, tier: "fast" },
            { value: "B", label: "Base", vram_gb: 3.5, tier: "accurate" },
          ],
        },
      ],
      params: {
        type: "object",
        properties: {
          box_threshold: { type: "number", default: 0.35, minimum: 0, maximum: 1 },
          sam_variant: {
            type: "string",
            enum: ["tiny", "large"],
            default: "tiny",
            title: "SAM 2 变体",
          },
          dino_variant: {
            type: "string",
            enum: ["T", "B"],
            default: "T",
            title: "DINO 变体",
          },
        },
      },
    });
    mockUpdatePreferences.mockResolvedValue(undefined);
  });

  it("渲染 header 含项目名 + ml_backend chip", () => {
    renderUI({ summary: { project_name: "Demo", project_display_id: "P-9" } });
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText(/P-9/)).toBeInTheDocument();
    expect(screen.getByText("grounded-sam2")).toBeInTheDocument();
  });

  it("空选中时配置区常驻 · prompt 表单仍显示但运行按钮禁用 (v0.14.16)", () => {
    renderUI();
    // v0.14.16 配置区常驻: 配置面板 (含 prompt) 不再被『先选批次』gate, 未选也可预先调参 / 存预设;
    // 防误触发的不变量改由「运行按钮禁用」承担, 而非隐藏表单.
    expect(screen.getByPlaceholderText(/car, person/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /跑预标/ })).toBeDisabled();
  });

  it("选中 1 个 batch 后显示 prompt 表单 (无并发模式)", () => {
    renderUI();
    const batchChecks = screen.getAllByRole("checkbox", { name: /选择/ });
    fireEvent.click(batchChecks[0]);
    expect(screen.getByPlaceholderText(/car, person/)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: /并发模式/ })).toBeNull();
  });

  it("选中 ≥2 个 batch 时出现串/并行单选", () => {
    renderUI();
    fireEvent.click(screen.getByRole("checkbox", { name: /全选 active/ }));
    expect(screen.getByRole("radiogroup", { name: /并发模式/ })).toBeInTheDocument();
  });

  it("串行模式: 多 batch 顺序触发 trigger.mutateAsync", async () => {
    renderUI();
    fireEvent.click(screen.getByRole("checkbox", { name: /全选 active/ }));
    fireEvent.change(screen.getByPlaceholderText(/car, person/), {
      target: { value: "car" },
    });
    fireEvent.click(screen.getByRole("button", { name: /跑预标.*2 批/ }));

    await waitFor(() => {
      expect(mockTriggerMutate).toHaveBeenCalledTimes(2);
    });
    expect(mockTriggerMutate).toHaveBeenNthCalledWith(1, expect.objectContaining({ batch_id: "b1" }));
    expect(mockTriggerMutate).toHaveBeenNthCalledWith(2, expect.objectContaining({ batch_id: "b2" }));
  });

  it("并行模式: 同时触发 N 次 mutateAsync", async () => {
    renderUI();
    fireEvent.click(screen.getByRole("checkbox", { name: /全选 active/ }));
    fireEvent.change(screen.getByPlaceholderText(/car, person/), {
      target: { value: "car, person" },
    });
    fireEvent.click(screen.getByLabelText(/并行/));
    fireEvent.click(screen.getByRole("button", { name: /跑预标.*2 批/ }));

    await waitFor(() => {
      expect(mockTriggerMutate).toHaveBeenCalledTimes(2);
    });
  });

  it("无绑定 ml_backend 时显示警告 + Run disabled", () => {
    mockUseProject.mockReturnValue({
      data: { type_key: "image-det", ml_backend_id: null },
      isLoading: false,
    });
    mockUseMLBackends.mockReturnValue({ data: [], isLoading: false });
    renderUI();
    expect(screen.getByText(/未绑定 ML backend/)).toBeInTheDocument();
  });

  it("aliases 加载后默认填充 prompt (按预标频率降序)", async () => {
    mockUseProject.mockReturnValue({
      data: {
        type_key: "image-det",
        ml_backend_id: "bk1",
        classes_config: {
          car: { alias: "car" },
          person: { alias: "person" },
          truck: { alias: "truck" },
        },
      },
      isLoading: false,
    });
    mockAliasFreqAPI.mockResolvedValue({
      project_id: "p1",
      total_predictions: 100,
      frequency: { person: 50, car: 30, truck: 5 },
      last_computed_at: new Date().toISOString(),
    });
    renderUI();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /选择/ })[0]);
    // 等 aliases query 解析后 useEffect 把 prompt 填上
    await waitFor(() => {
      const ta = screen.getByPlaceholderText(/car, person/) as HTMLTextAreaElement;
      expect(ta.value).toBe("person, car, truck");
    });
  });

  it("用户已手填 prompt 时不被 alias 默认覆盖", async () => {
    mockUseProject.mockReturnValue({
      data: {
        type_key: "image-det",
        ml_backend_id: "bk1",
        classes_config: { car: { alias: "car" } },
      },
      isLoading: false,
    });
    mockAliasFreqAPI.mockResolvedValue({
      project_id: "p1",
      total_predictions: 0,
      frequency: {},
      last_computed_at: new Date().toISOString(),
    });
    renderUI();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /选择/ })[0]);
    const ta = screen.getByPlaceholderText(/car, person/) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "我手填的" } });
    // 多次 re-render 不应覆盖
    await waitFor(() => expect(ta.value).toBe("我手填的"));
  });

  it("ai-pre 变体选择随 params 透传到预标请求", async () => {
    renderUI();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /选择/ })[0]);
    fireEvent.change(screen.getByPlaceholderText(/car, person/), {
      target: { value: "car" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("ai-variant-sam_variant")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("ai-variant-sam_variant"), {
      target: { value: "large" },
    });
    fireEvent.change(screen.getByTestId("ai-variant-dino_variant"), {
      target: { value: "B" },
    });
    fireEvent.click(screen.getByRole("button", { name: /跑预标.*1 批/ }));

    // v0.18.12 统一 wire: 变体走 model_variants (独立字段), params 只留非变体阈值。
    await waitFor(() => {
      expect(mockTriggerMutate).toHaveBeenCalledWith(expect.objectContaining({
        model_variants: expect.objectContaining({
          sam_variant: "large",
          dino_variant: "B",
        }),
        params: expect.objectContaining({ box_threshold: 0.35 }),
      }));
    });
  });

  it("保存当前配置时写入命名项目编排并设为默认", async () => {
    renderUI();
    fireEvent.change(screen.getByPlaceholderText(/car, person/), {
      target: { value: "car" },
    });
    fireEvent.change(screen.getByPlaceholderText(/例如 detect/), {
      target: { value: "车辆属性" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保存为命名编排/ }));

    await waitFor(() => {
      expect(mockCreateProjectPipelineMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "车辆属性",
          scope: "private",
          project_id: "p1",
          is_default: true,
          stages: [
            expect.objectContaining({
              stage: 0,
              ml_backend_id: "bk1",
            }),
          ],
        }),
      );
    });
    expect(mockApplyProjectPipelineMutateAsync).not.toHaveBeenCalled();
  });

  it("可从命名编排库套用为当前项目默认", async () => {
    mockUseProjectPipelines.mockReturnValue({
      data: [
        {
          id: "pipe-public",
          name: "detect-to-attr",
          scope: "public",
          project_id: null,
          organization_id: null,
          stages: [{ stage: 0, ml_backend_id: "bk1" }],
          is_default: false,
        },
      ],
      isLoading: false,
    });
    renderUI();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /套用为默认/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /套用为默认/ }));
    expect(mockApplyProjectPipelineMutate).toHaveBeenCalledWith(
      { pipelineId: "pipe-public", setDefault: true },
      expect.any(Object),
    );
  });

  it("全局池保留探测失败 backend 但禁用选择", async () => {
    mockUseCapabilityInstances.mockReturnValue({
      data: {
        instances: [
          {
            backend_id: "bk-global-ok",
            state: "connected",
            source: "manual",
            name: "global-det",
            infra: "onnx",
            models: [
              {
                id: "det",
                display_name: "Global Det",
                task: "detection",
                supported_inputs: ["full_image"],
                supported_geometric_outputs: ["bbox"],
                supported_prompts: [],
                supported_trackers: [],
                is_interactive: false,
              },
            ],
          },
          {
            backend_id: "bk-global-error",
            state: "error",
            source: "manual",
            name: "bad-det",
            infra: "onnx",
            models: [
              {
                id: "bad",
                display_name: "Bad Det",
                task: "detection",
                supported_inputs: ["full_image"],
                supported_geometric_outputs: ["bbox"],
                supported_prompts: [],
                supported_trackers: [],
                is_interactive: false,
              },
            ],
          },
        ],
      },
      isLoading: false,
    });
    renderUI();
    const source = screen.getByLabelText("全局源阶段模型") as HTMLSelectElement;
    const errorOption = Array.from(source.options).find((o) =>
      o.textContent?.includes("探测失败"),
    );
    expect(errorOption).toBeTruthy();
    expect(errorOption?.disabled).toBe(true);
  });

  it("保存全局编排时使用 instances.backend_id 作为 stage backend", async () => {
    mockUseCapabilityInstances.mockReturnValue({
      data: {
        instances: [
          {
            backend_id: "bk-global-det",
            state: "connected",
            source: "manual",
            name: "global-det",
            infra: "onnx",
            models: [
              {
                id: "det",
                display_name: "Global Det",
                task: "detection",
                supported_inputs: ["full_image"],
                supported_geometric_outputs: ["bbox"],
                supported_prompts: [],
                supported_trackers: [],
                is_interactive: false,
              },
              {
                id: "attr",
                display_name: "Vehicle Attr",
                task: "classification",
                supported_inputs: ["crop"],
                supported_geometric_outputs: [],
                supported_prompts: [],
                supported_trackers: [],
                output_attribute_types: ["class"],
                output_attribute_schema: [{ key: "color", label: "Color", type: "select" }],
                is_interactive: false,
              },
            ],
          },
        ],
      },
      isLoading: false,
    });
    renderUI();
    fireEvent.change(screen.getByPlaceholderText(/例如 detect/), {
      target: { value: "global detect attr" },
    });
    fireEvent.click(screen.getByRole("button", { name: /加入下游/ }));
    fireEvent.click(screen.getByRole("button", { name: /保存全局编排/ }));

    await waitFor(() => {
      expect(mockCreateProjectPipelineMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "global detect attr",
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

  it("点返回按钮触发 onBack", () => {
    const onBack = vi.fn();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ProjectDetailPanel projectId="p1" onBack={onBack} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /返回项目列表/ }));
    expect(onBack).toHaveBeenCalled();
  });

  // v0.18.5 / v0.18.16 · 多阶段下游 backend 门控: 单 backend 兜底提示 vs 双 backend 可编排。
  // 加阶段已移入 DAG 画布 (lazy, 测试里渲染 Suspense 占位), 故此处只断言两列编排区的兜底/引导文案。
  describe("多阶段下游 backend 门控 (v0.18.16)", () => {
    it("单 backend 项目: 提示需绑第二个 backend", () => {
      // 默认 mockUseMLBackends 只有 bk1 (单 backend)。
      renderUI();
      expect(
        screen.getByText(/需在项目设置绑定第二个 ML backend/),
      ).toBeInTheDocument();
    });

    it("双 backend 项目: 无单 backend 提示, 显示编排空态引导", () => {
      mockUseMLBackends.mockReturnValue({
        data: [
          { id: "bk1", name: "grounded-sam2" },
          { id: "bk2", name: "onnxtools" },
        ],
        isLoading: false,
      });
      renderUI();
      expect(
        screen.queryByText(/需在项目设置绑定第二个 ML backend/),
      ).toBeNull();
      expect(screen.getByText(/加下游阶段/)).toBeInTheDocument();
    });
  });

  // v0.14.9 · 能力声明协议 v2: backend models[] 含 ocr / doc_layout 时的任务类型分流.
  describe("OCR / 文档版面任务类型", () => {
    function withOcrCapabilities() {
      mockCapabilitiesAPI.mockResolvedValue({
        name: "doc-ai",
        models: [
          {
            id: "m-ocr",
            task: "ocr",
            display_name: "OCR",
            params: {
              type: "object",
              properties: { det_db_thresh: { type: "number", default: 0.3 } },
            },
          },
          { id: "m-layout", task: "doc_layout", display_name: "版面" },
        ],
      });
    }

    it("无 ocr / doc_layout 模型时,文本路径正常出 prompt(无 OCR 选项)", async () => {
      renderUI();
      fireEvent.click(screen.getAllByRole("checkbox", { name: /选择/ })[0]);
      // 等 capabilities query 解析
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/car, person/)).toBeInTheDocument();
      });
      // v0.20.5 · 已无「任务类型」tab; 这是几何/文本 backend, 不应出现 OCR/版面 model 选项。
      expect(screen.queryByRole("option", { name: /OCR/ })).toBeNull();
    });

    it("OCR backend: 统一「模型任务」下拉列出 OCR/版面,默认落 OCR 后隐藏 prompt + 显示静态提示", async () => {
      withOcrCapabilities();
      renderUI();
      fireEvent.click(screen.getAllByRole("checkbox", { name: /选择/ })[0]);
      // v0.20.5 · 不再有「OCR 文字识别」tab; OCR/版面 model 进统一「模型任务」下拉。
      await waitFor(() => {
        expect(screen.getByRole("option", { name: "OCR" })).toBeInTheDocument();
      });
      expect(screen.getByRole("option", { name: "版面" })).toBeInTheDocument();
      // 默认选中第一个可选 model(OCR)→ doc 模式: prompt 隐藏 + 静态提示。
      expect(screen.queryByPlaceholderText(/car, person/)).toBeNull();
      expect(screen.getByText(/未配置 text 属性，文本不会入库/)).toBeInTheDocument();
    });

    it("OCR 默认模型发起预标透传 model_id + task_type, 不带 prompt", async () => {
      withOcrCapabilities();
      renderUI();
      fireEvent.click(screen.getAllByRole("checkbox", { name: /选择/ })[0]);
      await waitFor(() => {
        expect(screen.getByRole("option", { name: "OCR" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /跑预标.*1 批/ }));

      await waitFor(() => {
        expect(mockTriggerMutate).toHaveBeenCalledTimes(1);
      });
      const arg = mockTriggerMutate.mock.calls[0][0];
      expect(arg).toMatchObject({
        ml_backend_id: "bk1",
        model_id: "m-ocr",
        task_type: "ocr",
        batch_id: "b1",
      });
      expect(arg).not.toHaveProperty("prompt");
    });
  });
});
