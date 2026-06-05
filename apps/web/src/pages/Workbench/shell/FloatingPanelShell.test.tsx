import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloatingPanelShell } from "./FloatingPanelShell";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

describe("FloatingPanelShell", () => {
  it("drags by the header and clamps inside the viewport", async () => {
    setViewport(800, 800);
    const onPositionChange = vi.fn();
    render(
      <FloatingPanelShell
        title="浮窗"
        position={{ x: 100, y: 100, w: 300, h: 300 }}
        onPositionChange={onPositionChange}
        minSize={{ w: 200, h: 240 }}
        maxSize={{ w: 720, h: 900 }}
      >
        <div>content</div>
      </FloatingPanelShell>,
    );

    const header = screen.getByText("浮窗").parentElement?.parentElement as HTMLElement;
    fireEvent(
      header,
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 120,
        clientY: 130,
      }),
    );
    await act(async () => {});
    fireEvent(
      window,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 760,
        clientY: 760,
      }),
    );
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));

    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 476, y: 476 });
  });

  it("clamps dragging inside custom bounds", async () => {
    setViewport(900, 900);
    const onPositionChange = vi.fn();
    render(
      <FloatingPanelShell
        title="浮窗"
        position={{ x: 100, y: 100, w: 200, h: 200 }}
        onPositionChange={onPositionChange}
        minSize={{ w: 200, h: 200 }}
        maxSize={{ w: 500, h: 500 }}
        bounds={{ left: 50, top: 60, right: 450, bottom: 460 }}
      >
        <div>content</div>
      </FloatingPanelShell>,
    );

    const header = screen.getByText("浮窗").parentElement?.parentElement as HTMLElement;
    fireEvent(
      header,
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 120,
        clientY: 130,
      }),
    );
    await act(async () => {});
    fireEvent(
      window,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 760,
        clientY: 760,
      }),
    );
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));

    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 250, y: 260 });
  });

  it("resizes from the bottom-right handle", async () => {
    setViewport(900, 900);
    const onPositionChange = vi.fn();
    render(
      <FloatingPanelShell
        title="浮窗"
        position={{ x: 100, y: 100, w: 300, h: 320 }}
        onPositionChange={onPositionChange}
        minSize={{ w: 200, h: 240 }}
        maxSize={{ w: 720, h: 900 }}
      >
        <div>content</div>
      </FloatingPanelShell>,
    );

    fireEvent(
      screen.getByLabelText("调整浮窗尺寸"),
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 400,
        clientY: 420,
      }),
    );
    await act(async () => {});
    fireEvent(
      window,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 480,
        clientY: 500,
      }),
    );
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));

    expect(onPositionChange).toHaveBeenLastCalledWith({ w: 380, h: 400 });
  });

  it("runs header actions without starting a drag", async () => {
    setViewport(900, 900);
    const onPositionChange = vi.fn();
    const onCollapse = vi.fn();
    const onMergeBack = vi.fn();
    const onClose = vi.fn();
    render(
      <FloatingPanelShell
        title="浮窗"
        position={{ x: 100, y: 100, w: 300, h: 320 }}
        onPositionChange={onPositionChange}
        onCollapse={onCollapse}
        onMergeBack={onMergeBack}
        onClose={onClose}
        minSize={{ w: 200, h: 240 }}
        maxSize={{ w: 720, h: 900 }}
      >
        <div>content</div>
      </FloatingPanelShell>,
    );

    const mergeButton = screen.getByLabelText("合并回侧栏");
    fireEvent(
      mergeButton,
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 280,
        clientY: 112,
      }),
    );
    await act(async () => {});
    fireEvent(
      window,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 500,
        clientY: 500,
      }),
    );
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));

    expect(onPositionChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("收起浮窗"));
    fireEvent.click(mergeButton);
    fireEvent.click(screen.getByLabelText("关闭浮窗"));

    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onMergeBack).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clamps size after viewport resize", () => {
    setViewport(900, 900);
    const onPositionChange = vi.fn();
    render(
      <FloatingPanelShell
        title="浮窗"
        position={{ x: 24, y: 24, w: 720, h: 800 }}
        onPositionChange={onPositionChange}
        minSize={{ w: 200, h: 240 }}
        maxSize={{ w: 720, h: 900 }}
      >
        <div>content</div>
      </FloatingPanelShell>,
    );

    setViewport(500, 500);
    fireEvent.resize(window);

    expect(onPositionChange).toHaveBeenLastCalledWith({ w: 452, h: 452 });
  });
});
