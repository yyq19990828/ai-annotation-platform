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
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("Escape 触发 onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>x</p>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击 overlay 触发 onClose；点击内容不触发", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <button>inside</button>
      </Modal>,
    );
    // 内容点击
    fireEvent.click(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    // overlay 是 dialog 父元素
    const overlay = screen.getByRole("dialog").parentElement!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
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
