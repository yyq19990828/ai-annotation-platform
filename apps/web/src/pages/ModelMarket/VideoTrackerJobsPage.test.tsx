import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import type {
  VideoTrackerJobCounts,
  VideoTrackerJobListItem,
  VideoTrackerJobStatus,
} from "@/api/videoTrackerJobs";

const mockListVideoJobs = vi.fn();
const mockListProjects = vi.fn();
const mockBuildWorkbenchUrl = vi.fn(
  (..._args: unknown[]) => "/projects/project-video/annotate?task=task-1",
);

vi.mock("@/api/videoTrackerJobs", () => ({
  videoTrackerJobsApi: {
    list: (...args: unknown[]) => mockListVideoJobs(...args),
  },
}));

vi.mock("@/api/projects", () => ({
  projectsApi: {
    list: (...args: unknown[]) => mockListProjects(...args),
  },
}));

vi.mock("@/utils/workbenchNavigation", () => ({
  buildWorkbenchUrl: (...args: unknown[]) => mockBuildWorkbenchUrl(...args),
  currentWorkbenchReturnTo: () => "/ai-pre/jobs?tab=video",
}));

import { VideoTrackerJobsPanel } from "./VideoTrackerJobsPage";

const EMPTY_COUNTS: VideoTrackerJobCounts = {
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  pending_review: 0,
  partially_reviewed: 0,
  accepted: 0,
  discarded: 0,
};

function makeJob(status: VideoTrackerJobStatus, index: number): VideoTrackerJobListItem {
  return {
    id: `job-${index}`,
    task_id: `task-${index}`,
    project_id: "project-video",
    project_name: "城市交通追踪",
    project_display_id: "P-VIDEO",
    dataset_item_id: `item-${index}`,
    annotation_id: `track-${index}`,
    segment_id: null,
    created_by: "user-1",
    status,
    model_key: "sam3_video",
    direction: "forward",
    from_frame: index * 10,
    to_frame: index * 10 + 90,
    error_message: null,
    started_at: "2026-08-16T08:00:00Z",
    completed_at: status === "running" ? null : "2026-08-16T08:00:10Z",
    created_at: "2026-08-16T08:00:00Z",
  };
}

function response(items: VideoTrackerJobListItem[], nextCursor: string | null = null) {
  const counts = { ...EMPTY_COUNTS };
  items.forEach((item) => {
    counts[item.status] += 1;
  });
  return { items, next_cursor: nextCursor, counts };
}

function renderPanel(projectId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/ai-pre/jobs?tab=video"]}>
        <VideoTrackerJobsPanel projectId={projectId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VideoTrackerJobsPanel", () => {
  beforeEach(() => {
    mockListVideoJobs.mockReset();
    mockListProjects.mockReset();
    mockBuildWorkbenchUrl.mockClear();
    mockListProjects.mockResolvedValue([
      { id: "project-video", name: "城市交通追踪", display_id: "P-VIDEO" },
      { id: "project-road", name: "道路目标追踪", display_id: "P-ROAD" },
    ]);
    mockListVideoJobs.mockResolvedValue(response([]));
  });

  it("使用专用 API 同时展示执行态和候选审阅态", async () => {
    const items = [
      makeJob("running", 1),
      makeJob("pending_review", 2),
      makeJob("accepted", 3),
      makeJob("discarded", 4),
    ];
    mockListVideoJobs.mockResolvedValue(response(items));

    renderPanel();

    expect(await screen.findByText("视频追踪任务 (4)")).toBeInTheDocument();
    expect(screen.getAllByText(/运行中/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/待审阅/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已采纳/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已丢弃/).length).toBeGreaterThan(0);
    expect(mockListVideoJobs).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
  });

  it("项目和状态筛选传给视频追踪任务 API", async () => {
    renderPanel();
    await screen.findByText("暂无视频追踪任务");

    fireEvent.change(screen.getByLabelText("筛选视频项目"), {
      target: { value: "project-road" },
    });
    fireEvent.change(screen.getByLabelText("筛选视频任务状态"), {
      target: { value: "pending_review" },
    });

    await waitFor(() => {
      expect(mockListVideoJobs).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "project-road",
          status: "pending_review",
        }),
      );
    });
  });

  it("URL 项目过滤会初始化专用 API 查询", async () => {
    renderPanel("project-video");

    await waitFor(() => {
      expect(mockListVideoJobs).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: "project-video" }),
      );
    });
  });

  it("逐任务返回对应视频工作台并保留返回地址", async () => {
    mockListVideoJobs.mockResolvedValue(response([makeJob("pending_review", 2)]));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /返回视频工作台/ }));
    expect(mockBuildWorkbenchUrl).toHaveBeenCalledWith(
      "project-video",
      expect.objectContaining({
        taskId: "task-2",
        trackId: "track-2",
        frameIndex: 20,
        returnTo: "/ai-pre/jobs?tab=video",
      }),
    );
  });
});
