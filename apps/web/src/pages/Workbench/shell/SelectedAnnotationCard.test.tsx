// v0.16.8 · SelectedAnnotationCard 基座单测:
// - 展开态渲染 FloatingPanelShell(标题 + 内容 + 收起按钮),点收起触发 onCollapse
// - 折叠态渲染可点小标签(不渲染内容),点击触发 onExpand

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SelectedAnnotationCard } from "./SelectedAnnotationCard";

const position = { x: 100, y: 80, w: 340, h: 440 };

describe("SelectedAnnotationCard", () => {
  it("展开态渲染标题与内容,点收起触发 onCollapse", () => {
    const onCollapse = vi.fn();
    const { getByText, getByLabelText } = render(
      <SelectedAnnotationCard
        title="car"
        position={position}
        onPositionChange={() => {}}
        collapsed={false}
        onCollapse={onCollapse}
        onExpand={() => {}}
      >
        <div>卡片内容</div>
      </SelectedAnnotationCard>,
    );
    expect(getByText("car")).not.toBeNull();
    expect(getByText("卡片内容")).not.toBeNull();
    fireEvent.click(getByLabelText("收起浮窗"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("折叠态渲染小标签(不渲染内容),点击触发 onExpand", () => {
    const onExpand = vi.fn();
    const { getByText, queryByText } = render(
      <SelectedAnnotationCard
        title="car"
        position={position}
        onPositionChange={() => {}}
        collapsed
        onCollapse={() => {}}
        onExpand={onExpand}
      >
        <div>卡片内容</div>
      </SelectedAnnotationCard>,
    );
    // 折叠态:标题仍在(标签上),但内容不渲染
    expect(getByText("car")).not.toBeNull();
    expect(queryByText("卡片内容")).toBeNull();
    fireEvent.click(getByText("car"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
