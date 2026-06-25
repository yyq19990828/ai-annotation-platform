/**
 * v0.18.15 · StageGraphSummary 单测: 受限树形 ASCII 摘要渲染。
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { StageGraphSummary } from "./StageGraphSummary";
import type { PipelineStagePayload } from "@/hooks/usePreannotation";

const p = (o: Partial<PipelineStagePayload>): PipelineStagePayload =>
  ({ stage: 0, ml_backend_id: "bk", ...o }) as PipelineStagePayload;

describe("StageGraphSummary", () => {
  it("空图不渲染", () => {
    const { container } = render(<StageGraphSummary stagesGraph={[]} payloads={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("depth-3 几何链渲染层级 + 角色 + 命名", () => {
    // person(源) → 检测 hat(几何) → 分类 hat_color(属性)
    const stagesGraph = [
      { sid: "a", parentSid: "root" },
      { sid: "b", parentSid: "a" },
    ];
    const payloads = [
      p({ model_id: "hat-det", input: { mode: "crop" }, write: { target: "geometry" } }),
      p({ label: "hat", write: { target: "attributes", keys: ["color"] } }),
    ];
    const { container } = render(
      <StageGraphSummary stagesGraph={stagesGraph} payloads={payloads} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("检测(源)");
    expect(text).toContain("检测（hat-det）");
    expect(text).toContain("分类 → hat_color");
  });

  it("并行兄弟用 ├─ / └─ 区分", () => {
    const stagesGraph = [
      { sid: "a", parentSid: "root" },
      { sid: "b", parentSid: "root" },
    ];
    const payloads = [
      p({ write: { target: "attributes", keys: ["color"] } }),
      p({ write: { target: "attributes", keys: ["type"] } }),
    ];
    const { container } = render(
      <StageGraphSummary stagesGraph={stagesGraph} payloads={payloads} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("├─ ");
    expect(text).toContain("└─ ");
  });
});
