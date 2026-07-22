import { describe, expect, it, vi } from "vitest";

import type { VideoMaskCorrectionIntent } from "../stage/VideoMaskCorrectionDialog";
import { executeVideoMaskCorrectionFlow } from "./videoMaskCorrectionFlow";

const propagateIntent: VideoMaskCorrectionIntent = {
  mode: "forward",
  direction: "forward",
  fromFrame: 5,
  toFrame: 20,
  modelKey: "sam2_video",
  modelId: "grounded-sam2-tracker",
  backendId: "backend-1",
  allowBboxFallback: false,
  segmentId: "segment-1",
};

describe("executeVideoMaskCorrectionFlow", () => {
  it("创建失败后重试只重发传播，不重复保存关键帧", async () => {
    const snapshot = { annotationId: "annotation-1", version: 4, digest: "a".repeat(64) };
    const saveKeyframe = vi.fn().mockResolvedValue(snapshot);
    const createPropagation = vi.fn()
      .mockRejectedValueOnce(new Error("broker unavailable"))
      .mockResolvedValueOnce(undefined);
    let savedKeyframe: typeof snapshot | null = null;
    const onKeyframeSaved = vi.fn((saved: typeof snapshot) => {
      savedKeyframe = saved;
    });

    await expect(executeVideoMaskCorrectionFlow({
      intent: propagateIntent,
      savedKeyframe,
      saveKeyframe,
      onKeyframeSaved,
      createPropagation,
    })).rejects.toThrow("broker unavailable");

    await expect(executeVideoMaskCorrectionFlow({
      intent: propagateIntent,
      savedKeyframe,
      saveKeyframe,
      onKeyframeSaved,
      createPropagation,
    })).resolves.toEqual({ kind: "created", savedKeyframe: snapshot });

    expect(saveKeyframe).toHaveBeenCalledTimes(1);
    expect(createPropagation).toHaveBeenCalledTimes(2);
    expect(createPropagation.mock.calls[0][0]).toBe(snapshot);
    expect(createPropagation.mock.calls[1][0]).toBe(snapshot);
  });

  it("保存失败不创建传播作业", async () => {
    const createPropagation = vi.fn();

    await expect(executeVideoMaskCorrectionFlow({
      intent: propagateIntent,
      savedKeyframe: null,
      saveKeyframe: vi.fn().mockResolvedValue(null),
      onKeyframeSaved: vi.fn(),
      createPropagation,
    })).resolves.toEqual({ kind: "save_failed", savedKeyframe: null });
    expect(createPropagation).not.toHaveBeenCalled();
  });

  it("仅保存模式不创建传播作业", async () => {
    const snapshot = { annotationId: "annotation-1" };
    const createPropagation = vi.fn();

    await expect(executeVideoMaskCorrectionFlow({
      intent: { ...propagateIntent, mode: "save_only", direction: undefined },
      savedKeyframe: null,
      saveKeyframe: vi.fn().mockResolvedValue(snapshot),
      onKeyframeSaved: vi.fn(),
      createPropagation,
    })).resolves.toEqual({ kind: "saved", savedKeyframe: snapshot });
    expect(createPropagation).not.toHaveBeenCalled();
  });
});
