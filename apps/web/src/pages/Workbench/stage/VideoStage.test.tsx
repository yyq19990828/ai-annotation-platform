import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { VideoStage } from "./VideoStage";
import type { AnnotationResponse, TaskVideoManifestResponse } from "@/types";

const manifest: TaskVideoManifestResponse = {
  task_id: "task-1",
  video_url: "http://storage.local/video.mp4",
  poster_url: "http://storage.local/poster.webp",
  expires_in: 3600,
  metadata: {
    duration_ms: 1000,
    fps: 10,
    frame_count: 10,
    width: 1000,
    height: 500,
    codec: "h264",
    poster_frame_path: "poster.webp",
    probe_error: null,
    poster_error: null,
  },
};

function setRect(el: Element) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 500,
    right: 1000,
    bottom: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function pointer(type: string, clientX: number, clientY: number) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
}

describe("VideoStage", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn() });
  });

  it("draws a bbox on the current frame while paused", () => {
    const onCreate = vi.fn();
    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={onCreate}
        onUpdate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    fireEvent(overlay, pointer("pointerdown", 100, 100));
    fireEvent(overlay, pointer("pointermove", 400, 250));
    fireEvent(overlay, pointer("pointerup", 400, 250));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [frame, geom] = onCreate.mock.calls[0];
    expect(frame).toBe(0);
    expect(geom.x).toBeCloseTo(0.1);
    expect(geom.y).toBeCloseTo(0.2);
    expect(geom.w).toBeCloseTo(0.3);
    expect(geom.h).toBeCloseTo(0.3);
  });

  it("renders only annotations from the selected frame", () => {
    const annotations = [
      {
        id: "a1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
      {
        id: "a2",
        class_name: "person",
        geometry: { type: "video_bbox", frame_index: 3, x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(getByTestId("video-overlay").textContent).toContain("car");
    expect(getByTestId("video-overlay").textContent).not.toContain("person");
  });

  it("adds a keyframe to the selected video track", () => {
    const onUpdate = vi.fn();
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByTestId, getByLabelText } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "3" } });
    fireEvent(overlay, pointer("pointerdown", 200, 100));
    fireEvent(overlay, pointer("pointermove", 500, 250));
    fireEvent(overlay, pointer("pointerup", 500, 250));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, geometry] = onUpdate.mock.calls[0];
    expect(geometry.type).toBe("video_track");
    expect(geometry.keyframes).toHaveLength(2);
    expect(geometry.keyframes[1].frame_index).toBe(3);
    expect(geometry.keyframes[1].bbox.x).toBeCloseTo(0.2);
  });

  it("renders interpolated track boxes between keyframes", () => {
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 2, bbox: { x: 0.3, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByLabelText, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "1" } });

    expect(getByTestId("video-overlay").textContent).toContain("car · 插值");
  });

  it("does not interpolate across an absent keyframe", () => {
    const annotations = [
      {
        id: "t1",
        class_name: "car",
        geometry: {
          type: "video_track",
          track_id: "trk_car",
          keyframes: [
            { frame_index: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
            { frame_index: 1, bbox: { x: 0.2, y: 0.1, w: 0.2, h: 0.2 }, source: "manual", absent: true },
            { frame_index: 2, bbox: { x: 0.3, y: 0.1, w: 0.2, h: 0.2 }, source: "manual" },
          ],
        },
      },
    ] as AnnotationResponse[];

    const { getByLabelText, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "1" } });

    expect(getByTestId("video-overlay").textContent).not.toContain("car");
  });
});
