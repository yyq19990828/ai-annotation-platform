import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoTrackContextBar, type VideoTrackContextBarProps } from "./VideoTrackContextBar";

function props(overrides: Partial<VideoTrackContextBarProps> = {}): VideoTrackContextBarProps {
  return {
    frameIndex: 12,
    track: {
      className: "车辆",
      shortId: "#7",
      color: "#245b86",
      locked: false,
      hidden: false,
      readOnly: false,
    },
    context: {
      state: "keyframe",
      source: "manual",
      sourceFrame: 12,
      occluded: false,
      previousFrame: 0,
      nextFrame: 31,
    },
    onSeekFrame: vi.fn(),
    actions: [{ id: "add-keyframe", label: "补关键帧", onClick: vi.fn() }],
    ...overrides,
  };
}

describe("VideoTrackContextBar", () => {
  it.each([
    ["keyframe", "manual", "关键帧", "人工"],
    ["interpolated", "interpolated", "插值帧", "插值记录"],
    ["held", "prediction", "保持帧", "AI预测"],
    ["outside", "unknown", "outside", "来源未知"],
    ["unavailable", "unknown", "本帧无几何", "来源未知"],
  ] as const)(
    "shows %s and its supplied provenance without losing track identity",
    (state, source, stateLabel, sourceLabel) => {
      const initial = props();
      render(
        <VideoTrackContextBar
          {...initial}
          frameIndex={0}
          context={{ ...initial.context!, state, source, sourceFrame: 0 }}
        />,
      );
      expect(screen.getByText("车辆")).toBeVisible();
      expect(screen.getByText("#7")).toBeVisible();
      expect(screen.getByTestId("video-track-context-frame")).toHaveTextContent("源帧 F0");
      expect(screen.getByTestId("video-track-context-state")).toHaveAttribute("data-state", state);
      expect(screen.getByTestId("video-track-context-state")).toHaveTextContent(stateLabel);
      expect(screen.getByTestId("video-track-context-source")).toHaveTextContent(sourceLabel);
      if (state === "held") {
        expect(screen.getByTestId("video-track-context-source")).toHaveTextContent("保持自 F0");
      } else {
        expect(screen.queryByText(/保持自/)).toBeNull();
      }
    },
  );

  it("seeks to the supplied neighboring frames, including frame zero", () => {
    const initial = props();
    const { rerender } = render(<VideoTrackContextBar {...initial} />);
    expect(screen.getByRole("button", { name: "上一关键帧" })).toHaveTextContent("F0");
    expect(screen.getByRole("button", { name: "下一关键帧" })).toHaveTextContent("F31");
    fireEvent.click(screen.getByRole("button", { name: "上一关键帧" }));
    fireEvent.click(screen.getByRole("button", { name: "下一关键帧" }));
    expect(initial.onSeekFrame).toHaveBeenNthCalledWith(1, 0);
    expect(initial.onSeekFrame).toHaveBeenNthCalledWith(2, 31);
    rerender(
      <VideoTrackContextBar
        {...initial}
        context={{ ...initial.context!, previousFrame: null, nextFrame: null }}
      />,
    );
    expect(screen.getByRole("button", { name: "上一关键帧" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一关键帧" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一关键帧" }));
    fireEvent.click(screen.getByRole("button", { name: "下一关键帧" }));
    expect(initial.onSeekFrame).toHaveBeenCalledTimes(2);
  });

  it.each(["locked", "readOnly"] as const)(
    "hides supplied write actions when %s while preserving navigation",
    (flag) => {
      const initial = props();
      const { rerender } = render(<VideoTrackContextBar {...initial} />);
      fireEvent.click(screen.getByRole("button", { name: "补关键帧" }));
      expect(initial.actions![0].onClick).toHaveBeenCalledTimes(1);
      rerender(<VideoTrackContextBar {...initial} track={{ ...initial.track!, [flag]: true }} />);
      expect(screen.queryByRole("button", { name: "补关键帧" })).toBeNull();
      expect(screen.getByText(flag === "locked" ? "已锁定" : "只读")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "下一关键帧" }));
      expect(initial.onSeekFrame).toHaveBeenCalledWith(31);
      expect(initial.actions![0].onClick).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps occlusion and visibility distinct from the current frame state", () => {
    const initial = props();
    render(
      <VideoTrackContextBar
        {...initial}
        track={{ ...initial.track!, hidden: true }}
        context={{ ...initial.context!, state: "outside", source: "unknown", occluded: true }}
      />,
    );
    expect(screen.getByTestId("video-track-context-state")).toHaveTextContent("outside");
    expect(screen.getByText("遮挡")).toBeVisible();
    expect(screen.getByText("已隐藏")).toBeVisible();
    expect(screen.getByTestId("video-track-context-source")).toHaveTextContent("来源未知");
  });

  it("retains the selected identity with unavailable geometry and unknown provenance", () => {
    render(<VideoTrackContextBar {...props({ context: null })} />);
    expect(screen.getByText("车辆")).toBeVisible();
    expect(screen.getByTestId("video-track-context-state")).toHaveTextContent("本帧无几何");
    expect(screen.getByTestId("video-track-context-source")).toHaveTextContent("来源未知");
    expect(screen.getByRole("button", { name: "上一关键帧" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一关键帧" })).toBeDisabled();
  });

  it("shows the no-selection prompt without stale context, actions or sticky ownership", () => {
    render(
      <VideoTrackContextBar
        {...props({
          track: null,
          stickyHint: { label: "#7 车辆", hasKeyframeAtFrame: false },
        })}
      />,
    );
    expect(screen.getByText("选择轨迹查看当前帧状态")).toBeVisible();
    expect(screen.getByTestId("video-track-context-frame")).toHaveTextContent("F12");
    expect(screen.queryByTestId("video-track-context-state")).toBeNull();
    expect(screen.queryByTestId("video-track-context-source")).toBeNull();
    expect(screen.queryByTestId("video-sticky-track-hint")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("embeds the existing sticky hint and updates its controlled keyframe wording", () => {
    const initial = props({ stickyHint: { label: "#7 车辆", hasKeyframeAtFrame: false } });
    const { rerender } = render(<VideoTrackContextBar {...initial} />);
    const hint = within(screen.getByTestId("video-track-context-bar")).getByTestId(
      "video-sticky-track-hint",
    );
    expect(hint).toHaveTextContent("正在延展轨迹 #7 车辆");
    expect(hint).toHaveTextContent("画框延展到本帧");
    expect(hint).toHaveTextContent("换帧画框继续 · Esc 结束");
    expect(hint).not.toHaveClass("absolute");
    rerender(
      <VideoTrackContextBar
        {...initial}
        stickyHint={{ label: "#7 车辆", hasKeyframeAtFrame: true }}
      />,
    );
    expect(hint).toHaveTextContent("本帧已有关键帧, 画框新建物体");
  });

  it("displays only supplied shortcuts and leaves K with its existing owner", () => {
    const initial = props({ shortcuts: [{ key: "K", label: "暂停" }] });
    const { rerender } = render(<VideoTrackContextBar {...initial} />);
    expect(screen.getByText("K")).toBeVisible();
    expect(screen.getByText("暂停")).toBeVisible();
    fireEvent.keyDown(screen.getByTestId("video-track-context-bar"), { key: "k" });
    expect(initial.actions![0].onClick).not.toHaveBeenCalled();
    expect(initial.onSeekFrame).not.toHaveBeenCalled();
    rerender(<VideoTrackContextBar {...initial} shortcuts={[]} />);
    expect(screen.queryByText("K")).toBeNull();
  });

  it("keeps button input on the local marker and stops canvas pointer handlers", () => {
    const initial = props();
    const canvasPointerDown = vi.fn();
    const canvasMouseDown = vi.fn();
    const canvasClick = vi.fn();
    render(
      <div onPointerDown={canvasPointerDown} onMouseDown={canvasMouseDown} onClick={canvasClick}>
        <VideoTrackContextBar {...initial} />
      </div>,
    );
    const button = screen.getByRole("button", { name: "下一关键帧" });
    const marker = button.closest("[data-workbench-track-context]");
    expect(marker).not.toBeNull();
    const capturedPath = vi.fn((event: KeyboardEvent) => event.composedPath());
    window.addEventListener("keydown", capturedPath, true);
    try {
      button.focus();
      expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
      expect(capturedPath.mock.results[0].value).toContain(marker);
      fireEvent.keyDown(document.body, { key: "k" });
      expect(capturedPath.mock.results[1].value).not.toContain(marker);
      fireEvent.pointerDown(button);
      fireEvent.mouseDown(button);
      fireEvent.click(button);
      expect(initial.onSeekFrame).toHaveBeenCalledOnce();
      expect(canvasPointerDown).not.toHaveBeenCalled();
      expect(canvasMouseDown).not.toHaveBeenCalled();
      expect(canvasClick).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", capturedPath, true);
    }
  });
});
