import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolDock } from "./ToolDock";

describe("ToolDock · video tools", () => {
  it("renders video select and creation tools without the retired pan tool", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
      />,
    );

    expect(screen.getByTestId("video-tool-btn-select")).toBeInTheDocument();
    expect(screen.getByTestId("video-tool-btn-box")).toBeInTheDocument();
    expect(screen.getByTestId("video-tool-btn-track")).toBeInTheDocument();
    expect(screen.queryByTestId("video-tool-btn-hand")).toBeNull();
    expect(screen.queryByRole("button", { name: "平移" })).toBeNull();
  });

  it("keeps video select when creation modes are disabled without falling back to hand", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
        videoModes={{ box: false, track: false, polygon: false, polyline: false }}
      />,
    );

    expect(screen.getByTestId("video-tool-btn-select")).toBeInTheDocument();
    expect(screen.queryByTestId("video-tool-btn-box")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-track")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-polygon")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-polyline")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-hand")).toBeNull();
  });
});
