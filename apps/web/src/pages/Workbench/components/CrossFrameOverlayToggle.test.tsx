/**
 * v0.14.1 · CrossFrameOverlayToggle 单测: 渲染 4 段 + 选中态 + onChange。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrossFrameOverlayToggle } from "./CrossFrameOverlayToggle";

describe("CrossFrameOverlayToggle", () => {
  it("渲染 4 段 (关/1/3/5) 并标记当前选中", () => {
    render(<CrossFrameOverlayToggle value={3} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "关" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("点击某段触发 onChange 对应 K", () => {
    const onChange = vi.fn();
    render(<CrossFrameOverlayToggle value={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
