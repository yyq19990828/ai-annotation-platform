import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualCreationPopover, type ManualCreationPopoverProps } from "./ManualCreationPopover";

function makeProps(
  overrides: Partial<ManualCreationPopoverProps> = {},
): ManualCreationPopoverProps {
  return {
    id: "draft-1",
    anchor: { left: 100, top: 80 },
    classes: ["车辆", "道路"],
    recent: [],
    className: "车辆",
    schema: {
      fields: [
        { key: "code", label: "编号", type: "text", required: true },
        { key: "note", label: "备注", type: "text" },
        {
          key: "detail",
          label: "补充说明",
          type: "text",
          required: true,
          visible_if: { key: "code", equals: "其他" },
        },
      ],
    },
    attributes: {},
    requiredKeys: ["code"],
    phase: "attributes",
    onPickClass: vi.fn(),
    onChangeAttributes: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("ManualCreationPopover", () => {
  it("未开启连续模式时可保留调用方原有的外部点击处理", async () => {
    const onOutside = vi.fn();
    render(<ManualCreationPopover {...makeProps({ phase: "class", onOutside })} />);
    await userEvent.setup().click(document.body);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("类别已确定时只展示揭示的必填字段并聚焦输入", () => {
    render(<ManualCreationPopover {...makeProps()} />);
    expect(screen.getByRole("dialog", { name: "补全必填属性" })).toBeInTheDocument();
    expect(screen.getByText("类别：车辆")).toBeInTheDocument();
    expect(screen.getByLabelText(/编号/)).toHaveFocus();
    expect(screen.queryByLabelText("备注")).not.toBeInTheDocument();
    expect(screen.queryByTestId("class-picker-popover")).not.toBeInTheDocument();
  });

  it("输入后立即 Enter 使用最新属性，中文输入法确认不提交", () => {
    let attributes: Record<string, unknown> = {};
    const submit = vi.fn(() => attributes);
    const props = makeProps({
      onChangeAttributes: (next) => {
        attributes = next;
      },
      onSubmit: submit,
    });
    render(<ManualCreationPopover {...props} />);
    const input = screen.getByLabelText(/编号/);
    fireEvent.change(input, { target: { value: "车道 7" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).toHaveReturnedWith({ code: "车道 7" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("Esc 取消当前草稿，Enter 长按不重复提交", () => {
    const props = makeProps();
    render(<ManualCreationPopover {...props} />);
    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText(/编号/), { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("点弹窗外保留草稿，阻止背景点击与绘制事件", async () => {
    const props = makeProps();
    const backgroundPointer = vi.fn();
    const backgroundClick = vi.fn();
    render(
      <>
        <div data-testid="workbench-stage">
          <canvas
            aria-label="背景画布"
            onPointerDown={backgroundPointer}
            onClick={backgroundClick}
          />
        </div>
        <ManualCreationPopover {...props} />
      </>,
    );
    await userEvent.setup().click(screen.getByLabelText("背景画布"));
    expect(backgroundPointer).not.toHaveBeenCalled();
    expect(backgroundClick).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onPickClass).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("保存中允许点击任务队列，旧草稿不执行外部取消", async () => {
    const props = makeProps({ phase: "saving" });
    const selectTask = vi.fn();
    render(
      <>
        <button onClick={selectTask}>下一题</button>
        <ManualCreationPopover {...props} />
      </>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "下一题" }));
    expect(selectTask).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("已有工具菜单接管 Enter、Esc 和点击", async () => {
    const props = makeProps();
    const menuClick = vi.fn();
    render(
      <>
        <button data-workbench-tool-menu data-state="open" onClick={menuClick}>
          更多工具
        </button>
        <ManualCreationPopover {...props} />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "更多工具" }));
    await user.keyboard("{Enter}{Escape}");
    expect(menuClick).toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("外部输入框和表单内原生 select 的 Enter 不触发提交", () => {
    const props = makeProps({
      schema: {
        fields: [
          {
            key: "kind",
            label: "类型",
            type: "select",
            options: [{ label: "道路", value: "road" }],
          },
        ],
      },
      requiredKeys: ["kind"],
    });
    render(
      <>
        <input aria-label="外部搜索" />
        <ManualCreationPopover {...props} />
      </>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "外部搜索" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "类型" }), { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("保存中锁住属性与动作，Esc 只保留保存提示", () => {
    const props = makeProps({ phase: "saving" });
    render(<ManualCreationPopover {...props} />);
    expect(screen.getByLabelText(/编号/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存中" })).toBeDisabled();
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("正在保存，暂时不能取消");
  });

  it("错误保留类别与属性，键盘点击重试只提交一次", async () => {
    const props = makeProps({
      phase: "error",
      error: "任务锁已更新",
      attributes: { code: "车道 7" },
    });
    render(<ManualCreationPopover {...props} />);
    expect(screen.getByRole("alert")).toHaveTextContent("任务锁已更新");
    expect(screen.getByDisplayValue("车道 7")).toBeInTheDocument();
    screen.getByRole("button", { name: "重试" }).focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onPickClass).not.toHaveBeenCalled();
  });

  it("owner 揭示新依赖字段后按 visible_if 展示", () => {
    const props = makeProps();
    const { rerender } = render(<ManualCreationPopover {...props} />);
    expect(screen.queryByLabelText(/补充说明/)).not.toBeInTheDocument();
    rerender(
      <ManualCreationPopover
        {...props}
        attributes={{ code: "其他" }}
        requiredKeys={["code", "detail"]}
      />,
    );
    expect(screen.getByLabelText(/补充说明/)).toBeInTheDocument();
    rerender(
      <ManualCreationPopover
        {...props}
        attributes={{ code: "车辆" }}
        requiredKeys={["code", "detail"]}
      />,
    );
    expect(screen.queryByLabelText(/补充说明/)).not.toBeInTheDocument();
  });

  it("更换草稿 id 清除前一份未保存输入，不产生卸载回写", () => {
    const props = makeProps();
    const { rerender } = render(<ManualCreationPopover {...props} />);
    fireEvent.change(screen.getByLabelText(/编号/), { target: { value: "旧草稿" } });
    expect(props.onChangeAttributes).toHaveBeenCalledTimes(1);
    expect(props.onChangeAttributes).toHaveBeenCalledWith({ code: "旧草稿" });
    const nextOnChange = vi.fn();
    rerender(<ManualCreationPopover {...props} id="draft-2" onChangeAttributes={nextOnChange} />);
    expect(screen.getByLabelText(/编号/)).toHaveValue("");
    expect(screen.getByLabelText(/编号/)).toHaveFocus();
    expect(nextOnChange).not.toHaveBeenCalled();
  });

  it("选类阶段复用原选类键盘，外部导航继续且不提交 unknown", async () => {
    const props = makeProps({ phase: "class", className: "过期类别" });
    const backgroundClick = vi.fn();
    render(
      <>
        <button onClick={backgroundClick}>背景画布</button>
        <ManualCreationPopover {...props} />
      </>,
    );
    expect(screen.getByTestId("class-picker-popover")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "背景画布" }));
    expect(backgroundClick).toHaveBeenCalledTimes(1);
    expect(props.onPickClass).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(props.onPickClass).toHaveBeenCalledTimes(1);
    expect(props.onPickClass).toHaveBeenCalledWith("车辆");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("固定弹窗在视口边缘翻转，并在窗口缩小后保持边界", () => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 288,
      bottom: 200,
      width: 288,
      height: 200,
      toJSON: () => ({}),
    });
    const { unmount } = render(
      <ManualCreationPopover {...makeProps({ anchor: { left: 1000, top: 750 } })} />,
    );
    const panel = screen.getByRole("dialog");
    expect(
      Number.parseFloat(panel.style.getPropertyValue("--manual-creation-left")),
    ).toBeLessThanOrEqual(viewport.width - 296);
    expect(
      Number.parseFloat(panel.style.getPropertyValue("--manual-creation-top")),
    ).toBeLessThanOrEqual(viewport.height - 208);
    try {
      Object.defineProperty(window, "innerWidth", { value: 640, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: 480, configurable: true });
      act(() => window.dispatchEvent(new Event("resize")));
      expect(panel.style.getPropertyValue("--manual-creation-left")).toBe("344px");
      expect(panel.style.getPropertyValue("--manual-creation-top")).toBe("272px");
    } finally {
      unmount();
      Object.defineProperty(window, "innerWidth", { value: viewport.width, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: viewport.height, configurable: true });
    }
  });
});
