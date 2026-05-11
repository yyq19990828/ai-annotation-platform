import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VideoStage, type VideoStageControls } from "./VideoStage";
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
    playback_path: null,
    playback_codec: null,
    playback_error: null,
    poster_frame_path: "poster.webp",
    probe_error: null,
    poster_error: null,
  },
};

const playMock = vi.fn();
const pauseMock = vi.fn();

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
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pauseMock });
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: playMock });
  });

  beforeEach(() => {
    playMock.mockClear();
    pauseMock.mockClear();
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

  it("toggles playback when clicking the video surface without drawing", () => {
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
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    fireEvent(overlay, pointer("pointerdown", 100, 100));
    fireEvent(overlay, pointer("pointerup", 100, 100));

    expect(playMock).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows playback errors when the browser rejects the video source", async () => {
    playMock.mockRejectedValueOnce(new Error("The element has no supported sources."));
    const { getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    fireEvent.click(getByTitle("播放 / 暂停 (Space)"));

    expect(await screen.findByTestId("video-playback-error")).toHaveTextContent("no supported sources");
  });

  it("exposes playback and frame seeking through ref controls", async () => {
    const ref = createRef<VideoStageControls>();
    const { getByLabelText } = render(
      <VideoStage
        ref={ref}
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    await act(async () => {
      ref.current?.togglePlayback();
    });
    expect(playMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      ref.current?.seekByFrames(3);
    });
    expect(pauseMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByLabelText("视频帧时间轴")).toHaveValue("3"));
  });

  it("renders playback controls as a floating overlay and hides it while editing", () => {
    const { getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    const playbackOverlay = getByTestId("video-playback-overlay");
    setRect(overlay);

    expect(playbackOverlay).toHaveStyle({ opacity: "1" });

    fireEvent(overlay, pointer("pointerdown", 100, 100));

    expect(playbackOverlay).toHaveStyle({ opacity: "0" });
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
      />,
    );

    expect(getByTestId("video-overlay").textContent).toContain("car");
    expect(getByTestId("video-overlay").textContent).not.toContain("person");
  });

  it("renders visible screen-pixel strokes for current frame boxes", () => {
    const annotations = [
      {
        id: "a1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const { container } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    const rect = container.querySelector("svg rect");
    expect(rect?.getAttribute("stroke-width")).toBe("2");
    expect(rect?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
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
        videoTool="track"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
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

  it("shows a nearest-keyframe ghost for selected tracks on empty frames", () => {
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

    const { getByLabelText, getByTestId, getByText } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
      />,
    );

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "3" } });

    expect(getByTestId("video-track-ghost").textContent).toContain("car · 参考 F0");

    fireEvent.click(getByText("复制到当前帧"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, geometry] = onUpdate.mock.calls[0];
    expect(geometry.type).toBe("video_track");
    expect(geometry.keyframes).toHaveLength(2);
    expect(geometry.keyframes[1].frame_index).toBe(3);
    expect(geometry.keyframes[1].bbox.x).toBeCloseTo(0.1);
  });

  it("drags the selected-track ghost into a current-frame keyframe", () => {
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

    const { getByLabelText, getByTestId } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={onUpdate}
        onRename={() => {}}
      />,
    );
    const overlay = getByTestId("video-overlay");
    setRect(overlay);

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "3" } });
    const ghostRect = getByTestId("video-track-ghost").querySelector("rect");
    expect(ghostRect).not.toBeNull();

    fireEvent(ghostRect!, pointer("pointerdown", 100, 50));
    fireEvent(overlay, pointer("pointermove", 200, 150));
    fireEvent(overlay, pointer("pointerup", 200, 150));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, geometry] = onUpdate.mock.calls[0];
    expect(geometry.type).toBe("video_track");
    expect(geometry.keyframes[1].frame_index).toBe(3);
    expect(geometry.keyframes[1].bbox.x).toBeCloseTo(0.2);
    expect(geometry.keyframes[1].bbox.y).toBeCloseTo(0.3);
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
      />,
    );

    fireEvent.change(getByLabelText("视频帧时间轴"), { target: { value: "1" } });

    expect(getByTestId("video-overlay").textContent).not.toContain("car");
  });

  it("does not reset frame or selection when callback references change for the same task", () => {
    const firstSelect = vi.fn();
    const secondSelect = vi.fn();
    const { rerender } = render(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={firstSelect}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(firstSelect).toHaveBeenCalledWith(null);

    rerender(
      <VideoStage
        manifest={manifest}
        annotations={[]}
        selectedId={null}
        activeClass="car"
        onSelect={secondSelect}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );

    expect(secondSelect).not.toHaveBeenCalled();
  });

  it("allows reviewers to select boxes in read-only mode", () => {
    const onSelect = vi.fn();
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

    const { container } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId={null}
        activeClass="car"
        readOnly
        onSelect={onSelect}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
      />,
    );
    onSelect.mockClear();

    const rect = container.querySelector("rect");
    expect(rect).not.toBeNull();
    fireEvent(rect!, pointer("pointerdown", 100, 100));

    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("routes selected object class changes through the class picker flow", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const onChangeUserBoxClass = vi.fn();
    const annotations = [
      {
        id: "b1",
        class_name: "car",
        geometry: { type: "video_bbox", frame_index: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
    ] as AnnotationResponse[];

    const { getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="b1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
        onChangeUserBoxClass={onChangeUserBoxClass}
      />,
    );

    fireEvent.click(getByTitle("修改类别"));

    expect(onChangeUserBoxClass).toHaveBeenCalledWith("b1");
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("routes track row rename through the class picker flow", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const onChangeUserBoxClass = vi.fn();
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

    const { getByTitle } = render(
      <VideoStage
        manifest={manifest}
        annotations={annotations}
        selectedId="t1"
        activeClass="car"
        onSelect={() => {}}
        onCreate={() => {}}
        onUpdate={() => {}}
        onRename={() => {}}
        onChangeUserBoxClass={onChangeUserBoxClass}
      />,
    );

    fireEvent.click(getByTitle("重命名轨迹类别"));

    expect(onChangeUserBoxClass).toHaveBeenCalledWith("t1");
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });
});
