import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloatingDock } from "./FloatingDock";

describe("FloatingDock", () => {
  it("贴在画布容器最右侧，不再为反馈按钮预留额外空档", () => {
    const { container } = render(
      <FloatingDock
        scale={1.49}
        canUndo={false}
        canRedo={false}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        showHistory={false}
      />,
    );

    expect(container.firstElementChild).toHaveClass("right-3");
    expect(container.firstElementChild).not.toHaveClass("right-[76px]");
  });
});
