/**
 * v0.10.3 · MlBackendsSection 上限态单测 — 配额角标 / 按钮 disabled / 强行点击触发 LimitModal.
 *
 * 仅覆盖 M3 新增行为. 其他业务行为 (绑定/删除/编辑) 沿用 v0.9.x 既有 e2e.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockUseMLBackends = vi.fn();
const mockSetup = vi.fn();

vi.mock("@/hooks/useMLBackends", () => ({
  useMLBackends: () => mockUseMLBackends(),
  useDeleteMLBackend: () => ({ mutate: vi.fn(), isPending: false }),
  useMLBackendHealth: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useProjects", () => ({
  useUpdateProject: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ role: "project_admin" }),
}));
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<any>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: any) => T) => sel({ push: vi.fn() }),
  };
});
vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: { setup: (...a: any[]) => mockSetup(...a) },
}));
// FormModal 在 limit 态下不会真正打开 — 用空实现避免依赖.
vi.mock("@/components/projects/MlBackendFormModal", () => ({
  MlBackendFormModal: () => null,
}));

import { MlBackendsSection } from "../MlBackendsSection";
import type { ProjectResponse } from "@/api/projects";

// v0.10.3 · ml_backend_limit 后端字段, codegen 未重跑前 ProjectOut 上没有声明; 测试侧用 augmented 类型.
type ProjectWithLimit = Partial<ProjectResponse> & { ml_backend_limit?: number };

function renderSection(project: ProjectWithLimit) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MlBackendsSection project={project as ProjectResponse} />
    </QueryClientProvider>,
  );
}

const SAMPLE_BACKEND = {
  id: "b1",
  name: "grounded-sam2",
  url: "http://172.17.0.1:8001",
  is_interactive: true,
  state: "connected",
  last_checked_at: null,
  auth_method: "none",
  extra_params: {},
};

beforeEach(() => {
  mockUseMLBackends.mockReset();
  mockSetup.mockReset();
  mockSetup.mockResolvedValue({ name: "grounded-sam2", supported_prompts: ["point", "bbox", "text"] });
});

describe("MlBackendsSection 上限态", () => {
  it("已用 1 / 1 角标 + 注册按钮 disabled", () => {
    mockUseMLBackends.mockReturnValue({ data: [SAMPLE_BACKEND], isLoading: false, isError: false });
    renderSection({ id: "p1", ml_backend_id: null, ml_backend_limit: 1 });
    expect(screen.getByTestId("ml-backend-quota").textContent).toContain("已用 1 / 1");
    const btn = screen.getByRole("button", { name: /注册 backend/ });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toContain("已达上限 1");
  });

  it("未达上限时按钮可用", () => {
    mockUseMLBackends.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderSection({ id: "p1", ml_backend_id: null, ml_backend_limit: 1 });
    expect(screen.getByTestId("ml-backend-quota").textContent).toContain("已用 0 / 1");
    expect(screen.getByRole("button", { name: /注册 backend/ })).not.toBeDisabled();
  });

  it("limit=0 视为不限, 角标显示 ∞", () => {
    mockUseMLBackends.mockReturnValue({ data: [SAMPLE_BACKEND], isLoading: false, isError: false });
    renderSection({ id: "p1", ml_backend_id: null, ml_backend_limit: 0 });
    expect(screen.getByTestId("ml-backend-quota").textContent).toContain("已用 1 / ∞");
    expect(screen.getByRole("button", { name: /注册 backend/ })).not.toBeDisabled();
  });
});
