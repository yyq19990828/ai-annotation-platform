// v0.14.11 · CapabilityCatalogPanel 双层视图测试.
// 覆盖:
// - 0 backend + groupBy=task → 9 张协议卡 + onboarding 横幅;
// - 切换 groupBy=backend → 退回旧空态 (v0.14.10 行为, 不渲染空协议卡);
// - 搜索 "ocr" → 仅 OCR 协议卡可见。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockOverview = vi.fn();
vi.mock("@/api/adminMlIntegrations", () => ({
  adminMlIntegrationsApi: { overview: () => mockOverview() },
}));

vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: {
    capabilities: vi.fn(),
    refreshCapabilities: vi.fn(),
  },
}));

const mockGetProtocol = vi.fn();
const mockGetInstances = vi.fn();
vi.mock("@/api/mlCapabilities", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useProtocolCapabilities: () =>
      useQuery({
        queryKey: ["ml-capabilities", "protocol"],
        queryFn: () => mockGetProtocol(),
      }),
    useCapabilityInstances: () =>
      useQuery({
        queryKey: ["ml-capabilities", "instances"],
        queryFn: () => mockGetInstances(),
      }),
    mlCapabilitiesApi: {
      getProtocol: () => mockGetProtocol(),
      getInstances: () => mockGetInstances(),
    },
  };
});

const mockPushToast = vi.fn();
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

import { CapabilityCatalogPanel } from "./CapabilityCatalogPanel";

function makeProtocol() {
  return {
    version: "v2",
    tasks: [
      { id: "detection", label: "目标检测", summary: "...", default_geometry: ["bbox"], default_modalities: ["image"], typical_models: ["YOLO"], protocol_notes: "...", suggested_backends: [] },
      { id: "obb", label: "旋转框", summary: "...", default_geometry: ["rotated_bbox"], default_modalities: ["image"], typical_models: ["YOLO-OBB"], protocol_notes: "...", suggested_backends: [] },
      { id: "segmentation", label: "实例分割", summary: "...", default_geometry: ["polygon"], default_modalities: ["image"], typical_models: ["Mask R-CNN"], protocol_notes: "...", suggested_backends: [] },
      { id: "keypoint", label: "关键点", summary: "...", default_geometry: ["keypoint"], default_modalities: ["image"], typical_models: ["YOLO-Pose"], protocol_notes: "...", suggested_backends: [] },
      { id: "classification", label: "图像分类", summary: "...", default_geometry: ["none"], default_modalities: ["image"], typical_models: ["ResNet"], protocol_notes: "...", suggested_backends: [] },
      { id: "ocr", label: "OCR", summary: "从图像提取文本", default_geometry: ["bbox"], default_modalities: ["image"], typical_models: ["PaddleOCR"], protocol_notes: "...", suggested_backends: [{ name: "PaddleOCR", repo_url: "https://github.com/PaddlePaddle/PaddleOCR", summary: "...", research_link: null, infra: "paddle", builtin: false }] },
      { id: "doc_layout", label: "版面分析", summary: "...", default_geometry: ["bbox"], default_modalities: ["image"], typical_models: ["LayoutLMv3"], protocol_notes: "...", suggested_backends: [] },
      { id: "tracker", label: "视频追踪", summary: "...", default_geometry: [], default_modalities: ["video"], typical_models: ["ByteTrack"], protocol_notes: "...", suggested_backends: [] },
      { id: "interactive_seg", label: "交互分割", summary: "...", default_geometry: ["polygon"], default_modalities: ["image"], typical_models: ["SAM"], protocol_notes: "...", suggested_backends: [] },
    ],
    infras: [{ id: "pytorch", label: "PyTorch", summary: "..." }],
    modalities: [{ id: "image", label: "图像", summary: "..." }],
    geometries: [{ id: "bbox", label: "bbox", summary: "..." }],
  };
}

function renderUI() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CapabilityCatalogPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CapabilityCatalogPanel · 协议双层视图", () => {
  beforeEach(() => {
    mockOverview.mockReset();
    mockGetProtocol.mockReset();
    mockGetInstances.mockReset();
    mockOverview.mockResolvedValue({
      projects: [],
      total_backends: 0,
      connected_backends: 0,
    });
    mockGetProtocol.mockResolvedValue(makeProtocol());
    mockGetInstances.mockResolvedValue({ instances: [] });
  });

  it("0 backend + 默认 groupBy=task → 渲染 9 张协议卡 + onboarding 横幅", async () => {
    renderUI();
    await screen.findByText(/支持 9 类 AI 标注能力/);
    // 9 个 task label 都出现 (作为卡标题)
    for (const label of [
      "目标检测",
      "旋转框",
      "实例分割",
      "关键点",
      "图像分类",
      "OCR",
      "版面分析",
      "视频追踪",
      "交互分割",
    ]) {
      // task.label 在 title 和 badge 中都出现 (多次)
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // 0 backend 时所有协议卡都是「暂无接入」
    expect(screen.getAllByText("暂无接入").length).toBe(9);
  });

  it("切换 groupBy=backend → 退回 v0.14.10 行为 (旧空态, 不渲染协议卡)", async () => {
    renderUI();
    await screen.findByText(/支持 9 类 AI 标注能力/);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "backend" } });
    await waitFor(() => {
      expect(screen.getByText("尚无项目注册 ML Backend")).toBeInTheDocument();
    });
    expect(screen.queryAllByText("暂无接入").length).toBe(0);
  });

  it("env-only 容器的 model 出现在对应协议卡 (即使 admin overview 为空)", async () => {
    mockGetInstances.mockResolvedValue({
      instances: [
        {
          source: "env_only",
          name: "gsam2",
          infra: "pytorch",
          models: [
            {
              id: "grounded-sam2-detection",
              display_name: "Grounded-SAM 2 · 文本检测",
              task: "detection",
              infra: "pytorch",
              is_interactive: false,
              supported_prompts: ["text"],
              supported_geometric_outputs: ["bbox"],
              supported_trackers: [],
              modality: "image",
            },
            {
              id: "grounded-sam2-tracker",
              display_name: "Grounded-SAM 2 · 视频追踪",
              task: "tracker",
              infra: "pytorch",
              is_interactive: true,
              supported_prompts: ["bbox"],
              supported_geometric_outputs: ["bbox"],
              supported_trackers: ["sam2_video"],
              modality: "video",
            },
          ],
        },
      ],
    });
    renderUI();
    await screen.findByText("Grounded-SAM 2 · 文本检测");
    expect(screen.getByText("Grounded-SAM 2 · 视频追踪")).toBeInTheDocument();
    // env-only model 有「自带」徽标
    expect(screen.getAllByText("自带").length).toBeGreaterThan(0);
    // detection / tracker 协议卡都不再是「暂无接入」
    const undeployedCount = screen.queryAllByText("暂无接入").length;
    // 9 张卡里只剩 7 张暂无接入 (detection / tracker 各挂了 1 个 model)
    expect(undeployedCount).toBe(7);
    // 0 backend 横幅不应再出现
    expect(screen.queryByText(/支持 9 类 AI 标注能力/)).not.toBeInTheDocument();
  });

  it("同 URL 跨多项目注册时, groupBy=backend 只渲染一组 + 注册状态列聚合项目名", async () => {
    // v0.14.12 · backendRefs 按 URL 去重 (避免重复 fetch + 重复显示).
    const sharedBackend = (projectId: string) => ({
      id: `${projectId}-bk`,
      project_id: projectId,
      name: "shared-yolo",
      url: "http://172.17.0.1:9999/",
      state: "connected" as const,
      auth_method: "none",
      is_interactive: false,
      extra_params: {},
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
      last_checked_at: null,
      error_message: null,
      health_meta: null,
    });
    mockOverview.mockResolvedValue({
      projects: [
        { project_id: "p1", project_name: "项目甲", backends: [sharedBackend("p1")] },
        { project_id: "p2", project_name: "项目乙", backends: [sharedBackend("p2")] },
        { project_id: "p3", project_name: "项目丙", backends: [sharedBackend("p3")] },
      ],
      total_backends: 3,
      connected_backends: 3,
    });
    const { mlBackendsApi } = await import("@/api/ml-backends");
    (mlBackendsApi.capabilities as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: "shared-yolo",
      infra: "pytorch",
      is_interactive: false,
      supported_prompts: ["none"],
      supported_geometric_outputs: ["bbox"],
      models: [
        {
          id: "detect",
          display_name: "YOLO 目标检测",
          task: "detection",
          infra: "pytorch",
          supported_geometric_outputs: ["bbox"],
          supported_prompts: ["none"],
        },
      ],
    });
    renderUI();
    // 切到 backend 分组 + 列表视图 (一旦 overview 解析完, 这俩会触发 capability fetch + rerender).
    const select = await screen.findByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "backend" } });
    fireEvent.click(screen.getByTitle("列表视图"));
    // 注册状态列聚合显示: "项目甲 +2"
    await screen.findByText("项目甲 +2");
    // capabilities API 只调用一次 (按 URL 去重) — 而非 3 次.
    expect(mlBackendsApi.capabilities).toHaveBeenCalledTimes(1);
    // 同 backendName 的 group 只出现一次 (按 URL 合并)
    expect(screen.getAllByText("shared-yolo").length).toBe(2); // group header + 来源列
  });

  it("搜索 'ocr' → 仅 OCR 协议卡可见", async () => {
    renderUI();
    await screen.findByText(/支持 9 类 AI 标注能力/);
    const searchBox = screen.getByPlaceholderText(
      "搜索模型、ID、模型族、任务或来源",
    ) as HTMLInputElement;
    fireEvent.change(searchBox, { target: { value: "ocr" } });
    await waitFor(() => {
      // OCR 卡仍在
      expect(screen.getAllByText("OCR").length).toBeGreaterThan(0);
      // 其他 task 卡不再出现 (用「目标检测」作为代表)
      expect(screen.queryAllByText("目标检测").length).toBe(0);
    });
  });
});
