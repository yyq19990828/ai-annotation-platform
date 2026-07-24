import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClassPickerPopover } from "./ClassPickerPopover";

describe("ClassPickerPopover", () => {
  it("Enter 不会提交来自其他工具单位的过期默认类别", () => {
    const onPick = vi.fn();
    render(
      <ClassPickerPopover
        position="fixed"
        anchor={{ left: 20, top: 20 }}
        classes={["road", "sky", "building"]}
        recent={[]}
        defaultClass="car"
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith("road");
  });
});
