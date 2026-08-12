import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiBox } from "../state/transforms";
import { VideoKonvaAiLayer } from "./VideoKonvaAiLayer";

function candidate(id: string, shape: "polygon" | "polyline" | "mask"): AiBox {
  return {
    id,
    cls: "car",
    conf: 0.9,
    x: 0.1,
    y: 0.1,
    w: 0.3,
    h: 0.3,
    predictionId: "prediction-1",
    shapeIndex: 0,
    predictionSource: "external_import",
    source: "prediction_based",
    ...(shape === "polygon"
      ? {
          polygon: [
            [0.1, 0.1],
            [0.4, 0.1],
            [0.3, 0.4],
          ],
        }
      : shape === "polyline"
        ? {
            polyline: [
              [0.1, 0.1],
              [0.4, 0.4],
            ],
          }
        : { geometry: { type: "video_track_mask" } }),
  } as unknown as AiBox;
}

describe("VideoKonvaAiLayer", () => {
  it("renders polygon closed, polyline open, and leaves mask pixels to the mask layer", () => {
    const onSelect = vi.fn();
    render(
      <VideoKonvaAiLayer
        boxes={[
          candidate("polygon", "polygon"),
          candidate("polyline", "polyline"),
          candidate("mask", "mask"),
        ]}
        size={{ w: 100, h: 50 }}
        scale={1}
        selectedId={null}
        listening
        onSelect={onSelect}
      />,
    );

    const lines = document.querySelectorAll('[data-konva="Line"]');
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute("data-closed")).toBe("true");
    expect(lines[1].getAttribute("data-closed")).toBe("false");
    expect(document.querySelector('[data-konva="Rect"]')).toBeNull();
    fireEvent.pointerDown(lines[1]);
    expect(onSelect).toHaveBeenCalledWith("polyline");
  });
});
