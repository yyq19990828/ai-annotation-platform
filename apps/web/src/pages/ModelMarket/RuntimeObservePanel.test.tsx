import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockListAll = vi.fn();
const mockOverview = vi.fn();
const mockObserve = vi.fn();
const mockSmokeTest = vi.fn();
vi.mock("@/api/adminMlIntegrations", () => ({
  adminMlIntegrationsApi: {
    listAll: () => mockListAll(),
    overview: () => mockOverview(),
    observe: () => mockObserve(),
    observeSmokeTest: (payload: unknown) => mockSmokeTest(payload),
  },
}));

vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: { setup: vi.fn() },
  mlBackendSetupQueryKey: (projectId: string, backendId: string) => [
    "ml-backend-setup",
    projectId,
    backendId,
  ],
}));

const mockReloadMutate = vi.fn();
const mockWarmupMutate = vi.fn();
vi.mock("@/hooks/useMLBackends", () => ({
  useMLBackendReload: () => ({ mutate: mockReloadMutate, isPending: false }),
  useMLBackendWarmup: () => ({ mutate: mockWarmupMutate, isPending: false }),
}));

const mockHealthMutate = vi.fn();
const mockUnloadMutate = vi.fn();
vi.mock("./useGlobalRegistry", () => ({
  useRegistryHealth: () => ({ mutate: mockHealthMutate, isPending: false }),
  useRegistryUnload: () => ({ mutate: mockUnloadMutate, isPending: false }),
}));

vi.mock("./VariantPanel", () => ({ VariantPanel: () => <div>variant panel</div> }));

const mockPushToast = vi.fn();
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(selector: (state: any) => T) =>
      selector({ push: mockPushToast }),
  };
});

import { RuntimeObservePanel } from "./RuntimeObservePanel";

function makeBackend(overrides: Record<string, unknown> = {}) {
  return {
    id: "backend-1",
    name: "grounded-sam2",
    url: "http://172.17.0.1:8001",
    state: "connected",
    is_interactive: true,
    auth_method: "none",
    extra_params: {},
    gpu_resource_id: "node-a/GPU-abc",
    vram_budget_mb: 8192,
    eviction_priority: 0,
    gpu_config: {
      status: "warning",
      desired_mode: "observe",
      effective_mode: "off",
      allocatable_mb: 20_000,
      resource_claimed_budget_mb: 8192,
      diagnostics: [],
    },
    health_meta: null,
    source_project_id: "",
    source_project_name: "manual",
    last_checked_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RuntimeObservePanel />
    </QueryClientProvider>,
  );
}

describe("RuntimeObservePanel GPU residency", () => {
  beforeEach(() => {
    mockListAll.mockReset();
    mockOverview.mockReset();
    mockObserve.mockReset();
    mockSmokeTest.mockReset();
    mockReloadMutate.mockReset();
    mockWarmupMutate.mockReset();
    mockHealthMutate.mockReset();
    mockUnloadMutate.mockReset();
    mockPushToast.mockReset();
    mockOverview.mockResolvedValue({
      storage: { items: [], total_object_count: 0, total_size_bytes: 0 },
      projects: [],
      total_backends: 0,
      connected_backends: 0,
    });
  });

  it("以 /all 展示零项目 backend，并用 registry 级入口卸载", async () => {
    mockListAll.mockResolvedValue({ items: [makeBackend()] });
    mockObserve.mockResolvedValue({
      configured_count: 1,
      targets: [
        {
          url: "http://172.17.0.1:8001",
          ok: true,
          status_code: 200,
          latency_ms: 12,
          supports_variants: false,
          registered: true,
          compute: {
            configured_device: "cuda:0",
            effective_device: "cpu",
            effective_provider: "CPUExecutionProvider",
            cpu_fallback_supported: true,
          },
          gpu_info: {
            device_index: 0,
            device_uuid: "GPU-abc",
            physical_device_token: "GPU-abc",
            memory_used_mb: 9000,
            memory_total_mb: 24_000,
          },
          residency: {
            state: "resident",
            gpu_loaded: true,
            active_requests: 0,
            draining: false,
            evictable: false,
            generation: null,
            lifecycle_gate: "legacy",
            pools: { image: { resident: true, device: "cuda:0", provider: null } },
          },
        },
      ],
    });

    renderPanel();
    expect(await screen.findByText("grounded-sam2")).toBeInTheDocument();
    expect(screen.getByText("未绑定项目")).toBeInTheDocument();
    expect(screen.queryByText("未注册容器")).not.toBeInTheDocument();
    expect(screen.getByText("⚠ CPU 回退")).toBeInTheDocument();
    expect(screen.getByText("GPU 仍驻留")).toBeInTheDocument();
    expect(screen.getByText("unmanaged")).toBeInTheDocument();
    expect(screen.getByText("GPU-abc")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "卸载" }));
    await waitFor(() => expect(mockUnloadMutate).toHaveBeenCalledWith("backend-1", expect.anything()));
  });

  it("陈旧且畸形的缓存 residency 只展示原始观测警告，不推断为空闲", async () => {
    mockListAll.mockResolvedValue({
      items: [
        makeBackend({
          last_checked_at: "2020-01-01T00:00:00Z",
          health_meta: { residency: { gpu_loaded: false } },
        }),
      ],
    });
    mockObserve.mockResolvedValue({ configured_count: 0, targets: [] });

    renderPanel();
    expect(await screen.findByText(/residency 格式不可识别/)).toBeInTheDocument();
    expect(screen.getByText(/缓存 health（过期或未知）/)).toBeInTheDocument();
    expect(screen.queryByText("GPU 空")).not.toBeInTheDocument();
  });

  it("陈旧但结构完整的 gpu_loaded=false 仍按未知处理", async () => {
    mockListAll.mockResolvedValue({
      items: [
        makeBackend({
          last_checked_at: "2020-01-01T00:00:00Z",
          health_meta: {
            residency: {
              state: "unloaded",
              gpu_loaded: false,
              active_requests: 0,
              builders: 0,
              borrowers: 0,
              draining: false,
              evictable: true,
              generation: "7",
              lifecycle_gate: "enforce",
              pools: { image: { resident: false, device: null, provider: null } },
            },
          },
        }),
      ],
    });
    mockObserve.mockResolvedValue({ configured_count: 0, targets: [] });

    renderPanel();
    expect(await screen.findByText("GPU 驻留未知")).toBeInTheDocument();
    expect(screen.getByText(/证据已过期或来源未知/)).toBeInTheDocument();
    expect(screen.queryByText("GPU 空")).not.toBeInTheDocument();
    expect(screen.getByText(/image: unknown/)).toBeInTheDocument();
  });

  it("直连 residency=null 时正确回落到新鲜缓存来源", async () => {
    mockListAll.mockResolvedValue({
      items: [
        makeBackend({
          health_meta: {
            residency: {
              state: "unloaded",
              gpu_loaded: false,
              active_requests: 0,
              builders: 0,
              borrowers: 0,
              draining: false,
              evictable: true,
              generation: "7",
              lifecycle_gate: "enforce",
              pools: { image: { resident: false, device: null, provider: null } },
            },
          },
        }),
      ],
    });
    mockObserve.mockResolvedValue({
      configured_count: 1,
      targets: [
        {
          url: "http://172.17.0.1:8001",
          ok: true,
          status_code: 200,
          latency_ms: 3,
          supports_variants: false,
          registered: true,
          residency: null,
        },
      ],
    });

    renderPanel();
    expect(await screen.findByText("GPU 空")).toBeInTheDocument();
    expect(screen.getByText("缓存 health（新鲜）")).toBeInTheDocument();
    expect(screen.queryByText("实时直连（仅作旁证）")).not.toBeInTheDocument();
  });

  it("合法 state 搭配畸形嵌套字段时不崩溃且不显示空闲", async () => {
    mockListAll.mockResolvedValue({ items: [makeBackend()] });
    mockObserve.mockResolvedValue({
      configured_count: 1,
      targets: [
        {
          url: "http://172.17.0.1:8001",
          ok: true,
          status_code: 200,
          latency_ms: 4,
          supports_variants: false,
          registered: true,
          residency: {
            state: "unloaded",
            gpu_loaded: false,
            active_requests: { invalid: true },
            builders: 0,
            borrowers: 0,
            draining: false,
            evictable: true,
            generation: { invalid: true },
            identity: { gpu_resource_id: { invalid: true } },
            pools: { image: { resident: false, device: { invalid: true } } },
          },
        },
      ],
    });

    renderPanel();
    expect(await screen.findByText(/含畸形字段/)).toBeInTheDocument();
    expect(screen.getByText("GPU 驻留未知")).toBeInTheDocument();
    expect(screen.queryByText("GPU 空")).not.toBeInTheDocument();
  });
});
