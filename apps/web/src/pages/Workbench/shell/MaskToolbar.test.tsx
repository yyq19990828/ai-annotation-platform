import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MaskToolbar } from "./MaskToolbar";

describe("MaskToolbar", () => {
  it("显示保存相位并连接笔画撤销重做", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const view = render(
      <MaskToolbar
        active
        mode="brush"
        radius={12}
        dirty
        phase="dirty"
        canUndo
        canRedo
        canEdit
        onSetMode={vi.fn()}
        onSetRadius={vi.fn()}
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
        mode="erase"
        radius={20}
        dirty
        phase="error"
        canUndo={false}
        canRedo={false}
        canEdit={false}
        onSetMode={vi.fn()}
        onSetRadius={vi.fn()}
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
  });
});
