import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageWorkbench, type ImageWorkbenchProps } from "./ImageWorkbench";

vi.mock("../../stage/ImageStage", () => ({
  ImageStage: ({ overlay }: { overlay?: React.ReactNode }) => <div>{overlay}</div>,
}));
vi.mock("../../shell/FloatingDock", () => ({
  FloatingDock: ({ onZoomOut }: { onZoomOut: () => void }) => (
    <button data-testid="floating-dock" onClick={onZoomOut}>
      缩小
    </button>
  ),
}));
vi.mock("../../stage/Minimap", () => ({
  Minimap: ({ bottom }: { bottom?: number }) => (
    <div data-testid="image-minimap" data-bottom={bottom} />
  ),
}));
vi.mock("../../state/useWorkbenchConfig", () => ({
  useWorkbenchConfig: () => ({ config: { common: { focusSelectionEnabled: false } } }),
}));

describe("ImageWorkbench", () => {
  it("缩略导航避让右下角缩放工具条", () => {
    const props = {
      rasterMaskRecords: [],
      rasterMaskStatusById: new Map(),
      userBoxes: [],
      aiBoxes: [],
      selectedId: null,
      imageSource: null,
      fileUrl: null,
      thumbnailUrl: null,
      vp: { scale: 1, tx: 0, ty: 0 },
      setVp: vi.fn(),
      stageGeom: { imgW: 21_600, imgH: 10_800, vpSize: { w: 1_200, h: 800 } },
    } as unknown as ImageWorkbenchProps;

    render(<ImageWorkbench {...props} />);

    expect(screen.getByTestId("floating-dock")).toBeTruthy();
    expect(screen.getByTestId("image-minimap").getAttribute("data-bottom")).toBe("64");
  });

  it("大图从 20% 以下继续缩小时不会反向跳到 20%", () => {
    const setVp = vi.fn();
    const props = {
      rasterMaskRecords: [],
      rasterMaskStatusById: new Map(),
      userBoxes: [],
      aiBoxes: [],
      selectedId: null,
      imageSource: null,
      fileUrl: null,
      thumbnailUrl: null,
      vp: { scale: 0.06, tx: 0, ty: 0 },
      setVp,
      stageGeom: { imgW: 21_600, imgH: 10_800, vpSize: { w: 1_200, h: 800 } },
    } as unknown as ImageWorkbenchProps;

    render(<ImageWorkbench {...props} />);
    fireEvent.click(screen.getByTestId("floating-dock"));

    const updateViewport = setVp.mock.calls[0]?.[0] as (
      current: ImageWorkbenchProps["vp"],
    ) => ImageWorkbenchProps["vp"];
    const next = updateViewport(props.vp);
    expect(next.scale).toBeCloseTo(1200 / 21_600);
    expect(next.scale).toBeLessThan(0.2);
  });
});
