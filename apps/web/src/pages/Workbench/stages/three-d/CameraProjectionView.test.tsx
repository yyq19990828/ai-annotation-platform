import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CameraProjectionView } from "./CameraProjectionView";

describe("CameraProjectionView frame loading", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides the previous frame image and overlay until the new URL loads", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const view = render(
      <CameraProjectionView
        name="front"
        imageUrl="/frame-0.jpg"
        boxes={[]}
        highlightedIds={new Set()}
        onSelectBox={vi.fn()}
      />,
    );
    const image = screen.getByRole("img", { name: "front" });
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 640 },
      naturalHeight: { configurable: true, value: 480 },
    });
    fireEvent.load(image);
    expect(image.className).not.toContain("opacity-0");

    view.rerender(
      <CameraProjectionView
        name="front"
        imageUrl="/frame-1.jpg"
        boxes={[]}
        highlightedIds={new Set()}
        onSelectBox={vi.fn()}
      />,
    );

    expect(image.className).toContain("opacity-0");
    expect(screen.getByText("加载相机…")).toBeTruthy();
    expect(screen.getByLabelText("front 相机投影").className).toContain("pointer-events-none");
  });

  it("expands the image together with its positioning container", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    render(
      <CameraProjectionView
        name="front"
        imageUrl="/frame-0.jpg"
        boxes={[]}
        highlightedIds={new Set()}
        onSelectBox={vi.fn()}
        expanded
      />,
    );

    const image = screen.getByRole("img", { name: "front" });
    const view = image.parentElement;
    expect(image.className).toContain("h-[70vh]");
    expect(image.className).toContain("max-w-full");
    expect(image.className).not.toContain("w-[190px]");
    expect(view?.className).toContain("w-fit");
    expect(view?.className).toContain("max-w-full");
    expect(view?.className).not.toContain("w-[190px]");
  });
});
