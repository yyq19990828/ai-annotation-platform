import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolUnitTabs } from "./ToolUnitTabs";

const bboxBindings = {
  bbox: {
    enabled: true,
    classRows: [],
    attributeFields: [],
  },
};

describe("ToolUnitTabs", () => {
  it("视频项目把 bbox 展示为矩形框 / 轨迹", () => {
    render(
      <ToolUnitTabs
        bindings={bboxBindings}
        activeUnit="bbox"
        onSelect={vi.fn()}
        dataType="video"
      />,
    );

    expect(screen.getByRole("button", { name: /矩形框 \/ 轨迹/ })).toBeInTheDocument();
    expect(screen.queryByText("矩形框 (bbox)")).toBeNull();
  });

  it("图片项目保留 bbox 原有标签", () => {
    render(
      <ToolUnitTabs
        bindings={bboxBindings}
        activeUnit="bbox"
        onSelect={vi.fn()}
        dataType="image"
      />,
    );

    expect(screen.getByRole("button", { name: /矩形框 \(bbox\)/ })).toBeInTheDocument();
  });
});
