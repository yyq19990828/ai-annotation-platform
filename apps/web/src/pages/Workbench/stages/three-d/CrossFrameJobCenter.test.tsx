import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listCrossFrame: vi.fn(),
  createCrossFrame: vi.fn(),
  retryCrossFrame: vi.fn(),
  cancel: vi.fn(),
}));
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/api/asyncJobs", () => ({ asyncJobsApi: api }));
vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (selector: (state: { push: typeof pushToast }) => unknown) =>
    selector({ push: pushToast }),
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
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

import { CrossFrameJobCenter } from "./CrossFrameJobCenter";

function job(patch: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    kind: "point_cloud_cross_frame",
    project_id: "project-1",
    user_id: "user-1",
    project_display_id: "P-1",
    project_name: "Point cloud",
    status: "completed",
    progress_pct: 100,
    payload: { start_frame: 13, end_frame: 22 },
    result: {
      success_count: 10,
      skipped_count: 0,
      failed_count: 0,
      stale_count: 0,
    },
    error_message: null,
    celery_task_id: "celery-1",
    started_at: "2026-08-25T00:00:00Z",
    completed_at: "2026-08-25T00:01:00Z",
    created_at: "2026-08-25T00:00:00Z",
    updated_at: "2026-08-25T00:01:00Z",
    ...patch,
  };
}

function renderCenter(patch: Partial<React.ComponentProps<typeof CrossFrameJobCenter>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CrossFrameJobCenter
        open
        onClose={vi.fn()}
        taskId="task-12"
        currentFrame={12}
        sceneStartFrame={0}
        sceneEndFrame={30}
        selectedAnnotationIds={["ann-1", "ann-2"]}
        selectedTrackId="trk-selected"
        boxCount={5}
        readOnly={false}
        {...patch}
      />
    </QueryClientProvider>,
  );
}

describe("CrossFrameJobCenter", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    pushToast.mockReset();
    api.listCrossFrame.mockResolvedValue({ items: [], total: 0 });
    api.createCrossFrame.mockResolvedValue(job({ status: "pending", progress_pct: 0 }));
    api.retryCrossFrame.mockResolvedValue(job({ id: "job-retry", status: "pending" }));
    api.cancel.mockResolvedValue({ status: "cancelled", id: "job-1" });
  });

  it("submits explicit selected scope, direction, range, and conflict policy", async () => {
    renderCenter();

    fireEvent.click(screen.getByRole("button", { name: "启动任务" }));

    await waitFor(() =>
      expect(api.createCrossFrame).toHaveBeenCalledWith("task-12", {
        operation: "propagate",
        scope: "selected",
        annotation_ids: ["ann-1", "ann-2"],
        direction: "forward",
        start_frame: 13,
        end_frame: 22,
        conflict_policy: "skip_existing",
      }),
    );
  });

  it("requires an explicit valid scope and blocks writes in read-only mode", () => {
    renderCenter({ selectedAnnotationIds: [], boxCount: 0, readOnly: true });

    expect(screen.getByRole("radio", { name: /已选择对象/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /当前帧全部框/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "启动任务" })).toBeDisabled();
    expect(screen.getByText("当前任务只读，不能启动写任务。")).toBeTruthy();
  });

  it("caps one job at 500 source boxes", () => {
    renderCenter({ selectedAnnotationIds: [], boxCount: 501 });

    expect(screen.getByText(/单个任务最多传播 500 个 3D 框/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "启动任务" })).toBeDisabled();
  });

  it("keeps track identity correction in the same cross-frame center", () => {
    renderCenter();

    fireEvent.click(screen.getByRole("tab", { name: "轨迹修正" }));

    expect(screen.getByRole("region", { name: "3D 轨迹修正" })).toBeTruthy();
    expect(screen.getByText(/当前 survivor/)).toBeTruthy();
  });

  it("cancels active jobs and retries only terminal jobs with failed frames", async () => {
    api.listCrossFrame.mockResolvedValue({
      items: [
        job({ id: "running-job", status: "running", progress_pct: 30 }),
        job({
          id: "failed-job",
          status: "failed",
          result: { failed_count: 1, stale_count: 1 },
        }),
      ],
      total: 2,
    });
    renderCenter();

    await screen.findByText("30%");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "重试失败帧" }));

    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("running-job"));
    await waitFor(() => expect(api.retryCrossFrame).toHaveBeenCalledWith("task-12", "failed-job"));
  });
});
