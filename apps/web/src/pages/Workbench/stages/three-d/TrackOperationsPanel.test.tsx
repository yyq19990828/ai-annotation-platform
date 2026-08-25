import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";

const api = vi.hoisted(() => ({
  listPointCloudTrackOperationCandidates: vi.fn(),
  previewPointCloudTrackOperation: vi.fn(),
  executePointCloudTrackOperation: vi.fn(),
}));
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/api/tasks", () => ({ tasksApi: api }));
vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (selector: (state: { push: typeof pushToast }) => unknown) =>
    selector({ push: pushToast }),
}));

import { TrackOperationsPanel } from "./TrackOperationsPanel";

function preview(operation: "split" | "merge") {
  return {
    contract_version: 1 as const,
    operation,
    scene_id: "scene-1",
    scene_name: "scene-0061",
    primary: {
      track_id: "trk-primary",
      class_name: "car",
      member_count: 3,
      first_frame: 10,
      last_frame: 12,
    },
    secondary:
      operation === "merge"
        ? {
            track_id: "trk-secondary",
            class_name: "car",
            member_count: 2,
            first_frame: 13,
            last_frame: 14,
          }
        : null,
    survivor_track_id: "trk-primary",
    affected_member_count: operation === "merge" ? 5 : 3,
    rewritten_member_count: 2,
    snapshot_token: "a".repeat(64),
  };
}

function renderPanel(patch: Partial<React.ComponentProps<typeof TrackOperationsPanel>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCompleted = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TrackOperationsPanel
        taskId="task-12"
        currentFrame={12}
        selectedTrackId="trk-primary"
        readOnly={false}
        onCompleted={onCompleted}
        {...patch}
      />
    </QueryClientProvider>,
  );
  return { onCompleted };
}

describe("TrackOperationsPanel", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    pushToast.mockReset();
    api.listPointCloudTrackOperationCandidates.mockResolvedValue({
      contract_version: 1,
      primary: preview("split").primary,
      candidates: [
        {
          track_id: "trk-secondary",
          class_name: "car",
          member_count: 2,
          first_frame: 13,
          last_frame: 14,
        },
      ],
      truncated: false,
    });
    api.previewPointCloudTrackOperation.mockImplementation(
      (_taskId: string, body: { operation: "split" | "merge" }) =>
        Promise.resolve(preview(body.operation)),
    );
    api.executePointCloudTrackOperation.mockImplementation(
      (_taskId: string, body: { operation: "split" | "merge" }) =>
        Promise.resolve({
          ...preview(body.operation),
          created_track_id: body.operation === "split" ? "trk-new" : null,
          updated_member_count: body.operation === "split" ? 3 : 5,
        }),
    );
  });

  it("requires a selected 3D track", () => {
    renderPanel({ selectedTrackId: null });

    expect(screen.getByText(/请先在当前帧选择/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "预览影响" })).toBeNull();
  });

  it("previews and confirms a split with the snapshot token", async () => {
    const { onCompleted } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "预览影响" }));
    await screen.findByText(/共更新 3 个成员/);
    expect(api.previewPointCloudTrackOperation).toHaveBeenCalledWith("task-12", {
      operation: "split",
      primary_track_id: "trk-primary",
      split_after_frame: 12,
    });

    fireEvent.click(screen.getByRole("button", { name: "确认拆分" }));
    await waitFor(() =>
      expect(api.executePointCloudTrackOperation).toHaveBeenCalledWith("task-12", {
        operation: "split",
        primary_track_id: "trk-primary",
        split_after_frame: 12,
        snapshot_token: "a".repeat(64),
      }),
    );
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith({ msg: "轨迹已拆分", kind: "success" });
  });

  it("loads safe candidates and keeps the selected track as merge survivor", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "合并轨迹" }));

    const select = await screen.findByRole("combobox", { name: "合并候选轨迹" });
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(select, { target: { value: "trk-secondary" } });
    fireEvent.click(screen.getByRole("button", { name: "预览影响" }));

    await screen.findByText(/共更新 5 个成员/);
    expect(api.previewPointCloudTrackOperation).toHaveBeenCalledWith("task-12", {
      operation: "merge",
      primary_track_id: "trk-primary",
      secondary_track_id: "trk-secondary",
    });
    expect(screen.getByText(/合并到当前轨迹/)).toBeTruthy();
  });

  it("drops a stale confirmation and requires a fresh preview", async () => {
    api.executePointCloudTrackOperation.mockRejectedValue(
      new ApiError(409, "stale", { reason: "track_snapshot_stale" }),
    );
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "预览影响" }));
    await screen.findByText(/共更新 3 个成员/);
    fireEvent.click(screen.getByRole("button", { name: "确认拆分" }));

    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith({
        msg: "轨迹已变化，请重新预览",
        kind: "warning",
      }),
    );
    expect(screen.queryByRole("button", { name: "确认拆分" })).toBeNull();
  });

  it("blocks previews in read-only mode", () => {
    renderPanel({ readOnly: true });

    expect(screen.getByText("当前任务只读，不能修改轨迹身份。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "预览影响" })).toBeDisabled();
  });
});
