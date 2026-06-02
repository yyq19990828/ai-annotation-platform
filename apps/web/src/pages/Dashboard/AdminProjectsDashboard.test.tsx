import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseProjects = vi.fn();
const mockUseProjectStats = vi.fn();
const mockPushToast = vi.fn();
const mockBuildWorkbenchUrl = vi.hoisted(() => vi.fn((id: string) => `/workbench/${id}`));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: (...args: unknown[]) => mockUseProjects(...args),
  useProjectStats: () => mockUseProjectStats(),
}));

vi.mock("@/components/projects/CreateProjectWizard", () => ({
  CreateProjectWizard: ({ open }: { open?: boolean }) => (open ? <div data-testid="cp-wizard" /> : null),
}));

vi.mock("@/components/datasets/ImportDatasetWizard", () => ({
  ImportDatasetWizard: ({ open }: { open?: boolean }) => (open ? <div data-testid="id-wizard" /> : null),
}));

vi.mock("./FilterDrawer", () => ({
  FilterDrawer: () => null,
  EMPTY_FILTERS: { data_type: [], member_id: undefined, created_from: undefined, created_to: undefined, status: undefined },
}));

vi.mock("./ExportSection", () => ({
  ExportSection: () => null,
}));

vi.mock("@/utils/workbenchNavigation", () => ({
  buildWorkbenchUrl: (id: string) => mockBuildWorkbenchUrl(id),
  currentWorkbenchReturnTo: () => "/dashboard?view=projects",
}));

vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/Toast")>(
    "@/components/ui/Toast",
  );
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: { push: typeof mockPushToast }) => T) =>
      sel({ push: mockPushToast }),
  };
});

import { AdminProjectsDashboard } from "./AdminProjectsDashboard";

function renderUI(initialPath = "/dashboard?view=projects") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AdminProjectsDashboard />
    </MemoryRouter>,
  );
}

describe("AdminProjectsDashboard", () => {
  beforeEach(() => {
    mockUseProjects.mockReset();
    mockUseProjectStats.mockReset();
    mockPushToast.mockReset();
    mockBuildWorkbenchUrl.mockClear();
    mockUseProjects.mockReturnValue({ data: [], isLoading: false });
    mockUseProjectStats.mockReturnValue({ data: undefined });
  });

  it("renders a super-admin project management surface", () => {
    renderUI();
    expect(screen.getByRole("heading", { name: "项目管理" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "全部项目" })).toBeInTheDocument();
    expect(screen.queryByText("我的项目")).not.toBeInTheDocument();
  });

  it("uses real stat series instead of mocked trend hints", () => {
    mockUseProjectStats.mockReturnValue({
      data: {
        total_data: 97,
        completed: 0,
        ai_rate: 0,
        pending_review: 0,
        total_data_series: [40, 44, 48, 50, 55, 60, 66, 70, 76, 82, 90, 97],
        completed_series: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ai_rate_series: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        pending_review_series: [2, 2, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      },
    });
    renderUI();
    expect(screen.getByText("97")).toBeInTheDocument();
    expect(screen.getByText("AI 派生标注率")).toBeInTheDocument();
    expect(screen.getAllByText("近 12 周").length).toBeGreaterThan(0);
    expect(screen.queryByText("↑ 12%")).not.toBeInTheDocument();
  });

  it("does not open projects from row text; the open button still enters workbench", () => {
    mockUseProjects.mockReturnValue({
      data: [
        {
          id: "p1",
          display_id: "P-1",
          name: "Demo项目",
          type_label: "图像 · 目标检测",
          type_key: "image-det",
          data_type: "image",
          owner_id: "u1",
          owner_name: "Alice",
          member_count: 2,
          status: "in_progress",
          total_tasks: 10,
          completed_tasks: 5,
          review_tasks: 0,
          in_progress_tasks: 0,
          ai_enabled: false,
        },
      ],
      isLoading: false,
    });
    renderUI();
    fireEvent.click(screen.getByText("Demo项目"));
    expect(mockBuildWorkbenchUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /打开/ }));
    expect(mockBuildWorkbenchUrl).toHaveBeenCalledWith("p1");
  });
});
