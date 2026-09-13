import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actions: {
    assignmentPreview: vi.fn(),
    assignmentApply: vi.fn(),
    exportTasks: vi.fn(),
    preannotate: vi.fn(),
  },
  jobs: new Map<string, { status: string; progress_pct: number; error_message: string | null }>(),
  invalidate: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/api/dataManagerActions", () => ({
  dataManagerTaskActionsApi: mocks.actions,
}));

vi.mock("@/hooks/useProjects", () => ({
  useProject: () => ({
    data: {
      id: "project-1",
      name: "Project",
      display_id: "P-1",
      data_type: "image",
      ml_backend_id: "backend-1",
    },
  }),
  useProjectMembers: () => ({
    data: [
      {
        user_id: "u-annotator",
        user_name: "Ada",
        user_email: "ada@example.com",
        role: "annotator",
      },
      {
        user_id: "u-reviewer",
        user_name: "Grace",
        user_email: "grace@example.com",
        role: "reviewer",
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useMLBackends", () => ({
  useMLBackends: () => ({ data: [{ id: "backend-1", name: "Default backend" }] }),
}));

vi.mock("@/hooks/useAsyncJob", () => ({
  useAsyncJob: (jobId: string | null) => ({
    data: jobId ? mocks.jobs.get(jobId) : undefined,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));

vi.mock("@/pages/AIPreAnnotate/components/usePreannotateConfig", () => ({
  usePreannotateConfig: () => ({
    configReady: true,
    sourceBatchableWarning: null,
    buildArgs: () => ({
      ml_backend_id: "backend-1",
      params: {},
      predict_mode: "skip_predicted",
    }),
  }),
}));

vi.mock("@/pages/AIPreAnnotate/components/PreannotateConfigForm", () => ({
  PreannotateConfigForm: () => <div data-testid="preannotate-config-form" />,
}));

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    open ? (
      <section role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </section>
    ) : null,
}));

import { DataManagerTaskActions } from "./DataManagerTaskActions";

const preview = {
  task_ids: ["task-1"],
  preview_version: "p".repeat(64),
  eligible_count: 1,
  skipped_count: 0,
  failed_count: 0,
  succeeded: [],
  items: [
    {
      task_id: "task-1",
      task_display_id: "T-1",
      batch_id: null,
      status: "pending",
      task_updated_at: null,
      before_annotator_id: null,
      after_annotator_id: "u-annotator",
      before_reviewer_id: null,
      after_reviewer_id: null,
      will_change: true,
      reason: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jobs.clear();
  mocks.actions.assignmentPreview.mockResolvedValue(preview);
  mocks.actions.assignmentApply.mockResolvedValue({
    ...preview,
    eligible_count: 1,
    succeeded: ["task-1"],
  });
  mocks.actions.exportTasks.mockResolvedValue({
    job_id: "job-export",
    status: "queued",
  });
});

describe("DataManagerTaskActions", () => {
  it("shows member targets in preview and preserves the applied summary", async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    render(
      <DataManagerTaskActions
        projectId="project-1"
        taskIds={["task-1"]}
        onCompleted={onCompleted}
      />,
    );

    await user.click(screen.getByTestId("data-manager-assign"));
    await user.selectOptions(screen.getByLabelText("标注员"), "u-annotator");
    await user.click(screen.getByRole("button", { name: "预览分派" }));

    await waitFor(() => expect(mocks.actions.assignmentPreview).toHaveBeenCalledOnce());
    expect(screen.getByText("标注员：未分派 → Ada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "应用 1 个任务" }));

    await waitFor(() => expect(mocks.actions.assignmentApply).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("已更新 1 个任务");
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it("keeps the submitted job status after the parent clears selection and invalidates once", async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    const view = render(
      <DataManagerTaskActions
        projectId="project-1"
        taskIds={["task-1"]}
        onCompleted={onCompleted}
      />,
    );

    await user.click(screen.getByTestId("data-manager-export"));
    await user.click(screen.getByRole("button", { name: "创建导出作业" }));
    await waitFor(() => expect(mocks.actions.exportTasks).toHaveBeenCalledOnce());
    expect(screen.getByText(/job-export/)).toBeInTheDocument();

    mocks.jobs.set("job-export", {
      status: "completed",
      progress_pct: 100,
      error_message: null,
    });
    view.rerender(
      <DataManagerTaskActions projectId="project-1" taskIds={[]} onCompleted={onCompleted} />,
    );
    await waitFor(() => expect(screen.getByText(/导出作业/)).toHaveTextContent("已完成"));
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["tasks", "project-1"],
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(6);
    expect(mocks.actions.exportTasks).toHaveBeenCalledOnce();
  });

  it("keeps a single dispatch while an export request is pending", async () => {
    const user = userEvent.setup();
    let resolveExport!: (value: { job_id: string; status: string }) => void;
    mocks.actions.exportTasks.mockReturnValue(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );
    render(<DataManagerTaskActions projectId="project-1" taskIds={["task-1"]} />);

    await user.click(screen.getByTestId("data-manager-export"));
    const submit = screen.getByRole("button", { name: "创建导出作业" });
    await user.click(submit);
    await user.click(submit);
    expect(mocks.actions.exportTasks).toHaveBeenCalledOnce();

    resolveExport({ job_id: "job-export", status: "queued" });
    await waitFor(() => expect(screen.getByText(/job-export/)).toBeInTheDocument());
  });

  it("drops a late preview after the selected task scope changes", async () => {
    const user = userEvent.setup();
    let resolvePreview!: (value: typeof preview) => void;
    mocks.actions.assignmentPreview.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const view = render(<DataManagerTaskActions projectId="project-1" taskIds={["task-1"]} />);

    await user.click(screen.getByTestId("data-manager-assign"));
    await user.selectOptions(screen.getByLabelText("标注员"), "u-annotator");
    await user.click(screen.getByRole("button", { name: "预览分派" }));
    view.rerender(<DataManagerTaskActions projectId="project-1" taskIds={["task-2"]} />);
    resolvePreview(preview);

    await waitFor(() => expect(mocks.actions.assignmentPreview).toHaveBeenCalledOnce());
    expect(screen.queryByText("标注员：未分派 → Ada")).not.toBeInTheDocument();
  });
});
