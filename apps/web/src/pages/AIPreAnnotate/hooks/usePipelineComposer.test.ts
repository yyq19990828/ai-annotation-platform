/**
 * v0.21.0 · usePipelineComposer hook 覆盖: 加子/改父/键冲突判据 (承接 pipelineGraph 纯函数覆盖).
 * 只测状态机层, 不管 UI. 项目页与全局页共用同一份判据.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import type { PipelineStagePayload } from "@/hooks/usePreannotation";
import { ROOT_SID, MAX_DEPTH } from "../utils/pipelineGraph";
import { usePipelineComposer } from "./usePipelineComposer";

const geoPayload = (backendId: string, keys?: string[], label?: string): PipelineStagePayload => ({
  stage: 1,
  ml_backend_id: backendId,
  model_id: "m",
  parent_stage: 0,
  roi: { mode: "crop", pad: 0.05 },
  input: { mode: "crop" },
  write: {
    target: keys ? "attributes" : "geometry",
    ...(keys ? { keys } : {}),
  },
  ...(label ? { label } : {}),
});

describe("usePipelineComposer", () => {
  it("初始状态: 空 stagesGraph, 选中 ROOT_SID, 无冲突", () => {
    const { result } = renderHook(() =>
      usePipelineComposer({ availableBackendCount: 2 }),
    );
    expect(result.current.stagesGraph).toEqual([]);
    expect(result.current.selectedSid).toBe(ROOT_SID);
    expect(result.current.hasKeyConflict).toBe(false);
    expect(result.current.allDownstreamReady).toBe(true);
  });

  it("addStage: 加到 root 后 stagesGraph 长度=1, 选中新节点; backend<2 时 canAddChildAt(root)=false", () => {
    const { result } = renderHook(() =>
      usePipelineComposer({ availableBackendCount: 1 }),
    );
    expect(result.current.canAddChildAt(ROOT_SID)).toBe(false);

    const { result: result2 } = renderHook(() =>
      usePipelineComposer({ availableBackendCount: 2 }),
    );
    expect(result2.current.canAddChildAt(ROOT_SID)).toBe(true);
    act(() => result2.current.addStage(ROOT_SID));
    expect(result2.current.stagesGraph).toHaveLength(1);
    expect(result2.current.stagesGraph[0].parentSid).toBe(ROOT_SID);
    expect(result2.current.selectedSid).toBe(result2.current.stagesGraph[0].sid);
  });

  it("removeStage: 级联删后代, 选中回落 ROOT_SID", () => {
    let cascade = 0;
    const { result } = renderHook(() =>
      usePipelineComposer({
        availableBackendCount: 2,
        onCascadeDelete: (n) => {
          cascade = n;
        },
      }),
    );
    // 建 root -> A -> B (受 MAX_DEPTH=3 上限约束, B depth=3 后不能再挂 C).
    act(() => result.current.addStage(ROOT_SID));
    const sidA = result.current.stagesGraph[0].sid;
    act(() => result.current.onStageChange(sidA, geoPayload("bk-a")));
    act(() => result.current.addStage(sidA));
    const sidB = result.current.stagesGraph[1].sid;
    act(() => result.current.onStageChange(sidB, geoPayload("bk-b")));

    // 删 A → B 级联删除 (1 个后代).
    act(() => result.current.removeStage(sidA));
    expect(result.current.stagesGraph).toHaveLength(0);
    expect(result.current.selectedSid).toBe(ROOT_SID);
    expect(cascade).toBe(1);
    // eslint 别把 sidB 视作 unused: 上文断言用到了它对应的层级.
    expect(sidB).toBeTruthy();
  });

  it(`最深 ${MAX_DEPTH} 层: 尝试超深加子会被拒并触发 onWarn`, () => {
    let warned = "";
    const { result } = renderHook(() =>
      usePipelineComposer({
        availableBackendCount: 2,
        onWarn: (msg) => {
          warned = msg;
        },
      }),
    );
    // root (depth=1) -> A (2) -> B (3). 再想在 B 上加子 → 会到 depth=4 > MAX_DEPTH=3, 应拒.
    act(() => result.current.addStage(ROOT_SID));
    const sidA = result.current.stagesGraph[0].sid;
    act(() => result.current.onStageChange(sidA, geoPayload("bk-a")));
    act(() => result.current.addStage(sidA));
    const sidB = result.current.stagesGraph[1].sid;
    act(() => result.current.onStageChange(sidB, geoPayload("bk-b")));
    expect(result.current.canAddChildAt(sidB)).toBe(false);
    // 强行调 addStage 触发 onWarn.
    act(() => result.current.addStage(sidB));
    expect(warned).toBe("无法加子阶段");
    expect(result.current.stagesGraph).toHaveLength(2); // 未新增第三个.
  });

  it("键冲突: 两下游写同一最终键 → hasKeyConflict=true, perCard 标出冲突键", () => {
    const { result } = renderHook(() =>
      usePipelineComposer({ availableBackendCount: 2 }),
    );
    act(() => result.current.addStage(ROOT_SID));
    const sidA = result.current.stagesGraph[0].sid;
    act(() => result.current.addStage(ROOT_SID));
    const sidB = result.current.stagesGraph[1].sid;
    // A / B 都写 attributes.color, 无 label 前缀 → 最终键都是 color → 冲突.
    act(() => result.current.onStageChange(sidA, geoPayload("bk-a", ["color"])));
    act(() => result.current.onStageChange(sidB, geoPayload("bk-b", ["color"])));
    expect(result.current.hasKeyConflict).toBe(true);
    expect(result.current.conflictInfo.displayFinals.has("color")).toBe(true);
    expect(result.current.conflictInfo.perCard[sidA]?.has("color")).toBe(true);
    expect(result.current.conflictInfo.perCard[sidB]?.has("color")).toBe(true);

    // 加不同 label 前缀 → hat_color / shoe_color → 不冲突.
    act(() => result.current.onStageChange(sidA, geoPayload("bk-a", ["color"], "hat")));
    act(() => result.current.onStageChange(sidB, geoPayload("bk-b", ["color"], "shoe")));
    expect(result.current.hasKeyConflict).toBe(false);
  });

  it("reset: 清空 stagesGraph / selectedSid / payloadsRef", () => {
    const { result } = renderHook(() =>
      usePipelineComposer({ availableBackendCount: 2 }),
    );
    act(() => result.current.addStage(ROOT_SID));
    const sidA = result.current.stagesGraph[0].sid;
    act(() => result.current.onStageChange(sidA, geoPayload("bk-a", ["color"])));
    expect(result.current.stagesGraph).toHaveLength(1);

    act(() => result.current.reset());
    expect(result.current.stagesGraph).toEqual([]);
    expect(result.current.selectedSid).toBe(ROOT_SID);
    expect(result.current.hasKeyConflict).toBe(false);
  });

  it("canReparentConn: 不能连回自己, 不能连到后代, 父须产几何", () => {
    const { result } = renderHook(() =>
      usePipelineComposer({ availableBackendCount: 2 }),
    );
    act(() => result.current.addStage(ROOT_SID)); // A
    const sidA = result.current.stagesGraph[0].sid;
    act(() => result.current.onStageChange(sidA, geoPayload("bk-a")));
    act(() => result.current.addStage(sidA)); // B (A 的子)
    const sidB = result.current.stagesGraph[1].sid;
    act(() => result.current.onStageChange(sidB, geoPayload("bk-b")));

    // A 不能连到自己.
    expect(result.current.canReparentConn(sidA, sidA)).toBe(false);
    // A 不能连到自己的后代 B (成环).
    expect(result.current.canReparentConn(sidA, sidB)).toBe(false);
    // B 挂到 ROOT_SID (源恒产几何) OK.
    expect(result.current.canReparentConn(sidB, ROOT_SID)).toBe(true);
  });
});
