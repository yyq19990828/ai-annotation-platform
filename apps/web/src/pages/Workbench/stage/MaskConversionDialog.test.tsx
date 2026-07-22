import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MaskConversionDialog } from "./MaskConversionDialog";

const apiMocks = vi.hoisted(() => ({
  dryRun: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/api/annotationConversions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/annotationConversions")>();
  return {
    ...original,
    annotationConversionsApi: apiMocks,
  };
});

const report = {
  source_annotation_id: "ann-1",
  source_type: "raster_mask",
  target_type: "polygon",
  source_version: 3,
  frame_indexes: [],
  result_count: 1,
  source_area_pixels: 12,
  target_area_pixels: 11,
  changed_pixels: 1,
  source_components: 2,
  target_components: 2,
  source_holes: 1,
  target_holes: 1,
  source_vertices: 0,
  target_vertices: 14,
  materialized_held_frames: 0,
  lossy: true,
  reasons: ["pixel_roundtrip_changed"],
};

describe("MaskConversionDialog", () => {
  beforeEach(() => {
    apiMocks.dryRun.mockReset();
    apiMocks.execute.mockReset();
  });

  it("先生成逐项报告，再确认有损转换并执行冻结计划", async () => {
    apiMocks.dryRun.mockResolvedValue({
      plan_token: "cvp_token",
      expires_at: "2099-01-01T00:00:00Z",
      target: "polygon",
      operation: "copy",
      scope: "image",
      items: [report],
      summary: {
        source_count: 1,
        result_count: 1,
        materialized_held_frames: 0,
        lossy_count: 1,
      },
    });
    apiMocks.execute.mockResolvedValue({
      operation_id: "op-1",
      updated_annotations: [],
      created_annotations: [],
      deleted_annotation_ids: [],
      lineage_edges: [],
      report: {
        source_count: 1,
        result_count: 1,
        materialized_held_frames: 0,
        lossy_count: 1,
      },
      idempotent_replay: false,
    });
    const onCompleted = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <MaskConversionDialog
        open
        request={{
          taskId: "task-1",
          annotationIds: ["ann-1"],
          sourceType: "raster_mask",
        }}
        onOpenChange={onOpenChange}
        onCompleted={onCompleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByLabelText("转换预览报告");
    expect(screen.getByText("XOR 1 px")).toBeInTheDocument();
    expect(apiMocks.dryRun).toHaveBeenCalledWith("task-1", expect.objectContaining({
      annotation_ids: ["ann-1"],
      target: "polygon",
      operation: "copy",
      scope: "image",
    }));

    fireEvent.click(screen.getByRole("button", { name: "执行转换" }));
    expect(await screen.findByRole("heading", { name: "确认执行转换？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));

    await waitFor(() => expect(apiMocks.execute).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        plan_token: "cvp_token",
        confirm_lossy: true,
        confirm_replace: false,
      }),
    ));
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("执行失败后复用同一个幂等键安全重试", async () => {
    apiMocks.dryRun.mockResolvedValue({
      plan_token: "cvp_retry",
      expires_at: "2099-01-01T00:00:00Z",
      target: "mask",
      operation: "copy",
      scope: "image",
      items: [{
        ...report,
        source_type: "polygon",
        target_type: "raster_mask",
        lossy: false,
        reasons: [],
        changed_pixels: 0,
      }],
      summary: {
        source_count: 1,
        result_count: 1,
        materialized_held_frames: 0,
        lossy_count: 0,
      },
    });
    const result = {
      operation_id: "op-retry",
      updated_annotations: [],
      created_annotations: [],
      deleted_annotation_ids: [],
      lineage_edges: [],
      report: {
        source_count: 1,
        result_count: 1,
        materialized_held_frames: 0,
        lossy_count: 0,
      },
      idempotent_replay: true,
    };
    apiMocks.execute
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(result);
    const onCompleted = vi.fn();
    render(
      <MaskConversionDialog
        open
        request={{
          taskId: "task-1",
          annotationIds: ["ann-1"],
          sourceType: "polygon",
        }}
        onOpenChange={vi.fn()}
        onCompleted={onCompleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByLabelText("转换预览报告");
    fireEvent.click(screen.getByRole("button", { name: "执行转换" }));
    await screen.findByText("response lost");
    fireEvent.click(screen.getByRole("button", { name: "执行转换" }));

    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(result));
    const firstKey = apiMocks.execute.mock.calls[0][1].idempotency_key;
    const secondKey = apiMocks.execute.mock.calls[1][1].idempotency_key;
    expect(secondKey).toBe(firstKey);
  });
});
