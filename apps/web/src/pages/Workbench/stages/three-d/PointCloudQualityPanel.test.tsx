import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PointCloudQualityIssue } from "@/api/pointCloudQuality";

const issuesMock = vi.hoisted(() => vi.fn());
const runMock = vi.hoisted(() => vi.fn());
const runQueryMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());
const createFeedbackMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePointCloudQuality", () => ({
  usePointCloudQualityIssues: issuesMock,
  useRunPointCloudQuality: runMock,
  usePointCloudQualityRun: runQueryMock,
  usePatchPointCloudQualityIssue: patchMock,
}));

vi.mock("@/hooks/useFeedbacks", () => ({
  useCreateFeedback: createFeedbackMock,
}));

import { PointCloudQualityPanel } from "./PointCloudQualityPanel";

const issue: PointCloudQualityIssue = {
  id: "issue-1",
  run_id: "run-1",
  last_seen_run_id: "run-1",
  project_id: "project-1",
  scene_id: "scene-1",
  task_id: "task-1",
  annotation_id: "annotation-1",
  annotation_version: 2,
  scene_track_id: "track-1",
  track_revision: 3,
  related_annotation_ids: ["annotation-1"],
  source_versions: { "annotation-1": 2 },
  code: "ground_clearance",
  rule_version: 1,
  severity: "warning",
  status: "open",
  frame_start: 7,
  frame_end: 7,
  metric: { clearance_m: 0.72, ground_z: 0.04 },
  threshold: { ground_float_m: 0.45 },
  evidence: {},
  locator: {
    scene_id: "scene-1",
    frame_index: 7,
    task_id: "task-1",
    annotation_id: "annotation-1",
    scene_track_id: "track-1",
    camera: null,
    auxiliary_layers: ["ground"],
  },
  suggested_command: "inspect_ground_clearance",
  resolution_reason: null,
  resolved_by_id: null,
  resolved_at: null,
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

describe("PointCloudQualityPanel", () => {
  const runMutate = vi.fn();
  const patchMutate = vi.fn();
  const feedbackMutate = vi.fn();

  beforeEach(() => {
    runMutate.mockReset();
    patchMutate.mockReset();
    feedbackMutate.mockReset();
    issuesMock.mockReturnValue({
      data: { items: [issue], total: 1 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    runMock.mockReturnValue({ mutate: runMutate, isPending: false });
    runQueryMock.mockReturnValue({ data: undefined });
    patchMock.mockReturnValue({ mutate: patchMutate, isPending: false });
    createFeedbackMock.mockReturnValue({ mutate: feedbackMutate, isPending: false });
  });

  it("starts a scene scan and locates a structured issue", () => {
    const locate = vi.fn();
    render(
      <PointCloudQualityPanel
        projectId="project-1"
        sceneId="scene-1"
        taskId="task-1"
        canScanScene
        onClose={vi.fn()}
        onLocate={locate}
      />,
    );

    expect(screen.getByText("穿地或悬浮")).toBeTruthy();
    expect(screen.getByTestId("point-cloud-quality-issue-ground_clearance").textContent).toContain(
      "离地 0.72 m",
    );
    fireEvent.click(screen.getByText("扫描当前 Scene"));
    expect(runMutate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("定位"));
    expect(locate).toHaveBeenCalledWith(issue);
  });

  it("uses task scope for a reviewer who does not own the project", () => {
    render(
      <PointCloudQualityPanel
        projectId="project-1"
        sceneId="scene-1"
        taskId="task-1"
        canScanScene={false}
        onClose={vi.fn()}
        onLocate={vi.fn()}
      />,
    );

    expect(runMock).toHaveBeenCalledWith("project-1", {
      scope: "task_ids",
      task_ids: ["task-1"],
    });
    fireEvent.click(screen.getByText("扫描当前任务"));
    expect(runMutate).toHaveBeenCalledOnce();
  });

  it("requires a wont-fix reason and creates a first-class point-cloud discussion anchor", () => {
    render(
      <PointCloudQualityPanel
        projectId="project-1"
        sceneId="scene-1"
        taskId="task-1"
        canScanScene
        onClose={vi.fn()}
        onLocate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("无需处理"));
    const confirm = screen.getByText("确认");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("填写无需处理的原因"), {
      target: { value: "雨天稀疏回波" },
    });
    fireEvent.click(confirm);
    expect(patchMutate).toHaveBeenCalledWith(
      { issueId: "issue-1", status: "wont_fix", reason: "雨天稀疏回波" },
      expect.any(Object),
    );

    fireEvent.click(screen.getByText("讨论"));
    fireEvent.change(screen.getByPlaceholderText("记录判断或 @ 协作者"), {
      target: { value: "请再检查地面估计" },
    });
    fireEvent.click(screen.getByText("发送"));
    expect(feedbackMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor_type: "point_cloud",
        task_id: "task-1",
        annotation_id: "annotation-1",
        anchor_position: {
          frame: 7,
          point_cloud_quality_issue_id: "issue-1",
          scene_id: "scene-1",
          scene_track_id: "track-1",
          auxiliary_layers: ["ground"],
        },
      }),
      expect.any(Object),
    );
  });
});
