/**
 * RegisteredBackendsTab 单测
 * 覆盖: 加载态 / 错误态 / 空项目列表 / 有项目+backend 渲染 / 注册管理动作
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
vi.mock("@/api/adminMlIntegrations", () => ({
  adminMlIntegrationsApi: {
    overview: () => mockOverview(),
  },
}));

// ── useMLBackends hooks mock ──────────────────────────────────────────────────
const mockDeleteMutate = vi.fn();
const mockHealthMutate = vi.fn();
const mockUnloadMutate = vi.fn();
const mockReloadMutate = vi.fn();

vi.mock("@/hooks/useMLBackends", () => ({
  useDeleteMLBackend: () => ({ mutate: mockDeleteMutate, isPending: false }),
  useMLBackendHealth: () => ({ mutate: mockHealthMutate, isPending: false }),
  useMLBackendUnload: () => ({ mutate: mockUnloadMutate, isPending: false }),
  useMLBackendReload: () => ({ mutate: mockReloadMutate, isPending: false }),
}));

// ── MlBackendFormModal mock ───────────────────────────────────────────────────
vi.mock("@/components/projects/MlBackendFormModal", () => ({
  MlBackendFormModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="ml-backend-form-modal">modal</div> : null,
}));

// ── VariantPanel mock ────────────────────────────────────────────────────────
vi.mock("./VariantPanel", () => ({
  VariantPanel: () => <div data-testid="variant-panel">variant-panel</div>,
}));

import { RegisteredBackendsTab } from "./RegisteredBackendsTab";

function makeBackend(overrides: Record<string, unknown> = {}) {
  return {
    id: "bk-1",
    project_id: "p-1",
    name: "grounded-sam2",
    url: "http://localhost:8080",
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
    mockDeleteMutate.mockReset();
    mockHealthMutate.mockReset();
    mockUnloadMutate.mockReset();
    mockReloadMutate.mockReset();
    // 默认: 正常返回空 overview
    mockOverview.mockResolvedValue(makeOverview());
  });

  it("加载态 → 显示加载中文本", () => {
    mockOverview.mockImplementation(() => new Promise(() => {}));
    renderUI();
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("错误态 → 显示加载失败 + 重试按钮", async () => {
    mockOverview.mockRejectedValue(new Error("网络故障"));
    renderUI();
    await screen.findByText(/加载失败/);
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("空项目列表 → 显示空状态提示", async () => {
    mockOverview.mockResolvedValue(makeOverview());
    renderUI();
    await screen.findByText(/尚无项目启用 AI/);
  });

  it("有项目+backend → 渲染项目名与 backend 名", async () => {
    mockOverview.mockResolvedValue(
      makeOverview({
        total_backends: 1,
        connected_backends: 1,
        projects: [
          {
            project_id: "p-1",
            project_name: "My AI Project",
            backends: [makeBackend()],
          },
        ],
      }),
    );
    renderUI();
    await screen.findByText("My AI Project");
    expect(screen.getByText("grounded-sam2")).toBeInTheDocument();
  });

  it("注册管理不再渲染运行时生命周期动作", async () => {
    mockOverview.mockResolvedValue(
      makeOverview({
        total_backends: 1,
        connected_backends: 1,
        projects: [
          {
            project_id: "p-1",
            project_name: "My AI Project",
            backends: [makeBackend()],
          },
        ],
      }),
    );
    renderUI();
    await screen.findByText("grounded-sam2");
    expect(screen.queryByTitle("健康检查")).not.toBeInTheDocument();
    expect(screen.queryByTitle("卸载模型释放显存 (空闲时建议)")).not.toBeInTheDocument();
    expect(screen.getByTitle("编辑")).toBeInTheDocument();
    expect(screen.getByTitle("删除")).toBeInTheDocument();
  });

  it("点击注册按钮 → 打开 MlBackendFormModal", async () => {
    mockOverview.mockResolvedValue(
      makeOverview({
        total_backends: 1,
        connected_backends: 1,
        projects: [
          {
            project_id: "p-1",
            project_name: "My AI Project",
            backends: [makeBackend()],
          },
        ],
      }),
    );
    renderUI();
    await screen.findByText("My AI Project");
    // 点击「注册」按钮
    const registerBtns = screen.getAllByRole("button", { name: /注册/ });
    fireEvent.click(registerBtns[0]);
    await waitFor(() => {
      expect(screen.getByTestId("ml-backend-form-modal")).toBeInTheDocument();
    });
  });

  it("表头显示项目/backend 总数", async () => {
    mockOverview.mockResolvedValue(
      makeOverview({
        total_backends: 3,
        connected_backends: 2,
        projects: [
          {
            project_id: "p-1",
            project_name: "Project X",
            backends: [makeBackend()],
          },
        ],
      }),
    );
    renderUI();
    await screen.findByText("共 1 个 AI 项目 · 3 个 backend");
  });
});
