/**
 * v0.19.0 · ADR-0044 · MlBackendsSection 启用清单单测 —
 * 已启用角标 / 勾选启用调 setEnablement / 空态 / AI 设置保存设主后端 (仅从已启用项选)。
 *
 * 项目层不再「注册 backend」(全局 backend 由超管在模型市场注册); 旧上限态断言已废弃。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockUseAvailable = vi.fn();
const mockSetup = vi.fn();
const mockUpdateMutate = vi.fn();
const mockSetEnablementMutate = vi.fn();

vi.mock("@/hooks/useMLBackends", () => ({
  useAvailableMLBackends: () => mockUseAvailable(),
  useSetMLBackendEnablement: () => ({ mutate: mockSetEnablementMutate, isPending: false }),
  useMLBackendHealth: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useProjects", () => ({
  useUpdateProject: () => ({ mutate: mockUpdateMutate, isPending: false }),
}));
vi.mock("@/hooks/useUnsavedWarning", () => ({
  useUnsavedWarning: vi.fn(),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ role: "project_admin" }),
}));
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/Toast")>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: { push: ReturnType<typeof vi.fn> }) => T) =>
      sel({ push: vi.fn() }),
  };
});
vi.mock("@/api/ml-backends", () => ({
  mlBackendsApi: { setup: (...a: unknown[]) => mockSetup(...a) },
  mlBackendSetupQueryKey: (p: unknown, b: unknown) => ["ml-backends", p, b, "setup"],
}));

import { MlBackendsSection } from "../MlBackendsSection";
import type { ProjectResponse } from "@/api/projects";

function renderSection(project: Partial<ProjectResponse>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const merged = {
    id: "p1",
    ai_enabled: false,
    ml_backend_id: null,
    iou_dedup_threshold: 0.7,
    text_output_default: null,
    ...project,
  };
  return render(
    <QueryClientProvider client={qc}>
      <MlBackendsSection project={merged as ProjectResponse} />
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

function item(enabled: boolean) {
  return {
    backend: SAMPLE_BACKEND,
    enabled,
    box_threshold: null,
    text_threshold: null,
    default_variants: null,
  };
}

beforeEach(() => {
  mockUseAvailable.mockReset();
  mockSetup.mockReset();
  mockUpdateMutate.mockReset();
  mockSetEnablementMutate.mockReset();
  mockSetup.mockResolvedValue({ name: "grounded-sam2", supported_prompts: ["point", "bbox", "text"] });
});

describe("MlBackendsSection 启用清单", () => {
  it("已启用角标 = 启用数 / 全局总数", () => {
    mockUseAvailable.mockReturnValue({
      data: { items: [item(true)] },
      isLoading: false,
      isError: false,
    });
    renderSection({ id: "p1", ml_backend_id: null });
    expect(screen.getByTestId("ml-backend-quota").textContent).toContain("已启用 1 / 1");
  });

  it("在「管理 backend」悬浮面板里勾选启用调 setEnablement", () => {
    mockUseAvailable.mockReturnValue({
      data: { items: [item(false)] },
      isLoading: false,
      isError: false,
    });
    renderSection({ id: "p1", ml_backend_id: null });
    // 主表只显示已启用项; 未启用项的启用勾选在悬浮面板里, 先打开面板。
    fireEvent.click(screen.getByRole("button", { name: /管理 backend/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /启用 grounded-sam2/ }));
    expect(mockSetEnablementMutate).toHaveBeenCalledTimes(1);
    const [args] = mockSetEnablementMutate.mock.calls[0];
    expect(args).toMatchObject({ registryId: "b1", payload: { enabled: true } });
  });

  it("主表只显示已启用项: 未启用的 backend 不出现在主表", () => {
    mockUseAvailable.mockReturnValue({
      data: { items: [item(false)] },
      isLoading: false,
      isError: false,
    });
    renderSection({ id: "p1", ml_backend_id: null });
    // 主表空态 (未启用任何), 面板未开 ⇒ 行内启用勾选不可见。
    expect(screen.getByText(/本项目暂未启用任何 ML backend/)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /启用 grounded-sam2/ })).toBeNull();
  });

  it("无全局 backend 时主表空态提示去模型市场注册", () => {
    mockUseAvailable.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    });
    renderSection({ id: "p1", ml_backend_id: null });
    expect(screen.getByText(/本项目暂未启用任何 ML backend/)).toBeTruthy();
    expect(screen.getByText(/模型市场/)).toBeTruthy();
  });

  it("AI 设置保存时从已启用项设项目主后端", () => {
    mockUseAvailable.mockReturnValue({
      data: { items: [item(true)] },
      isLoading: false,
      isError: false,
    });
    renderSection({ id: "p1", ml_backend_id: null });

    fireEvent.click(screen.getByRole("checkbox", { name: /启用 AI 预标注/ }));
    fireEvent.change(screen.getByDisplayValue(/未设项目主后端/), {
      target: { value: "b1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保存 AI 设置/ }));

    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    const [payload] = mockUpdateMutate.mock.calls[0];
    expect(payload).toMatchObject({
      ai_enabled: true,
      ml_backend_id: "b1",
      iou_dedup_threshold: 0.7,
    });
  });
});
