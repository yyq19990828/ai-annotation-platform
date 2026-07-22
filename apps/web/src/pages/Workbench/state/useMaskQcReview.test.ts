import { describe, expect, it } from "vitest";
import {
  assertMaskQcLocalAiCandidate,
  assertMaskQcTrackerCandidate,
  collectMaskQcTrackerCandidates,
  maskQcNavigationContextMatches,
  maskQcReadyContextMatches,
  MaskQcNavigationGeneration,
  MaskQcNavigationStaleError,
} from "./useMaskQcReview";

describe("MaskQcNavigationGeneration", () => {
  it("invalidates every phase of an older asynchronous navigation", () => {
    const generation = new MaskQcNavigationGeneration();
    const first = generation.next();
    const second = generation.next();
    expect(first.signal.aborted).toBe(true);
    expect(() => generation.assert(first.value)).toThrow(MaskQcNavigationStaleError);
    expect(() => generation.assert(second.value)).not.toThrow();
    generation.cancel();
    expect(second.signal.aborted).toBe(true);
    expect(() => generation.assert(second.value)).toThrow(MaskQcNavigationStaleError);
  });
});

describe("Mask QC candidate identity", () => {
  const issue = {
    task_id: "task-1",
    annotation_id: "annotation-1",
    annotation_version: 7,
  };

  it("绑定本地 AI 候选的 task、frame 与精修源版本", () => {
    const candidate = {
      taskId: "task-1",
      digest: "digest",
      rle: { encoding: "coco_rle" as const, size: [2, 2] as [number, number], counts: [4] },
      frameIndex: 3,
      refineSource: { annotationId: "annotation-1", sourceVersion: 7 },
    };
    expect(() => assertMaskQcLocalAiCandidate(candidate, issue, 3)).not.toThrow();
    expect(() => assertMaskQcLocalAiCandidate({ ...candidate, taskId: "task-2" }, issue, 3))
      .toThrow(/目标任务/);
    expect(() => assertMaskQcLocalAiCandidate({ ...candidate, frameIndex: 4 }, issue, 3))
      .toThrow(/当前帧/);
    expect(() => assertMaskQcLocalAiCandidate({
      ...candidate,
      refineSource: { annotationId: "annotation-2", sourceVersion: 7 },
    }, issue, 3)).toThrow(/目标标注版本/);
  });

  it("Tracker 候选必须精确匹配 annotation、frame、revision 与 digest", () => {
    const candidate = {
      key: "candidate",
      jobId: "job-1",
      jobRevision: 2,
      digest: "digest",
      frameIndex: 3,
      annotationId: "annotation-1",
      instanceId: "1",
      label: "Tracker",
    };
    expect(() => assertMaskQcTrackerCandidate(candidate, issue, 3)).not.toThrow();
    expect(() => assertMaskQcTrackerCandidate({ ...candidate, annotationId: "annotation-2" }, issue, 3))
      .toThrow(/目标标注/);
    expect(() => assertMaskQcTrackerCandidate({ ...candidate, frameIndex: 4 }, issue, 3))
      .toThrow(/目标帧/);
    expect(() => assertMaskQcTrackerCandidate({ ...candidate, jobRevision: 0 }, issue, 3))
      .toThrow(/revision/);
  });

  it("从多源 staged preview 只选择目标 annotation 的不可变候选", () => {
    const candidates = collectMaskQcTrackerCandidates(
      issue,
      3,
      {
        "job-1": {
          job_revision: 4,
          annotation_id: null,
          results: [
            {
              frame_index: 3,
              geometry: { type: "mask" },
              geometry_digest: "digest-a",
              target_annotation_id: "annotation-1",
              instance_id: "a",
            },
            {
              frame_index: 3,
              geometry: { type: "mask" },
              geometry_digest: "digest-b",
              target_annotation_id: "annotation-2",
              instance_id: "b",
            },
            {
              frame_index: 4,
              geometry: { type: "mask" },
              geometry_digest: "digest-late",
              target_annotation_id: "annotation-1",
              instance_id: "a",
            },
          ],
        } as never,
      },
      {
        "job-1": { taskId: "task-1", revision: 4, modelKey: "SAM2" },
      },
    );
    expect(candidates).toEqual([expect.objectContaining({
      jobId: "job-1",
      jobRevision: 4,
      digest: "digest-a",
      annotationId: "annotation-1",
      frameIndex: 3,
      instanceId: "a",
    })]);
  });
});

describe("maskQcReadyContextMatches", () => {
  const expected = {
    taskId: "task-1",
    annotationId: "annotation-1",
    annotationVersion: 7,
    frameIndex: 3,
  };
  const current = {
    taskId: "task-1",
    selectedId: "annotation-1",
    visibleAnnotationIds: new Set(["annotation-1"]),
    isVideoTask: true,
    frameIndex: 3,
    annotationVersion: 7,
  };

  it("任一 task/frame/selection/version 偏离都会让旧 compare 失效", () => {
    expect(maskQcReadyContextMatches(current, expected)).toBe(true);
    expect(maskQcReadyContextMatches({ ...current, taskId: "task-2" }, expected)).toBe(false);
    expect(maskQcReadyContextMatches({ ...current, selectedId: "annotation-2" }, expected)).toBe(false);
    expect(maskQcReadyContextMatches({ ...current, frameIndex: 4 }, expected)).toBe(false);
    expect(maskQcReadyContextMatches({ ...current, annotationVersion: 8 }, expected)).toBe(false);
  });

  it("加载与回退区域期间也会校验 task/frame/selection", () => {
    expect(maskQcNavigationContextMatches(current, expected)).toBe(true);
    expect(maskQcNavigationContextMatches({ ...current, taskId: "task-2" }, expected)).toBe(false);
    expect(maskQcNavigationContextMatches({ ...current, selectedId: "annotation-2" }, expected)).toBe(false);
    expect(maskQcNavigationContextMatches({ ...current, frameIndex: 4 }, expected)).toBe(false);
    const versionDrift = {
      ...current,
      annotationVersion: 99,
    };
    expect(maskQcNavigationContextMatches(versionDrift, expected)).toBe(true);
  });
});
