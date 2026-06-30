import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchPet } from "./WorkbenchPet";

function renderPet(overrides: Partial<React.ComponentProps<typeof WorkbenchPet>> = {}) {
  return render(
    <WorkbenchPet
      hasSelection={false}
      collapsed={false}
      selectionTitle={null}
      annotationCount={0}
      onExpand={vi.fn()}
      {...overrides}
    />,
  );
}

describe("WorkbenchPet", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("默认渲染像素标注员皮肤", () => {
    const { container } = renderPet();
    expect(container.querySelector('svg[data-pet-skin="pixel-human"]')).not.toBeNull();
  });

  it("举牌态点击展开选中信息卡", () => {
    const onExpand = vi.fn();
    const { getByLabelText, getByText } = renderPet({
      hasSelection: true,
      collapsed: true,
      selectionTitle: "car",
      onExpand,
    });

    expect(getByText("car")).not.toBeNull();
    fireEvent.click(getByLabelText(/展开选中信息卡:car/));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
