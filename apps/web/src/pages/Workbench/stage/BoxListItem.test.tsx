import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoxListItem } from "./BoxListItem";
import type { Annotation } from "@/types";

const base: Annotation = {
  id: "a1",
  cls: "car",
  conf: 1,
  source: "manual",
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.4,
};

describe("BoxListItem", () => {
  it("shows bbox tool metadata", () => {
    const b: Annotation = {
      ...base,
      annotation_type: "bbox",
      geometry: { type: "bbox", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    };
    const { getByText } = render(
      <BoxListItem
        b={b}
        selected={false}
        imageWidth={1000}
        imageHeight={500}
        onSelect={vi.fn()}
      />,
    );

    expect(getByText("矩形框")).toBeInTheDocument();
    expect(getByText("(100, 100) · 300×200")).toBeInTheDocument();
  });

  it("shows track-specific metadata", () => {
    const b: Annotation = {
      ...base,
      annotation_type: "video_track",
      geometry: {
        type: "video_track",
        track_id: "trk_abcdefgh12345678",
        keyframes: [
          { frame_index: 0, bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, source: "manual" },
          { frame_index: 10, bbox: { x: 0.3, y: 0.2, w: 0.3, h: 0.4 }, source: "manual", occluded: true },
          { frame_index: 12, bbox: { x: 0.3, y: 0.2, w: 0.3, h: 0.4 }, source: "manual", absent: true },
        ],
      },
    };
    const { getByText } = render(
      <BoxListItem
        b={b}
        selected={false}
        imageWidth={1000}
        imageHeight={500}
        onSelect={vi.fn()}
      />,
    );

    expect(getByText("轨迹")).toBeInTheDocument();
    expect(getByText(/3 关键帧/)).toHaveTextContent("F0-F12");
    expect(getByText(/3 关键帧/)).toHaveTextContent("1 消失");
    expect(getByText(/3 关键帧/)).toHaveTextContent("1 遮挡");
  });
});
