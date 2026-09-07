import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ContinuousCreationControls,
  type ContinuousCreationControlsProps,
} from "./ContinuousCreationControls";

function makeProps(
  overrides: Partial<ContinuousCreationControlsProps> = {},
): ContinuousCreationControlsProps {
  return {
    enabled: false,
    toolUnitId: "bbox",
    units: [
      { id: "bbox", label: "矩形框", classes: ["车辆", "行人"] },
      { id: "region", label: "多边形", classes: ["车辆", "道路"] },
    ],
    activeClass: "车辆",
    onEnabledChange: vi.fn(),
    onSelectUnit: vi.fn(),
    onPickClass: vi.fn(),
    ...overrides,
  };
}

describe("ContinuousCreationControls", () => {
  it("默认展示显式开关与只读图例，开启由 owner 决定", async () => {
    const props = makeProps();
    render(<ContinuousCreationControls {...props} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "连续创建" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("车辆")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText("车辆"));
    expect(props.onPickClass).not.toHaveBeenCalled();
    await userEvent.setup().click(toggle);
    expect(props.onEnabledChange).toHaveBeenCalledTimes(1);
    expect(props.onEnabledChange).toHaveBeenCalledWith(true);
    expect(props.onPickClass).not.toHaveBeenCalled();
  });

  it("工具单元选择与类别选择分开回调，同名类别保持单位边界", async () => {
    const user = userEvent.setup();
    const props = makeProps({ enabled: true });
    const { rerender } = render(<ContinuousCreationControls {...props} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "创建工具单元" }), "region");
    expect(props.onSelectUnit).toHaveBeenCalledTimes(1);
    expect(props.onSelectUnit).toHaveBeenCalledWith("region");
    expect(props.onPickClass).not.toHaveBeenCalled();

    rerender(<ContinuousCreationControls {...props} toolUnitId="region" />);
    expect(screen.queryByRole("button", { name: "行人" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "道路" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "车辆" }));
    expect(props.onPickClass).toHaveBeenCalledTimes(1);
    expect(props.onPickClass).toHaveBeenCalledWith("车辆");
  });

  it("类别使用原生按钮，键盘可选且报告当前类别", async () => {
    const props = makeProps({ enabled: true });
    render(<ContinuousCreationControls {...props} />);
    const current = screen.getByRole("button", { name: "车辆" });
    expect(current).toHaveAttribute("aria-pressed", "true");
    const next = screen.getByRole("button", { name: "行人" });
    next.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(props.onPickClass).toHaveBeenCalledTimes(1);
    expect(props.onPickClass).toHaveBeenCalledWith("行人");
  });

  it("只读状态禁用模式、工具和类别入口", async () => {
    const props = makeProps({ enabled: true, readOnly: true });
    render(<ContinuousCreationControls {...props} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    const cls = screen.getByRole("button", { name: "车辆" });
    expect(cls).toBeDisabled();
    await userEvent.setup().click(cls);
    expect(props.onEnabledChange).not.toHaveBeenCalled();
    expect(props.onSelectUnit).not.toHaveBeenCalled();
    expect(props.onPickClass).not.toHaveBeenCalled();
  });

  it("切换单位后不残留上个单位的搜索条件", async () => {
    const user = userEvent.setup();
    const props = makeProps({
      enabled: true,
      units: [
        { id: "bbox", label: "矩形框", classes: Array.from({ length: 10 }, (_, i) => `类别 ${i}`) },
        { id: "region", label: "多边形", classes: ["道路"] },
      ],
    });
    const { rerender } = render(<ContinuousCreationControls {...props} />);
    await user.type(screen.getByRole("textbox", { name: "搜索创建类别" }), "类别 9");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    rerender(<ContinuousCreationControls {...props} toolUnitId="region" />);
    expect(screen.getByRole("button", { name: "道路" })).toBeInTheDocument();
  });
});
