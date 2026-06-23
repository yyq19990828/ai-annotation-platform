/**
 * v0.18.5 / v0.18.6 · StageCard 单测: 选择器化字段 + 运行态徽标。
 *
 * 重依赖 (usePreannotateConfig 拉 setup/capabilities + PreannotateConfigForm) 全 mock,
 * 聚焦 StageCard 自身: 类别/属性键 chip 多选、能力门控 ⚠、运行态徽标 + 计数。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mockCfg: any = {
  configReady: true,
  buildArgs: () => ({ ml_backend_id: "bk2", params: {} }),
  capabilitiesQ: { isLoading: false, data: { models: [] } },
};

vi.mock("./usePreannotateConfig", () => ({
  usePreannotateConfig: () => mockCfg,
}));
vi.mock("./PreannotateConfigForm", () => ({
  PreannotateConfigForm: () => <div data-testid="cfg-form" />,
}));

import { StageCard } from "./StageCard";

function renderCard(props: Partial<Record<string, unknown>> = {}) {
  return render(
    <StageCard
      id="s1"
      displayIndex={2}
      projectId="p1"
      backends={[
        { id: "bk1", name: "det" },
        { id: "bk2", name: "cls" },
      ]}
      projectMlBackendId="bk1"
      sourceBackendId="bk1"
      projectClasses={["car", "person"]}
      projectAttributeKeys={["color", "vehicle_type"]}
      onChange={() => {}}
      onRemove={() => {}}
      {...(props as any)}
    />,
  );
}

describe("StageCard v0.18.5/6", () => {
  beforeEach(() => {
    mockCfg.capabilitiesQ = { isLoading: false, data: { models: [] } };
  });

  it("父框类别 chip 来自项目类别, 可点选", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "car" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "person" })).toBeInTheDocument();
  });

  it("backend 自报属性 schema 时, 写回属性键 chip 取 schema key", () => {
    mockCfg.capabilitiesQ = {
      isLoading: false,
      data: {
        models: [
          {
            output_attribute_schema: [
              { key: "vehicle_color", label: "车辆颜色", type: "select" },
            ],
          },
        ],
      },
    };
    renderCard();
    expect(screen.getByRole("button", { name: "车辆颜色" })).toBeInTheDocument();
    // 不产属性的回落项 (项目 key) 不应出现, 因 backend 自报优先
    expect(screen.queryByRole("button", { name: "color" })).toBeNull();
  });

  it("backend 未自报属性时, 给 ⚠ 警示 + 写回键回落项目属性 key", () => {
    renderCard();
    expect(
      screen.getByText(/该后端未自报输出属性/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "color" })).toBeInTheDocument();
  });

  it("运行态徽标 + 计数: running 显「运行中」+ 成功/失败/几何跳过", () => {
    renderCard({
      runState: "running",
      stat: { stage: 1, targeted: 5, ok: 3, failed: 1, skipped_geometry: 1 },
    });
    expect(screen.getByText("运行中")).toBeInTheDocument();
    // 计数块: 标签 + 值分列 (StatCard 风格)
    expect(screen.getByText("目标")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // 目标值
    expect(screen.getByText("3")).toBeInTheDocument(); // 成功值
    expect(screen.getByText("几何跳过")).toBeInTheDocument();
  });

  it("未跑时徽标为「待运行」, 无计数行", () => {
    renderCard();
    expect(screen.getByText("待运行")).toBeInTheDocument();
    expect(screen.queryByText(/目标/)).toBeNull();
  });

  it("backend 有纯分类 model 时, 下游 payload 用分类 model_id + 显示提示", () => {
    mockCfg.capabilitiesQ = {
      isLoading: false,
      data: {
        models: [
          { id: "vehicle-attr", task: "detection", display_name: "检测+分类" },
          {
            id: "vehicle-attr-classify",
            task: "classification",
            display_name: "纯分类·吃 ROI",
            output_attribute_schema: [
              { key: "color", label: "颜色", type: "select" },
            ],
          },
        ],
      },
    };
    const onChange = vi.fn();
    renderCard({ onChange });
    // 可见提示: 走纯分类 model
    expect(screen.getByText(/纯分类，跳过检测/)).toBeInTheDocument();
    // 上抛的 payload 用分类 model 而非 buildArgs 默认 (检测 model)
    const calls = onChange.mock.calls;
    const lastPayload = calls[calls.length - 1]?.[1];
    expect(lastPayload?.model_id).toBe("vehicle-attr-classify");
    expect(lastPayload?.task_type).toBe("classification");
  });

  it("点类别 chip 选中后再点清空", () => {
    renderCard();
    const carChip = screen.getByRole("button", { name: "car" });
    fireEvent.click(carChip);
    // 选中后出现 ✓ 前缀
    expect(screen.getByRole("button", { name: /✓.*car/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(screen.queryByRole("button", { name: /✓/ })).toBeNull();
  });
});
