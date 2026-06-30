// v0.16.8 · SelectedAnnotationCard 基座单测:
// - 展开态渲染 FloatingPanelShell(标题 + 内容 + 收起按钮),点收起触发 onCollapse
// - 折叠态渲染可点信息胶囊(不渲染内容),点击触发 onExpand

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, fireEvent } from "@testing-library/react";
import { SelectedAnnotationCard } from "./SelectedAnnotationCard";

const position = { x: 100, y: 80, w: 340, h: 440 };

afterEach(() => {
  vi.useRealTimers();
});

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
    expect(getByText("选中对象")).not.toBeNull();
    expect(getByText("car")).not.toBeNull();
    expect(getByText("卡片内容")).not.toBeNull();
    fireEvent.click(getByLabelText("收起浮窗"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("折叠态渲染信息胶囊(不渲染内容),点击触发 onExpand", () => {
    const onExpand = vi.fn();
    const { getByLabelText, getByText, queryByText } = render(
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
    // 折叠态:标题仍在(信息胶囊上),但内容不渲染;胶囊以展开面板中心定位。
    const tab = getByLabelText("展开选中信息卡(可拖动)") as HTMLElement;
    expect(getByText("car")).not.toBeNull();
    expect(queryByText("卡片内容")).toBeNull();
    expect(tab.style.getPropertyValue("--selection-tab-x")).toBe("212px");
    expect(tab.style.getPropertyValue("--selection-tab-y")).toBe("280px");
    expect(tab.style.getPropertyValue("--selection-tab-w")).toBe("116px");
    fireEvent.click(tab);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("收起时先保留展开面板完成退场,再渲染信息胶囊", () => {
    vi.useFakeTimers();
    const props = {
      title: "car",
      position,
      onPositionChange: () => {},
      onCollapse: () => {},
      onExpand: () => {},
      children: <div>卡片内容</div>,
    };
    const { getByText, queryByText, rerender } = render(
      <SelectedAnnotationCard {...props} collapsed={false} />,
    );

    rerender(<SelectedAnnotationCard {...props} collapsed />);

    expect(getByText("卡片内容")).not.toBeNull();
    expect(queryByText("选中")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(getByText("car")).not.toBeNull();
    expect(queryByText("卡片内容")).toBeNull();
  });
});
