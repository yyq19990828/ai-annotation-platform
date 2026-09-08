import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ClassPickerPopover } from "./ClassPickerPopover";

describe("ClassPickerPopover", () => {
  it.each(["data-workbench-video-tool-command", "data-workbench-tracker-review"])(
    "%s pointer capture and native activation do not prematurely commit the pending class",
    async (marker) => {
      const onPick = vi.fn();
      const onCancel = vi.fn();
      const onCommand = vi.fn();
      const user = userEvent.setup();
      const { getByRole } = render(
        <>
          <button {...{ [marker]: "" }} onClick={onCommand}>
            轨迹范围
          </button>
          <ClassPickerPopover
            position="fixed"
            anchor={{ left: 20, top: 20 }}
            classes={["car", "person"]}
            recent={[]}
            defaultClass="car"
            onPick={onPick}
            onCancel={onCancel}
          />
        </>,
      );
      await user.click(getByRole("button", { name: "轨迹范围" }));
      await user.keyboard("{Enter}");
      expect(onCommand).toHaveBeenCalledTimes(2);
      expect(onPick).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "Enter" });
      expect(onPick).toHaveBeenCalledWith("car");
    },
  );

  it("工具菜单接管按键和外部点击时保留待选类别的草稿", async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { getByRole } = render(
      <>
        <button data-workbench-tool-menu data-state="open">
          更多工具
        </button>
        <ClassPickerPopover
          position="fixed"
          anchor={{ left: 20, top: 20 }}
          classes={["car", "person"]}
          recent={[]}
          defaultClass="car"
          onPick={onPick}
          onCancel={onCancel}
        />
      </>,
    );

    await user.click(getByRole("button", { name: "更多工具" }));
    await user.keyboard("1{Enter}{Escape}");
    expect(onPick).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    getByRole("button", { name: "更多工具" }).setAttribute("data-state", "closed");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("car");
  });

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
