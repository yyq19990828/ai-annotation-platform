/**
 * RegisteredBackendsTab 单测
 * v0.19.0 ADR-0044 重构后结构:
 *   - 全局注册表 (listAll · 超管 CRUD / 项目管理员只读)
 *   - 项目启用概览 (overview · 仅超管 · 只读)
 * 覆盖: 加载/错误/空态 · 角色门控 (CRUD 仅超管) · 项目管理员只读 · 项目启用概览
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Toast mock ───────────────────────────────────────────────────────────────
const mockPushToast = vi.fn();
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: mockPushToast }),
  };
});

// ── adminMlIntegrationsApi mock ───────────────────────────────────────────────
const mockOverview = vi.fn();
const mockListAll = vi.fn();
const mockGpuResources = vi.fn();
vi.mock("@/api/adminMlIntegrations", () => ({
  adminMlIntegrationsApi: {
    overview: () => mockOverview(),
    listAll: () => mockListAll(),
    gpuResources: () => mockGpuResources(),
  },
}));

// ── 全局注册表 CRUD hooks mock ────────────────────────────────────────────────
const mockDeleteRegistryMutate = vi.fn();
const mockHealthMutate = vi.fn();
vi.mock("./useGlobalRegistry", () => ({
  useDeleteRegistry: () => ({ mutate: mockDeleteRegistryMutate, isPending: false }),
  useRegistryHealth: () => ({ mutate: mockHealthMutate, isPending: false }),
}));

// ── GlobalBackendFormModal mock ───────────────────────────────────────────────
vi.mock("./GlobalBackendFormModal", () => ({
  GlobalBackendFormModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="global-backend-form-modal">modal</div> : null,
}));

// ── usePermissions mock (角色可切) ────────────────────────────────────────────
let mockRole = "super_admin";
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ role: mockRole }),
}));

import { RegisteredBackendsTab } from "./RegisteredBackendsTab";

function makeGlobalItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "bk-1",
    name: "grounded-sam2",
    url: "http://172.17.0.1:8001",
    state: "connected",
    is_interactive: true,
    auth_method: "none",
    extra_params: {},
    gpu_resource_id: "node-a/index:0",
    vram_budget_mb: 8192,
    eviction_priority: 0,
    gpu_config: {
      status: "ok",
      desired_mode: "observe",
      effective_mode: "observe",
      allocatable_mb: 20_000,
      resource_claimed_budget_mb: 8192,
      diagnostics: [],
    },
    health_meta: null,
    source_project_id: "p-1",
    source_project_name: "env",
    last_checked_at: "2026-05-01T10:00:00Z",
    ...overrides,
  };
}

function makeOverviewBackend(overrides: Record<string, unknown> = {}) {
  return {
    id: "bk-1",
    project_id: "p-1",
    name: "grounded-sam2",
    url: "http://172.17.0.1:8001",
    state: "connected",
    is_interactive: true,
    auth_method: "none",
    extra_params: {},
    health_meta: null,
    error_message: null,
    last_checked_at: "2026-05-01T10:00:00Z",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeOverview(overrides: Record<string, unknown> = {}) {
  return {
    storage: { items: [], total_object_count: 0, total_size_bytes: 0 },
    projects: [],
    total_backends: 0,
    connected_backends: 0,
    ...overrides,
  };
}

function renderUI() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RegisteredBackendsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RegisteredBackendsTab", () => {
  beforeEach(() => {
    mockPushToast.mockReset();
    mockDeleteRegistryMutate.mockReset();
    mockHealthMutate.mockReset();
    mockOverview.mockReset();
    mockListAll.mockReset();
    mockGpuResources.mockReset();
    mockRole = "super_admin";
    mockListAll.mockResolvedValue({ items: [] });
    mockOverview.mockResolvedValue(makeOverview());
    mockGpuResources.mockResolvedValue({
      global_desired_mode: "observe",
      runtime_ready: true,
      observe_runtime_ready: true,
      enforce_runtime_ready: false,
      resources: [],
      diagnostics: [],
    });
  });

  it("全局表加载态 → 显示加载中文本", () => {
    mockListAll.mockImplementation(() => new Promise(() => {}));
    renderUI();
    expect(screen.getAllByText("加载中…").length).toBeGreaterThan(0);
  });

  it("全局表错误态 → 显示加载失败 + 重试按钮", async () => {
    mockListAll.mockRejectedValue(new Error("网络故障"));
    renderUI();
    await screen.findByText(/加载失败/);
    expect(screen.getAllByRole("button", { name: /重试/ }).length).toBeGreaterThan(0);
  });

  it("全局表空态 → 显示空状态提示", async () => {
    renderUI();
    await screen.findByText(/尚无全局 backend/);
  });

  it("超管 → 全局表渲染 backend + 注册/编辑/删除/检查可用", async () => {
    mockListAll.mockResolvedValue({ items: [makeGlobalItem()] });
    renderUI();
    await screen.findByText("grounded-sam2");
    expect(screen.getByRole("button", { name: /注册全局 backend/ })).toBeInTheDocument();
    expect(screen.getByTitle("编辑")).toBeInTheDocument();
    expect(screen.getByTitle("删除")).toBeInTheDocument();
    expect(screen.getByTitle("健康检查")).toBeInTheDocument();
  });

  it("全局表显示 max_concurrency chip (缺省不显示)", async () => {
    mockListAll.mockResolvedValue({
      items: [
        makeGlobalItem({ id: "bk-a", name: "with-limit", extra_params: { max_concurrency: 2 } }),
        makeGlobalItem({ id: "bk-b", name: "no-limit", extra_params: {} }),
      ],
    });
    renderUI();
    await screen.findByText("with-limit");
    expect(screen.getByText("≤2 并发")).toBeInTheDocument();
    expect(screen.queryByText(/并发$/)).toBeInTheDocument(); // 仅一处
    expect(screen.getAllByText(/并发/).length).toBe(1);
  });

  it("显示 backend 静态 GPU claim，并明确区分 desired/effective", async () => {
    mockListAll.mockResolvedValue({ items: [makeGlobalItem()] });
    renderUI();
    await screen.findByText("node-a/index:0");
    expect(screen.getByText(/预算 8192\/20000 MiB/)).toBeInTheDocument();
    expect(screen.getByText(/observe→observe/)).toBeInTheDocument();
  });

  it("超管逐卡展示单卡、多卡/多节点隔离资源与诊断", async () => {
    mockGpuResources.mockResolvedValue({
      global_desired_mode: "observe",
      runtime_ready: true,
      observe_runtime_ready: true,
      enforce_runtime_ready: false,
      resources: [
        {
          gpu_resource_id: "node-a/index:0",
          node_id: "node-a",
          physical_device_token: "index:0",
          allocatable_mb: 20_000,
          configured_mode: "observe",
          desired_mode: "observe",
          effective_mode: "observe",
          claimed_budget_mb: 24_000,
          claimed_backend_count: 2,
          status: "warning",
          diagnostics: [
            {
              code: "gpu_resource_oversubscribed",
              level: "warning",
              message: "该卡存在弹性超售",
            },
          ],
        },
        {
          gpu_resource_id: "node-a/index:1",
          node_id: "node-a",
          physical_device_token: "index:1",
          allocatable_mb: 20_000,
          configured_mode: "off",
          desired_mode: "off",
          effective_mode: "off",
          claimed_budget_mb: 8_000,
          claimed_backend_count: 1,
          status: "ok",
          diagnostics: [],
        },
        {
          gpu_resource_id: "node-b/index:0",
          node_id: "node-b",
          physical_device_token: "index:0",
          allocatable_mb: 24_000,
          configured_mode: "observe",
          desired_mode: "observe",
          effective_mode: "observe",
          claimed_budget_mb: 4_000,
          claimed_backend_count: 1,
          status: "ok",
          diagnostics: [],
        },
      ],
      diagnostics: [],
    });
    renderUI();
    expect(await screen.findByText("node-a/index:0")).toBeInTheDocument();
    expect(screen.getByText("node-a/index:1")).toBeInTheDocument();
    expect(screen.getByText("node-b/index:0")).toBeInTheDocument();
    expect(screen.getByText("该卡存在弹性超售")).toBeInTheDocument();
    expect(screen.getByText("observe runtime ready")).toBeInTheDocument();
  });

  it("点击注册全局 backend → 打开 GlobalBackendFormModal", async () => {
    mockListAll.mockResolvedValue({ items: [makeGlobalItem()] });
    renderUI();
    await screen.findByText("grounded-sam2");
    fireEvent.click(screen.getByRole("button", { name: /注册全局 backend/ }));
    await waitFor(() => {
      expect(screen.getByTestId("global-backend-form-modal")).toBeInTheDocument();
    });
  });

  it("项目管理员 → 全局表只读 (无注册/编辑/删除) + 看不到项目启用概览", async () => {
    mockRole = "project_admin";
    mockListAll.mockResolvedValue({
      items: [
        makeGlobalItem({
          gpu_resource_id: null,
          vram_budget_mb: null,
          eviction_priority: null,
          gpu_config: null,
        }),
      ],
    });
    renderUI();
    await screen.findByText("grounded-sam2");
    expect(screen.queryByRole("button", { name: /注册全局 backend/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle("编辑")).not.toBeInTheDocument();
    expect(screen.queryByTitle("删除")).not.toBeInTheDocument();
    expect(screen.getByText(/注册由超级管理员维护/)).toBeInTheDocument();
    expect(screen.queryByText("GPU 配置")).not.toBeInTheDocument();
    expect(screen.queryByText("node-a/index:0")).not.toBeInTheDocument();
    // 项目启用概览仅超管可见
    expect(screen.queryByText("项目启用概览")).not.toBeInTheDocument();
    // 项目管理员不应触发超管专属 overview 查询
    expect(mockOverview).not.toHaveBeenCalled();
    expect(mockGpuResources).not.toHaveBeenCalled();
  });

  it("超管 → 项目启用概览只读渲染项目名与已启用 backend chip", async () => {
    mockOverview.mockResolvedValue(
      makeOverview({
        total_backends: 1,
        connected_backends: 1,
        projects: [
          {
            project_id: "p-1",
            project_name: "My AI Project",
            backends: [makeOverviewBackend()],
          },
        ],
      }),
    );
    renderUI();
    await screen.findByText("My AI Project");
    expect(screen.getByText("项目启用概览")).toBeInTheDocument();
    // chip 显示 backend 名 (全局表 + 概览各一处)
    expect(screen.getAllByText("grounded-sam2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("共 1 个 AI 项目 · 1 个 backend")).toBeInTheDocument();
    // 只读: 概览里没有 per-project 注册/编辑/删除
    expect(screen.getByText("打开项目设置 →")).toBeInTheDocument();
  });

  it("超管 → 项目已启用 AI 但无 backend → 显示告警 badge", async () => {
    mockOverview.mockResolvedValue(
      makeOverview({
        projects: [
          { project_id: "p-2", project_name: "Empty AI Project", backends: [] },
        ],
      }),
    );
    renderUI();
    await screen.findByText("Empty AI Project");
    expect(screen.getByText("AI 已启用 · 未启用 backend")).toBeInTheDocument();
  });
});
