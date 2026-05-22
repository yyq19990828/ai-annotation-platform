import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoTrackComposeDialog } from "./VideoTrackComposeDialog";

describe("VideoTrackComposeDialog", () => {
  it("renders nothing when closed", () => {
    const { queryByTestId } = render(
      <VideoTrackComposeDialog open={false} onCancel={() => {}} onSubmit={() => {}} />,
    );
    expect(queryByTestId("video-track-compose-dialog")).toBeNull();
  });

  it("submits the default gap mode (interpolate)", () => {
    const onSubmit = vi.fn();
    const { getByText } = render(
      <VideoTrackComposeDialog open onCancel={() => {}} onSubmit={onSubmit} />,
    );
    fireEvent.click(getByText("跳连"));
    expect(onSubmit).toHaveBeenCalledWith("interpolate");
  });

  it("submits the selected gap mode (outside)", () => {
    const onSubmit = vi.fn();
    const { getByText, getByDisplayValue } = render(
      <VideoTrackComposeDialog open onCancel={() => {}} onSubmit={onSubmit} />,
    );
    fireEvent.click(getByDisplayValue("outside"));
    fireEvent.click(getByText("跳连"));
    expect(onSubmit).toHaveBeenCalledWith("outside");
  });

  it("cancels via the close button", () => {
    const onCancel = vi.fn();
    const { getByText } = render(
      <VideoTrackComposeDialog open onCancel={onCancel} onSubmit={() => {}} />,
    );
    fireEvent.click(getByText("取消"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
