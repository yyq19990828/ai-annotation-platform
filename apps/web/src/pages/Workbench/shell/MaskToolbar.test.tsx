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

  it("低内存只读时禁用编辑但允许保存已有草稿", () => {
    const onCommit = vi.fn();
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
        canRedo={false}
        canEdit={false}
        canCommit
        editBlockReason="large_canvas_budget_exceeded"
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
        onCommit={onCommit}
        onCancel={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />,
    );

    expect((view.getByTitle("撤销笔画 (Ctrl+Z)") as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText(/不可编辑：当前设备无法容纳可见分块/)).not.toBeNull();
    fireEvent.click(view.getByTitle("确认 (Enter)"));
    expect(onCommit).toHaveBeenCalledOnce();
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

  it("实例预览走原子提交，冲突可重试或刷新范围", () => {
    const onCommitInstanceOperation = vi.fn();
    const onRefreshInstanceOperation = vi.fn();
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
        instanceOperationPreview={{
          id: 3,
          name: "split_components",
          sourceRevision: 4,
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
        }}
        operationStatus="preview"
        instanceCommitError="scope_stale"
        instanceCanRetry
        instanceCanRefresh
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
        onRunOperation={vi.fn()}
        onRunInstanceOperation={vi.fn()}
        onCommitInstanceOperation={onCommitInstanceOperation}
        onRefreshInstanceOperation={onRefreshInstanceOperation}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "原子提交" }));
    fireEvent.click(view.getByRole("button", { name: "重试" }));
    fireEvent.click(view.getByRole("button", { name: "刷新范围" }));
    expect(onCommitInstanceOperation).toHaveBeenCalledTimes(2);
    expect(onRefreshInstanceOperation).toHaveBeenCalledOnce();
    expect(view.getByRole("alert").textContent).toContain("scope_stale");
  });

  it("按错误恢复策略只显示可用动作，提交中禁用取消", () => {
    const view = render(
      <MaskToolbar
        active
        tool="brush"
        brushShape="circle"
        connectivity={4}
        radius={8}
        dirty
        phase="saving"
        canUndo={false}
        canRedo={false}
        canEdit={false}
        operationPreview={null}
        instanceOperationPreview={{
          id: 4,
          name: "join_masks",
          sourceRevision: 5,
          plan: {
            kind: "join_masks",
            sourceCount: 2,
            resultCount: 1,
            sourceAreas: [3, 2],
            resultAreas: [5],
            primary: new Uint8Array(4),
            created: [],
            focusAlpha: new Uint8Array(4),
          },
        }}
        operationStatus="preview"
        instanceCommitError="范围已变更"
        instanceCanRefresh
        instancePreviewDetail="创建 1 个合并副本，保留 2 个来源"
        instanceCommitting
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
        onRunOperation={vi.fn()}
        onRunInstanceOperation={vi.fn()}
        onCommitInstanceOperation={vi.fn()}
        onRefreshInstanceOperation={vi.fn()}
      />,
    );

    expect(view.queryByRole("button", { name: "重试" })).toBeNull();
    expect((view.getByRole("button", { name: "刷新范围" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "取消预览" }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText("创建 1 个合并副本，保留 2 个来源")).not.toBeNull();
  });

  it("未解决实例禁用提交并列出冻结的受影响对象", () => {
    const onRetry = vi.fn();
    const view = render(
      <MaskToolbar
        active
        tool="brush"
        brushShape="circle"
        connectivity={4}
        radius={8}
        dirty
        phase="error"
        canUndo={false}
        canRedo={false}
        canEdit
        operationPreview={null}
        instanceOperationPreview={{
          id: 5,
          name: "overlap",
          sourceRevision: 6,
          plan: {
            kind: "overlap",
            sourceCount: 2,
            resultCount: 2,
            sourceAreas: [4],
            resultAreas: [4, 2],
            primary: new Uint8Array(4),
            created: [],
            focusAlpha: new Uint8Array(4),
          },
        }}
        operationStatus="preview"
        instanceCommitError="1 个对象未解决"
        instanceCommitBlocked
        instancePreviewRows={[{
          annotationId: "12345678-aaaa-bbbb-cccc-1234567890ab",
          version: 7,
          changedPixels: 12,
          status: "unresolved",
        }]}
        onSetTool={vi.fn()}
        onSetBrushShape={vi.fn()}
        onSetConnectivity={vi.fn()}
        onSetRadius={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onRetry={onRetry}
        onConfirmOperation={vi.fn()}
        onCancelOperation={vi.fn()}
        onRunOperation={vi.fn()}
        onRunInstanceOperation={vi.fn()}
        onCommitInstanceOperation={vi.fn()}
      />,
    );

    expect((view.getByRole("button", { name: "原子提交" }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.queryByTitle("恢复或重试 Mask")).toBeNull();
    expect(view.getByText("12345678·v7·12px·未解决")).not.toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("合并菜单显式区分替换与保留来源", async () => {
    const onPrepareJoin = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <MaskToolbar
        active
        tool="brush"
        brushShape="circle"
        connectivity={4}
        radius={8}
        dirty={false}
        phase="ready"
        canUndo={false}
        canRedo={false}
        canEdit
        operationPreview={null}
        instanceOperationPreview={null}
        operationStatus="idle"
        canPrepareJoin
        onPrepareJoin={onPrepareJoin}
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
        onRunOperation={vi.fn()}
        onRunInstanceOperation={vi.fn()}
      />,
    );

    await user.click(view.getByTitle("Mask 高级工具"));
    await user.click(screen.getByRole("menuitem", { name: "合并已选 Mask（替换来源）" }));
    await user.click(view.getByTitle("Mask 高级工具"));
    await user.click(screen.getByRole("menuitem", { name: "合并为副本（保留来源）" }));
    expect(onPrepareJoin).toHaveBeenNthCalledWith(1, "replace_sources");
    expect(onPrepareJoin).toHaveBeenNthCalledWith(2, "preserve_sources");
  });
});
