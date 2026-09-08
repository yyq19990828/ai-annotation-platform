import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextToolbar } from "./ContextToolbar";

// A second, non-Mask consumer verifies the shell has no editing or persistence assumptions.
describe("ContextToolbar", () => {
  it("derives the opening transform from the actual capsule and panel rectangles", async () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === "geometry-tool-capsule") return new DOMRect(10, 20, 100, 40);
        if (this.hasAttribute("data-radix-popper-content-wrapper"))
          return new DOMRect(300, 20, 600, 120);
        return new DOMRect();
      });
    try {
      const user = userEvent.setup();
      render(
        <ContextToolbar
          id="geometry"
          label="几何"
          summary="◇"
          summaryLabel="几何工具"
          quickActions={[]}
        >
          {() => <p>完整工具栏</p>}
        </ContextToolbar>,
      );
      await user.click(screen.getByRole("button", { name: "几何工具" }));
      await user.click(screen.getByRole("button", { name: "更多 几何 工具" }));
      const panel = screen.getByTestId("geometry-toolbar");
      await waitFor(() => expect(panel).toHaveAttribute("data-motion-ready", "true"));
      expect(panel.style.getPropertyValue("--toolbar-from")).toBe(
        "translate(-290px, 0px) scale(0.16666666666666666, 0.3333333333333333)",
      );
    } finally {
      rect.mockRestore();
    }
  });

  it("dispatches supplied actions and preserves owner content across close/reopen", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    render(
      <ContextToolbar
        id="sample"
        label="示例"
        summary="◇"
        summaryLabel="示例常用工具"
        quickActions={[{ id: "pick", label: "点选", icon: "·", onSelect: choose }]}
      >
        {(close) => (
          <>
            <p>工具提供的内容</p>
            <button onClick={close}>收起</button>
          </>
        )}
      </ContextToolbar>,
    );
    const summary = screen.getByRole("button", { name: "示例常用工具" });
    await user.click(summary);
    await user.click(screen.getByRole("button", { name: "点选" }));
    expect(choose).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "更多 示例 工具" }));
    expect(screen.getByText("工具提供的内容")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "收起" }));
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(summary);
    await user.click(screen.getByRole("button", { name: "更多 示例 工具" }));
    expect(screen.getByText("工具提供的内容")).toBeVisible();
  });
});
