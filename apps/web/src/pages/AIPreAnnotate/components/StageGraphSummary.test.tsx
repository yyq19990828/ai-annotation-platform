/**
 * v0.18.15 · StageGraphSummary 单测: 受限树形可视化摘要渲染。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { StageGraphSummary } from "./StageGraphSummary";
import type { PipelineStagePayload } from "@/hooks/usePreannotation";

const p = (o: Partial<PipelineStagePayload>): PipelineStagePayload =>
  ({ stage: 0, ml_backend_id: "bk", ...o }) as PipelineStagePayload;

describe("StageGraphSummary", () => {
  it("空图不渲染", () => {
    const { container } = render(<StageGraphSummary stagesGraph={[]} payloads={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("depth-3 几何链渲染层级 + 角色徽标 + 命名", () => {
    // person(源) → 检测 hat(几何) → 分类 hat_color(属性)
    const stagesGraph = [
      { sid: "a", parentSid: "root" },
      { sid: "b", parentSid: "a" },
    ];
    const payloads = [
      p({ model_id: "hat-det", input: { mode: "crop" }, write: { target: "geometry" } }),
      p({ label: "hat", write: { target: "attributes", keys: ["color"] } }),
    ];
    render(<StageGraphSummary stagesGraph={stagesGraph} payloads={payloads} />);
    // 源节点 + 角色徽标
    expect(screen.getByText("源")).toBeInTheDocument();
    // "检测" 出现两次: 源节点名 + crop-detect 几何节点徽标
    expect(screen.getAllByText("检测")).toHaveLength(2);
    expect(screen.getByText("分类")).toBeInTheDocument(); // 属性叶子
    // 详情: hat 检测模型 + 带前缀的写回键
    expect(screen.getByText("hat-det")).toBeInTheDocument();
    expect(screen.getByText("hat_color")).toBeInTheDocument();
  });

  it("并行兄弟各渲染一枚节点 chip", () => {
    const stagesGraph = [
      { sid: "a", parentSid: "root" },
      { sid: "b", parentSid: "root" },
    ];
    const payloads = [
      p({ write: { target: "attributes", keys: ["color"] } }),
      p({ write: { target: "attributes", keys: ["type"] } }),
    ];
    render(<StageGraphSummary stagesGraph={stagesGraph} payloads={payloads} />);
    // 两枚 attributes 节点: 角色徽标各一 + 各自写回键
    expect(screen.getAllByText("分类")).toHaveLength(2);
    expect(screen.getByText("color")).toBeInTheDocument();
    expect(screen.getByText("type")).toBeInTheDocument();
  });
});
