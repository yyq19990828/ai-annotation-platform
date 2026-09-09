import type { ComponentProps, ReactElement } from "react";
import { act, fireEvent, render as renderComponent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  resolveMaskPrimaryActions,
  type MaskPrimaryActionsInput,
} from "../state/maskPrimaryActions";
import type { MaskInstanceOperationPreview, MaskOperationPreview } from "../state/useMaskEditor";
import { isWorkbenchInteractionBlocked } from "../state/workbenchInteractionGuards";
import { MaskToolbar } from "./MaskToolbar";

function render(element: ReactElement) {
  const view = renderComponent(element);
  fireEvent(
    view.getByTestId("mask-tool-capsule"),
    new MouseEvent("pointerover", { bubbles: true, buttons: 0 }),
  );
  fireEvent.click(view.getByRole("button", { name: "更多 Mask 工具" }));
  return view;
}

function regionPreview(afterArea = 14): MaskOperationPreview {
  return {
    id: 1,
    name: "lasso_add",
    sourceRevision: 8,
    alpha: new Uint8Array(4),
    report: {
      beforeArea: 10,
      afterArea,
      changedPixels: 4,
      beforeComponents: 1,
      afterComponents: afterArea === 0 ? 0 : 1,
      beforeHoles: 0,
      afterHoles: 0,
      bounds: { x0: 0, y0: 0, x1: 2, y1: 2 },
    },
  };
}

function instancePreview(): MaskInstanceOperationPreview {
  return {
    id: 2,
    name: "split_components",
    sourceRevision: 8,
    plan: {
      kind: "split_components",
      sourceCount: 1,
      resultCount: 2,
      sourceAreas: [4],
      resultAreas: [3, 1],
      primary: new Uint8Array(4),
      created: [new Uint8Array(4)],
      focusAlpha: new Uint8Array(4),
    },
  };
}

function toolbarProps(
  input: Partial<MaskPrimaryActionsInput> = {},
  props: Partial<ComponentProps<typeof MaskToolbar>> = {},
): ComponentProps<typeof MaskToolbar> {
  const state: MaskPrimaryActionsInput = {
    active: true,
    phase: "ready",
    dirty: false,
    canEdit: true,
    revision: 8,
    operationStatus: "idle",
    operationPreview: null,
    instanceOperationPreview: null,
    ...input,
  };
  return {
    ...state,
    actions: resolveMaskPrimaryActions(state),
    tool: "brush",
    brushShape: "circle",
    connectivity: 4,
    radius: 12,
    canUndo: false,
    canRedo: false,
    onPrimaryAction: vi.fn(),
    onSecondaryAction: vi.fn(),
    onSetTool: vi.fn(),
    onSetBrushShape: vi.fn(),
    onSetConnectivity: vi.fn(),
    onSetRadius: vi.fn(),
    onRunOperation: vi.fn(async () => true),
    onRunInstanceOperation: vi.fn(async () => true),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...props,
  };
}

describe("MaskToolbar", () => {
  it("starts collapsed, preserves settings, and lets the first outside pointer reach the canvas", async () => {
    const user = userEvent.setup();
    const props = toolbarProps();
    const onDraw = vi.fn();
    const view = renderComponent(
      <>
        <button onPointerDown={onDraw}>画布</button>
        <MaskToolbar {...props} />
      </>,
    );
    const capsule = screen.getByTestId("mask-tool-capsule");
    const compact = screen.getByRole("button", { name: "Mask 常用工具：笔刷" });
    expect(compact).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("mask-toolbar")).toBeNull();
    fireEvent(capsule, new MouseEvent("pointerover", { bubbles: true, buttons: 1 }));
    expect(compact).toHaveAttribute("aria-expanded", "false");
    fireEvent(capsule, new MouseEvent("pointerover", { bubbles: true, buttons: 0 }));
    expect(compact).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "橡皮" }));
    expect(props.onSetTool).toHaveBeenCalledWith("erase");
    await user.click(screen.getByRole("button", { name: "更多 Mask 工具" }));
    const slider = screen.getByTestId("mask-radius-slider");
    fireEvent.change(slider, { target: { value: "24" } });
    expect(props.onSetRadius).toHaveBeenCalledWith(24);
    const seen: boolean[] = [];
    const guard = (event: Event) => seen.push(isWorkbenchInteractionBlocked(event));
    window.addEventListener("pointerdown", guard, true);
    try {
      await user.click(screen.getByRole("button", { name: "画布" }));
    } finally {
      window.removeEventListener("pointerdown", guard, true);
    }
    expect(onDraw).toHaveBeenCalledOnce();
    expect(seen).toEqual([false]);
    expect(screen.queryByTestId("mask-toolbar")).toBeNull();
    expect(props.onSecondaryAction).not.toHaveBeenCalled();
    view.rerender(<MaskToolbar {...props} radius={24} />);
    fireEvent(
      screen.getByTestId("mask-tool-capsule"),
      new MouseEvent("pointerover", { bubbles: true, buttons: 0 }),
    );
    await user.click(screen.getByRole("button", { name: "更多 Mask 工具" }));
    expect(screen.getByTestId("mask-radius-slider")).toHaveValue("24");
    const keys: boolean[] = [];
    const keyGuard = (event: KeyboardEvent) => keys.push(isWorkbenchInteractionBlocked(event));
    window.addEventListener("keydown", keyGuard, true);
    try {
      await user.keyboard("{Escape}");
      act(() => screen.getByTestId("mask-settings-trigger").focus());
      await user.keyboard("b");
    } finally {
      window.removeEventListener("keydown", keyGuard, true);
    }
    expect(keys).toEqual([true, false]);
    expect(props.onSecondaryAction).not.toHaveBeenCalled();
    fireEvent(
      screen.getByTestId("mask-tool-capsule"),
      new MouseEvent("pointerover", { bubbles: true, buttons: 0 }),
    );
    await user.click(screen.getByRole("button", { name: "更多 Mask 工具" }));
    await user.click(screen.getByRole("button", { name: "收起 Mask 设置" }));
    expect(screen.queryByTestId("mask-toolbar")).toBeNull();
  });

  it("offers image slice only for a saved eligible source and changes only the pointer tool", async () => {
    const user = userEvent.setup();
    const props = toolbarProps({}, { sliceUnavailableReason: null });
    const view = render(<MaskToolbar {...props} />);
    await user.click(view.getByTitle("Mask 高级工具"));
    await user.click(screen.getByRole("menuitem", { name: "直线切割为两个实例" }));
    expect(props.onSetTool).toHaveBeenCalledWith("slice_mask");
    expect(props.onRunInstanceOperation).not.toHaveBeenCalled();
    view.rerender(<MaskToolbar {...props} sliceUnavailableReason="有活动子对象的 Mask 不能切割" />);
    await user.click(view.getByTitle("Mask 高级工具"));
    expect(screen.getByRole("menuitem", { name: "直线切割为两个实例" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.keyboard("{Escape}");
    view.rerender(<MaskToolbar {...props} sliceUnavailableReason={undefined} />);
    await user.click(view.getByTitle("Mask 高级工具"));
    expect(screen.queryByRole("menuitem", { name: "直线切割为两个实例" })).toBeNull();
  });
  it("阶段变化沿用工作台紧凑字号和按钮尺寸", () => {
    const view = render(<MaskToolbar {...toolbarProps()} />);

    expect(view.getByTestId("mask-toolbar").className).toContain("px-3");
    expect(view.getByTestId("mask-toolbar").className).toContain("py-3");
    for (const button of [
      view.getByTitle("Mask 高级工具"),
      view.getByTestId("mask-primary-action"),
      view.getByTestId("mask-secondary-action"),
    ]) {
      expect(button.className).toContain("h-6");
      expect(button.className).toContain("text-xs");
      expect(button.className).toContain(":size-3");
    }
    expect(view.getByTitle("笔刷 (B)").parentElement?.className).toContain("[&_svg]:size-3");
    expect(view.getByRole("button", { name: "已保存" })).toBeDisabled();
    expect(view.getByRole("status")).toHaveTextContent("Enter 不新建标注或关键帧");
  });

  it("普通脏稿只将保存和受保护退出交给 owner，保留笔画撤销重做", () => {
    const props = toolbarProps({ dirty: true, phase: "dirty" }, { canUndo: true, canRedo: true });
    const view = render(<MaskToolbar {...props} />);

    expect(view.getByText("未保存")).toBeVisible();
    fireEvent.click(view.getByTitle("撤销笔画 (Ctrl+Z)"));
    fireEvent.click(view.getByTitle("重做笔画 (Ctrl+Y)"));
    fireEvent.click(view.getByRole("button", { name: "保存 Mask" }));
    fireEvent.click(view.getByRole("button", { name: "退出编辑" }));
    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(props.onRedo).toHaveBeenCalledOnce();
    expect(props.onPrimaryAction).toHaveBeenCalledOnce();
    expect(props.onSecondaryAction).toHaveBeenCalledOnce();
    expect(view.getByRole("status")).toHaveTextContent("保存、丢弃或继续编辑");
  });

  it("普通错误通过唯一主动作恢复编辑，不展示另一个确认或重试按钮", () => {
    const props = toolbarProps({
      dirty: true,
      phase: "error",
      canEdit: false,
      editBlockReason: "editor_error",
    });
    const view = render(<MaskToolbar {...props} />);

    expect(view.getByText("操作失败")).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "恢复编辑" }));
    expect(props.onPrimaryAction).toHaveBeenCalledOnce();
    expect(view.queryByRole("button", { name: "确认" })).toBeNull();
    expect(view.queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("低内存时禁用编辑但允许保存已有像素草稿", () => {
    const props = toolbarProps(
      {
        dirty: true,
        phase: "dirty",
        canEdit: false,
        canCommit: true,
        editBlockReason: "large_canvas_budget_exceeded",
      },
      { canUndo: true },
    );
    const view = render(<MaskToolbar {...props} />);

    expect(view.getByTitle("撤销笔画 (Ctrl+Z)")).toBeDisabled();
    expect(view.getByText(/不可编辑：当前设备无法容纳可见分块/)).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "保存 Mask" }));
    expect(props.onPrimaryAction).toHaveBeenCalledOnce();
  });

  it("区域预览只保留一组应用和取消，继续显示变化指标与 pointer 工具", () => {
    const props = toolbarProps(
      { operationPreview: regionPreview(), operationStatus: "preview" },
      { tool: "lasso_add" },
    );
    const view = render(<MaskToolbar {...props} />);

    fireEvent.click(view.getByTitle("橡皮 (E)"));
    expect(props.onSetTool).toHaveBeenCalledWith("erase");
    expect(view.getByText("变化 4 px")).toBeVisible();
    expect(view.getAllByRole("button", { name: "应用区域预览" })).toHaveLength(1);
    expect(view.getAllByRole("button", { name: "取消预览" })).toHaveLength(1);
    fireEvent.click(view.getByTestId("mask-primary-action"));
    fireEvent.click(view.getByTestId("mask-secondary-action"));
    expect(props.onPrimaryAction).toHaveBeenCalledOnce();
    expect(props.onSecondaryAction).toHaveBeenCalledOnce();
    expect(view.getByTestId("mask-primary-action").title).toContain("随后保存才会写入标注");
  });

  it("空区域预览也交给共享主动作，工具栏不另建确认状态", () => {
    const props = toolbarProps({
      dirty: true,
      phase: "dirty",
      operationPreview: regionPreview(0),
      operationStatus: "preview",
    });
    const view = render(<MaskToolbar {...props} />);

    fireEvent.click(view.getByRole("button", { name: "应用区域预览" }));
    expect(props.onPrimaryAction).toHaveBeenCalledOnce();
    expect(view.queryByRole("alertdialog")).toBeNull();
    expect(view.getByText(/面积 10→0/)).toBeVisible();
  });

  it("实例预览的唯一主动作显示结果数和持久化含义", () => {
    const props = toolbarProps(
      { instanceOperationPreview: instancePreview(), operationStatus: "preview" },
      { instancePreviewDetail: "保留主对象，创建 1 个新实例" },
    );
    const view = render(<MaskToolbar {...props} />);

    expect(view.getByText("1 个来源 → 2 个结果")).toBeVisible();
    expect(view.getByText("保留主对象，创建 1 个新实例")).toBeVisible();
    expect(view.getAllByRole("button", { name: "提交 2 个实例" })).toHaveLength(1);
    expect(view.queryByRole("button", { name: "原子提交" })).toBeNull();
    fireEvent.click(view.getByTestId("mask-primary-action"));
    expect(props.onPrimaryAction).toHaveBeenCalledOnce();
    expect(view.getByTestId("mask-primary-action").title).toContain("直接保存到当前任务");
  });

  it("实例错误只展示 owner 允许的单一重试主动作", () => {
    const props = toolbarProps({
      phase: "error",
      canEdit: false,
      editBlockReason: "editor_error",
      instanceOperationPreview: instancePreview(),
      operationStatus: "preview",
      instanceCommitError: "服务暂不可用，预览已保留",
      instanceCanRetry: true,
      instanceCanRefresh: true,
    });
    const view = render(<MaskToolbar {...props} />);

    expect(view.getByRole("alert")).toHaveTextContent("服务暂不可用");
    fireEvent.click(view.getByRole("button", { name: "重试实例提交" }));
    expect(props.onPrimaryAction).toHaveBeenCalledOnce();
    expect(view.queryByRole("button", { name: "刷新范围" })).toBeNull();
    expect(view.queryByRole("button", { name: "恢复编辑" })).toBeNull();
  });

  it("实例预览被刷新清理后，错误态仍可通过主动作刷新范围", () => {
    const props = toolbarProps({
      phase: "error",
      canEdit: false,
      editBlockReason: "editor_error",
      instanceCommitError: "来源 Mask 已变更，草稿已保留",
      instanceCanRefresh: true,
    });
    const view = render(<MaskToolbar {...props} />);

    expect(view.getByRole("button", { name: "刷新范围" })).toBeEnabled();
    fireEvent.click(view.getByTestId("mask-primary-action"));
    expect(props.onPrimaryAction).toHaveBeenCalledOnce();
  });

  it.each<Partial<MaskPrimaryActionsInput>>([
    { phase: "saving" },
    { savePending: true },
    { instanceCommitting: true },
    { instanceRefreshing: true },
    { interactionFrozen: true },
  ])("不可取消的处理阶段禁用唯一主次按钮：%j", (pending) => {
    const props = toolbarProps({ dirty: true, phase: "dirty", ...pending });
    const view = render(<MaskToolbar {...props} />);

    const primary = view.getByTestId("mask-primary-action");
    const secondary = view.getByTestId("mask-secondary-action");
    expect(primary).toBeDisabled();
    expect(secondary).toBeDisabled();
    fireEvent.click(primary);
    fireEvent.click(secondary);
    expect(props.onPrimaryAction).not.toHaveBeenCalled();
    expect(props.onSecondaryAction).not.toHaveBeenCalled();
  });

  it("计算中只有次动作可取消运算，不另显示取消按钮", () => {
    const props = toolbarProps({ dirty: true, phase: "dirty", operationStatus: "computing" });
    const view = render(<MaskToolbar {...props} />);

    expect(view.getByTestId("mask-primary-action")).toBeDisabled();
    expect(view.getAllByRole("button", { name: "取消运算" })).toHaveLength(1);
    fireEvent.click(view.getByRole("button", { name: "取消运算" }));
    expect(props.onSecondaryAction).toHaveBeenCalledOnce();
    expect(view.getByRole("status")).toHaveTextContent("保留已有像素草稿");
  });

  it("运算失败保留错误说明，通过主动作恢复，不另显示关闭按钮", () => {
    const props = toolbarProps({
      dirty: true,
      phase: "dirty",
      operationStatus: "error",
      operationError: new Error("预览超出资源预算"),
    });
    const view = render(<MaskToolbar {...props} />);

    expect(view.getByRole("alert")).toHaveTextContent("预览超出资源预算");
    fireEvent.click(view.getByRole("button", { name: "恢复编辑" }));
    expect(props.onPrimaryAction).toHaveBeenCalledOnce();
    expect(view.queryByRole("button", { name: "关闭" })).toBeNull();
  });

  it("未解决实例不能显示提交动作，保留受影响对象明细", () => {
    const props = toolbarProps(
      {
        phase: "error",
        instanceOperationPreview: instancePreview(),
        operationStatus: "preview",
        instanceCommitError: "1 个对象未解决",
        instanceCommitBlocked: true,
      },
      {
        instancePreviewRows: [
          {
            annotationId: "12345678-aaaa-bbbb-cccc-1234567890ab",
            version: 7,
            changedPixels: 12,
            status: "unresolved",
          },
        ],
      },
    );
    const view = render(<MaskToolbar {...props} />);

    expect(view.queryByRole("button", { name: "提交 2 个实例" })).toBeNull();
    expect(view.getByText("12345678·v7·12px·未解决")).toBeVisible();
    expect(view.getByRole("alert")).toHaveTextContent("1 个对象未解决");
  });

  it("只有普通像素保存阶段允许保存并传播", () => {
    const onCommitAndPropagate = vi.fn();
    const view = render(
      <MaskToolbar {...toolbarProps({ dirty: true, phase: "dirty" }, { onCommitAndPropagate })} />,
    );
    fireEvent.click(view.getByRole("button", { name: "保存并传播" }));
    expect(onCommitAndPropagate).toHaveBeenCalledOnce();

    for (const state of [
      { dirty: false },
      { dirty: true, operationPreview: regionPreview(), operationStatus: "preview" as const },
      {
        dirty: true,
        instanceOperationPreview: instancePreview(),
        operationStatus: "preview" as const,
      },
      { dirty: true, savePending: true },
    ]) {
      view.rerender(<MaskToolbar {...toolbarProps(state, { onCommitAndPropagate })} />);
      expect(view.getByRole("button", { name: "保存并传播" })).toBeDisabled();
    }
  });

  it("高级菜单继续复用形态学和实例 runner，并让背景快捷键让位", async () => {
    const props = toolbarProps();
    const user = userEvent.setup();
    const view = render(<MaskToolbar {...props} />);
    const trigger = view.getByTitle("Mask 高级工具");
    const seen: boolean[] = [];
    const onKey = (event: KeyboardEvent) => {
      if (["Enter", "Escape"].includes(event.key)) seen.push(isWorkbenchInteractionBlocked(event));
    };
    window.addEventListener("keydown", onKey, true);
    try {
      trigger.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("menu")).toHaveAttribute("data-workbench-tool-menu");
      await user.keyboard("{Escape}");
      expect(seen).toEqual([true, true]);
    } finally {
      window.removeEventListener("keydown", onKey, true);
    }

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "膨胀" }));
    expect(props.onRunOperation).toHaveBeenCalledWith("dilate", {
      type: "morphology",
      operation: "dilate",
      kernelShape: "disk",
      radius: 1,
    });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "拆分全部组件（保留最大）" }));
    expect(props.onRunInstanceOperation).toHaveBeenCalledWith("split_components", {
      type: "split_components",
      keep: "largest",
      connectivity: 4,
    });
  });

  it("合并菜单继续显式区分替换与保留来源", async () => {
    const onPrepareJoin = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <MaskToolbar {...toolbarProps({}, { canPrepareJoin: true, onPrepareJoin })} />,
    );

    await user.click(view.getByTitle("Mask 高级工具"));
    await user.click(screen.getByRole("menuitem", { name: "合并已选 Mask（替换来源）" }));
    await user.click(view.getByTitle("Mask 高级工具"));
    await user.click(screen.getByRole("menuitem", { name: "合并为副本（保留来源）" }));
    expect(onPrepareJoin).toHaveBeenNthCalledWith(1, "replace_sources");
    expect(onPrepareJoin).toHaveBeenNthCalledWith(2, "preserve_sources");
  });
});
