import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "./ResizeHandle";

describe("ResizeHandle", () => {
  it("expands a top-attached panel when dragged upward", () => {
    const onResize = vi.fn();
    render(<ResizeHandle side="top" width={220} onResize={onResize} min={112} max={420} />);

    fireEvent.mouseDown(screen.getByRole("separator"), { clientY: 300 });
    fireEvent.mouseMove(document, { clientY: 260 });
    fireEvent.mouseUp(document);

    expect(onResize).toHaveBeenLastCalledWith(260);
  });

  it("keeps the existing right-attached width drag direction", () => {
    const onResize = vi.fn();
    render(<ResizeHandle side="right" width={260} onResize={onResize} min={200} max={560} />);

    fireEvent.mouseDown(screen.getByRole("separator"), { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    fireEvent.mouseUp(document);

    expect(onResize).toHaveBeenLastCalledWith(310);
  });
});
