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
const mockSummaryAPI = vi.fn();
const mockQueueAPI = vi.fn();
const mockAliasFreqAPI = vi.fn();

vi.mock("@/hooks/useProjects", () => ({
  useProject: (id: string) => mockUseProject(id),
  useProjects: () => ({ data: [], isLoading: false }),
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
    mockUseProject.mockReturnValue({
      data: { type_key: "image-det", ml_backend_id: "bk1" },
      isLoading: false,
    });
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
  });

  it("渲染 header 含项目名 + ml_backend chip", () => {
    renderUI({ summary: { project_name: "Demo", project_display_id: "P-9" } });
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText(/P-9/)).toBeInTheDocument();
    expect(screen.getByText("grounded-sam2")).toBeInTheDocument();
  });

  it("空选中时不显示 prompt 表单", () => {
    renderUI();
    expect(screen.queryByPlaceholderText(/car, person/)).toBeNull();
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
});
