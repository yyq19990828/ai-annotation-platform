// v0.18.28 · popover「运行当前题（按项目编排）」载荷构造的纯函数守护。
import { describe, it, expect } from "vitest";
import { buildPipelineRunPayload } from "../useWorkbenchShellModel.helpers";
import type { PipelineStagePayload } from "@/hooks/usePreannotation";

const STAGES: PipelineStagePayload[] = [
  { stage: 0, ml_backend_id: "be-detect", model_id: "detect" },
  {
    stage: 1,
    ml_backend_id: "be-classify",
    model_id: "va",
    parent_stage: 0,
    roi: { mode: "crop", pad: 0.05 },
    write: { target: "attributes", keys: ["color"] },
  },
];

describe("buildPipelineRunPayload", () => {
  it("有编排 + taskId → 顶层 backend=源阶段, task_ids=[当前], overwrite + last_wins", () => {
    const out = buildPipelineRunPayload(STAGES, "T-1");
    expect(out).toEqual({
      ml_backend_id: "be-detect",
      task_ids: ["T-1"],
      pipeline_stages: STAGES,
      predict_mode: "overwrite",
      on_key_conflict: "last_wins",
    });
  });

  it("源阶段非首位时仍取 parent_stage=null 的 backend 作顶层", () => {
    const reordered: PipelineStagePayload[] = [STAGES[1]!, STAGES[0]!];
    const out = buildPipelineRunPayload(reordered, "T-2");
    expect(out?.ml_backend_id).toBe("be-detect");
  });

  it("空编排 → null (不发请求)", () => {
    expect(buildPipelineRunPayload([], "T-1")).toBeNull();
    expect(buildPipelineRunPayload(null, "T-1")).toBeNull();
    expect(buildPipelineRunPayload(undefined, "T-1")).toBeNull();
  });

  it("无 taskId → null (不发请求)", () => {
    expect(buildPipelineRunPayload(STAGES, null)).toBeNull();
    expect(buildPipelineRunPayload(STAGES, undefined)).toBeNull();
    expect(buildPipelineRunPayload(STAGES, "")).toBeNull();
  });
});
