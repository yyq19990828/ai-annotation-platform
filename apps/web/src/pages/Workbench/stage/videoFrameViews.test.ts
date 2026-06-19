import { describe, expect, it } from "vitest";
import { deriveVideoFrameViews } from "./videoFrameViews";
import { DEFAULT_ANNOTATION_VISUAL } from "./annotationVisual";
import type { AnnotationResponse } from "@/types";

function trackAnn(id: string, trackId: string, keyframes: { frame_index: number; bbox: { x: number; y: number; w: number; h: number }; source?: string; occluded?: boolean }[], className = "car"): AnnotationResponse {
  return {
    id,
    class_name: className,
    geometry: { type: "video_track_bbox", track_id: trackId, keyframes },
  } as unknown as AnnotationResponse;
}

function bboxAnn(id: string, frame: number, className = "car"): AnnotationResponse {
  return {
    id,
    class_name: className,
    geometry: { type: "video_bbox", frame_index: frame, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  } as unknown as AnnotationResponse;
}

const base = { visual: DEFAULT_ANNOTATION_VISUAL, selectedId: null };

describe("deriveVideoFrameViews", () => {
  it("精确关键帧:实线、非遮挡;插值帧:虚线", () => {
    const ann = trackAnn("t1", "trk1", [
      { frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual" },
      { frame_index: 10, bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, source: "manual" },
    ]);
    const atKf = deriveVideoFrameViews({ ...base, annotations: [ann], frameIndex: 0 });
    expect(atKf.entries).toHaveLength(1);
    expect(atKf.entries[0].dashed).toBe(false);

    const atInterp = deriveVideoFrameViews({ ...base, annotations: [ann], frameIndex: 5 });
    expect(atInterp.entries[0].dashed).toBe(true); // 插值 → 虚线
    expect(atInterp.entries[0].labelText).toContain("插值");
  });

  it("遮挡关键帧:虚线 + 标签含遮挡", () => {
    const ann = trackAnn("t1", "trk1", [
      { frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual", occluded: true },
    ]);
    const v = deriveVideoFrameViews({ ...base, annotations: [ann], frameIndex: 0 });
    expect(v.entries[0].dashed).toBe(true);
    expect(v.entries[0].occluded).toBe(true);
    expect(v.entries[0].labelText).toContain("遮挡");
  });

  it("hidden track 不渲染", () => {
    const ann = trackAnn("t1", "trk1", [{ frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual" }]);
    const v = deriveVideoFrameViews({ ...base, annotations: [ann], frameIndex: 0, hiddenTrackIds: new Set(["trk1"]) });
    expect(v.entries).toHaveLength(0);
    expect(v.previews).toHaveLength(0);
  });

  it("选中态标记 + 预览线只在选中时给关键帧圆点", () => {
    const ann = trackAnn("t1", "trk1", [
      { frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual" },
      { frame_index: 10, bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, source: "manual" },
    ]);
    const unsel = deriveVideoFrameViews({ ...base, annotations: [ann], frameIndex: 0 });
    expect(unsel.entries[0].selected).toBe(false);
    expect(unsel.previews[0].selected).toBe(false);
    expect(unsel.previews[0].points).toHaveLength(2); // 中心点归一化

    const sel = deriveVideoFrameViews({ ...base, annotations: [ann], frameIndex: 0, selectedId: "t1" });
    expect(sel.entries[0].selected).toBe(true);
    expect(sel.previews[0].selected).toBe(true);
    // 预览中心点 = bbox 中心(归一化)
    expect(sel.previews[0].points[0]).toMatchObject({ frame: 0, x: 0.1, y: 0.1 });
  });

  it("选中轨迹当前帧无框 → ghost 取最近关键帧", () => {
    const ann = trackAnn("t1", "trk1", [
      { frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual" },
      { frame_index: 10, bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, source: "manual" },
      { frame_index: 20, bbox: { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }, source: "manual" },
    ], "car");
    // outside 区间让第 50 帧无解析帧
    (ann.geometry as { outside?: unknown[] }).outside = [{ start_frame: 21, end_frame: 100 }];
    const v = deriveVideoFrameViews({ ...base, annotations: [ann], frameIndex: 50, selectedId: "t1" });
    expect(v.entries).toHaveLength(0);
    expect(v.ghost).not.toBeNull();
    expect(v.ghost!.labelText).toContain("参考 F20");
  });

  it("锁定轨迹 → 不显示 ghost 参考框", () => {
    const ann = trackAnn("t1", "trk1", [
      { frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual" },
      { frame_index: 20, bbox: { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }, source: "manual" },
    ]);
    (ann.geometry as { outside?: unknown[] }).outside = [{ start_frame: 21, end_frame: 100 }];
    const v = deriveVideoFrameViews({ ...base, annotations: [ann], frameIndex: 50, selectedId: "t1", lockedTrackIds: new Set(["trk1"]) });
    expect(v.ghost).toBeNull();
  });

  it("predictReference → ghost 改用恒速外推 + 预测标签", () => {
    const ann = trackAnn("t1", "trk1", [
      { frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual" },
      { frame_index: 10, bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, source: "manual" },
      { frame_index: 20, bbox: { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }, source: "manual" },
    ]);
    (ann.geometry as { outside?: unknown[] }).outside = [{ start_frame: 21, end_frame: 100 }];
    // F10→F20 vx=0.02/帧;F25 = 0.6 + 0.02*5 = 0.7。
    const v = deriveVideoFrameViews({ ...base, annotations: [ann], frameIndex: 25, selectedId: "t1", predictReference: true });
    expect(v.ghost).not.toBeNull();
    expect(v.ghost!.labelText).toContain("预测 F20");
    expect(v.ghost!.geom.x).toBeCloseTo(0.7);
  });

  it("标签门控:none 全隐,selected 仅选中", () => {
    const ann = trackAnn("t1", "trk1", [{ frame_index: 0, bbox: { x: 0, y: 0, w: 0.2, h: 0.2 }, source: "manual" }]);
    const none = deriveVideoFrameViews({ annotations: [ann], frameIndex: 0, selectedId: "t1", visual: { ...DEFAULT_ANNOTATION_VISUAL, labelVisibility: "none" } });
    expect(none.labels).toHaveLength(0);

    const onlySel = deriveVideoFrameViews({ annotations: [ann, bboxAnn("b1", 0)], frameIndex: 0, selectedId: "t1", visual: { ...DEFAULT_ANNOTATION_VISUAL, labelVisibility: "selected" } });
    expect(onlySel.labels).toHaveLength(1); // 只有选中的 t1
    expect(onlySel.labels[0].key).toContain("t1");
  });

  it("pending draft 进入标签", () => {
    const v = deriveVideoFrameViews({ ...base, annotations: [], frameIndex: 0, pendingDraft: { geom: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, className: "person" } });
    expect(v.labels.find((l) => l.key === "pending-draft")?.text).toBe("person");
  });
});
