import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MaskToolbar } from "./MaskToolbar";

describe("MaskToolbar", () => {
  it("显示保存相位并连接笔画撤销重做", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const view = render(
      <MaskToolbar
        active
        tool="brush"
        brushShape="circle"
        connectivity={4}
        radius={12}
        dirty
        phase="dirty"
        canUndo
        canRedo
        canEdit
        operationPreview={null}
        instanceOperationPreview={null}
        operationStatus="idle"
        onSetTool={vi.fn()}
        onSetBrushShape={vi.fn()}
        onSetConnectivity={vi.fn()}
        onSetRadius={vi.fn()}
        onConfirmOperation={vi.fn()}
        onCancelOperation={vi.fn()}
        onRunOperation={vi.fn()}
        onRunInstanceOperation={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );

    expect(view.getByText("未保存")).not.toBeNull();
    fireEvent.click(view.getByTitle("撤销笔画 (Ctrl+Z)"));
    fireEvent.click(view.getByTitle("重做笔画 (Ctrl+Y)"));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("错误相位提供重试并禁用确认", () => {
    const onRetry = vi.fn();
    const view = render(
      <MaskToolbar
        active
        tool="erase"
        brushShape="square"
        connectivity={8}
        radius={20}
        dirty
        phase="error"
        canUndo={false}
        canRedo={false}
        canEdit={false}
        editBlockReason="annotation_locked"
        operationPreview={null}
        instanceOperationPreview={null}
        operationStatus="idle"
        onSetTool={vi.fn()}
        onSetBrushShape={vi.fn()}
        onSetConnectivity={vi.fn()}
        onSetRadius={vi.fn()}
        onConfirmOperation={vi.fn()}
        onCancelOperation={vi.fn()}
        onRunOperation={vi.fn()}
        onRunInstanceOperation={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(view.getByText("操作失败")).not.toBeNull();
    fireEvent.click(view.getByTitle("恢复或重试 Mask"));
    expect(onRetry).toHaveBeenCalledOnce();
    expect((view.getByTitle("确认 (Enter)") as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText("不可编辑：当前标注已锁定")).not.toBeNull();
  });

  it("高级 pointer tool 使用单选组并显示 operation preview 指标", () => {
    const onSetTool = vi.fn();
    const onConfirmOperation = vi.fn();
    const onCancelOperation = vi.fn();
    const view = render(
      <MaskToolbar
        active
        tool="lasso_add"
        brushShape="circle"
        connectivity={4}
        radius={8}
        dirty={false}
        phase="ready"
        canUndo={false}
        canRedo={false}
        canEdit
        operationPreview={{
          id: 1,
          name: "lasso_add",
          sourceRevision: 2,
          alpha: new Uint8Array(4),
          report: {
            beforeArea: 10,
            afterArea: 14,
            changedPixels: 4,
            beforeComponents: 1,
            afterComponents: 1,
            beforeHoles: 0,
            afterHoles: 0,
            bounds: { x0: 0, y0: 0, x1: 2, y1: 2 },
          },
        }}
        operationStatus="preview"
        instanceOperationPreview={null}
        onSetTool={onSetTool}
        onSetBrushShape={vi.fn()}
        onSetConnectivity={vi.fn()}
        onSetRadius={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onConfirmOperation={onConfirmOperation}
        onCancelOperation={onCancelOperation}
        onRunOperation={vi.fn()}
        onRunInstanceOperation={vi.fn()}
      />,
    );

    fireEvent.click(view.getByTitle("橡皮 (E)"));
    expect(onSetTool).toHaveBeenCalledWith("erase");
    expect(view.getByText("变化 4 px")).not.toBeNull();
    fireEvent.click(view.getByRole("button", { name: "应用预览" }));
    fireEvent.click(view.getByRole("button", { name: "取消预览" }));
    expect(onConfirmOperation).toHaveBeenCalledOnce();
    expect(onCancelOperation).toHaveBeenCalledOnce();
  });

  it("形态学与 split 从高级菜单进入统一 runner", async () => {
    const onRunOperation = vi.fn(async () => true);
    const onRunInstanceOperation = vi.fn(async () => true);
    const user = userEvent.setup();
    const view = render(
      <MaskToolbar
        active
        tool="brush"
        brushShape="circle"
        connectivity={4}
        radius={8}
        dirty
        phase="dirty"
        canUndo={false}
        canRedo={false}
        canEdit
        operationPreview={null}
        instanceOperationPreview={null}
        operationStatus="idle"
        onSetTool={vi.fn()}
        onSetBrushShape={vi.fn()}
        onSetConnectivity={vi.fn()}
        onSetRadius={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onConfirmOperation={vi.fn()}
        onCancelOperation={vi.fn()}
        onRunOperation={onRunOperation}
        onRunInstanceOperation={onRunInstanceOperation}
      />,
    );

    await user.click(view.getByTitle("Mask 高级工具"));
    await user.click(screen.getByRole("menuitem", { name: "膨胀" }));
    expect(onRunOperation).toHaveBeenCalledWith("dilate", {
      type: "morphology",
      operation: "dilate",
      kernelShape: "disk",
      radius: 1,
    });

    await user.click(view.getByTitle("Mask 高级工具"));
    await user.click(screen.getByRole("menuitem", { name: "拆分全部组件（保留最大）" }));
    expect(onRunInstanceOperation).toHaveBeenCalledWith("split_components", {
      type: "split_components",
      keep: "largest",
      connectivity: 4,
    });
  });

  it("空结果必须经过 AlertDialog 二次确认", () => {
    const onConfirmOperation = vi.fn();
    const view = render(
      <MaskToolbar
        active
        tool="component_delete"
        brushShape="circle"
        connectivity={4}
        radius={8}
        dirty
        phase="dirty"
        canUndo={false}
        canRedo={false}
        canEdit
        operationPreview={{
          id: 2,
          name: "component_delete",
          sourceRevision: 3,
          alpha: new Uint8Array(4),
          report: {
            beforeArea: 4,
            afterArea: 0,
            changedPixels: 4,
            beforeComponents: 1,
            afterComponents: 0,
            beforeHoles: 0,
            afterHoles: 0,
            bounds: { x0: 0, y0: 0, x1: 2, y1: 2 },
          },
        }}
        instanceOperationPreview={null}
        operationStatus="preview"
        onSetTool={vi.fn()}
        onSetBrushShape={vi.fn()}
        onSetConnectivity={vi.fn()}
        onSetRadius={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onConfirmOperation={onConfirmOperation}
        onCancelOperation={vi.fn()}
        onRunOperation={vi.fn()}
        onRunInstanceOperation={vi.fn()}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "应用预览" }));
    expect(onConfirmOperation).not.toHaveBeenCalled();
    expect(view.getByText("确认清空当前 Mask？")).not.toBeNull();
    fireEvent.click(view.getByRole("button", { name: "确认清空" }));
    expect(onConfirmOperation).toHaveBeenCalledOnce();
  });
});
