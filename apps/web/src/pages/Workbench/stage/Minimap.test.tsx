import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Minimap } from "./Minimap";

function setRect(el: Element) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 160,
    height: 80,
    right: 160,
    bottom: 80,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function pointerEvent(type: string, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("Minimap", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses drag navigation with a grab cursor", () => {
    const setVp = vi.fn();
    const { getByTitle } = render(
      <Minimap
        imgW={1000}
        imgH={500}
        vpSize={{ w: 500, h: 250 }}
        vp={{ scale: 2, tx: 0, ty: 0 }}
        setVp={setVp}
        thumbnailUrl="/thumb.jpg"
        fileUrl="/image.jpg"
      />,
    );
    const minimap = getByTitle("缩略图导航：点击跳转视口");
    setRect(minimap);

    expect(minimap).toHaveStyle({ cursor: "grab" });

    fireEvent(minimap, pointerEvent("pointerdown", 80, 40));

    expect(minimap).toHaveStyle({ cursor: "grabbing" });
    expect(setVp).toHaveBeenCalledWith({ scale: 2, tx: -750, ty: -375 });
  });

  it("renders optional video frame and cache range overlays", () => {
    const { getByTestId } = render(
      <Minimap
        imgW={1000}
        imgH={500}
        vpSize={{ w: 500, h: 250 }}
        vp={{ scale: 2, tx: 0, ty: 0 }}
        setVp={() => {}}
        thumbnailUrl="/poster.jpg"
        fileUrl="/video.mp4"
        currentFrameIndex={5}
        maxFrame={10}
        cachedFrameRanges={[{ from: 2, to: 4 }]}
      />,
    );

    expect(getByTestId("minimap-current-frame")).toHaveStyle({ left: "50%" });
    expect(getByTestId("minimap-cached-frame-ranges")).toBeInTheDocument();
  });
});
