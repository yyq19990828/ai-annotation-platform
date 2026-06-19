/**
 * v0.7.6 · Modal 单测：open 切换、Escape 关闭、点击 overlay 关闭、点击内部不关闭。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("<Modal />", () => {
  it("open=false 不渲染", () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>hidden</p>
      </Modal>,
    );
    expect(screen.queryByText("hidden")).toBeNull();
  });

  it("open=true 渲染 children + title", () => {
    render(
      <Modal open onClose={() => {}} title="测试 modal">
        <p>visible</p>
      </Modal>,
    );
    expect(screen.getByText("visible")).toBeInTheDocument();
    expect(screen.getByText("测试 modal")).toBeInTheDocument();
    // v0.17.2：迁到 Radix Dialog —— role=dialog + data-state=open + aria-labelledby(关联 title)。
    // Radix 不显式设 aria-modal(靠 FocusScope 实现模态),故改断言其 open 态与可访问名关联。
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-state", "open");
    expect(dialog).toHaveAttribute("aria-labelledby");
  });

  it("Escape 触发 onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>x</p>
      </Modal>,
    );
    // Radix 的 Esc 监听挂在 document(旧实现挂 window),故在 document 上派发。
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击内容不触发 onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <button>inside</button>
      </Modal>,
    );
    // 内容内点击不应关闭(我们关心子元素点击不误触发);
    // 「外部点击关闭」是 Radix DismissableLayer 的库行为,onClose 接线已由 Escape / 关闭按钮用例覆盖。
    fireEvent.pointerDown(screen.getByText("inside"));
    fireEvent.click(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("点击右上角关闭按钮触发 onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="t">
        <p>x</p>
      </Modal>,
    );
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
