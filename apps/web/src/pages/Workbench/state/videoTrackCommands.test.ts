import { describe, expect, it } from "vitest";
import type { VideoTrackGeometry } from "@/types";
import {
  applyVideoKeyframeToGeometry,
  buildVideoKeyframeCommand,
  buildVideoPropagateCommand,
  propagateKeyframes,
  type VideoTrackKeyframeWithAttrs,
} from "./videoTrackCommands";

const base: VideoTrackGeometry = {
  type: "video_track",
  track_id: "trk_1",
  keyframes: [
    { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
    { frame_index: 10, bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
  ],
};

describe("videoTrackCommands", () => {
  it("builds a keyframe command when exactly one frame changes", () => {
    const after: VideoTrackGeometry = {
      ...base,
      keyframes: [
        base.keyframes[0],
        { frame_index: 10, bbox: { x: 0.5, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
      ],
    };

    const cmd = buildVideoKeyframeCommand("ann-1", base, after);

    expect(cmd).toMatchObject({
      kind: "videoKeyframe",
      annotationId: "ann-1",
      frameIndex: 10,
      before: { frame_index: 10, bbox: { x: 0.4 } },
      after: { frame_index: 10, bbox: { x: 0.5 } },
    });
  });

  it("returns null when multiple keyframes change", () => {
    const after: VideoTrackGeometry = {
      ...base,
      keyframes: [
        { frame_index: 0, bbox: { x: 0.2, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
        { frame_index: 10, bbox: { x: 0.5, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
      ],
    };

    expect(buildVideoKeyframeCommand("ann-1", base, after)).toBeNull();
  });

  it("applies a keyframe replacement without touching other frames", () => {
    const next = applyVideoKeyframeToGeometry(base, 10, {
      frame_index: 10,
      bbox: { x: 0.6, y: 0.2, w: 0.2, h: 0.2 },
      source: "manual",
      occluded: true,
    });

    expect(next.keyframes).toHaveLength(2);
    expect(next.keyframes[0]).toEqual(base.keyframes[0]);
    expect(next.keyframes[1].bbox.x).toBe(0.6);
    expect(next.keyframes[1].occluded).toBe(true);
  });

  it("applies a keyframe deletion", () => {
    const next = applyVideoKeyframeToGeometry(base, 10, null);

    expect(next.keyframes).toEqual([base.keyframes[0]]);
  });
});

const pbbox = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
function ptrack(keyframes: VideoTrackKeyframeWithAttrs[]): VideoTrackGeometry {
  return { type: "video_track", track_id: "trk", keyframes };
}

describe("propagateKeyframes (2.6)", () => {
  it("forward 复制到后续 N 帧", () => {
    const next = propagateKeyframes(ptrack([{ frame_index: 5, bbox: pbbox, source: "manual" }]), 5, pbbox, {
      direction: "forward",
      count: 3,
      overwrite: false,
    });
    expect(next?.keyframes.map((kf) => kf.frame_index)).toEqual([5, 6, 7, 8]);
    expect(next?.keyframes[1].bbox).toEqual(pbbox);
    expect(next?.keyframes[1].source).toBe("manual");
  });

  it("backward 向前复制并裁掉负帧", () => {
    const next = propagateKeyframes(ptrack([{ frame_index: 2, bbox: pbbox, source: "manual" }]), 2, pbbox, {
      direction: "backward",
      count: 5,
      overwrite: false,
    });
    expect(next?.keyframes.map((kf) => kf.frame_index)).toEqual([0, 1, 2]);
  });

  it("overwrite=false 跳过已有关键帧, true 覆盖", () => {
    const other = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
    const geo = ptrack([
      { frame_index: 5, bbox: pbbox, source: "manual" },
      { frame_index: 6, bbox: other, source: "manual" },
    ]);
    const skip = propagateKeyframes(geo, 5, pbbox, { direction: "forward", count: 2, overwrite: false });
    expect(skip?.keyframes.find((kf) => kf.frame_index === 6)?.bbox).toEqual(other);
    expect(skip?.keyframes.find((kf) => kf.frame_index === 7)?.bbox).toEqual(pbbox);

    const force = propagateKeyframes(geo, 5, pbbox, { direction: "forward", count: 2, overwrite: true });
    expect(force?.keyframes.find((kf) => kf.frame_index === 6)?.bbox).toEqual(pbbox);
  });

  it("无可铺帧 / count<=0 时返回 null", () => {
    const geo = ptrack([
      { frame_index: 5, bbox: pbbox, source: "manual" },
      { frame_index: 6, bbox: pbbox, source: "manual" },
    ]);
    expect(propagateKeyframes(geo, 5, pbbox, { direction: "forward", count: 1, overwrite: false })).toBeNull();
    expect(propagateKeyframes(geo, 5, pbbox, { direction: "forward", count: 0, overwrite: false })).toBeNull();
  });

  it("buildVideoPropagateCommand 生成单条 update 命令", () => {
    const before = ptrack([{ frame_index: 5, bbox: pbbox, source: "manual" }]);
    const after = propagateKeyframes(before, 5, pbbox, { direction: "forward", count: 2, overwrite: false })!;
    const cmd = buildVideoPropagateCommand("ann-1", before, after);
    expect(cmd.kind).toBe("update");
    expect(cmd.annotationId).toBe("ann-1");
    expect(cmd.before.geometry).toBe(before);
    expect(cmd.after.geometry).toBe(after);
  });
});

describe("keyframe attributes 逐帧覆盖 (2.3)", () => {
  it("buildVideoKeyframeCommand 检测 attributes 变化为单帧 diff", () => {
    const before = ptrack([{ frame_index: 5, bbox: pbbox, source: "manual" }]);
    const after = applyVideoKeyframeToGeometry(before, 5, {
      frame_index: 5,
      bbox: pbbox,
      source: "manual",
      occluded: false,
      attributes: { state: "open" },
    } as VideoTrackKeyframeWithAttrs);
    const cmd = buildVideoKeyframeCommand("ann-1", before, after);
    expect(cmd?.kind).toBe("videoKeyframe");
    expect((cmd?.after as VideoTrackKeyframeWithAttrs).attributes).toEqual({ state: "open" });
  });

  it("attributes 相同不产生 diff", () => {
    const kf: VideoTrackKeyframeWithAttrs = {
      frame_index: 5,
      bbox: pbbox,
      source: "manual",
      occluded: false,
      attributes: { state: "open" },
    };
    const before = ptrack([kf]);
    const after = ptrack([{ ...kf, bbox: { ...pbbox }, attributes: { state: "open" } }]);
    expect(buildVideoKeyframeCommand("ann-1", before, after)).toBeNull();
  });

  it("clone 深拷贝 attributes", () => {
    const attrs = { state: "open" };
    const after = applyVideoKeyframeToGeometry(ptrack([]), 5, {
      frame_index: 5,
      bbox: pbbox,
      source: "manual",
      occluded: false,
      attributes: attrs,
    } as VideoTrackKeyframeWithAttrs);
    const stored = after.keyframes[0] as VideoTrackKeyframeWithAttrs;
    expect(stored.attributes).toEqual(attrs);
    expect(stored.attributes).not.toBe(attrs);
  });
});
