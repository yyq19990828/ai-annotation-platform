/**
 * v0.14.1 · CrossFrameOverlayToggle 单测: 渲染开关 / 档位 + 选中态 + onChange。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrossFrameOverlayToggle } from "./CrossFrameOverlayToggle";

describe("CrossFrameOverlayToggle", () => {
  it("渲染独立开关与档位 (1/3/5/7), 并标记当前选中", () => {
    render(
      <CrossFrameOverlayToggle
        enabled={true}
        onEnabledChange={() => {}}
        value={3}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "开" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "7" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("点击某段触发 onChange 对应 K", () => {
    const onChange = vi.fn();
    render(
      <CrossFrameOverlayToggle
        enabled={true}
        onEnabledChange={() => {}}
        value={1}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("点击开关触发 onEnabledChange", () => {
    const onEnabledChange = vi.fn();
    render(
      <CrossFrameOverlayToggle
        enabled={false}
        onEnabledChange={onEnabledChange}
        value={1}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "关" }));
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });
});
