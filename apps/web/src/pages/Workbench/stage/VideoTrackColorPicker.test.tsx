import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TRACK_COLOR_PALETTE } from "./colors";
import { VideoTrackColorPicker } from "./VideoTrackColorPicker";

describe("VideoTrackColorPicker", () => {
  it("renders every palette swatch and emits the picked color", () => {
    const onPick = vi.fn();
    const { getByLabelText } = render(
      <VideoTrackColorPicker
        currentColor={TRACK_COLOR_PALETTE[0].value}
        hasOverride={false}
        onPick={onPick}
        onReset={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(getByLabelText(TRACK_COLOR_PALETTE[1].label));
    expect(onPick).toHaveBeenCalledWith(TRACK_COLOR_PALETTE[1].value);
  });

  it("shows reset only when an override exists and emits onReset", () => {
    const onReset = vi.fn();
    const { queryByText, rerender, getByText } = render(
      <VideoTrackColorPicker
        currentColor={TRACK_COLOR_PALETTE[0].value}
        hasOverride={false}
        onPick={() => {}}
        onReset={onReset}
        onClose={() => {}}
      />,
    );
    expect(queryByText("恢复默认")).toBeNull();

    rerender(
      <VideoTrackColorPicker
        currentColor={TRACK_COLOR_PALETTE[0].value}
        hasOverride
        onPick={() => {}}
        onReset={onReset}
        onClose={() => {}}
      />,
    );
    fireEvent.click(getByText("恢复默认"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <VideoTrackColorPicker
        currentColor={TRACK_COLOR_PALETTE[0].value}
        hasOverride={false}
        onPick={() => {}}
        onReset={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
