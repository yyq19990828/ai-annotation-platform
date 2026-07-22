import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationResponse, CocoRleMaskRef, VideoTrackMaskGeometry } from "@/types";
import type { VideoMaskKeyframeActionHandlers } from "../../stage/videoMaskKeyframeActions";
import { VideoPointsTrackCardContent } from "./VideoPointsTrackCardContent";

const mask: CocoRleMaskRef = {
  encoding: "coco_rle_ref",
  size: [2, 3],
  object_key: "raster-masks/test.json",
  sha256: "a".repeat(64),
  runs: 3,
  bytes: 12,
};

function maskTrack(outside: VideoTrackMaskGeometry["outside"] = []): AnnotationResponse {
  return {
    id: "mask-1",
    task_id: "task-1",
    project_id: "project-1",
    user_id: "user-1",
    source: "manual",
    annotation_type: "video_track_mask",
    class_name: "Car",
    geometry: {
      type: "video_track_mask",
      track_id: "trk-mask-1",
      keyframes: [0, 5, 10].map((frame_index) => ({
        frame_index,
        mask: { ...mask, object_key: `raster-masks/${frame_index}.json` },
        source: "manual" as const,
      })),
      outside,
    },
    confidence: null,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    version: 2,
    created_at: "2026-07-22T00:00:00Z",
    updated_at: null,
  };
}

function actions(): VideoMaskKeyframeActionHandlers {
  return {
    clipboardLabel: "F0（关键帧 F0）",
    hasClipboard: true,
    busy: false,
    copyCurrent: vi.fn(),
    pasteSameTrack: vi.fn(),
    pasteNewTrack: vi.fn(),
    deleteCurrentKeyframe: vi.fn(),
    toggleCurrentOutside: vi.fn(),
    splitCurrentComponents: vi.fn(),
  };
}

function renderCard(input: {
  annotation?: AnnotationResponse;
  frameIndex?: number;
  maskActions?: VideoMaskKeyframeActionHandlers;
  onSeekFrame?: (frame: number) => void;
  onConvert?: (id: string) => void;
} = {}) {
  const annotation = input.annotation ?? maskTrack();
  const maskActions = input.maskActions ?? actions();
  const onSeekFrame = input.onSeekFrame ?? vi.fn();
  render(
    <VideoPointsTrackCardContent
      annotation={annotation}
      frameIndex={input.frameIndex ?? 5}
      imageWidth={3}
      imageHeight={2}
      fps={null}
      readOnly={false}
      hidden={false}
      locked={false}
      onSeekFrame={onSeekFrame}
      onChangeClass={vi.fn()}
      onDelete={vi.fn()}
      onToggleHidden={vi.fn()}
      onToggleLock={vi.fn()}
      onConvert={input.onConvert}
      maskActions={maskActions}
    />,
  );
  return { annotation, maskActions, onSeekFrame };
}

describe("VideoPointsTrackCardContent Mask 关键帧操作", () => {
  it("导航跳过 outside 内的关键帧", () => {
    const onSeekFrame = vi.fn();
    renderCard({
      annotation: maskTrack([{ from: 5, to: 5, source: "manual" }]),
      frameIndex: 6,
      onSeekFrame,
    });

    fireEvent.click(screen.getByTitle("上一可见关键帧"));
    fireEvent.click(screen.getByTitle("下一可见关键帧"));
    expect(onSeekFrame).toHaveBeenNthCalledWith(1, 0);
    expect(onSeekFrame).toHaveBeenNthCalledWith(2, 10);
  });

  it("outside 帧禁用复制、删除与拆轨，可恢复 held", () => {
    const maskActions = actions();
    const annotation = maskTrack([{ from: 5, to: 5, source: "manual" }]);
    renderCard({ annotation, frameIndex: 5, maskActions });

    expect((screen.getByRole("button", { name: "复制当前帧" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "删除关键帧" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "组件拆轨" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "恢复保持" }));
    expect(maskActions.toggleCurrentOutside).toHaveBeenCalledWith(annotation);
  });

  it("剪贴板可用时分流到同轨草稿与新轨预览", () => {
    const maskActions = actions();
    const annotation = maskTrack();
    renderCard({ annotation, frameIndex: 5, maskActions });

    fireEvent.click(screen.getByRole("button", { name: "粘贴当前轨迹" }));
    fireEvent.click(screen.getByRole("button", { name: "粘贴新轨迹" }));
    expect(maskActions.pasteSameTrack).toHaveBeenCalledWith(annotation);
    expect(maskActions.pasteNewTrack).toHaveBeenCalledWith(annotation);
  });

  it("预测 outside 显示准确原因且不允许人工恢复", () => {
    renderCard({
      annotation: maskTrack([{ from: 5, to: 5, source: "prediction" }]),
      frameIndex: 5,
    });
    const button = screen.getByRole("button", { name: "预测消失" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("预测 outside 不可人工恢复");
  });

  it("从 Mask 轨迹卡打开当前帧 BBox 转换", () => {
    const onConvert = vi.fn();
    renderCard({ onConvert });

    fireEvent.click(screen.getByRole("button", { name: "转 BBox" }));
    expect(onConvert).toHaveBeenCalledWith("mask-1");
  });
});
